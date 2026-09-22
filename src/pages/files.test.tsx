import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LibraryItem, LibraryKind } from '@/lib/library-request';

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

// The Images, Videos and Documents filters are not filtered folder listings
// any more - each is the library view, a workspace-wide feed from
// /api/library?kind=…. The suites below assert the swap at the page level: the
// library request goes out with the right kind, the folder listing does NOT,
// and what lands on screen is month-grouped rather than a folder grid.

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let queryClient: QueryClient | null = null;

function unmountLibraryPage() {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  queryClient = null;
  navigateTo = null;
  apiMock.mockReset();
  localStorage.clear();
}

// Lets a test hop from one filter to another the way the sidebar does, WITHOUT
// remounting the page. The distinction matters: a remount hands TanStack a
// fresh observer, and a fresh observer has no previous query to take
// placeholder data from - which is exactly the state the kind-hop bug lived in.
let navigateTo: ((to: string) => void) | null = null;
function NavCapture() {
  navigateTo = useNavigate();
  return null;
}

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'p', name: 'IMG.jpg', size_bytes: 1, mime_type: 'image/jpeg', extension: '.jpg',
    region: 'eu', created_at: 1, updated_at: 1, current_version: 1, lock_mode: 'none',
    is_hidden: 0, hidden_mode: 'none', uploaded_by: 'u1', uploader_name: 'Me',
    share_count: 0, comment_count: 0, is_synced: 0, origin: null,
    folder_id: null, taken_at: 1_718_445_600,
    ...over,
  };
}

// A different month and different ids per kind, so a request that asks for the
// wrong kind shows up as the wrong month header and missing tiles rather than
// as a passing test.
interface LibraryFixture {
  total: number;
  counts: Record<string, number>;
  months: { key: string; label: string; files: LibraryItem[] }[];
}

const LIBRARY_FIXTURES: Record<LibraryKind, LibraryFixture> = {
  photos: {
    total: 2,
    counts: { '2024-06': 2 },
    months: [{ key: '2024-06', label: 'June 2024', files: [item({ id: 'p1', name: 'IMG_1.jpg' }), item({ id: 'p2', name: 'IMG_2.jpg' })] }],
  },
  videos: {
    total: 2,
    counts: { '2024-07': 2 },
    months: [{
      key: '2024-07',
      label: 'July 2024',
      files: [
        item({ id: 'v1', name: 'trip.mp4', extension: '.mp4', mime_type: 'video/mp4', size_bytes: 184_000_000, taken_at: 1_720_000_000 }),
        item({ id: 'v2', name: 'clip.mov', extension: '.mov', mime_type: 'video/quicktime', size_bytes: 96_000_000, taken_at: 1_720_000_000 }),
      ],
    }],
  },
  documents: {
    total: 1,
    counts: { '2024-07': 1 },
    months: [{
      key: '2024-07',
      label: 'July 2024',
      files: [item({ id: 'd1', name: 'lease.pdf', extension: '.pdf', mime_type: 'application/pdf', size_bytes: 2_100_000, taken_at: 1_720_000_000 })],
    }],
  },
};

function mockLibraryApi() {
  apiMock.mockImplementation((path: unknown) => {
    if (typeof path === 'string' && path.startsWith('/api/library?')) {
      // Answering from the kind the page actually asked for is what makes the
      // per-kind assertions below real: a page still pinned to photos would
      // render June 2024 photo tiles under a Videos toolbar.
      const kind = new URLSearchParams(path.slice(path.indexOf('?') + 1)).get('kind') ?? 'photos';
      const fixture: LibraryFixture | undefined = LIBRARY_FIXTURES[kind as LibraryKind];
      if (!fixture) return Promise.reject(new Error(`unexpected library kind: ${kind}`));
      return Promise.resolve({ ok: true, kind, ...fixture, next_cursor: null, can_lock: false, can_hide: false });
    }
    // The folder listing must be OFF here; if the page ever asks for it, the
    // rejection surfaces as a failed query rather than a silent second fetch.
    if (typeof path === 'string' && path.startsWith('/api/files?')) {
      return Promise.reject(new Error('the folder listing must not be requested in library mode'));
    }
    // ImportProgressCard destructures `{ jobs }` off any response (see the
    // hidden-badge suite above); everything else is the sidebar's fetches.
    if (typeof path === 'string' && path.startsWith('/api/cloud/imports')) {
      return Promise.resolve({ ok: true, jobs: [] });
    }
    // create_folders is GRANTED on purpose: usePermissions answers false for
    // any permission missing from a loaded map, so without this the "no New
    // folder in library mode" assertion below would pass for the wrong reason.
    if (typeof path === 'string' && path.startsWith('/api/me/permissions')) {
      return Promise.resolve({
        ok: true, user_id: 'u1', role_id: 'role_owner', role_name: 'owner', is_builtin: true,
        root_folder_id: null, root_folder_name: null, permissions: { create_folders: true },
      });
    }
    return Promise.resolve({ ok: true, files: [], folders: [], groups: [], requests: [], total: 0, permissions: {} });
  });
}

