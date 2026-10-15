import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

// The profile is split into one route per section. These tests pin the
// routing contract: /profile lands somewhere sensible on each width, the old
// ?section= deep links still work, and a section page renders ONLY its own
// section - the whole point of the split.

const reqMock = vi.fn();
vi.mock('@/api/req', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/req')>();
  return { ...actual, req: (...args: unknown[]) => reqMock(...args) };
});

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

vi.mock('@/api/cloud-import', () => ({ listProviders: async () => [] }));

let mobile = false;
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobile }));

const { default: ProfilePage } = await import('./profile');

const USER = {
  id: 'u1', name: 'Firat Kaya', email: 'firat@example.com', initials: 'FK',
  avatar_url: null, preferred_language: 'en', created_at: 1_700_000_000,
  email_verified_at: 1_700_000_000, workspace_count: 1, has_password: true,
};

function answer(path: string): unknown {
  if (path === '/api/me') return { ok: true, user: USER };
  if (path === '/api/me/2fa/status') return { ok: true, method: null, totp_enabled: false, recovery_codes_remaining: 0 };
  if (path === '/api/me/api-keys') return { ok: true, keys: [] };
  if (path === '/api/me/sessions') return { ok: true, sessions: [{ id: 's1', device: 'MacBook', kind: 'desktop', browser: 'Chrome', meta: 'now', is_current: true, created_at: 1 }] };
  if (path === '/api/workspaces') return { ok: true, workspaces: [] };
  if (path === '/api/cloud/accounts') return { ok: true, accounts: [] };
  if (path === '/api/me/ai-connections') return { ok: true, connections: [] };
  if (path === '/api/me/notifications') return { ok: true, groups: [], channels: {} };
  if (path === '/api/me/delete-preview') return { ok: true, workspaces: [], file_count: 0, window_days: 30, deletion_scheduled_for: null };
  return { ok: true };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mobile = false;
  reqMock.mockImplementation(async (path: string) => answer(path));
  apiMock.mockImplementation(async (path: string) => answer(path));
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  reqMock.mockReset();
  apiMock.mockReset();
});

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

async function open(url: string) {
  const router = createMemoryRouter(
    [{ path: '/profile/:section?', element: <ProfilePage /> }, { path: '*', element: <p>elsewhere</p> }],
    { initialEntries: [url] },
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<RouterProvider router={router} />); });
  await flush();
  return router;
}

const headings = () => Array.from(container!.querySelectorAll('h2')).map((h) => h.textContent);

describe('profile routes', () => {
  it('/profile on a desktop lands on Identity and renders only that section', async () => {
    const router = await open('/profile');
    expect(router.state.location.pathname).toBe('/profile/identity');
    expect(headings()).toContain('Identity');
    expect(headings()).not.toContain('Active sessions');
    expect(headings()).not.toContain('Delete account');
  });

  it('a section page renders only its own section and marks its rail entry current', async () => {
    await open('/profile/sessions');
    expect(headings()).toEqual(['Active sessions']);
    const current = container!.querySelector('nav a[aria-current="page"]');
    expect(current?.textContent?.trim()).toBe('Sessions');
    expect(current?.getAttribute('href')).toBe('/profile/sessions');
  });

  it('keeps the old ?section= deep links working as redirects', async () => {
    const router = await open('/profile?section=delete');
    expect(router.state.location.pathname).toBe('/profile/delete');
    expect(router.state.location.search).toBe('');
    expect(headings()).toEqual(['Delete account']);
  });

  it('keeps the old #section- anchors working as redirects', async () => {
    const router = await open('/profile#section-api');
    expect(router.state.location.pathname).toBe('/profile/api');
    expect(router.state.location.hash).toBe('');
    expect(headings()).toEqual(['API keys']);
  });

  it('keeps the links old notification emails carry working as redirects', async () => {
    let router = await open('/profile#sessions');
    expect(router.state.location.pathname).toBe('/profile/sessions');
    expect(router.state.location.hash).toBe('');
    router = await open('/profile#security');
    expect(router.state.location.pathname).toBe('/profile/password');
    router = await open('/profile#danger');
    expect(router.state.location.pathname).toBe('/profile/delete');
  });

  it('sends an unknown section back to the start', async () => {
    const router = await open('/profile/nope');
    expect(router.state.location.pathname).toBe('/profile/identity');
  });

  it('on a phone, /profile is a list of every section with no section content', async () => {
    mobile = true;
    const router = await open('/profile');
    expect(router.state.location.pathname).toBe('/profile');
    const links = Array.from(container!.querySelectorAll('a[href^="/profile/"]')).map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/profile/identity', '/profile/appearance', '/profile/password', '/profile/api', '/profile/sessions',
      '/profile/notifications', '/profile/integrations', '/profile/ai-apps', '/profile/workspaces', '/profile/privacy', '/profile/delete',
    ]);
    expect(headings()).toEqual([]);
  });

  it('on a phone, a section page offers a way back to the list', async () => {
    mobile = true;
    await open('/profile/sessions');
    expect(headings()).toEqual(['Active sessions']);
    const back = Array.from(container!.querySelectorAll('a')).find((a) => a.getAttribute('href') === '/profile');
    expect(back).toBeTruthy();
  });

  it('the delete page points "Get a copy" at the privacy page instead of scrolling', async () => {
    await open('/profile/delete');
    const link = Array.from(container!.querySelectorAll('a')).find((a) => a.textContent?.includes('Get a copy'));
    expect(link?.getAttribute('href')).toBe('/profile/privacy');
  });
});
