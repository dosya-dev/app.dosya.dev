import { describe, it, expect, vi, beforeEach } from 'vitest';

const enqueue = vi.fn();
const enqueueByFolder = vi.fn<(groups: Map<string | null, File[]>, input: unknown) => number>();
const enqueueRejected = vi.fn<(rejected: { file: File; reason: string }[], input: unknown) => void>();
const apiMock = vi.fn<(path: string, init: RequestInit) => Promise<unknown>>();
const toasts: { kind: string; title: string; body?: string }[] = [];

vi.mock('@/lib/upload-runner', () => ({
  enqueue: (...a: unknown[]) => enqueue(...a),
  enqueueByFolder: (...a: [Map<string | null, File[]>, unknown]) => enqueueByFolder(...a),
  enqueueRejected: (...a: [{ file: File; reason: string }[], unknown]) => enqueueRejected(...a),
}));
vi.mock('@/api/client', async (importOriginal) => ({
  // shouldRetryQuery does `error instanceof ApiError` on every retry, and a retry
  // can outlive the test that started it - a mock without it throws and fails the run.
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  api: (path: string, init: RequestInit) => apiMock(path, init),
  apiErrorMessage: (err: unknown, fallback: string) =>
    (err instanceof Error ? err.message : fallback),
}));
vi.mock('@/lib/toast', () => ({
  toast: {
    info: (title: string, body?: string) => toasts.push({ kind: 'info', title, body }),
    error: (title: string, body?: string) => toasts.push({ kind: 'error', title, body }),
    success: (title: string, body?: string) => toasts.push({ kind: 'success', title, body }),
  },
}));

const { uploadTree } = await import('./upload-drop');
const { clearUploadLimitsCache } = await import('./upload-limits');
import type { DroppedTree } from './dropped-entries';

const file = (name: string) => new File(['x'], name);
const input = { workspace_id: 'ws_1', folder_id: null };

const tree = (entries: [string, string][], dirs: string[]): DroppedTree => ({
  entries: entries.map(([path, name]) => ({ path, file: file(name) })),
  dirs,
  hadDirectory: dirs.length > 0,
  skipped: 0,
});

/**
 * Bodies of the POST /api/folders calls, in order.
 *
 * Filtered rather than "every api call": uploadTree also GETs the workspace's
 * upload-limits before it creates anything, and that call has no body at all.
 */
const folderCalls = () =>
  apiMock.mock.calls
    .filter(([path]) => path === '/api/folders')
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));

/** The upload-limits GETs, which every screening path makes exactly once. */
const limitsCalls = () =>
  apiMock.mock.calls.filter(([path]) => path.endsWith('/upload-limits'));

beforeEach(() => {
  enqueue.mockClear();
  enqueueByFolder.mockReset();
  enqueueRejected.mockReset();
  apiMock.mockReset();
  toasts.length = 0;
  // getUploadLimits memoises per workspace for 60s, so without this the first
  // test in the file is the only one that sees the fetch and the rest silently
  // inherit its result - test order would decide what each one exercises.
  clearUploadLimitsCache();
  let n = 0;
  apiMock.mockImplementation(async (path: string) => (
    path.endsWith('/upload-limits')
      // A workspace with no restrictions: every file passes screening, so these
      // tests keep asserting the folder/queue behaviour they were written for.
      ? { ok: true, allowed_extensions: null, blocked_extensions: null, max_file_size_gb: null, storage_remaining_bytes: null }
      : { ok: true, folder: { id: `fld_${++n}` } }
  ));
  enqueueByFolder.mockImplementation((groups) =>
    [...groups.values()].reduce((total, files) => total + files.length, 0));
});

