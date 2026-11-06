import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// "New" menu on the files page: a folder, or a blank Markdown, text or Word
// file in the current folder. Drives the real page through the toolbar
// dropdown and the blank-space right-click menu; the API is mocked and the
// PUT (a raw fetch) is stubbed.

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
const toastCalls: { kind: string; title: string; body?: string }[] = [];
vi.mock('@/lib/toast', () => ({
  toast: {
    info: (title: string, body?: string) => { toastCalls.push({ kind: 'info', title, body }); },
    error: (title: string, body?: string) => { toastCalls.push({ kind: 'error', title, body }); },
    success: (title: string, body?: string) => { toastCalls.push({ kind: 'success', title, body }); },
  },
}));
const viewerProps = vi.fn();
vi.mock('@/components/file-viewer', () => ({
  FileViewer: (props: Record<string, unknown>) => { viewerProps(props); return <div data-testid="viewer" />; },
}));

const { default: FilesPage } = await import('./files');

/** Where the page navigated last, with its router state. */
let where: { pathname: string; state: unknown } = { pathname: '', state: null };
function LocationProbe() {
  const loc = useLocation();
  where = { pathname: loc.pathname, state: loc.state };
  return null;
}
const { useWorkspace } = await import('@/stores/workspace');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const fetchMock = vi.fn();
const openMock = vi.fn();

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
  fetchMock.mockReset();
  openMock.mockReset();
  viewerProps.mockReset();
  vi.unstubAllGlobals();
  toastCalls.length = 0;
  localStorage.clear();
  document.body.innerHTML = '';
});

const file = (id: string, name: string, mime = 'text/plain', size = 12) => ({
  id, name, size_bytes: size, mime_type: mime, extension: name.slice(name.lastIndexOf('.')),
  region: 'ap-southeast-2', created_at: 1_700_000_000, updated_at: 1_700_000_000, current_version: 1,
  lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', uploaded_by: 'u_me', uploader_name: 'Me',
  share_count: 0, comment_count: 0, is_synced: 0, origin: 'web',
});
const folder = (id: string, name: string) => ({
  id, name, created_at: 1_700_000_000, updated_at: 1_700_000_000,
  file_count: 0, lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', is_synced: 0,
  total_size_bytes: 0, content_updated_at: 1_700_000_000, region: null,
  uploader_name: null, share_count: 0, comment_count: 0, origin: null, created_by: 'u_me',
});

interface Opts {
  url?: string;
  permissions?: Record<string, boolean>;
  /** What the name-check query (`q=`) answers. */
  search?: { files?: unknown[]; folders?: unknown[] };
  /** The new file's row, as GET /api/files/:id returns it. */
  created?: ReturnType<typeof file>;
  /** The folder's file rows (default: notes.txt). */
  listed?: ReturnType<typeof file>[];
}

async function render({
  url = '/files?folder=fld_cur',
  permissions = { upload_files: true, create_folders: true, access_upload: true },
  search = {},
  created = file('file_new', 'Untitled.md', 'text/markdown', 0),
  listed = [file('file_1', 'notes.txt')],
}: Opts = {}) {
  const listing = {
    ok: true,
    folders: [folder('fld_a', 'Drafts')],
    files: listed,
    breadcrumbs: url.includes('folder=fld_cur') ? [{ id: 'fld_cur', name: 'Current' }] : [],
    pagination: { page: 1, per_page: 100, total_files: 1, total_pages: 1 },
  };
  apiMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith('/api/cloud/imports')) return Promise.resolve({ ok: true, jobs: [] });
    if (p.startsWith('/api/me/permissions')) {
      return Promise.resolve({
        ok: true, user_id: 'u_me', role_id: 'r', role_name: 'Role', is_builtin: false,
        root_folder_id: null, root_folder_name: null, permissions,
      });
    }
    if (p.startsWith('/api/groups')) return Promise.resolve({ ok: true, groups: [] });
    if (p.startsWith('/api/favourites')) return Promise.resolve({ ok: true, files: [] });
    if (p.startsWith('/api/file-requests')) return Promise.resolve({ ok: true, total: 0 });
    if (p === '/api/upload/init') return Promise.resolve({ ok: true, session_id: 'upl_1' });
    if (p.startsWith('/api/files?') && p.includes('q=')) return Promise.resolve({ ok: true, files: [], folders: [], ...search });
    if (p.startsWith(`/api/files/${created.id}`)) return Promise.resolve({ ok: true, file: created });
    return Promise.resolve(listing);
  });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, file: { id: created.id, name: created.name } }), { status: 201 }));
  vi.stubGlobal('open', openMock);
  openMock.mockReturnValue({});

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}><FilesPage /><LocationProbe /></MemoryRouter>
      </QueryClientProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  await settle();
}

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const buttons = () => [...document.body.querySelectorAll<HTMLButtonElement>('button')];
const button = (text: string) => buttons().find((b) => b.textContent?.trim() === text);

