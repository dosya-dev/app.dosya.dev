/**
 * The files page and its panels in Turkish: no English left on the list and
 * grid views, the empty state, the selection bar, the context menu, the file
 * detail panel, the info dialog, the lock and hide modals, the folder picker,
 * the sidebar and the library view. Mode names, column headers and the
 * purge/bulk toasts translate at render (or call) time, in the language that is
 * current then.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';
import type { MonthGroup, LibraryItem } from '@/lib/library-request';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/components/file-viewer', () => ({
  FileViewer: () => <div data-testid="viewer" />,
  default: () => <div data-testid="viewer" />,
}));
vi.mock('@/components/file-preview-image', () => ({
  FilePreviewImage: ({ fileName }: { fileName: string }) => <img alt={fileName} />,
}));

const { default: FilesPage } = await import('@/pages/files');
const { FileDetailPanel } = await import('@/components/file-detail-panel');
const { FileInfoDialog } = await import('@/components/file-info-dialog');
const { LockModal } = await import('@/components/lock-modal');
const { HideModal } = await import('@/components/hide-modal');
const { FolderPickerDialog } = await import('@/components/folder-picker-dialog');
const { FolderLockedPanel } = await import('@/components/folder-locked-panel');
const { FilesSidebar } = await import('@/components/files-sidebar');
const { LibraryView } = await import('@/components/library/library-view');
const { BulkProgressDialog } = await import('@/components/bulk-progress-dialog');
const { LocationPicker } = await import('@/components/location-picker');
const { OriginBadge } = await import('@/components/origin-badge');
const { LOCK_MODE_OPTIONS, describeLockMode, lockActionLabel, passwordHint, describeLockStatus, describeLockTarget } = await import('@/lib/lock-mode');
const { purgeSummary, bulkPurgeStillEmptying, bulkPurgeCancelled } = await import('@/lib/folder-purge');
const { ALL_COLUMNS, libraryColumnsFor } = await import('@/lib/file-columns');
const { KIND_COPY, sortOptionsFor, plural } = await import('@/lib/library-request');
const { useLocale } = await import('@/lib/i18n');
const { useWorkspace } = await import('@/stores/workspace');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;
const pl = (await import('@/i18n/messages/pl.json')).default as Record<string, string>;

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  localStorage.clear();
  document.getElementById('toast-root')?.remove();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await Promise.resolve(); });
async function show(ui: React.ReactElement, locale: 'tr' | 'pl' | 'en' = 'tr', entries?: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  shown = await renderInLocale(
    <QueryClientProvider client={queryClient}><MemoryRouter initialEntries={entries}>{ui}</MemoryRouter></QueryClientProvider>,
    locale,
  );
  await flush();
  await flush();
  return shown;
}

function file(over: Record<string, unknown> = {}) {
  return {
    id: 'file_1', name: 'Alpha.zip', size_bytes: 2048, mime_type: 'application/zip', extension: 'zip',
    region: 'us', created_at: 1_700_000_000, updated_at: 1_700_000_100, current_version: 3,
    lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', uploaded_by: 'u1', uploader_name: 'Alice',
    share_count: 2, comment_count: 1, is_synced: 0, origin: null, captured_at: null, ...over,
  };
}
function folder(over: Record<string, unknown> = {}) {
  return {
    id: 'folder_1', name: 'Beta', created_at: 1_700_000_000, updated_at: 1_700_000_000,
    file_count: 4, lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', is_synced: 0,
    total_size_bytes: 4096, content_updated_at: 1_700_000_000, region: 'us',
    uploader_name: 'Alice', share_count: 0, comment_count: 0, origin: 'desktop', ...over,
  };
}

function serve(listing: Record<string, unknown>) {
  apiMock.mockImplementation((path: unknown) => {
    const p = typeof path === 'string' ? path : '';
    if (p.startsWith('/api/cloud/imports')) return Promise.resolve({ ok: true, jobs: [] });
    if (p.startsWith('/api/files?') || p.startsWith('/api/files/list')) return Promise.resolve(listing);
    if (p.includes('/versions')) {
      return Promise.resolve({ ok: true, current_version: 3, versions: [
        { id: 'v3', version_number: 3, size_bytes: 30, uploader_name: null, created_at: 1_700_000_000 },
        { id: 'v2', version_number: 2, size_bytes: 20, uploader_name: 'Bob', created_at: 1_699_000_000 },
      ] });
    }
    if (p.endsWith('/share')) return Promise.resolve({ ok: true, links: [{ id: 'l1', url: 'https://x.test/s/1', view_count: 5, expires_at: null, is_revoked: 0, is_password_protected: 1 }] });
    return Promise.resolve(listing);
  });
}
const LISTING = {
  ok: true,
  folders: [folder()],
  files: [file(), file({ id: 'file_2', name: 'Gamma.zip', current_version: 1 })],
  breadcrumbs: [],
  pagination: { page: 1, per_page: 100, total_files: 2, total_pages: 2 },
};

describe('files page in Turkish', () => {
  it('grid view has no leftover English', async () => {
    localStorage.setItem('dosya_files_view', 'grid');
    serve(LISTING);
    const r = await show(<FilesPage />);
    expect(r.container.textContent).toContain('Alpha.zip');
    expect(r.container.textContent).toContain(tr['common.label.folders']);
    expect(r.leftover()).toEqual([]);
  });

  it('list view has no leftover English, headers included', async () => {
    localStorage.setItem('dosya_files_view', 'list');
    serve(LISTING);
    const r = await show(<FilesPage />);
    expect(r.container.textContent).toContain('Alpha.zip');
    expect(r.container.textContent).toContain(tr['common.label.created']);
    expect(r.leftover()).toEqual([]);
  });

  it('empty state has no leftover English', async () => {
    serve({ ok: true, folders: [], files: [], breadcrumbs: [], pagination: { page: 1, per_page: 100, total_files: 0, total_pages: 1 } });
    const r = await show(<FilesPage />);
    expect(r.container.textContent).toContain(tr['files.tooltip.thisFolderIsEmpty']);
    expect(r.leftover()).toEqual([]);
  });

  it('selection bar counts and has no leftover English', async () => {
    localStorage.setItem('dosya_files_view', 'grid');
    serve(LISTING);
    const r = await show(<FilesPage />);
    const card = document.getElementById('file-file_1')!;
    for (const n of [1, 2]) {
      const target = document.getElementById(n === 1 ? 'file-file_1' : 'file-file_2')!;
      await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
      expect(r.container.textContent).toContain(tr['files.status.shownselectedSelected'].replace('{totalSelected}', String(n)));
    }
    expect(card).toBeTruthy();
    expect(r.leftover()).toEqual([]);
  });

  it('context menu has no leftover English', async () => {
    localStorage.setItem('dosya_files_view', 'grid');
    serve(LISTING);
    const r = await show(<FilesPage />);
    const card = document.getElementById('file-file_1')!;
    await act(async () => { card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
    expect(document.body.textContent).toContain(tr['files.action.getInfo']);
    expect(r.leftover()).toEqual([]);
  });

  it('bulk delete dialog has no leftover English', async () => {
    localStorage.setItem('dosya_files_view', 'grid');
    serve(LISTING);
    const r = await show(<FilesPage />);
    await act(async () => { document.getElementById('file-file_1')!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
    await act(async () => { document.getElementById('file-file_2')!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); });
    expect(document.body.textContent).toContain(tr['files.heading.deleteSelectedItems']);
    expect(r.leftover()).toEqual([]);
  });
});

describe('file panels in Turkish', () => {
  const noop = () => {};
  it('detail panel has no leftover English', async () => {
    serve(LISTING);
    const r = await show(
      <FileDetailPanel file={file() as never} onClose={noop} onDownload={noop} onCopy={noop} onDelete={noop} onShare={noop} onView={noop} onRefresh={noop} />,
    );
    expect(r.container.textContent).toContain(tr['common.label.properties']);
    expect(r.container.textContent).toContain(tr['common.label.versions']);
    expect(r.container.textContent).not.toContain('&middot;');
    expect(r.leftover()).toEqual([]);
  });

  it('locked detail panel has no leftover English', async () => {
    serve(LISTING);
    const r = await show(
      <FileDetailPanel file={file({ lock_mode: 'full_lock' }) as never} onClose={noop} onView={noop} onRefresh={noop} />,
    );
    expect(r.container.textContent).toContain(tr['files.label.thisFileIsLocked']);
    expect(r.leftover()).toEqual([]);
  });

  it('info dialogs (file and folder) have no leftover English', async () => {
    let r = await show(<FileInfoDialog target={{ type: 'file', item: file({ lock_mode: 'full_lock', is_hidden: 1 }) as never }} location="Alpha" onClose={noop} />);
    expect(document.body.textContent).toContain(tr['files.label.kind']);
    expect(r.leftover()).toEqual([]);
    r.unmount();
    r = await show(<FileInfoDialog target={{ type: 'folder', item: folder() as never }} onClose={noop} />);
    expect(document.body.textContent).toContain(tr['files.label.items']);
    expect(r.leftover()).toEqual([]);
  });

  for (const lock_mode of ['none', 'view_only', 'full_lock']) {
    it(`lock modal (${lock_mode}) has no leftover English and names its modes in Turkish`, async () => {
      apiMock.mockResolvedValue({ ok: true, lock_mode, locked_by_name: 'Alice', locked_at: 1_700_000_000 });
      const r = await show(
        <LockModal open target={{ id: 'file_1', name: 'Alpha.zip', type: 'file', size_bytes: 10, extension: 'zip', lock_mode } as never} onClose={noop} onDone={noop} />,
      );
      expect(document.body.textContent).toContain(tr['file-security.label.unlocked']);
      expect(document.body.textContent).toContain(tr['files.label.viewOnly']);
      expect(r.leftover()).toEqual([]);
    });
  }

  it('lock modal for a folder has no leftover English', async () => {
    apiMock.mockResolvedValue({ ok: true, lock_mode: 'none' });
    const r = await show(
      <LockModal open target={{ id: 'folder_1', name: 'Beta', type: 'folder', file_count: 3, total_size_bytes: 10, lock_mode: 'none' } as never} onClose={noop} onDone={noop} />,
    );
    expect(document.body.textContent).toContain(tr['file-security.label.anyoneWithAccessToItCanOpenItAnd']);
    expect(r.leftover()).toEqual([]);
  });

  for (const mode of ['none', 'everyone', 'users', 'roles']) {
    it(`hide modal (${mode}) has no leftover English`, async () => {
      apiMock.mockImplementation((p: string) => {
        if (p.includes('/hide')) return Promise.resolve({ ok: true, hidden_mode: mode, rules: [] });
        if (p.startsWith('/api/team')) return Promise.resolve({ ok: true, members: [{ user_id: 'u1', name: 'Alice', email: 'a@x.test', role_id: 'r1', is_you: true }] });
        return Promise.resolve({ ok: true, roles: [{ id: 'r1', name: 'Zeta' }] });
      });
      const r = await show(<HideModal open target={{ id: 'file_1', name: 'Alpha.zip', type: 'file' }} onClose={noop} onDone={noop} />);
      expect(document.body.textContent).toContain(tr['files.label.visible']);
      expect(r.leftover()).toEqual([]);
    });
  }

  it('folder picker has no leftover English', async () => {
    apiMock.mockResolvedValue({ ok: true, folders: [{ id: 'a', name: 'Alpha', parent_id: null, file_count: 1, has_children: false }] });
    const r = await show(<FolderPickerDialog open onClose={noop} workspaceId="ws_1" onSelect={noop} />);
    expect(document.body.textContent).toContain(tr['common.label.selectFolder']);
    expect(r.leftover()).toEqual([]);
  });

  it('locked folder panel has no leftover English', async () => {
    const r = await show(<FolderLockedPanel folderId="folder_1" folderName="Beta" onUnlocked={noop} onBack={noop} />);
    expect(r.container.textContent).toContain(tr['files.description.enterTheFolderPasswordToSeeWhatIsInsideAccessStays']);
    expect(r.leftover()).toEqual([]);
  });

  it('sidebar has no leftover English', async () => {
    apiMock.mockImplementation((p: string) => {
      if (p.includes('/api/favourites')) return Promise.resolve({ ok: true, favourites: [] });
      if (p.includes('/api/groups')) return Promise.resolve({ ok: true, groups: [] });
      return Promise.resolve({ ok: true });
    });
    const r = await show(<FilesSidebar onFilterChange={noop} onFavouriteClick={noop} onGroupClick={noop} />);
    expect(r.container.textContent).toContain(tr['common.label.videos']);
    expect(r.leftover()).toEqual([]);
  });

  it('location picker and origin badge have no leftover English', async () => {
    const r = await show(<div><LocationPicker regions={[]} value="" onChange={noop} /><span className="relative"><OriginBadge origin="desktop" /></span></div>);
    expect(r.container.textContent).toContain(tr['create-workspace.description.noLocationsAvailable']);
    expect(r.leftover()).toEqual([]);
  });
});

function photo(id: string, over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id, name: `${id}.jpg`, size_bytes: 1, mime_type: 'image/jpeg', extension: '.jpg', region: 'eu',
    created_at: 1, updated_at: 1, current_version: 1, lock_mode: 'none', is_hidden: 0,
    uploaded_by: 'u1', uploader_name: 'Me', share_count: 0, comment_count: 0, is_synced: 0,
    folder_id: null, taken_at: 1718445600, ...over,
  } as LibraryItem;
}
const MONTHS: MonthGroup[] = [
  { key: '2024-07', label: 'July 2024', count: 23, files: [photo('a'), photo('b')] },
];
function libProps(over: Partial<React.ComponentProps<typeof LibraryView>> = {}): React.ComponentProps<typeof LibraryView> {
  const noop = () => {};
  return {
    months: MONTHS, total: 25, loaded: 2, hasMore: true, isLoading: false, isLoadingMore: false, error: null,
    search: '', selected: new Set(), favourites: new Set(), unlockedFiles: new Map(), activeId: null,
    kind: 'photos', tileSize: 'small', layout: 'grid', columns: [], uploadHref: '/uploads',
    onLoadMore: noop, onRetry: noop, onOpen: noop, onToggleSelect: noop, onSelectMany: noop, onFavourite: noop, onContextMenu: noop,
    ...over,
  };
}

describe('library view in Turkish', () => {
  for (const kind of ['photos', 'videos', 'documents'] as const) {
    it(`${kind} grid, table, empty and error states have no leftover English`, async () => {
      let r = await show(<LibraryView {...libProps({ kind })} />);
      expect(r.leftover()).toEqual([]);
      r.unmount();
      r = await show(<LibraryView {...libProps({ kind, layout: 'list', columns: libraryColumnsFor(kind) })} />);
      expect(r.container.textContent).toContain(libraryColumnsFor(kind)[0].label);
      expect(r.leftover()).toEqual([]);
      r.unmount();
      r = await show(<LibraryView {...libProps({ kind, months: [], total: 0, loaded: 0, hasMore: false })} />);
      expect(r.container.textContent).toContain(KIND_COPY[kind].emptyTitle);
      expect(r.leftover()).toEqual([]);
      r.unmount();
      r = await show(<LibraryView {...libProps({ kind, months: [], error: 'x' })} />);
      expect(r.leftover()).toEqual([]);
    });
  }
});

describe('counts', () => {
  it('bulk progress dialog reads per the plural rules (tr 1 and 2, pl 5)', async () => {
    let r = await show(<BulkProgressDialog progress={{ done: 0, total: 1, permanent: false }} />);
    expect(r.container.ownerDocument.body.textContent).toContain(tr['files.status.deleting']);
    expect(r.leftover()).toEqual([]);
    r.unmount();
    r = await show(<BulkProgressDialog progress={{ done: 1, total: 2, permanent: true }} onCancel={() => {}} />);
    expect(document.body.textContent).toContain(tr['files.heading.deletingPermanently']);
    expect(r.leftover()).toEqual([]);
    r.unmount();
    // Polish: 1 takes the "one" form, 5 the "many" form (the Polish file is not yet complete,
    // so only the plural sentence is asserted here, not leftover English).
    r = await show(<BulkProgressDialog progress={{ done: 0, total: 1, permanent: false }} />, 'pl');
    expect(document.body.textContent).toContain('element usunięty.');
    r.unmount();
    r = await show(<BulkProgressDialog progress={{ done: 2, total: 5, permanent: false }} />, 'pl');
    expect(document.body.textContent).toContain('2 z 5');
    expect(document.body.textContent).toContain('elementów usuniętych.');
  });

  it('a Polish selection count of 5 comes from the Polish message', async () => {
    localStorage.setItem('dosya_files_view', 'grid');
    const many = Array.from({ length: 5 }, (_, i) => file({ id: `f${i}`, name: `Item${i}.zip` }));
    serve({ ...LISTING, files: many, folders: [] });
    const r = await show(<FilesPage />, 'pl');
    for (let i = 0; i < 5; i++) {
      await act(async () => { document.getElementById(`file-f${i}`)!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
    }
    expect(r.container.textContent).toContain(pl['files.status.shownselectedSelected'].replace('{totalSelected}', '5'));
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); });
    expect(document.body.textContent).toContain(pl['files.heading.deleteSelectedItems']);
    // The question names the selection with the Polish list conjunction.
    expect(document.body.textContent).toContain('Usunąć: 5 ');
  });
});

describe('translated at call time, in the language that is current then', () => {
  let setLocaleRef: ((l: 'en' | 'tr') => Promise<void>) | null = null;
  function Probe() {
    setLocaleRef = useLocale().setLocale;
    return null;
  }

  it('lock mode names, descriptions and action labels follow a language switch', async () => {
    await show(<Probe />);
    await act(async () => { await setLocaleRef!('en'); });
    expect(LOCK_MODE_OPTIONS.map((o) => o.label)).toEqual(['Unlocked', 'View only', 'Password']);
    await act(async () => { await setLocaleRef!('tr'); });
    expect(LOCK_MODE_OPTIONS.map((o) => o.label)).toEqual([tr['file-security.label.unlocked'], tr['files.label.viewOnly'], tr['common.label.password']]);
    expect(describeLockMode('file', 'none')).toBe(tr['file-security.label.anyoneWithAccessToItCanOpenDownloadAnd']);
    expect(describeLockMode('folder', 'full_lock')).toBe(tr['file-security.description.opensOnlyWithAPasswordWhileItIsLocked']);
    expect(lockActionLabel({ selected: 'none', current: 'full_lock' })).toBe(tr['files.label.removeLock']);
    expect(passwordHint('full_lock')).toContain('8');
    expect(describeLockStatus({ lock_mode: 'view_only', locked_by_name: 'Alice', lockedWhen: '2d' })).toContain('Alice');
    expect(describeLockTarget({ kind: 'folder', file_count: 2 })).toContain(tr['common.label.folder']);
    await act(async () => { await setLocaleRef!('en'); });
  });

  it('column headers and library copy follow a language switch', async () => {
    await show(<Probe />);
    await act(async () => { await setLocaleRef!('tr'); });
    expect(ALL_COLUMNS.map((c) => c.label)).toContain(tr['common.label.created']);
    expect(ALL_COLUMNS.map((c) => c.label)).not.toContain('Created');
    expect(KIND_COPY.photos.title).toBe(tr['common.heading.photos']);
    expect(sortOptionsFor('photos')[2].label).toBe(tr['files.label.dateUploadedNewest']);
    expect(plural('photos', 3)).toContain('3');
    await act(async () => { await setLocaleRef!('en'); });
    expect(ALL_COLUMNS.map((c) => c.label)).toContain('Created');
    expect(plural('photos', 1)).toBe('1 photo');
  });

  it('purge toasts are Turkish after a switch to Turkish', async () => {
    await show(<Probe />);
    await act(async () => { await setLocaleRef!('tr'); });
    const done = purgeSummary({ complete: true, cancelled: false, filesAffected: 3, remaining: 0, calls: 1 }, 'Beta');
    expect(done.title).toBe(tr['files.heading.deleted']);
    expect(done.body).not.toMatch(/permanently deleted/);
    const still = purgeSummary({ complete: false, cancelled: false, filesAffected: 3, remaining: 9, calls: 1 }, 'Beta');
    expect(still.title).toBe(tr['files.label.stillEmptying']);
    const bulk = bulkPurgeStillEmptying({ deleted: 2, failed: 1, incomplete: [{ name: 'Beta', filesAffected: 1, remaining: 2 }] });
    expect(bulk.title).toBe(tr['files.label.stillEmptying']);
    expect(bulk.body).not.toMatch(/very large|could not be deleted/);
    const cancelled = bulkPurgeCancelled({ deleted: 1, leftInTrash: 2, partial: [{ name: 'Beta', filesAffected: 4, remaining: 1 }] });
    expect(cancelled.title).toBe(tr['files.heading.deleteCancelled']);
    expect(cancelled.body).not.toMatch(/already deleted|left in the trash|already been removed/);
    await act(async () => { await setLocaleRef!('en'); });
    expect(purgeSummary({ complete: true, cancelled: false, filesAffected: 1, remaining: 0, calls: 1 }, 'Beta').body)
      .toBe('"Beta" and its 1 file were permanently deleted.');
  });
});

describe('English output of the exact-text workarounds', () => {
  it('permanent folder delete text is exact, with and without files', async () => {
    for (const [count, expected] of [[3, 'Permanently delete Beta and its 3 files? This cannot be undone.'], [0, 'Permanently delete Beta? This cannot be undone.']] as const) {
      localStorage.setItem('dosya_files_view', 'list');
      serve({ ok: true, folders: [folder({ file_count: count, is_trash_root: true })], files: [], breadcrumbs: [], pagination: { page: 1, per_page: 100, total_files: 0, total_pages: 1 } });
      const r = await show(<FilesPage />, 'en', ['/files?filter=deleted']);
      const name = [...document.querySelectorAll('span')].find((e) => e.textContent === 'Beta')!;
      await act(async () => { name.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })); });
      const item = [...document.querySelectorAll('button, [role="menuitem"]')].filter((e) => e.textContent?.trim() === 'Delete permanently').at(-1)!;
      await act(async () => { (item as HTMLElement).click(); });
      const dialog = document.querySelector('[role="dialog"]')!;
      expect([...dialog.querySelectorAll('p')].find((p) => p.textContent!.includes('Permanently delete '))!.textContent).toBe(expected);
      r.unmount();
      shown = null;
    }
  });
});
