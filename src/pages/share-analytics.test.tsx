import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { default: ShareAnalyticsPage } = await import('./share-analytics');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
});

const NOW = 1_756_800_000;

const ANALYTICS = {
  ok: true,
  link: {
    link_id: 'lnk_1', url: 'https://dosya.dev/s/tok', display_name: 'report.pdf',
    is_folder: false, is_bundle: false, size_bytes: 1024, extension: '.pdf', region: 'ap-southeast-2',
    created_at: NOW - 86_400, created_by: 'u1', created_by_name: 'Ada', is_mine: true,
    expires_at: null, is_revoked: false, revoked_at: null, is_password_protected: false,
    lock_mode: 'none', access_mode: 'public', status: 'active',
    view_count: 3, download_count: 1,
  },
  range: 30,
  timeline: [{ day: '2026-09-01', opens: 3, downloads: 1 }],
  reach: {
    visitors: 2, truncated: false,
    devices: [{ label: 'Desktop', count: 2 }],
    browsers: [{ label: 'Chrome', count: 2 }],
  },
  recipients: null,
  log: {
    total: 2, offset: 0, limit: 50,
    rows: [
      { id: 'v1', visitor: 'a1b2c3d4', event: 'view', device: 'desktop', device_label: 'Chrome on Mac', country: 'TR', viewed_at: NOW - 3_600 },
      // An older row, or a request the edge could not place: the column is
      // null, which is NOT the same as the feature being off.
      { id: 'v2', visitor: 'e5f6g7h8', event: 'download', device: 'mobile', device_label: 'Safari on iPhone', country: null, viewed_at: NOW - 7_200 },
    ],
  },
  gaps: {
    repeat_visits: 'a returning visitor is deduped by ip_hash and never counted twice',
    per_recipient: null,
  },
};

async function render(payload: unknown = ANALYTICS) {
  apiMock.mockResolvedValue(payload);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/shared/lnk_1']}>
          <Routes><Route path="/shared/:id" element={<ShareAnalyticsPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
  // react-query settles on a macrotask: without this the page is still its
  // loading skeleton and every assertion below would read an empty container.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const countryCells = () => [...container!.querySelectorAll('[data-testid="log-country"]')].map((c) => c.textContent?.trim());

/**
 * The API selects and returns `country` on every access-log row, and has
 * dropped the `gaps.country` note that said it did not. This page still
 * declared the row without the field, printed four columns, and told the user
 * country was "not tracked" beside a response carrying exactly that.
 */
describe('ShareAnalyticsPage country', () => {
  it('gives the access log a Country column', async () => {
    await render();
    const headers = [...container!.querySelectorAll('th')].map((h) => h.textContent?.trim());
    expect(headers).toContain('Country');
  });

  it('renders the country on a row that has one, and a neutral dash on a row that does not', async () => {
    await render();
    expect(countryCells()).toEqual(['TR', '-']);
  });

  it('no longer claims country is untracked', async () => {
    await render();
    expect(container!.textContent).not.toContain('not tracked');
    expect(container!.textContent).not.toContain('Not recorded');
  });

  it('breaks reach down by country, counting the unplaceable rows separately', async () => {
    await render();
    const rail = [...container!.querySelectorAll('section')].find((s) => s.textContent?.includes('Who reached it'))!;
    expect(rail, 'reach panel').toBeTruthy();
    expect(rail.textContent).toContain('Country');
    expect(rail.textContent).toContain('TR');
    expect(rail.textContent).toContain('Unknown');
  });

  it('says nothing about country when no loaded event carries one', async () => {
    await render({
      ...ANALYTICS,
      log: { ...ANALYTICS.log, rows: [{ ...ANALYTICS.log.rows[1] }] },
    });
    const rail = [...container!.querySelectorAll('section')].find((s) => s.textContent?.includes('Who reached it'))!;
    // One unplaceable row is not a country breakdown; showing "Unknown 100%"
    // would be noise dressed as data.
    expect(rail.textContent).not.toContain('Country');
    expect(countryCells()).toEqual(['-']);
  });
});
