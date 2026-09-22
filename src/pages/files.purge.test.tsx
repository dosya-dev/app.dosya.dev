import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const toasts: { kind: string; title: string; body?: string }[] = [];
vi.mock('@/lib/toast', () => ({
  toast: {
    info: (title: string, body?: string) => toasts.push({ kind: 'info', title, body }),
    error: (title: string, body?: string) => toasts.push({ kind: 'error', title, body }),
    success: (title: string, body?: string) => toasts.push({ kind: 'success', title, body }),
  },
}));

const { default: FilesPage } = await import('./files');
const { useWorkspace } = await import('@/stores/workspace');
const { MAX_PURGE_CALLS } = await import('@/lib/folder-purge');
const { ApiError } = await import('@/api/client');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
  toasts.length = 0;
  localStorage.clear();
  document.body.innerHTML = '';
});

const TRASHED_FOLDER = {
  id: 'fld_1', name: 'Archive', created_at: 1_700_000_000, updated_at: 1_700_000_000,
  file_count: 900, lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', is_synced: 0,
  total_size_bytes: 10, content_updated_at: 1_700_000_000, region: null,
  uploader_name: null, share_count: 0, comment_count: 0, origin: null,
  deleted_at: 1_700_000_500, is_trash_root: 1,
};

/** A promise the test resolves by hand, to hold one purge pass open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const TRASHED_FILE = {
  id: 'file_1', name: 'notes.txt', size_bytes: 12, mime_type: 'text/plain', extension: '.txt',
  region: 'ap-southeast-2', created_at: 1_700_000_000, updated_at: 1_700_000_000, current_version: 1,
  lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', uploaded_by: 'u1', uploader_name: 'Me',
  share_count: 0, comment_count: 0, is_synced: 0, origin: 'web', deleted_at: 1_700_000_500,
};

/** DELETEs against the folder, in call order. */
const deleteCalls = () => apiMock.mock.calls.filter(
  ([path, init]) => path === '/api/folders/fld_1' && (init as RequestInit | undefined)?.method === 'DELETE',
);

