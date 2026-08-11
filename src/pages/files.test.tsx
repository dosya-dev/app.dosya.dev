import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Hidden-item badge coverage.
//
// "Hidden" is not binary - is_hidden/hidden_mode describe who ELSE an item is
// hidden from (migration 0023: 'everyone' | 'users' | 'roles'), never "hidden
// from you". This page renders an EyeOff badge next to a hidden folder's name
// - in both the list row and the grid FolderCard, the same two places the
// Lock badge already appears - with a title that names who it's hidden from
// and warns that hidden items drop out of share links.
const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { default: FilesPage } = await import('./files');
const { useWorkspace } = await import('@/stores/workspace');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function folder(over: Record<string, unknown>) {
  return {
    id: 'default_id', name: 'Folder', created_at: 1_700_000_000, updated_at: 1_700_000_000,
    file_count: 0, lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', is_synced: 0,
    total_size_bytes: 0, content_updated_at: 1_700_000_000, region: null,
    uploader_name: null, share_count: 0, comment_count: 0, origin: null,
    ...over,
  };
}

// One visible folder plus two hidden ones (one per non-"everyone" mode
// grouping) so a single render can prove both "appears when hidden" and
// "text differs by mode" at once.
const VISIBLE = folder({ id: 'f_visible', name: 'Public Folder' });
const HIDDEN_EVERYONE = folder({ id: 'f_hidden_everyone', name: 'Team Docs', is_hidden: 1, hidden_mode: 'everyone' });
const HIDDEN_USERS = folder({ id: 'f_hidden_users', name: 'Payroll', is_hidden: 1, hidden_mode: 'users' });

const EVERYONE_TITLE = 'Hidden from everyone. Not included in share links.';
const SOME_PEOPLE_TITLE = 'Hidden from some people. Not included in share links.';

describe('FilesPage hidden-item badge', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    useWorkspace.setState({ activeId: 'ws_1' });
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    apiMock.mockReset();
    localStorage.clear();
  });

  async function render() {
    const listing = {
      ok: true,
      folders: [VISIBLE, HIDDEN_EVERYONE, HIDDEN_USERS],
      files: [],
      breadcrumbs: [],
      pagination: { page: 1, per_page: 100, total_files: 0, total_pages: 1 },
    };
    // The page also mounts <ImportProgressCard>, whose store unconditionally
    // destructures `{ jobs }` off whatever this same mocked api() returns for
    // ANY call - unlike the sidebar's favourites/groups fetches, it has no
    // `if (data.ok && ...)` guard, so serving it the folder listing shape
    // leaves `jobs` undefined and crashes on the first `.filter()`.
    apiMock.mockImplementation((path: unknown) =>
      Promise.resolve(typeof path === 'string' && path.startsWith('/api/cloud/imports')
        ? { ok: true, jobs: [] }
        : listing));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter><FilesPage /></MemoryRouter>
        </QueryClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // Badges carry their tooltip in the `title` attribute, matching how the
  // page exposes every other row indicator's tooltip.
  function hiddenBadgeTitles(): string[] {
    return [...container!.querySelectorAll('[title^="Hidden from"]')].map((el) => el.getAttribute('title')!);
  }

  it('list view: badges exactly the 2 hidden folders, with per-mode copy, and leaves the visible one bare', async () => {
    localStorage.setItem('dosya_files_view', 'list');
    await render();
    expect(container!.textContent).toContain('Public Folder');
    expect(container!.textContent).toContain('Team Docs');

    const titles = hiddenBadgeTitles();
    expect(titles).toHaveLength(2);
    expect(titles).toContain(EVERYONE_TITLE);
    expect(titles).toContain(SOME_PEOPLE_TITLE);
  });

  it('grid view (FolderCard): same 2-of-3 badge count, with per-mode copy', async () => {
    localStorage.setItem('dosya_files_view', 'grid');
    await render();
    expect(container!.textContent).toContain('Public Folder');

    const titles = hiddenBadgeTitles();
    expect(titles).toHaveLength(2);
    expect(titles).toContain(EVERYONE_TITLE);
    expect(titles).toContain(SOME_PEOPLE_TITLE);
  });
});
