/**
 * Task 10fix2: size, date, mime type and ratio runs in meta lines are isolated
 * in right-to-left (so "62.9 MB" never splits around a date), the notification
 * badge uses the language's digits, and the viewer counter reads as one
 * left-to-right unit. English text is unchanged.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/components/comments/api', () => ({
  listComments: vi.fn().mockResolvedValue([]), postComment: vi.fn(), deleteComment: vi.fn(),
  editComment: vi.fn(), searchMentionable: vi.fn().mockResolvedValue([]),
}));

const { default: FilesPage } = await import('@/pages/files');
const { default: ApiAnalyticsPage } = await import('@/pages/api-analytics');
const { FileViewer } = await import('@/components/file-viewer');
const { NotificationBell } = await import('@/components/notifications/notification-bell');
const { useNotifications } = await import('@/stores/notifications');
const { useWorkspace } = await import('@/stores/workspace');

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
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await Promise.resolve(); });
async function show(ui: React.ReactElement, locale: 'en' | 'ar' | 'fa') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  shown = await renderInLocale(
    <QueryClientProvider client={queryClient}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>,
    locale,
  );
  await flush();
  await flush();
  return shown;
}

const file = {
  id: 'f1', name: 'clip.mp4', size_bytes: 65_950_000, mime_type: 'video/mp4', extension: 'mp4', region: 'weur',
  created_at: 1_700_000_000, updated_at: 1_700_000_100, current_version: 1, lock_mode: 'none', is_hidden: 0,
  hidden_mode: 'none', uploaded_by: 'u1', uploader_name: 'A', share_count: 0, comment_count: 0, is_synced: 0,
  origin: null, captured_at: null,
};
const file2 = { ...file, id: 'f2', name: 'two.mp4' };
const bdiTexts = (root: ParentNode) => [...root.querySelectorAll('bdi')].map((b) => b.textContent);

describe('card meta line', () => {
  const open = async (locale: 'en' | 'ar') => {
    localStorage.setItem('dosya_files_view', 'grid');
    apiMock.mockImplementation((path: unknown) => Promise.resolve(typeof path === 'string' && path.startsWith('/api/cloud/imports') ? { ok: true, jobs: [] } : {
      ok: true, folders: [], breadcrumbs: [], files: [file],
      pagination: { page: 1, per_page: 100, total_files: 1, total_pages: 1 },
    }));
    return show(<FilesPage />, locale);
  };
  const metaLine = (root: ParentNode) =>
    [...root.querySelectorAll('p')].find((p) => p.className.includes('text-white/70') && p.querySelector(':scope > bdi'));
  it('ar: size and date are separate isolates', async () => {
    const r = await open('ar');
    const p = metaLine(r.container) as HTMLElement;
    expect(p).toBeTruthy();
    expect(p.querySelectorAll(':scope > bdi')).toHaveLength(2);
    expect(p.children[0].textContent).toMatch(/MB|م/);
  });
  it('en: text is exactly the old string (size · date), no extra characters', async () => {
    const r = await open('en');
    const p = metaLine(r.container) as HTMLElement;
    // base ad3be9849: {humanSize(...)} · <DateCell/>
    expect(p.textContent).toMatch(/^\d[\d.]* MB · \S/);
    expect(p.textContent).toBe(`${p.children[0].textContent} · ${p.children[1].textContent}`);
  });
});

describe('API analytics errors tile', () => {
  const tables: Record<string, unknown> = {
    '/api/me/api-keys': { ok: true, keys: [] },
    '/api/me/api-analytics/series': { ok: true, range: '24h', bucket_seconds: 3600, series: [{ t: 1_700_000_000, total: 25, errors: 20 }], totals: { total: 25, errors: 20 } },
    '/api/me/api-analytics/logs': { ok: true, logs: [], has_more: false },
  };
  const tile = (root: ParentNode) => [...root.querySelectorAll('p')].find((p) => p.className.includes('text-2xl') && p.querySelector('bdi'));
  it('ar: count and percentage are separate isolates', async () => {
    apiMock.mockImplementation((path: string) => Promise.resolve(tables[path.split('?')[0]] ?? { ok: true }));
    const r = await show(<ApiAnalyticsPage />, 'ar');
    const p = tile(r.container) as HTMLElement;
    expect(p).toBeTruthy();
    expect([...p.querySelectorAll(':scope > bdi')].map((b) => b.textContent)).toEqual(['20', '80.0%']);
  });
  it('en: text is exactly count then percentage', async () => {
    apiMock.mockImplementation((path: string) => Promise.resolve(tables[path.split('?')[0]] ?? { ok: true }));
    const r = await show(<ApiAnalyticsPage />, 'en');
    expect((tile(r.container) as HTMLElement).textContent).toBe('2080.0%');
  });
});

describe('notification badge', () => {
  const badge = async (locale: 'en' | 'fa') => {
    useNotifications.setState({ unread: 3, items: [], open: false, loading: false });
    return show(<NotificationBell />, locale);
  };
  it('fa uses Persian digits, en unchanged', async () => {
    let r = await badge('fa');
    expect(r.container.textContent).toContain('۳');
    r.unmount();
    r = await badge('en');
    expect(r.container.textContent).toBe('3');
  });
});

describe('viewer', () => {
  const view = async (locale: 'en' | 'ar') => {
    apiMock.mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    shown = await renderInLocale(
      createElement(FileViewer, {
        file: file as never, files: [file, file2] as never, workspaceId: 'w1',
        onClose: () => {}, onNavigate: () => {}, onRefresh: () => {},
      }),
      locale,
    );
    await flush();
    await flush();
    return shown;
  };
  afterEach(() => { vi.unstubAllGlobals(); });
  it('ar: counter is an LTR unit, sub-line values are isolated', async () => {
    const r = await view('ar');
    const counter = [...r.container.querySelectorAll('span')].find((s) => /^1 \/ 2$/.test(s.textContent ?? '')) as HTMLElement;
    expect(counter?.getAttribute('dir')).toBe('ltr');
    const texts = bdiTexts(r.container);
    expect(texts).toContain('video/mp4');
    expect(texts.filter((t) => /MB/.test(t ?? '')).length).toBeGreaterThanOrEqual(2);
  });
  it('en: counter and sub-line text unchanged', async () => {
    const r = await view('en');
    const counter = [...r.container.querySelectorAll('span')].find((s) => /^1 \/ 2$/.test(s.textContent ?? ''));
    expect(counter).toBeTruthy();
    expect(r.container.textContent).toContain('62.9 MB · video/mp4 · v1');
  });
});
