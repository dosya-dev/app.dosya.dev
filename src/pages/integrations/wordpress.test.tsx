import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { WORDPRESS_ORG_URL } from '@/lib/integrations';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  API_BASE: '',
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/api/client';
const { default: WordPressSetup } = await import('./wordpress');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
});

const NOW = Math.floor(Date.now() / 1000);
const CAPS = { sites_max: 1, retention_days_max: 7, immutability_hours_max: 24 };
const site = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Site ${id}`, site_url: `https://${id}.example.com/blog`, status: 'active',
  created_at: NOW, last_heartbeat_at: NOW, retention_days: 7, immutability_hours: 24,
  workspace_id: 'w1', root_folder_id: `fold_${id}`, ...over,
});
const backup = (over: Record<string, unknown> = {}) => ({
  id: 'b1', kind: 'incremental', state: 'verified', bytes_new: 38 * 1024 * 1024, bytes_total: 1.2 * 1024 ** 3,
  volume_count: 1, locked_until: NOW + 3600, expires_at: NOW + 86400, created_at: NOW - 7200, completed_at: NOW - 7200, ...over,
});

function route(opts: {
  sites?: unknown[]; caps?: unknown; backups?: Record<string, unknown>; sitesError?: unknown;
}) {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/api/wp/sites') {
      if (opts.sitesError) throw opts.sitesError;
      return { sites: opts.sites ?? [], caps: opts.caps ?? CAPS };
    }
    const m = /^\/api\/wp\/sites\/([^/]+)\/backups$/.exec(path);
    if (m) {
      const v = opts.backups?.[m[1]];
      if (v instanceof Error) throw v;
      return { backups: v ?? [] };
    }
    if (/\/disconnect$/.test(path) && init?.method === 'POST') return { ok: true };
    throw new Error('unexpected ' + path);
  });
}

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><WordPressSetup /></MemoryRouter>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const text = () => container!.textContent ?? '';
const rows = () => [...container!.querySelectorAll('[data-testid="wp-site-row"]')] as HTMLElement[];

beforeEach(() => { apiMock.mockReset(); });