async function openBlankMenu() {
  const main = document.querySelector('.flex-1.flex.flex-col.min-w-0')!;
  await act(async () => { main.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
}

/** Base UI's menu opens on mousedown, not click - drive the whole gesture. */
async function openToolbarNew() {
  const trigger = buttons().find((b) => b.textContent?.trim() === 'New');
  expect(trigger, 'toolbar New button').toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    trigger!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    trigger!.click();
  });
  await settle();
}
const menuItems = () => [...document.body.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent?.trim());

const nameInput = () => document.body.querySelector<HTMLInputElement>('input[aria-label="Name"]');

async function typeName(value: string) {
  const input = nameInput()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function clickCreate() {
  await act(async () => { button('Create')!.click(); });
  await settle();
}

const initCall = () => apiMock.mock.calls.find(([p]) => p === '/api/upload/init');

describe('files page: blank-space menu "New" group', () => {
  it('lists Folder, Markdown file, Text file and Word document under a New heading', async () => {
    await render();
    await openBlankMenu();
    const labels = buttons().map((b) => b.textContent?.trim());
    for (const l of ['Folder', 'Markdown file', 'Text file', 'Word document', 'Upload files', 'Refresh']) expect(labels).toContain(l);
    const heading = [...document.body.querySelectorAll('[role="presentation"]')].find((el) => el.textContent === 'New');
    expect(heading).toBeTruthy();
  });

  it('gates Folder on create_folders and the files on upload_files', async () => {
    await render({ permissions: { create_folders: true } });
    await openBlankMenu();
    let labels = buttons().map((b) => b.textContent?.trim());
    expect(labels).toContain('Folder');
    expect(labels).not.toContain('Markdown file');
    act(() => root!.unmount()); root = null; document.body.innerHTML = '';

    await render({ permissions: { upload_files: true } });
    await openBlankMenu();
    labels = buttons().map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Folder');
    expect(labels).toContain('Word document');
  });

  it('is gone in the trash and the hidden view', async () => {
    await render({ url: '/files?filter=deleted' });
    await openBlankMenu();
    expect(buttons().map((b) => b.textContent?.trim())).not.toContain('Markdown file');
    act(() => root!.unmount()); root = null; document.body.innerHTML = '';

    await render({ url: '/files?filter=hidden' });
    await openBlankMenu();
    const labels = buttons().map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Markdown file');
    expect(labels).not.toContain('Folder');
    expect(buttons().some((b) => b.textContent?.trim() === 'New')).toBe(false);
  });

  it('Folder opens the existing New folder dialog', async () => {
    await render();
    await openBlankMenu();
    await act(async () => { button('Folder')!.click(); });
    expect(document.body.textContent).toContain('Create new folder');
  });
});

describe('files page: toolbar New dropdown', () => {
  it('replaces New folder and offers the same four choices', async () => {
    await render();
    expect(button('New folder')).toBeUndefined();
    await openToolbarNew();
    expect(menuItems()).toEqual(['Folder', 'Markdown file', 'Text file', 'Word document']);
    const names = [...document.body.querySelectorAll('[role="menuitem"]')].map((i) => i.getAttribute('aria-label'));
    expect(names).toEqual(['New folder', 'New Markdown file', 'New text file', 'New Word document']);
  });

  it('is not shown without either permission', async () => {
    await render({ permissions: { access_upload: true } });
    expect(button('New')).toBeUndefined();
  });

  it('opens the name dialog for the chosen kind', async () => {
    await render();
    await openToolbarNew();
    const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent?.trim() === 'Word document')!;
    await act(async () => { item.click(); });
    await settle();
    expect(document.body.textContent).toContain('New Word document');
    expect(nameInput()!.value).toBe('Untitled.docx');
  });
});

