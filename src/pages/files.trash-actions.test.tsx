import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The Trash view's Restore and Delete permanently used to render for every
// member. Both doors ask delete_own_files (own rows) or delete_any_file on the
// server, so a Viewer saw two actions that could only 403. The view now hides
// them behind the same split the server applies - the server stays the
// authority; this only keeps locked doors out of sight.

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/lib/toast', () => ({
  toast: { info: () => {}, error: () => {}, success: () => {} },
}));

const { default: FilesPage } = await import('./files');
const { useWorkspace } = await import('@/stores/workspace');

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
  localStorage.clear();
  document.body.innerHTML = '';
});

const ME = 'u_me';
const SOMEONE_ELSE = 'u_other';

const trashedFolder = (created_by: string) => ({
  id: 'fld_1', name: 'Archive', created_at: 1_700_000_000, updated_at: 1_700_000_000,
  file_count: 3, lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', is_synced: 0,
  total_size_bytes: 10, content_updated_at: 1_700_000_000, region: null,
  uploader_name: null, share_count: 0, comment_count: 0, origin: null,
  deleted_at: 1_700_000_500, is_trash_root: 1, created_by,
});

const trashedFile = (uploaded_by: string) => ({
  id: 'file_1', name: 'notes.txt', size_bytes: 12, mime_type: 'text/plain', extension: '.txt',
  region: 'ap-southeast-2', created_at: 1_700_000_000, updated_at: 1_700_000_000, current_version: 1,
  lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', uploaded_by, uploader_name: 'Someone',
  share_count: 0, comment_count: 0, is_synced: 0, origin: 'web', deleted_at: 1_700_000_500,
});

async function render(opts: { permissions: Record<string, boolean>; fileBy: string; folderBy: string }) {
  const files = [trashedFile(opts.fileBy)];
  const listing = {
    ok: true, folders: [trashedFolder(opts.folderBy)], files, breadcrumbs: [],
    pagination: { page: 1, per_page: 100, total_files: files.length, total_pages: 1 },
  };
  apiMock.mockImplementation((path: unknown) => {
    if (typeof path === 'string' && path.startsWith('/api/cloud/imports')) return Promise.resolve({ ok: true, jobs: [] });
    if (typeof path === 'string' && path.startsWith('/api/me/permissions')) {
      return Promise.resolve({
        ok: true, user_id: ME, role_id: 'role_under_test', role_name: 'Role', is_builtin: false,
        root_folder_id: null, root_folder_name: null, permissions: opts.permissions,
      });
    }
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
  // Let the permissions query settle so can() answers from the map, not optimistically.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Right-click the row whose text includes `name` and return the context menu's item labels. */
async function contextMenuLabels(name: string): Promise<string[]> {
  const row = [...container!.querySelectorAll('div')]
    .find((d) => d.className.includes('cursor-pointer') && d.textContent?.includes(name));
  expect(row, `row "${name}"`).toBeTruthy();
  await act(async () => { row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); });
  const menu = [...document.body.querySelectorAll('div')].find((d) => d.className.includes('z-[9000]'));
  const labels = menu ? [...menu.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '').filter(Boolean) : [];
  // Close it again so the next row's menu is the only one on the page.
  await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  return labels;
}

/** Every button label currently in the document (row dropdown triggers included). */
const bodyText = () => document.body.textContent ?? '';

describe('FilesPage trash actions follow the delete permissions', () => {
  it('a role with neither delete permission sees no Restore and no Delete permanently', async () => {
    await render({ permissions: {}, fileBy: SOMEONE_ELSE, folderBy: SOMEONE_ELSE });
    expect(bodyText()).toContain('notes.txt');
    expect(bodyText()).toContain('Archive');

    const fileMenu = await contextMenuLabels('notes.txt');
    expect(fileMenu).not.toContain('Restore');
    expect(fileMenu).not.toContain('Delete permanently');

    const folderMenu = await contextMenuLabels('Archive');
    expect(folderMenu).not.toContain('Restore');
    expect(folderMenu).not.toContain('Delete permanently');
  });

  it('delete_own_files alone covers only rows the member uploaded or created', async () => {
    await render({ permissions: { delete_own_files: true }, fileBy: ME, folderBy: SOMEONE_ELSE });

    expect(await contextMenuLabels('notes.txt')).toContain('Restore');
    expect(await contextMenuLabels('Archive')).not.toContain('Restore');
  });

  it('delete_any_file covers every row', async () => {
    await render({ permissions: { delete_any_file: true }, fileBy: SOMEONE_ELSE, folderBy: SOMEONE_ELSE });

    const fileMenu = await contextMenuLabels('notes.txt');
    expect(fileMenu).toContain('Restore');
    expect(fileMenu).toContain('Delete permanently');
    const folderMenu = await contextMenuLabels('Archive');
    expect(folderMenu).toContain('Restore');
    expect(folderMenu).toContain('Delete permanently');
  });
});
