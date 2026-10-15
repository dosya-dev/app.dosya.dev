import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
const navigate = vi.fn();
const assign = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/api/client', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  API_BASE: '',
  api: (...args: unknown[]) => apiMock(...args),
}));
vi.mock('@/components/public-nav', () => ({ PublicNav: () => <nav /> }));

import { ApiError } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import ConnectWordPressPage from './wordpress';

const RETURN = 'https://blog.example.com/wp-admin/admin.php?page=dosya-backup';
const q = (over: Record<string, string> = {}) => '?' + new URLSearchParams({
  site_url: 'https://blog.example.com',
  home_url: 'https://blog.example.com',
  name: 'My Blog',
  fingerprint: 'f'.repeat(24),
  code_challenge: 'C'.repeat(43),
  state: 's'.repeat(32),
  return: RETURN,
  ...over,
}).toString();

const WORKSPACES = [{ id: 'ws_1', name: 'Personal' }, { id: 'ws_2', name: 'Agency' }];
const CAPS = { sites_max: 1, retention_days_max: 7, immutability_hours_max: 24 };

function route(over: { workspaces?: unknown[]; sites?: unknown[]; caps?: unknown; authorize?: () => unknown } = {}) {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/workspaces') return { ok: true, workspaces: over.workspaces ?? WORKSPACES };
    if (path === '/api/me') return { ok: true, user: { id: 'u', plan: { id: 'free', name: 'Free' } } };
    if (path === '/api/wp/sites') return { sites: over.sites ?? [], caps: over.caps ?? CAPS };
    if (path === '/api/wp/connect/authorize') {
      if (over.authorize) return over.authorize();
      return { ok: true, code: 'wpc_abc', state: 's'.repeat(32), expires_in: 300 };
    }
    throw new Error('unexpected ' + path);
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
});

