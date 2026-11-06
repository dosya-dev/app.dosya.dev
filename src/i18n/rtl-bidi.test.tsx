/**
 * User content and server text keep their own direction. File, folder,
 * workspace and person names sit in <bdi> (or, where they truncate, in an
 * element with dir="auto"); server text blocks and multi-line
 * user text carry dir="auto"; identifiers shown alone are dir="ltr". English
 * output gets no added characters.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';
import type { ApiKey } from '@/lib/api-keys';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/components/file-viewer', () => ({
  FileViewer: () => <div data-testid="viewer" />,
  default: () => <div data-testid="viewer" />,
}));
vi.mock('@/components/pdf-viewer/pdf-viewer', () => ({ PdfViewer: () => null, default: () => null }));
vi.mock('@/components/file-preview-image', () => ({
  FilePreviewImage: ({ fileName }: { fileName: string }) => <img alt={fileName} />,
}));

const { default: FilesPage } = await import('@/pages/files');
const { FileDetailPanel } = await import('@/components/file-detail-panel');
const { ApiKeysSection } = await import('@/components/api-keys/api-keys-section');
const { NotificationCard } = await import('@/components/notifications/notification-card');
const { CommentBody } = await import('@/components/comments/comment-body');
const { Input } = await import('@/components/ui/input');
const { toast } = await import('@/lib/toast');
const { LibraryView } = await import('@/components/library/library-view');
const { EncryptedFolderCard, EncryptedFileCard } = await import('@/components/e2ee/encrypted-browser');
const { MaintenanceScreen } = await import('@/components/maintenance-screen');
const { FileViewer } = await vi.importActual<typeof import('@/components/file-viewer')>('@/components/file-viewer');
const { useWorkspace } = await import('@/stores/workspace');

const HEBREW = 'גיבוי 2026 (final).zip';
const LATIN = 'report (1).pdf';
const ISOLATES = /[⁦-⁩]/;

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
async function show(ui: React.ReactElement, locale: 'en' | 'he' | 'ar' | 'fa') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  shown = await renderInLocale(
    <QueryClientProvider client={queryClient}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>,
    locale,
  );
  await flush();
  await flush();
  return shown;
}

function file(over: Record<string, unknown> = {}) {
  return {
    id: 'file_1', name: HEBREW, size_bytes: 2048, mime_type: 'application/zip', extension: 'zip',
    region: 'us', created_at: 1_700_000_000, updated_at: 1_700_000_100, current_version: 1,
    lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', uploaded_by: 'u1', uploader_name: 'Alice',
    share_count: 0, comment_count: 0, is_synced: 0, origin: null, captured_at: null, ...over,
  };
}
const LISTING = {
  ok: true,
  folders: [],
  files: [file(), file({ id: 'file_2', name: LATIN })],
  breadcrumbs: [],
  pagination: { page: 1, per_page: 100, total_files: 2, total_pages: 1 },
};
function serve() {
  apiMock.mockImplementation((path: unknown) => {
    const p = typeof path === 'string' ? path : '';
    if (p.startsWith('/api/cloud/imports')) return Promise.resolve({ ok: true, jobs: [] });
    if (p.includes('/versions')) return Promise.resolve({ ok: true, current_version: 1, versions: [] });
    if (p.endsWith('/share')) return Promise.resolve({ ok: true, links: [{ id: 'l1', url: 'https://x.test/s/1', view_count: 5, expires_at: null, is_revoked: 0, is_password_protected: 0 }] });
    return Promise.resolve(LISTING);
  });
}
// A name is isolated by a <bdi> or by an element carrying its own dir (the
// browser stylesheet gives [dir] unicode-bidi: isolate). Truncating names use
// the latter, since dir="auto" skips bdi content when it resolves.
const bdiTexts = (root: ParentNode) => [...root.querySelectorAll('bdi, [dir]')].map((b) => b.textContent);

describe('file names are isolated', () => {
  it('list view wraps every name in <bdi> (he)', async () => {
    localStorage.setItem('dosya_files_view', 'list');
    serve();
    const r = await show(<FilesPage />, 'he');
    expect(bdiTexts(r.container)).toEqual(expect.arrayContaining([HEBREW, LATIN]));
  });

  it('grid view wraps every name in <bdi> (ar)', async () => {
    localStorage.setItem('dosya_files_view', 'grid');
    serve();
    const r = await show(<FilesPage />, 'ar');
    expect(bdiTexts(r.container)).toEqual(expect.arrayContaining([HEBREW, LATIN]));
  });

  it.each([HEBREW, LATIN])('detail panel wraps %s in <bdi> and shows share links LTR', async (name) => {
    serve();
    const noop = () => {};
    const r = await show(
      <FileDetailPanel file={file({ name }) as never} onClose={noop} onDownload={noop} onCopy={noop} onDelete={noop} onShare={noop} onView={noop} onRefresh={noop} />,
      'he',
    );
    expect(bdiTexts(r.container)).toContain(name);
    const link = [...r.container.querySelectorAll('span')].find((s) => s.textContent === 'https://x.test/s/1');
    expect(link?.getAttribute('dir')).toBe('ltr');
  });

  it('English output carries no isolate characters and the same text as the name alone', async () => {
    localStorage.setItem('dosya_files_view', 'list');
    serve();
    const r = await show(<FilesPage />, 'en');
    expect(ISOLATES.test(r.container.textContent ?? '')).toBe(false);
    expect(r.container.textContent).toContain(LATIN);
  });
});

describe('identifiers and inputs', () => {
  const key = (over: Partial<ApiKey> = {}): ApiKey => ({
    id: 'key_x', name: 'x', scope: 'full', key_prefix: 'abcd1234', created_at: 1_700_000_000,
    last_used_at: null, expires_at: null, s3_access_key_id: null, surfaces: null,
    workspace_id: null, root_folder_id: null, allowed_ips: null, active_hours: null, ...over,
  });

  it('an API key prefix is dir="ltr" and its name is in <bdi> (fa)', async () => {
    const r = await show(<ApiKeysSection keys={[key({ name: 'پشتیبان' })]} workspaces={[{ id: 'ws_1', name: 'W' }]} onChanged={() => {}} />, 'fa');
    const prefix = [...r.container.querySelectorAll('span')].find((s) => s.textContent?.startsWith('dos_'));
    expect(prefix?.getAttribute('dir')).toBe('ltr');
    expect(bdiTexts(r.container)).toContain('پشتیبان');
  });

  it('email, url, tel, password and number inputs are dir="ltr"; text inputs are not forced', async () => {
    const r = await show(
      <div>
        {['email', 'url', 'tel', 'password', 'number'].map((type) => <Input key={type} type={type} data-t={type} />)}
        <Input type="text" data-t="text" />
      </div>,
      'he',
    );
    for (const type of ['email', 'url', 'tel', 'password', 'number']) {
      expect(r.container.querySelector(`[data-t="${type}"]`)?.getAttribute('dir')).toBe('ltr');
    }
    expect(r.container.querySelector('[data-t="text"]')?.hasAttribute('dir')).toBe(false);
  });
});

describe('server text and user text blocks', () => {
  it('notification title and body take their own direction', async () => {
    const item = { id: 'n1', title: 'Upload finished', body: 'שלום world', icon: null, category: 'files', priority: 'normal', created_at: 1_700_000_000, read_at: null, link_path: null, actions: [] };
    const r = await show(<NotificationCard item={item as never} />, 'ar');
    expect(r.container.querySelector('p.font-medium')?.getAttribute('dir')).toBe('auto');
    expect([...r.container.querySelectorAll('p')].find((p) => p.textContent === 'שלום world')?.getAttribute('dir')).toBe('auto');
  });

  it('toast title and description (server text) have dir="auto"', async () => {
    await show(<div />, 'he');
    toast.error('Error', 'File "report (1).pdf" is too large.');
    const root = document.getElementById('toast-root')!;
    expect(root.querySelector('.dosya-toast__title')?.getAttribute('dir')).toBe('auto');
    const desc = root.querySelector('.dosya-toast__desc');
    expect(desc?.getAttribute('dir')).toBe('auto');
    expect(desc?.textContent).toBe('File "report (1).pdf" is too large.');
  });

  it('a comment body keeps its own text untouched', async () => {
    const r = await show(<p dir="auto"><CommentBody body="שלום (1)" mentions={[]} /></p>, 'he');
    expect(r.container.textContent).toBe('שלום (1)');
  });
});

describe('library, viewer header, Vault and error text', () => {
  const photo = (id: string, name: string) => ({
    id, name, size_bytes: 1, mime_type: 'image/jpeg', extension: '.jpg', region: 'eu',
    created_at: 1, updated_at: 1, current_version: 1, lock_mode: 'none', is_hidden: 0,
    uploaded_by: 'u1', uploader_name: 'Me', share_count: 0, comment_count: 0, is_synced: 0,
    folder_id: null, taken_at: 1718445600,
  });
  const libProps = (kind: string, layout: string) => {
    const noop = () => {};
    return {
      months: [{ key: '2024-07', label: 'July 2024', count: 2, files: [photo('a', HEBREW), photo('b', LATIN)] }],
      total: 2, loaded: 2, hasMore: false, isLoading: false, isLoadingMore: false, error: null,
      search: '', selected: new Set(), favourites: new Set(), unlockedFiles: new Map(), activeId: null,
      kind, tileSize: 'small', layout, columns: [], uploadHref: '/uploads',
      onLoadMore: noop, onRetry: noop, onOpen: noop, onToggleSelect: noop, onSelectMany: noop, onFavourite: noop, onContextMenu: noop,
    } as unknown as React.ComponentProps<typeof LibraryView>;
  };

  it('library photo tiles isolate names (ar) and English has none added', async () => {
    let r = await show(<LibraryView {...libProps('photos', 'grid')} />, 'ar');
    expect(bdiTexts(r.container)).toEqual(expect.arrayContaining([HEBREW, LATIN]));
    r.unmount();
    r = await show(<LibraryView {...libProps('photos', 'grid')} />, 'en');
    expect(ISOLATES.test(r.container.textContent ?? '')).toBe(false);
  });

  it('file viewer header isolates the name (fa)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    apiMock.mockRejectedValue(new Error('offline'));
    const f = file({ name: LATIN, extension: 'html' });
    const r = await show(<FileViewer file={f as never} files={[f] as never} workspaceId="w1" onClose={() => {}} onNavigate={() => {}} onRefresh={() => {}} />, 'fa');
    expect(bdiTexts(r.container)).toContain(LATIN);
    vi.unstubAllGlobals();
  });

  it('Vault cards isolate Space and file names (he)', async () => {
    const r = await show(<div><EncryptedFolderCard name={HEBREW} onClick={() => {}} /><EncryptedFileCard name={LATIN} onDownload={() => {}} /></div>, 'he');
    expect(bdiTexts(r.container)).toEqual(expect.arrayContaining([HEBREW, LATIN]));
  });

  it('maintenance server message is dir="auto"', async () => {
    const r = await show(<MaintenanceScreen surface="app" message="Back at 10:00 (UTC)." onRetry={async () => true} email="a@b.c" onSignOut={() => {}} />, 'ar');
    expect([...r.container.querySelectorAll('div')].find((d) => d.textContent === 'Back at 10:00 (UTC).')?.getAttribute('dir')).toBe('auto');
  });
});