describe('WordPressSetup', () => {
  it('shows the empty state with the listing link and the three steps', async () => {
    route({ sites: [] });
    await render();
    expect(text()).toContain('No WordPress site connected yet.');
    expect(text()).toContain('Install it on your site, then press Connect to dosya in wp-admin.');
    expect(text()).toContain('Add a site');
    expect(text()).not.toContain('Add another site');
    const links = [...container!.querySelectorAll(`a[href="${WORDPRESS_ORG_URL}"]`)];
    const primary = links.find((a) => a.textContent?.includes('View on WordPress.org'));
    expect(primary).toBeTruthy();
    expect(primary!.getAttribute('target')).toBe('_blank');
    for (const s of ['Install', 'Connect', 'Back up']) expect(text()).toContain(s);
    expect(container!.querySelector('[data-testid="wp-site-row"]')).toBeNull();
  });

  it('lists sites with host, last backup, protection and no-backup states', async () => {
    route({
      sites: [site('a'), site('b')],
      backups: { a: [backup()], b: [] },
      caps: { sites_max: 3, retention_days_max: 7, immutability_hours_max: 24 },
    });
    await render();
    const [a, b] = rows();
    expect(a.textContent).toContain('Site a');
    expect(a.textContent).toContain('a.example.com');
    expect(a.textContent).toContain('2h ago');
    expect(a.textContent).toContain('incremental, 38 MB new');
    expect(a.textContent).toContain('1.2 GB');
    expect(a.textContent).toContain('Protected until');
    expect(b.textContent).toContain('No backup yet');
    expect(text()).toContain('Add another site');
    expect(text()).toContain('2 of 3 on your plan · 7-day retention · 24 h protection');
    const open = a.querySelector('a[href="/files?folder=fold_a"]');
    expect(open?.textContent).toContain('Open folder');
  });

  it('shows Connected when the lock has passed, and the other backup states', async () => {
    route({
      sites: [site('a'), site('b'), site('c', { status: 'clone_suspected' })],
      backups: {
        a: [backup({ locked_until: NOW - 10, kind: 'full' })],
        b: [backup({ state: 'running', completed_at: null })],
        c: [backup()],
      },
    });
    await render();
    const [a, b, c] = rows();
    expect(a.textContent).toContain('Connected');
    expect(a.textContent).toContain('full, 1.2 GB');
    expect(b.textContent).toContain('Uploading…');
    expect(c.textContent).toContain('Copy detected, check the site');
  });

  it('words the caps line with and without a site limit', async () => {
    route({ sites: [site('a')], backups: { a: [backup()] } });
    await render();
    expect(text()).toContain('1 of 1 on your plan · 7-day retention · 24 h protection');
    act(() => root!.unmount());
    container!.remove();
    route({ sites: [site('a'), site('b')], caps: { sites_max: null, retention_days_max: 30, immutability_hours_max: 72 } });
    await render();
    expect(text()).toContain('2 sites · 30-day retention · 72 h protection');
  });

  it('keeps the table when one site backups request fails', async () => {
    route({ sites: [site('a'), site('b')], backups: { a: new ApiError(500, 'boom'), b: [backup()] } });
    await render();
    const [a, b] = rows();
    expect(a.textContent).toContain('Unknown');
    expect(a.textContent).not.toContain('None');
    expect(a.querySelectorAll('td')[2].textContent).toBe('Unknown');
    expect(b.textContent).toContain('Protected until');
  });

  it('shows the sites error message', async () => {
    route({ sitesError: new ApiError(500, JSON.stringify({ message: 'Database is down' })) });
    await render();
    expect(text()).toContain('Database is down');
  });

  it('disconnects after confirming, once, and removes the row', async () => {
    route({ sites: [site('a'), site('b')], backups: { a: [backup()], b: [backup()] } });
    await render();
    const trigger = container!.querySelector('button[aria-label="Actions for Site a"]') as HTMLElement;
    await act(async () => { trigger.click(); });
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.includes('Disconnect')) as HTMLElement;
    expect(item).toBeTruthy();
    await act(async () => { item.click(); });
    expect(document.body.textContent).toContain('Disconnect Site a from dosya? Backups already stored in dosya are kept.');
    const confirm = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Disconnect').pop() as HTMLElement;
    await act(async () => { confirm.click(); confirm.click(); });
    const posts = apiMock.mock.calls.filter((c) => String(c[0]).endsWith('/disconnect'));
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe('/api/wp/sites/a/disconnect');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('Site b');
    expect(document.body.textContent).not.toContain('Disconnect Site a from dosya?');
    expect(document.body.textContent).toContain('Site disconnected');
  });

  it('renders skeleton rows while loading', async () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    await render();
    expect(container!.querySelectorAll('[data-testid="wp-site-skeleton"]').length).toBeGreaterThan(0);
  });

  it('flags a failed newest backup in amber and keeps Stored on the last good one', async () => {
    route({ sites: [site('a')], backups: { a: [backup({ state: 'failed', id: 'b2' }), backup({ bytes_total: 5 * 1024 * 1024 })] } });
    await render();
    const [a] = rows();
    expect(a.textContent).toContain('Failed');
    expect(a.textContent).toContain('Last backup failed');
    expect(a.textContent).toContain('5 MB');
    expect(a.querySelector('.bg-amber-500')).not.toBeNull();
  });

  it('hides Open folder without a root folder id', async () => {
    route({ sites: [site('a', { root_folder_id: null })], backups: { a: [backup()] } });
    await render();
    expect(rows()[0].textContent).not.toContain('Open folder');
  });

  it('caps at 20 sites, keeps the real count and says so', async () => {
    const many = Array.from({ length: 23 }, (_, i) => site(`s${i}`));
    route({ sites: many, caps: { sites_max: null, retention_days_max: 7, immutability_hours_max: 24 } });
    await render();
    expect(rows()).toHaveLength(20);
    expect(text()).toContain('23 sites');
    expect(text()).toContain('Showing 20 of 23 sites.');
    const trigger = container!.querySelector('button[aria-label="Actions for Site s0"]') as HTMLElement;
    await act(async () => { trigger.click(); });
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.includes('Disconnect')) as HTMLElement;
    await act(async () => { item.click(); });
    const confirm = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Disconnect').pop() as HTMLElement;
    await act(async () => { confirm.click(); });
    expect(rows()).toHaveLength(19);
    expect(text()).toContain('22 sites');
    expect(text()).toContain('Showing 19 of 22 sites.');
  });

  it('titles the rail Add a site when loading failed', async () => {
    route({ sitesError: new ApiError(500, 'x') });
    await render();
    expect(text()).toContain('Add a site');
    expect(text()).not.toContain('Add another site');
  });

  it('does not ask for an API key and links out safely', async () => {
    route({ sites: [] });
    await render();
    const hrefs = [...container!.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/profile/api');
    const docs = container!.querySelector('a[href="https://dosya.dev/integration/wordpress"]');
    for (const l of [docs]) {
      expect(l?.getAttribute('target')).toBe('_blank');
      expect(l?.getAttribute('rel')).toContain('noreferrer');
    }
    expect(text()).toContain('Restoring is free at any size.');
    expect(hrefs).toContain('/billing');
    expect(text()).not.toContain('WP-CLI');
  });
});
