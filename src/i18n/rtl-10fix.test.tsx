/**
 * Task 10 fixes: the rename badge keeps its old text and one flex item in
 * English (and isolates both names in right-to-left), counts use the language's
 * digits (Persian gets its own, Arabic keeps Western), and truncating names
 * resolve their own direction so Latin names clip at their end.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { default: ActivityPage } = await import('@/pages/activity');
const { SetupPill } = await import('@/components/onboarding/setup-pill');
const { useOnboarding } = await import('@/stores/onboarding');
const { useWorkspace } = await import('@/stores/workspace');
const { localDigits } = await import('@/lib/format-locale');
const { default: FilesPage } = await import('@/pages/files');

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

const renameRow = {
  id: 'a1', action: 'file_renamed', entity_type: 'file', entity_id: 'f1', created_at: Math.floor(Date.now() / 1000) - 600,
  user_name: 'Ada', user_id: 'u1', user_email: 'ada@example.com', user_avatar: null, resource_name: 'x.pdf',
  meta: { old_name: 'old name.pdf', new_name: 'new name.pdf' },
};
const activityApi = () => async (path: string) => {
  if (path.startsWith('/api/activity')) {
    return { ok: true, activities: [renameRow], members: [], pagination: { page: 1, per_page: 30, total: 1, total_pages: 1 } };
  }
  return { ok: true };
};
const renameBadge = (root: ParentNode) =>
  [...root.querySelectorAll('span')].find((s) => s.textContent?.includes('old name.pdf') && s.textContent.includes('new name.pdf') && s.querySelector(':scope > span > bdi'));

describe('rename row spacing', () => {
  it('English text is exactly the old string and is one flex item', async () => {
    apiMock.mockImplementation(activityApi());
    const r = await show(<ActivityPage />, 'en');
    const badge = renameBadge(r.container) as HTMLElement;
    expect(badge).toBeTruthy();
    // base ad3be9849: {meta.old_name} → {meta.new_name}
    expect(badge.textContent).toBe('old name.pdf → new name.pdf');
    expect(badge.children).toHaveLength(1);
    expect(badge.children[0].tagName).toBe('SPAN');
  });

  it('still isolates both names in right-to-left', async () => {
    apiMock.mockImplementation(activityApi());
    const r = await show(<ActivityPage />, 'he');
    const badge = renameBadge(r.container) as HTMLElement;
    expect([...badge.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['old name.pdf', 'new name.pdf']);
  });
});

describe('counts use the language digits', () => {
  it('localDigits: fa Persian, ar Western, en plain with no grouping', async () => {
    const out: Record<string, string> = {};
    for (const l of ['en', 'de', 'ar', 'fa'] as const) {
      const r = await renderInLocale(<div />, l);
      out[l] = localDigits(1234);
      r.unmount();
    }
    expect(out.en).toBe('1234');
    expect(out.de).toBe('1234');
    expect(out.ar).toBe('1234');
    expect(out.fa).toBe('۱۲۳۴');
  });

  const pill = async (locale: 'en' | 'fa' | 'ar') => {
    useOnboarding.setState({
      purpose: 'dev', dismissed: false, loaded: true, failed: false,
      steps: { upload: true, share: false, import: false, api_key: true, client_used: false, invite: false, file_request: false, geo: false, desktop: false, mobile: false },
    });
    return show(<SetupPill />, locale);
  };
  it('setup chip: fa Persian, ar Western, en unchanged', async () => {
    let r = await pill('fa');
    expect(r.container.querySelector('[data-testid="setup-pill"]')!.textContent).toMatch(/۲\/۴/);
    r.unmount();
    r = await pill('ar');
    expect(r.container.querySelector('[data-testid="setup-pill"]')!.textContent).toMatch(/2\/4/);
    r.unmount();
    r = await pill('en');
    expect(r.container.querySelector('[data-testid="setup-pill"]')!.textContent).toMatch(/2\/4/);
  });
});

describe('truncating names resolve their own direction', () => {
  it('every truncating element that holds a name has dir="auto" (ar list view)', async () => {
    localStorage.setItem('dosya_files_view', 'list');
    apiMock.mockImplementation((path: unknown) => Promise.resolve(typeof path === 'string' && path.startsWith('/api/cloud/imports') ? { ok: true, jobs: [] } : {
      ok: true, folders: [], breadcrumbs: [],
      files: [{ id: 'f1', name: 'report (1).pdf', size_bytes: 1, mime_type: 'application/pdf', extension: 'pdf', region: 'us', created_at: 1_700_000_000, updated_at: 1_700_000_100, current_version: 1, lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', uploaded_by: 'u1', uploader_name: 'A', share_count: 0, comment_count: 0, is_synced: 0, origin: null, captured_at: null }],
      pagination: { page: 1, per_page: 100, total_files: 1, total_pages: 1 },
    }));
    const r = await show(<FilesPage />, 'ar');
    // The truncating element holds the name itself (dir="auto" skips <bdi>).
    const truncating = [...r.container.querySelectorAll('.truncate')].find((el) => el.textContent === 'report (1).pdf') as HTMLElement;
    expect(truncating).toBeTruthy();
    expect(truncating.querySelector('bdi')).toBeNull();
    expect(truncating.getAttribute('dir')).toBe('auto');
  });
});