async function render(onDelete: () => unknown, opts: { withFile?: boolean } = {}) {
  const files = opts.withFile ? [TRASHED_FILE] : [];
  const listing = {
    ok: true, folders: [TRASHED_FOLDER], files, breadcrumbs: [],
    pagination: { page: 1, per_page: 100, total_files: files.length, total_pages: 1 },
  };
  apiMock.mockImplementation((path: unknown, init?: RequestInit) => {
    if (typeof path === 'string' && path.startsWith('/api/cloud/imports')) return Promise.resolve({ ok: true, jobs: [] });
    if (path === '/api/folders/fld_1' && init?.method === 'DELETE') return Promise.resolve(onDelete());
    if (path === '/api/files/file_1' && init?.method === 'DELETE') return Promise.resolve({ ok: true });
    return Promise.resolve(listing);
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/files?filter=deleted']}><FilesPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Right-click the trashed folder, choose "Delete permanently", confirm in the dialog. */
async function purgeViaContextMenu() {
  const row = [...container!.querySelectorAll('div')]
    .find((d) => d.className.includes('cursor-pointer') && d.textContent?.includes('Archive'))!;
  await act(async () => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); });

  // Scoped to the menu portal: the row's own dropdown carries a button with
  // the same label, and the dialog will too.
  const menu = [...document.body.querySelectorAll('div')].find((d) => d.className.includes('z-[9000]'))!;
  expect(menu, 'context menu').toBeTruthy();
  const menuItem = [...menu.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete permanently')!;
  expect(menuItem, 'context menu item').toBeTruthy();
  await act(async () => { menuItem.click(); });

  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog, 'confirm dialog').toBeTruthy();
  const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete permanently')!;
  expect(confirm, 'dialog confirm').toBeTruthy();
  await act(async () => { confirm.click(); });
  await act(async () => { await Promise.resolve(); });
}

// The purge is bounded server-side and idempotent, so an unfinished pass is
// answered with 202 and has to be re-called. Before this the page took the
// first answer as the whole job and told the user a folder was gone while
// most of it was still in the trash.
describe('FilesPage permanent folder purge', () => {
  it('re-calls DELETE until the server says it is complete, and reports the total', async () => {
    const answers = [
      { ok: true, permanent: true, complete: false, remaining: 120, files_affected: 300 },
      { ok: true, permanent: true, complete: true, remaining: 0, files_affected: 120 },
    ];
    let i = 0;
    await render(() => answers[Math.min(i++, answers.length - 1)]);

    await purgeViaContextMenu();

    expect(deleteCalls()).toHaveLength(2);
    const last = toasts.at(-1)!;
    expect(last.kind).toBe('success');
    expect(`${last.title} ${last.body}`).toContain('420');
  });

  it('stops at the cap and says the folder is still emptying', async () => {
    await render(() => ({ ok: true, permanent: true, complete: false, remaining: 5_000, files_affected: 10 }));

    await purgeViaContextMenu();

    expect(deleteCalls()).toHaveLength(MAX_PURGE_CALLS);
    const last = toasts.at(-1)!;
    expect(`${last.title} ${last.body}`.toLowerCase()).toContain('still emptying');
    expect(`${last.title} ${last.body}`.toLowerCase()).toContain('very large');
  });

  // An API that predates the loopable contract answers a bare `{ ok: true }`.
  // Reading a missing flag as "unfinished" would fire fifty deletes at a
  // server that had already finished on the first one.
  it('asks exactly once when the answer carries no completion flag', async () => {
    await render(() => ({ ok: true }));

    await purgeViaContextMenu();

    expect(deleteCalls()).toHaveLength(1);
    expect(toasts.at(-1)?.kind).toBe('success');
  });
});

/** Ctrl-click a row to add it to the bulk selection. */
async function ctrlClickRow(text: string) {
  const row = [...container!.querySelectorAll('div')]
    .find((d) => d.className.includes('cursor-pointer') && d.textContent?.includes(text))!;
  expect(row, `row for ${text}`).toBeTruthy();
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
}

/** The toolbar's bulk "Delete permanently", then the confirm dialog's. */
async function bulkPurge() {
  const toolbarButton = [...container!.querySelectorAll('button')]
    .find((b) => b.textContent?.trim() === 'Delete permanently')!;
  expect(toolbarButton, 'bulk toolbar button').toBeTruthy();
  await act(async () => { toolbarButton.click(); });

  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog, 'bulk confirm dialog').toBeTruthy();
  const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete permanently')!;
  await act(async () => { confirm.click(); });
  await act(async () => { await Promise.resolve(); });
}

// The multi-select purge sends folders through the same bounded loop. Counting
// a 202 as a finished item told the user "1 item permanently deleted" while
// the folder was still half full.
describe('FilesPage bulk permanent purge', () => {
  it('reports a partial outcome when a selected folder is still emptying', async () => {
    await render(
      () => ({ ok: true, permanent: true, complete: false, remaining: 900, files_affected: 10 }),
      { withFile: true },
    );

    await ctrlClickRow('Archive');
    await ctrlClickRow('notes.txt');
    await bulkPurge();

    // The folder was asked the full fifty times; the file took one call.
    expect(deleteCalls()).toHaveLength(MAX_PURGE_CALLS);
    const last = toasts.at(-1)!;
    const text = `${last.title} ${last.body}`;
    expect(last.kind).toBe('info');
    expect(text.toLowerCase()).toContain('still emptying');
    expect(text.toLowerCase()).toContain('very large');
    expect(text).toContain('"Archive"');
    // The file that DID go is still counted, and the folder is not.
    expect(text).toContain('1 item permanently deleted');
    expect(text).not.toContain('2 items permanently deleted');
  });

  it('reports a plain success when every selected folder finishes', async () => {
    const answers = [
      { ok: true, permanent: true, complete: false, remaining: 5, files_affected: 7 },
      { ok: true, permanent: true, complete: true, remaining: 0, files_affected: 5 },
    ];
    let i = 0;
    await render(() => answers[Math.min(i++, answers.length - 1)], { withFile: true });

    await ctrlClickRow('Archive');
    await ctrlClickRow('notes.txt');
    await bulkPurge();

    expect(deleteCalls()).toHaveLength(2);
    const last = toasts.at(-1)!;
    expect(last.kind).toBe('success');
    expect(`${last.title} ${last.body}`).toContain('2 items permanently deleted');
    expect(`${last.title} ${last.body}`.toLowerCase()).not.toContain('still emptying');
  });
});

