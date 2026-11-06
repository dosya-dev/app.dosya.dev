import { describe, it, expect, vi, afterEach } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { createBlankFile, folderHasName } = await import('./new-file');

const fetchMock = vi.fn();
afterEach(() => { apiMock.mockReset(); fetchMock.mockReset(); vi.unstubAllGlobals(); });

function serve(listing: { files?: { name: string }[]; folders?: { name: string }[] }) {
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/files?')) return Promise.resolve({ ok: true, ...listing });
    if (path === '/api/upload/init') return Promise.resolve({ ok: true, session_id: 'upl_1' });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, file: { id: 'file_new', name: 'Plan.md' } }), { status: 201 }));
}

describe('folderHasName', () => {
  it('asks the folder with the listing params and matches exactly, ignoring case', async () => {
    serve({ files: [{ name: 'plan.MD' }], folders: [] });
    expect(await folderHasName({ workspaceId: 'ws_1', folderId: 'fld_1', name: 'Plan.md', unlockToken: 'tok' })).toBe(true);
    const url = new URL(apiMock.mock.calls[0][0], 'https://x');
    expect(url.pathname).toBe('/api/files');
    expect(url.searchParams.get('workspace_id')).toBe('ws_1');
    expect(url.searchParams.get('folder_id')).toBe('fld_1');
    expect(url.searchParams.get('q')).toBe('Plan.md');
    expect(url.searchParams.get('ut')).toBe('tok');
  });
  it('counts folders, and ignores substring hits', async () => {
    serve({ files: [{ name: 'Plan.md.bak' }], folders: [{ name: 'PLAN.MD' }] });
    expect(await folderHasName({ workspaceId: 'ws_1', folderId: null, name: 'Plan.md' })).toBe(true);
    serve({ files: [{ name: 'Plan.md.bak' }], folders: [] });
    expect(await folderHasName({ workspaceId: 'ws_1', folderId: null, name: 'Plan.md' })).toBe(false);
  });
  it('sends no folder_id at the root', async () => {
    serve({});
    await folderHasName({ workspaceId: 'ws_1', folderId: null, name: 'a.txt' });
    expect(new URL(apiMock.mock.calls[0][0], 'https://x').searchParams.has('folder_id')).toBe(false);
  });
});

describe('createBlankFile', () => {
  it('a taken name never reaches the upload API', async () => {
    serve({ files: [{ name: 'Plan.md' }] });
    const res = await createBlankFile({ workspaceId: 'ws_1', folderId: 'fld_1', name: 'Plan.md', kind: 'md' });
    expect(res).toEqual({ ok: false, conflict: true });
    expect(apiMock.mock.calls.some(([p]) => p === '/api/upload/init')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('inits without file_id in the folder, PUTs the blank bytes, and returns the new id', async () => {
    serve({});
    const res = await createBlankFile({ workspaceId: 'ws_1', folderId: 'fld_1', name: 'Plan.md', kind: 'md' });
    expect(res).toEqual({ ok: true, fileId: 'file_new', name: 'Plan.md' });
    const init = apiMock.mock.calls.find(([p]) => p === '/api/upload/init')!;
    const body = JSON.parse(init[1].body);
    expect(body).toEqual({ workspace_id: 'ws_1', folder_id: 'fld_1', file_name: 'Plan.md', file_size: 0, mime_type: 'text/markdown' });
    expect(body).not.toHaveProperty('file_id');
    const [url, put] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/upload\/upl_1$/);
    expect(put.method).toBe('PUT');
    expect((put.body as Blob).size).toBe(0);
  });

  it('a Word document uploads the 1735-byte blank docx', async () => {
    serve({});
    await createBlankFile({ workspaceId: 'ws_1', folderId: null, name: 'Letter.docx', kind: 'docx' });
    const body = JSON.parse(apiMock.mock.calls.find(([p]) => p === '/api/upload/init')![1].body);
    expect(body.file_size).toBe(1735);
    expect(body.folder_id).toBeNull();
    expect(body.mime_type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect((fetchMock.mock.calls[0][1].body as Blob).size).toBe(1735);
  });

  it("a refused PUT comes back with the server's message", async () => {
    serve({});
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'Storage limit reached' }), { status: 413 }));
    const res = await createBlankFile({ workspaceId: 'ws_1', folderId: null, name: 'a.txt', kind: 'txt' });
    expect(res.ok).toBe(false);
    expect(res.ok === false && !res.conflict && res.error).toContain('Storage limit reached');
  });
});