async function renderLibrary(filter: string) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient!}>
        <MemoryRouter initialEntries={[`/files?filter=${filter}`]}><NavCapture /><FilesPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Every request path the page sent this render. */
function requestedPaths(): string[] {
  return apiMock.mock.calls.map(([p]) => p).filter((p): p is string => typeof p === 'string');
}

describe('FilesPage in photos mode (?filter=images)', () => {
  beforeAll(() => {
    useWorkspace.setState({ activeId: 'ws_1' });
  });

  afterEach(unmountLibraryPage);

  it('requests /api/library, renders month headers and never a folder row', async () => {
    mockLibraryApi();
    await renderLibrary('images');

    const paths = requestedPaths();
    expect(paths.some((p) => p.startsWith('/api/library?workspace_id=ws_1'))).toBe(true);
    expect(paths.some((p) => p.includes('kind=photos'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/api/files?'))).toBe(false);

    expect(container!.textContent).toContain('Photos');
    expect(container!.textContent).toContain('June 2024');
    expect(container!.textContent).toContain('2 photos');
    expect(container!.querySelector('[data-testid="library-view"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="photo-p1"]')).not.toBeNull();
    expect(container!.textContent).not.toContain('Folders');
  });

  // A mutation made from the Photos view has to reach BOTH caches. Neither
  // hook's own refresh() can do it: each derives its workspace from the view
  // it was handed, and the listing's view is null for the whole of photos
  // mode - so calling it there invalidated ['files', undefined], which
  // partial-matches nothing and left every folder page stale for its 30s
  // staleTime. Driven through the blank-area context menu's Refresh, the
  // cheapest real path to loadFiles().
  it('a refresh from photos mode invalidates the files cache as well as the photos cache', async () => {
    mockLibraryApi();
    await renderLibrary('images');

    const invalidate = vi.spyOn(queryClient!, 'invalidateQueries').mockResolvedValue(undefined as never);
    const view = container!.querySelector('[data-testid="library-view"]')!;
    await act(async () => {
      view.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    const refresh = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Refresh');
    expect(refresh).toBeDefined();
    await act(async () => { refresh!.click(); });

    const keys = invalidate.mock.calls.map(([f]) => (f as { queryKey?: unknown[] }).queryKey);
    expect(keys).toContainEqual(['files', 'ws_1']);
    expect(keys).toContainEqual(['library', 'ws_1']);
    invalidate.mockRestore();
  });

  // The toolbar already hides its New folder button in photos mode - the
  // workspace-wide library has no current folder to create in, so the dialog
  // would have created one at the root with no visible effect. The blank-area
  // context menu is the same door, and was still offering it.
  it('offers no New folder in the blank-area context menu', async () => {
    mockLibraryApi();
    await renderLibrary('images');

    const view = container!.querySelector('[data-testid="library-view"]')!;
    await act(async () => {
      view.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    const labels = [...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toContain('Refresh');
    expect(labels).not.toContain('New folder');
  });
});

// The same page, the same hooks, one different `kind` - the two suites below
// are the proof that nothing about the library view is pinned to photos.
describe('FilesPage in videos mode (?filter=videos)', () => {
  beforeAll(() => {
    useWorkspace.setState({ activeId: 'ws_1' });
  });

  afterEach(unmountLibraryPage);

  it('asks for kind=videos, never the folder listing, and renders video cards', async () => {
    mockLibraryApi();
    await renderLibrary('videos');

    const paths = requestedPaths();
    expect(paths.some((p) => p.startsWith('/api/library?workspace_id=ws_1'))).toBe(true);
    expect(paths.some((p) => p.includes('kind=videos'))).toBe(true);
    expect(paths.some((p) => p.includes('kind=photos'))).toBe(false);
    expect(paths.some((p) => p.startsWith('/api/files?'))).toBe(false);

    // 'Videos' alone would pass on the sidebar's own nav label, so the two
    // assertions that can only come from the toolbar carry this: the count
    // line (built by plural(kind, total)) and the absence of the photos title
    // (the sidebar row for photos reads 'Images').
    expect(container!.textContent).toContain('Videos');
    expect(container!.textContent).toContain('2 videos · all folders');
    expect(container!.textContent).not.toContain('Photos');
    expect(container!.textContent).toContain('July 2024');
    expect(container!.querySelector('[data-testid="library-view"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="video-v1"]')).not.toBeNull();
    // Cards, not photo tiles: proof the kind reached the view and not just the request.
    expect(container!.querySelector('[data-testid^="photo-"]')).toBeNull();
    // Videos keep the tile-size toggle photos have (documents drop it below).
    expect(container!.querySelector('[title="Small tiles"]')).not.toBeNull();
    expect(container!.textContent).not.toContain('Folders');
  });
});

describe('FilesPage in documents mode (?filter=documents)', () => {
  beforeAll(() => {
    useWorkspace.setState({ activeId: 'ws_1' });
  });

  afterEach(unmountLibraryPage);

  it('asks for kind=documents, renders rows, and drops the tile-size toggle', async () => {
    mockLibraryApi();
    await renderLibrary('documents');

    const paths = requestedPaths();
    expect(paths.some((p) => p.includes('kind=documents'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/api/files?'))).toBe(false);

    // Same trap as the videos suite: 'Documents' is also a sidebar nav label.
    expect(container!.textContent).toContain('Documents');
    expect(container!.textContent).not.toContain('Photos');
    // Documents open as a table (defaultLayoutFor), so the item is a row.
    // The layout suite below covers the toggle that turns it into tiles.
    expect(container!.querySelector('[data-testid="library-row-d1"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid^="photo-"]')).toBeNull();

    // A table is one size, so the toolbar slot the tile toggle occupies for a
    // grid is empty here.
    expect(container!.querySelector('[title="Small tiles"]')).toBeNull();
    expect(container!.querySelector('[title="Large tiles"]')).toBeNull();

    // The sort menu names the kind's primary date: documents sort by date
    // created, where photos say "Date taken".
    expect(container!.textContent).toContain('Date created · newest');
    expect(container!.textContent).not.toContain('Date taken');
  });
});

// The one path where TanStack's placeholderData can cross kinds: the page stays
// mounted, so the documents query inherits the videos query's pages unless the
// hook refuses them. It used to accept them, and for a whole round-trip the
// page drew the videos as document rows, under a "Documents" title, with the
// videos' total - and `isLoading` was false throughout, so not even a skeleton.
describe('FilesPage hopping from videos to documents', () => {
  beforeAll(() => {
    useWorkspace.setState({ activeId: 'ws_1' });
  });

  afterEach(unmountLibraryPage);

  it('never paints the previous kind while the new one loads', async () => {
    // Same responses as mockLibraryApi(), except the documents answer sits
    // behind a gate this test controls - so "before the response lands" is
    // an actual state to assert against, not a race against a real timer.
    let releaseDocs!: () => void;
    const gate = new Promise<void>((resolve) => { releaseDocs = resolve; });
    apiMock.mockImplementation((path: unknown) => {
      if (typeof path === 'string' && path.startsWith('/api/library?')) {
        const kind = new URLSearchParams(path.slice(path.indexOf('?') + 1)).get('kind') ?? 'photos';
        const fixture: LibraryFixture | undefined = LIBRARY_FIXTURES[kind as LibraryKind];
        if (!fixture) return Promise.reject(new Error(`unexpected library kind: ${kind}`));
        const response = { ok: true, kind, ...fixture, next_cursor: null, can_lock: false, can_hide: false };
        return kind === 'documents' ? gate.then(() => response) : Promise.resolve(response);
      }
      if (typeof path === 'string' && path.startsWith('/api/files?')) {
        return Promise.reject(new Error('the folder listing must not be requested in library mode'));
      }
      if (typeof path === 'string' && path.startsWith('/api/cloud/imports')) {
        return Promise.resolve({ ok: true, jobs: [] });
      }
      if (typeof path === 'string' && path.startsWith('/api/me/permissions')) {
        return Promise.resolve({
          ok: true, user_id: 'u1', role_id: 'role_owner', role_name: 'owner', is_builtin: true,
          root_folder_id: null, root_folder_name: null, permissions: { create_folders: true },
        });
      }
      return Promise.resolve({ ok: true, files: [], folders: [], groups: [], requests: [], total: 0, permissions: {} });
    });
    await renderLibrary('videos');
    expect(container!.querySelector('[data-testid="video-v1"]')).not.toBeNull();

    // Synchronous act on purpose: this asserts the frame right AFTER the hop
    // and BEFORE the documents response lands - the gate is still closed.
    act(() => { navigateTo!('/files?filter=documents'); });
    // A leak would show up as the videos redrawn in the documents layout,
    // which is the table - so the rows are what has to be absent here.
    expect(container!.querySelector('[data-testid="library-row-v1"]')).toBeNull();
    expect(container!.querySelector('[data-testid="library-row-v2"]')).toBeNull();
    expect(container!.querySelector('[data-testid="document-v1"]')).toBeNull();
    expect(container!.querySelector('[data-testid="document-v2"]')).toBeNull();
    expect(container!.querySelector('[data-testid^="document-"]')).toBeNull();
    expect(container!.querySelector('[data-testid^="library-row-"]')).toBeNull();
    expect(container!.textContent).not.toContain('2 documents');
    expect(container!.textContent).not.toContain('trip.mp4');

    // ...release the gate, and the real documents arrive right behind it. A
    // bounded poll instead of a fixed setTimeout(0): the gate's .then hop
    // and TanStack's own microtask queue mean more than one tick can stand
    // between release and paint, and a fixed wait either flakes on a slow
    // run or hides a regression that takes longer than one tick to fix.
    releaseDocs();
    for (let i = 0; i < 50; i++) {
      if (container!.querySelector('[data-testid="library-row-d1"]')) break;
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    expect(container!.querySelector('[data-testid="library-row-d1"]')).not.toBeNull();
    expect(container!.textContent).toContain('1 document · all folders');
  });
});

// The library's per-kind layout. Documents open as a table and photos/videos
// as a grid on the first visit (defaultLayoutFor), the toolbar swaps either
// way for every kind, and the choice is remembered per kind under
// `dosya_library_layout` - so one kind's preference never leaks into another.
describe('FilesPage library layout toggle', () => {
  beforeAll(() => {
    useWorkspace.setState({ activeId: 'ws_1' });
  });

  afterEach(unmountLibraryPage);

  /** Base UI's menu opens on mousedown, not click - drive the whole gesture. */
  async function openMenu(trigger: Element) {
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      (trigger as HTMLElement).click();
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  /** The open column picker's rows. It portals, so it is on body, not in the page. */
  function pickerItem(label: string): Element | undefined {
    return [...document.body.querySelectorAll('[role="menuitemcheckbox"]')]
      .find((i) => i.textContent?.trim() === label);
  }

  function savedLayouts(): unknown {
    return JSON.parse(localStorage.getItem('dosya_library_layout') ?? 'null');
  }

  async function click(el: Element | null) {
    expect(el).not.toBeNull();
    await act(async () => { (el as HTMLElement).click(); });
  }

  async function hopTo(filter: string) {
    await act(async () => { navigateTo!(`/files?filter=${filter}`); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  it('documents open as a table, with the column picker and no tile toggle', async () => {
    mockLibraryApi();
    await renderLibrary('documents');

    expect(container!.querySelector('[data-testid="library-table-header"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="library-row-d1"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="document-d1"]')).toBeNull();
    // Tile size means nothing to a table.
    expect(container!.querySelector('[title="Small tiles"]')).toBeNull();
    expect(container!.querySelector('[title="Large tiles"]')).toBeNull();
    expect(container!.querySelector('[title="List"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(container!.querySelector('[title="Grid"]')!.getAttribute('aria-pressed')).toBe('false');

    const picker = container!.querySelector('[title="Table columns"]');
    expect(picker).not.toBeNull();
    await openMenu(picker!);
    // The kind's primary date is the column the library sorts by, so it is
    // always on - shown checked and, like Name, impossible to switch off.
    const taken = pickerItem('Date created');
    expect(taken).toBeDefined();
    expect(taken!.getAttribute('aria-checked')).toBe('true');
    expect(taken!.getAttribute('aria-disabled')).toBe('true');
    expect(pickerItem('Name')!.getAttribute('aria-disabled')).toBe('true');
    // A togglable column proves the disabling is per row, not the whole menu.
    expect(pickerItem('Type')!.getAttribute('aria-disabled')).toBeNull();
    // Documents' "Date created" and the folder listing's "Created" are the
    // same value (both COALESCE(source_created_at, created_at)) - the picker
    // offers it once, not under two names.
    expect(pickerItem('Created')).toBeUndefined();
  });

  it('videos open as a grid, with the tile-size toggle and no column picker', async () => {
    mockLibraryApi();
    await renderLibrary('videos');

    expect(container!.querySelector('[data-testid="video-v1"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="library-table-header"]')).toBeNull();
    expect(container!.querySelector('[title="Small tiles"]')).not.toBeNull();
    expect(container!.querySelector('[title="Table columns"]')).toBeNull();
    expect(container!.querySelector('[title="Grid"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(container!.querySelector('[title="List"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('images still open as a grid of photo tiles', async () => {
    mockLibraryApi();
    await renderLibrary('images');

    expect(container!.querySelector('[data-testid="photo-p1"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="library-table-header"]')).toBeNull();
    expect(container!.querySelector('[title="Small tiles"]')).not.toBeNull();
    expect(container!.querySelector('[title="Table columns"]')).toBeNull();
  });

  it('switching videos to List swaps cards for rows and saves the kind', async () => {
    mockLibraryApi();
    await renderLibrary('videos');
    await click(container!.querySelector('[title="List"]'));

    expect(container!.querySelector('[data-testid="library-row-v1"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="video-v1"]')).toBeNull();
    expect(container!.querySelector('[data-testid="library-table-header"]')).not.toBeNull();
    // The tile toggle goes with the tiles; the column picker takes its slot.
    expect(container!.querySelector('[title="Small tiles"]')).toBeNull();
    expect(container!.querySelector('[title="Table columns"]')).not.toBeNull();
    // Only the kind that was switched moves; the other two keep their defaults.
    expect(savedLayouts()).toEqual({ photos: 'grid', videos: 'list', documents: 'list' });
  });

  it('switching documents to Grid swaps rows for tiles and saves the kind', async () => {
    mockLibraryApi();
    await renderLibrary('documents');
    await click(container!.querySelector('[title="Grid"]'));

    expect(container!.querySelector('[data-testid="document-d1"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="library-row-d1"]')).toBeNull();
    expect(container!.querySelector('[data-testid="library-table-header"]')).toBeNull();
    // Tiles come with a size to pick, and take the column picker's slot back.
    expect(container!.querySelector('[title="Small tiles"]')).not.toBeNull();
    expect(container!.querySelector('[title="Table columns"]')).toBeNull();
    expect(savedLayouts()).toEqual({ photos: 'grid', videos: 'grid', documents: 'grid' });
  });

  it('hopping videos to documents and back keeps each kind its own layout', async () => {
    mockLibraryApi();
    await renderLibrary('videos');
    expect(container!.querySelector('[data-testid="video-v1"]')).not.toBeNull();

    await hopTo('documents');
    expect(container!.querySelector('[data-testid="library-row-d1"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="library-table-header"]')).not.toBeNull();

    await hopTo('videos');
    expect(container!.querySelector('[data-testid="video-v1"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="library-table-header"]')).toBeNull();

    // ...and a kind switched by hand survives the same round trip.
    await click(container!.querySelector('[title="List"]'));
    await hopTo('documents');
    await hopTo('videos');
    expect(container!.querySelector('[data-testid="library-row-v1"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="video-v1"]')).toBeNull();
    expect(savedLayouts()).toEqual({ photos: 'grid', videos: 'list', documents: 'list' });
  });
});