// Fix round: a purge that dies partway has still removed everything the passes
// before it removed. Saying "the item could not be deleted" over several
// hundred deleted files is the same dishonesty as reporting success over
// unfinished work, pointing the other way.
describe('FilesPage purge failures report what was already removed', () => {
  it('row-level: names the count that went before the failure, and keeps it on screen', async () => {
    const answers: (() => unknown)[] = [
      () => ({ ok: true, permanent: true, complete: false, remaining: 900, files_affected: 400 }),
      () => Promise.reject(new ApiError(403, JSON.stringify({ error: 'You do not have permission' }))),
    ];
    let i = 0;
    await render(() => answers[Math.min(i++, answers.length - 1)]());

    await purgeViaContextMenu();

    expect(deleteCalls()).toHaveLength(2);
    const last = toasts.at(-1)!;
    expect(last.kind).toBe('error');
    expect(last.body).toContain('400');
    // The server's own sentence survives the partial-count wrapper.
    expect(last.body).toContain('You do not have permission');
    // The dialog is still open, and still says what went.
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('400');
  });

  it('bulk: reports the partial count alongside the failure', async () => {
    const answers: (() => unknown)[] = [
      () => ({ ok: true, permanent: true, complete: false, remaining: 900, files_affected: 400 }),
      () => Promise.reject(new ApiError(500, 'Internal error')),
    ];
    let i = 0;
    await render(() => answers[Math.min(i++, answers.length - 1)](), { withFile: true });

    await ctrlClickRow('Archive');
    await ctrlClickRow('notes.txt');
    await bulkPurge();

    const last = toasts.at(-1)!;
    expect(last.kind).toBe('error');
    expect(`${last.title} ${last.body}`).toContain('1 deleted');
    expect(last.body).toContain('400 files had already been removed from "Archive"');
  });
});

// Cancelling used to wait out the whole inner loop - up to fifty sequential
// round trips - because the folder's own passes never asked whether the user
// had given up.
describe('FilesPage bulk purge cancellation', () => {
  it('stops between passes and reports the half-emptied folder as left in the trash', async () => {
    const hold = deferred<unknown>();
    let calls = 0;
    await render(() => { calls += 1; return calls === 1 ? hold.promise : { ok: true, permanent: true, complete: true, remaining: 0, files_affected: 1 }; }, { withFile: true });

    await ctrlClickRow('Archive');
    await ctrlClickRow('notes.txt');

    // Start the purge WITHOUT awaiting it: the folder's first pass hangs.
    const toolbarButton = [...container!.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Delete permanently')!;
    await act(async () => { toolbarButton.click(); });
    const confirmDialog = document.querySelector('[role="dialog"]')!;
    const confirm = [...confirmDialog.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete permanently')!;
    await act(async () => { confirm.click(); await Promise.resolve(); });

    // The progress dialog's Cancel (the confirm dialog has closed by now).
    const cancel = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel')!;
    expect(cancel, 'progress dialog cancel').toBeTruthy();
    await act(async () => { cancel.click(); });

    // The held pass now answers 202 - and the loop must not ask again.
    await act(async () => {
      hold.resolve({ ok: true, permanent: true, complete: false, remaining: 900, files_affected: 400 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteCalls()).toHaveLength(1);
    const last = toasts.at(-1)!;
    expect(last.title).toBe('Delete cancelled');
    // The file went; the folder did not, and is counted as still in the trash.
    expect(last.body).toContain('1 item already deleted');
    expect(last.body).toContain('1 left in the trash');
    expect(last.body).toContain('400 files had already been removed from "Archive"');
  });
});