describe('files page: creating a blank file', () => {
  it('prefills Untitled.md with only the base name selected', async () => {
    await render();
    await openBlankMenu();
    await act(async () => { button('Markdown file')!.click(); });
    await settle();
    expect(document.body.textContent).toContain('New Markdown file');
    const input = nameInput()!;
    expect(input.value).toBe('Untitled.md');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 8]);
  });

  it('a name already in the loaded folder keeps the dialog open with an inline error and never uploads', async () => {
    await render();
    await openBlankMenu();
    await act(async () => { button('Text file')!.click(); });
    await settle();
    await typeName('NOTES');
    await clickCreate();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('A file with this name already exists.');
    expect(nameInput()).not.toBeNull();
    expect(initCall()).toBeUndefined();
  });

  it('a name the API finds (not loaded) is caught the same way', async () => {
    await render({ search: { files: [file('file_far', 'untitled.MD')] } });
    await openBlankMenu();
    await act(async () => { button('Markdown file')!.click(); });
    await settle();
    await clickCreate();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('A file with this name already exists.');
    expect(nameInput()).not.toBeNull();
    expect(initCall()).toBeUndefined();
  });

  it('Create inits the upload with the name, size and folder, then opens Markdown in the text editor', async () => {
    await render();
    await openBlankMenu();
    await act(async () => { button('Markdown file')!.click(); });
    await settle();
    await typeName('Plan');
    // The server echoes the stored name; serve it back as the user typed it.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, file: { id: 'file_new', name: 'Plan.md' } }), { status: 201 }));
    await clickCreate();

    const body = JSON.parse(initCall()![1].body);
    expect(body).toMatchObject({ workspace_id: 'ws_1', folder_id: 'fld_cur', file_name: 'Plan.md', file_size: 0, mime_type: 'text/markdown' });
    expect(body.file_id).toBeUndefined();
    expect(toastCalls).toContainEqual({ kind: 'success', title: 'Created Plan.md', body: undefined });
    expect(nameInput()).toBeNull();

    // The full-page editor, in this tab; Close comes back here with Back.
    expect(where.pathname).toBe('/text-editor/file_new');
    expect(where.state).toEqual({ back: true });
    expect(viewerProps).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
  });

  it('Enter creates', async () => {
    await render({ created: file('file_new', 'Untitled.txt', 'text/plain', 0) });
    await openBlankMenu();
    await act(async () => { button('Text file')!.click(); });
    await settle();
    await act(async () => { nameInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await settle();
    expect(JSON.parse(initCall()![1].body).file_name).toBe('Untitled.txt');
    expect(where.pathname).toBe('/text-editor/file_new');
  });

  it('a Word document uploads the blank docx and opens the editor', async () => {
    await render({ created: file('file_doc', 'Untitled.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1735) });
    await openBlankMenu();
    await act(async () => { button('Word document')!.click(); });
    await settle();
    await clickCreate();
    const body = JSON.parse(initCall()![1].body);
    expect(body.file_name).toBe('Untitled.docx');
    expect(body.file_size).toBe(1735);
    expect(openMock).toHaveBeenCalledWith('/editor/file_doc', '_blank');
    expect(viewerProps).not.toHaveBeenCalled();
  });

  it("a server refusal is a toast with the server's message", async () => {
    await render();
    await openBlankMenu();
    await act(async () => { button('Markdown file')!.click(); });
    await settle();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'Storage limit reached' }), { status: 413 }));
    await clickCreate();
    const err = toastCalls.find((c) => c.kind === 'error');
    expect(err?.title).toBe('Could not create the file');
    expect(err?.body).toContain('Storage limit reached');
  });
});

/** Right-click the row showing `name`; returns the context menu's buttons. */
async function rowMenu(name: string): Promise<HTMLButtonElement[]> {
  const row = [...container!.querySelectorAll('div')]
    .find((d) => d.className.includes('cursor-pointer') && d.textContent?.includes(name));
  expect(row, `row "${name}"`).toBeTruthy();
  await act(async () => { row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); });
  const menu = [...document.body.querySelectorAll('div')].find((d) => d.className.includes('z-[9000]'));
  return menu ? [...menu.querySelectorAll('button')] : [];
}

describe('files page: "Open in editor" for Markdown and text', () => {
  it('opens a .md file in the text editor, in this tab', async () => {
    await render({ listed: [file('file_md', 'plan.md', 'text/markdown')] });
    const item = (await rowMenu('plan.md')).find((b) => b.textContent?.trim() === 'Open in editor');
    expect(item, 'Open in editor').toBeTruthy();
    await act(async () => { item!.click(); });
    await settle();
    expect(where.pathname).toBe('/text-editor/file_md');
    expect(where.state).toEqual({ back: true });
    expect(openMock).not.toHaveBeenCalled();
  });

  it('offers it for .txt and .markdown too', async () => {
    await render({ listed: [file('file_t', 'notes.txt'), file('file_m', 'readme.markdown', 'text/markdown')] });
    expect((await rowMenu('notes.txt')).some((b) => b.textContent?.trim() === 'Open in editor')).toBe(true);
    await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect((await rowMenu('readme.markdown')).some((b) => b.textContent?.trim() === 'Open in editor')).toBe(true);
  });

  it('is not offered for other text, files over 2 MB, or password-locked files', async () => {
    const locked = { ...file('file_l', 'locked.md', 'text/markdown'), lock_mode: 'full_lock' };
    await render({ listed: [file('file_j', 'data.json', 'application/json'), file('file_b', 'big.md', 'text/markdown', 3 * 1024 * 1024), locked] });
    for (const name of ['data.json', 'big.md']) {
      expect((await rowMenu(name)).some((b) => b.textContent?.trim() === 'Open in editor'), name).toBe(false);
      await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    }
    expect((await rowMenu('locked.md')).some((b) => b.textContent?.trim() === 'Open in editor')).toBe(false);
  });
});