describe('uploadTree', () => {
  it('takes the plain path for loose files, touching no folder API', async () => {
    const res = await uploadTree(tree([['', 'a.txt'], ['', 'b.txt']], []), input);
    // No FOLDER call - which is what this test is named for. The one
    // upload-limits GET is expected: loose files are screened too.
    expect(folderCalls()).toEqual([]);
    expect(limitsCalls()).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ queued: 2, folders: 0, hadDirectory: false });
    expect(toasts[0]).toMatchObject({ kind: 'info', title: 'Uploading 2 files' });
  });

  it('recreates the tree parents-first, then queues each file into its folder', async () => {
    const res = await uploadTree(
      tree([['Photos', 'a.jpg'], ['Photos/2024', 'b.jpg'], ['', 'loose.txt']],
        ['Photos', 'Photos/2024']),
      input,
    );
    expect(folderCalls()).toEqual([
      { workspace_id: 'ws_1', parent_id: null, name: 'Photos' },
      { workspace_id: 'ws_1', parent_id: 'fld_1', name: '2024' },
    ]);
    const groups = enqueueByFolder.mock.calls[0][0];
    expect([...groups.keys()]).toEqual(['fld_1', 'fld_2', null]);
    expect(groups.get('fld_2')?.map((f: File) => f.name)).toEqual(['b.jpg']);
    expect(res).toMatchObject({ queued: 3, folders: 2, skipped: 0 });
  });

  it('creates the tree under the folder being viewed, not the workspace root', async () => {
    await uploadTree(tree([['Photos', 'a.jpg']], ['Photos']), { ...input, folder_id: 'fld_here' });
    expect(folderCalls()[0]).toMatchObject({ parent_id: 'fld_here' });
  });

  it('leaves out files whose folder failed, and says so with the server reason', async () => {
    apiMock.mockImplementation(async (_p: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.name === 'Photos') throw new Error('Folder name "Photos" is too long');
      return { ok: true, folder: { id: 'fld_ok' } };
    });
    const res = await uploadTree(
      tree([['Photos', 'a.jpg'], ['Photos/2024', 'b.jpg'], ['Docs', 'c.pdf']],
        ['Photos', 'Photos/2024', 'Docs']),
      input,
    );
    // The Photos subtree is skipped entirely - not flattened into the root.
    const groups = enqueueByFolder.mock.calls[0][0];
    expect([...groups.values()].flat().map((f: File) => f.name)).toEqual(['c.pdf']);
    expect(res).toMatchObject({ queued: 1, skipped: 2 });
    const err = toasts.find((t) => t.kind === 'error');
    expect(err?.title).toBe('Some folders could not be created');
    expect(err?.body).toContain('is too long');
  });

  it('warns when the drop was capped instead of pretending it uploaded', async () => {
    const t = tree([['Photos', 'a.jpg']], ['Photos']);
    t.skipped = 40;
    const res = await uploadTree(t, input);
    expect(res.skipped).toBe(40);
    expect(toasts.find((x) => x.kind === 'error')?.title).toBe('Too many files in one go');
  });

  // Empty folders nested in a tree are recreated, so a folder that happens to
  // be empty on its own must be too - not silently ignored.
  it('still creates a dropped folder that has no files in it', async () => {
    const res = await uploadTree(tree([], ['Empty', 'Empty/deeper']), input);
    expect(res).toMatchObject({ queued: 0, folders: 2 });
    expect(folderCalls().map((c) => c.name)).toEqual(['Empty', 'deeper']);
    expect(enqueueByFolder).not.toHaveBeenCalled();
    expect(toasts[0]).toMatchObject({ kind: 'info', title: 'Created 2 folders' });
  });

  // The screening wiring, end to end through uploadTree - upload-limits.test.ts
  // covers screenBatch on its own, but not that the drop path actually applies
  // it, nor that it does so BEFORE spending a round trip per folder.
  it('drops files the workspace refuses, and does not build folders for them', async () => {
    apiMock.mockImplementation(async (path: string) => (
      path.endsWith('/upload-limits')
        ? { ok: true, allowed_extensions: null, blocked_extensions: '.exe', max_file_size_gb: null, storage_remaining_bytes: null }
        : { ok: true, folder: { id: 'fld_1' } }
    ));
    const res = await uploadTree(tree([['', 'ok.txt'], ['', 'bad.exe']], []), input);

    expect(res).toMatchObject({ queued: 1 });
    expect(enqueue.mock.calls[0][0].map((f: File) => f.name)).toEqual(['ok.txt']);
    const err = toasts.find((t) => t.kind === 'error');
    expect(err?.title).toBe('1 file left out');
    expect(err?.body).toContain('.exe is not allowed in this workspace');
  });

  it('refuses the whole drop without creating a single folder when nothing passes', async () => {
    apiMock.mockImplementation(async (path: string) => (
      path.endsWith('/upload-limits')
        ? { ok: true, allowed_extensions: '.jpg', blocked_extensions: null, max_file_size_gb: null, storage_remaining_bytes: null }
        : { ok: true, folder: { id: 'fld_1' } }
    ));
    const res = await uploadTree(tree([['Docs', 'a.pdf']], ['Docs']), input);

    // The point of screening first: no folder was created for files that were
    // never going to be accepted.
    expect(folderCalls()).toEqual([]);
    expect(enqueueByFolder).not.toHaveBeenCalled();
    expect(res).toMatchObject({ queued: 0 });
    expect(toasts.find((t) => t.kind === 'error')?.title).toBe('Nothing could be uploaded');
  });

  it('does nothing at all for a drop with neither files nor folders', async () => {
    const res = await uploadTree(tree([], []), input);
    expect(res).toMatchObject({ queued: 0, folders: 0 });
    expect(apiMock).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
  });
});

// F3 (field report): a file the pre-screen refuses used to vanish behind a
// toast. It now lands in the queue as an error row carrying the reason, so it
// can be seen, retried, or removed like any other failure.
describe('uploadTree - pre-screen rejections become error rows', () => {
  it('hands each rejected file and its reason to the runner', async () => {
    apiMock.mockImplementation(async (path: string) => (
      path.endsWith('/upload-limits')
        ? { ok: true, allowed_extensions: null, blocked_extensions: '.exe', max_file_size_gb: null, storage_remaining_bytes: null }
        : { ok: true, folder: { id: 'fld_x' } }
    ));
    await uploadTree(tree([['a.exe', 'a.exe'], ['b.txt', 'b.txt']], []), input);
    expect(enqueueRejected).toHaveBeenCalledTimes(1);
    const [rejected, passedInput] = enqueueRejected.mock.calls[0];
    expect(rejected.map((r) => [r.file.name, r.reason])).toEqual([
      ['a.exe', 'File type .exe is not allowed in this workspace'],
    ]);
    expect(passedInput).toEqual(input);
    // The accepted file still goes through the normal queue.
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('still records error rows when nothing at all was accepted', async () => {
    apiMock.mockImplementation(async (path: string) => (
      path.endsWith('/upload-limits')
        ? { ok: true, allowed_extensions: null, blocked_extensions: '.exe', max_file_size_gb: null, storage_remaining_bytes: null }
        : { ok: true, folder: { id: 'fld_x' } }
    ));
    const r = await uploadTree(tree([['a.exe', 'a.exe']], []), input);
    expect(r.skipped).toBe(1);
    expect(enqueueRejected).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