describe('connect/wordpress page', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    apiMock.mockReset(); navigate.mockReset(); assign.mockReset(); sessionStorage.clear();
    useWorkspace.setState({ activeId: 'ws_2' });
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { act(() => root?.unmount()); container?.remove(); });

  const mount = async (query = q()) => {
    root = createRoot(container!);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[`/connect/wordpress${query}`]}>
          <ConnectWordPressPage />
        </MemoryRouter>,
      );
    });
    await act(async () => { await Promise.resolve(); });
  };
  const btn = (label: string) => Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
  const click = async (label: string) => {
    expect(btn(label), label).toBeTruthy();
    await act(async () => { btn(label)!.click(); });
  };

  it('shows the site host, the caps line and a workspace picker defaulting to the current workspace', async () => {
    route();
    await mount();
    expect(container!.textContent).toContain('blog.example.com');
    expect(container!.textContent).toContain('Free plan: 1 site, 7 days retention, 24 h immutability');
    const select = container!.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('ws_2');
    expect(container!.querySelector(`label[for="${select.id}"]`)).toBeTruthy();
    expect(container!.textContent).toContain('0 of 1 sites connected');
  });

  it('refuses a return URL on another host and offers no Allow', async () => {
    route();
    await mount(q({ return: 'https://evil.example/wp-admin/x' }));
    expect(container!.textContent).toContain('return address');
    expect(btn('Allow')).toBeUndefined();
  });

  it('refuses a return URL outside /wp-admin/', async () => {
    route();
    await mount(q({ return: 'https://blog.example.com/other' }));
    expect(btn('Allow')).toBeUndefined();
  });

  it('is incomplete without a required field', async () => {
    route();
    await mount(q({ state: '' }));
    expect(container!.textContent).toContain('This connect request is incomplete');
    expect(btn('Allow')).toBeUndefined();
  });

  it('Allow posts the chosen workspace and redirects with code and state', async () => {
    route();
    await mount();
    const select = container!.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'ws_1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click('Allow');
    const call = apiMock.mock.calls.find((c) => c[0] === '/api/wp/connect/authorize')!;
    expect(JSON.parse(call[1].body)).toEqual({
      workspace_id: 'ws_1', site_url: 'https://blog.example.com', home_url: 'https://blog.example.com',
      name: 'My Blog', fingerprint: 'f'.repeat(24), multisite: false, code_challenge: 'C'.repeat(43), state: 's'.repeat(32),
    });
    const url = new URL(assign.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://blog.example.com/wp-admin/admin.php');
    expect(url.searchParams.get('page')).toBe('dosya-backup');
    expect(url.searchParams.get('code')).toBe('wpc_abc');
    expect(url.searchParams.get('state')).toBe('s'.repeat(32));
  });

  it('Cancel redirects to return with error=cancelled and state', async () => {
    route();
    await mount();
    await click('Cancel');
    const url = new URL(assign.mock.calls[0][0]);
    expect(url.searchParams.get('error')).toBe('cancelled');
    expect(url.searchParams.get('state')).toBe('s'.repeat(32));
    expect(url.searchParams.get('code')).toBeNull();
    expect(apiMock.mock.calls.some((c) => c[0] === '/api/wp/connect/authorize')).toBe(false);
  });

  it('disables Allow and links to pricing when the site cap is reached', async () => {
    route({ sites: [{ id: 'a', status: 'active' }, { id: 'b', status: 'disconnected' }] });
    await mount();
    expect(container!.textContent).toContain('1 of 1 sites connected');
    expect((btn('Allow') as HTMLButtonElement).disabled).toBe(true);
    expect(container!.querySelector('a[href="/pricing"]')).toBeTruthy();
  });

  it('treats a 402 from authorize as the cap message', async () => {
    route({ authorize: () => { throw new ApiError(402, JSON.stringify({ ok: false, error: 'site_cap', message: 'Your plan allows 1 connected site(s).' })); } });
    await mount();
    await click('Allow');
    expect(assign).not.toHaveBeenCalled();
    expect(container!.querySelector('a[href="/pricing"]')).toBeTruthy();
    expect(container!.textContent).toContain('Your plan allows 1 connected site(s).');
  });

  it('a 401 remembers the path and goes to login', async () => {
    apiMock.mockRejectedValue(new ApiError(401, 'Sign in required'));
    await mount();
    expect(sessionStorage.getItem('dosya.postAuthPath')).toBe(`/connect/wordpress${q()}`);
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('does not redirect when the authorize response state does not match', async () => {
    route({ authorize: () => ({ ok: true, code: 'wpc_abc', state: 'x'.repeat(32), expires_in: 300 }) });
    await mount();
    await click('Allow');
    expect(assign).not.toHaveBeenCalled();
    expect(container!.textContent).toContain('The connection response did not match this request. Nothing was connected.');
  });

  it('does not redirect when the authorize response has no code', async () => {
    route({ authorize: () => ({ ok: true, state: 's'.repeat(32) }) });
    await mount();
    await click('Allow');
    expect(assign).not.toHaveBeenCalled();
  });

  it('with no workspace, says so, links home and keeps Allow disabled', async () => {
    route({ workspaces: [] });
    await mount();
    expect(container!.textContent).toContain('You have no workspace to save backups in.');
    expect(container!.querySelector('a[href="/"]')).toBeTruthy();
    expect((btn('Allow') as HTMLButtonElement).disabled).toBe(true);
  });

  const SHOP = { site_url: 'https://shop.test', home_url: 'https://shop.test' };
  it.each([
    'https://evil.com/wp-admin/',
    'https://shop.test@evil.com/wp-admin/',
    'https://shop.test.evil.com/wp-admin/',
    '//evil.com/wp-admin/',
    'javascript:alert(1)',
    'https://shop.test:8443/wp-admin/',
    'https://shop.test/wp-admin/../',
    'https://shop.test/wp-admin',
    'https://shop.test/wp-adminx/',
    'https://shop.test/WP-ADMIN/',
    'http://shop.test/wp-admin/',
  ])('refuses hostile return %s', async (ret) => {
    route();
    await mount(q({ ...SHOP, return: ret }));
    expect(btn('Allow')).toBeUndefined();
    expect(container!.textContent).toContain('refused');
  });

  it('accepts a clean return and preserves its query', async () => {
    route();
    await mount(q({ ...SHOP, return: 'https://shop.test/wp-admin/admin.php?page=dosya-backup' }));
    await click('Allow');
    const url = new URL(assign.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://shop.test/wp-admin/admin.php');
    expect(url.searchParams.get('page')).toBe('dosya-backup');
    expect(url.searchParams.get('code')).toBe('wpc_abc');
    expect(url.searchParams.get('state')).toBe('s'.repeat(32));
  });

  describe('subdirectory install', () => {
    const SUB = { site_url: 'https://shop.test/blog', home_url: 'https://shop.test/blog' };

    it('accepts a return under the subdirectory and redirects with code and state', async () => {
      route();
      await mount(q({ ...SUB, return: 'https://shop.test/blog/wp-admin/admin-post.php?action=dosya_connect_callback' }));
      await click('Allow');
      const url = new URL(assign.mock.calls[0][0]);
      expect(url.origin + url.pathname).toBe('https://shop.test/blog/wp-admin/admin-post.php');
      expect(url.searchParams.get('code')).toBe('wpc_abc');
      expect(url.searchParams.get('state')).toBe('s'.repeat(32));
    });

    it.each([
      'https://shop.test/wp-admin/admin-post.php',
      'https://shop.test/blog/../wp-admin/',
      'https://shop.test/blogx/wp-admin/',
    ])('refuses %s', async (ret) => {
      route();
      await mount(q({ ...SUB, return: ret }));
      expect(btn('Allow')).toBeUndefined();
      expect(container!.textContent).toContain('refused');
    });

    it('still accepts a root install', async () => {
      route();
      await mount(q({ ...SHOP, return: 'https://shop.test/wp-admin/admin-post.php?action=dosya_connect_callback' }));
      await click('Allow');
      expect(assign).toHaveBeenCalledTimes(1);
    });
  });
});
