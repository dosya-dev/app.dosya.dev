import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const bootDashboard = vi.hoisted(() => vi.fn());
const api = vi.fn();
// PublicNav probes /api/me on mount; keep it off the ordered mock above.
const meApi = vi.fn();

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/api/client', async (importOriginal) => ({
  // shouldRetryQuery does `error instanceof ApiError` on every retry, and a retry
  // can outlive the test that started it - a mock without it throws and fails the run.
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  API_BASE: '',
  api: (...args: unknown[]) => (args[0] === '/api/me' ? meApi(...args) : api(...args)),
}));

vi.mock('@/lib/boot', () => ({
  bootDashboard: (...args: unknown[]) => bootDashboard(...args),
}));

vi.mock('@/components/layout/dashboard-sidebar', () => ({
  DashboardSidebar: () => <aside>Sidebar</aside>,
}));
vi.mock('@/components/layout/dashboard-topbar', () => ({
  DashboardTopbar: () => <header>Topbar</header>,
}));
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/deletion-banner', () => ({
  DeletionBanner: () => null,
}));
vi.mock('@/components/uploads/upload-dock', () => ({
  default: () => null,
}));
vi.mock('@/components/notifications/notification-poller', () => ({
  NotificationPoller: () => null,
}));

// Turnstile injects a Cloudflare script and renders an iframe; irrelevant here
// and unavailable in jsdom. The handle must still expose the methods the pages
// call on submit, or the click path throws before the fetch is made.
vi.mock('@/components/turnstile-widget', () => ({
  TurnstileWidget: () => <div data-testid="turnstile" />,
}));

import LoginPage from './login';
import SignUpPage from './sign-up';
import VerifyPage from './verify';
import Login2faPage from './login-2fa';
import { DashboardLayout } from '@/components/layout/dashboard-layout';

const TERMS_URL = 'https://dosya.dev/terms-of-service';
const PRIVACY_URL = 'https://dosya.dev/privacy-policy';
const VALID_CLAIM = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCD';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('auth pages - legal notices', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    meApi.mockRejectedValue(new Error('Not authenticated'));
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    navigate.mockClear();
    api.mockReset();
    meApi.mockReset();
    bootDashboard.mockReset();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  async function render(Page: () => React.ReactNode, entry = '/') {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[entry]}>
          <Page />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
  }

  function links() {
    return [...container!.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  }

  function setInput(selector: string, value: string) {
    const el = container!.querySelector<HTMLInputElement>(selector)!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    act(() => {
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function submitForm() {
    await act(async () => {
      container!.querySelector<HTMLFormElement>('form')!.requestSubmit();
      await Promise.resolve();
    });
  }

  it('sign-up links BOTH the Terms of Service and the Privacy Policy', async () => {
    await render(SignUpPage);
    // The privacy notice must be given at the point personal data is
    // collected, which is this form - a Terms-only link does not cover it.
    expect(links()).toContain(TERMS_URL);
    expect(links()).toContain(PRIVACY_URL);
  });

  it('login links BOTH the Terms of Service and the Privacy Policy', async () => {
    await render(LoginPage);
    expect(links()).toContain(TERMS_URL);
    expect(links()).toContain(PRIVACY_URL);
  });

  it('sign-up carries a notice covering the OAuth buttons, not just the checkbox', async () => {
    await render(SignUpPage);
    // "Continue with Google" sits ABOVE the form and creates a real account
    // without ever touching the consent checkbox. The API stamps those
    // accounts as having accepted, so the passive notice is what that stamp
    // rests on - the checkbox alone leaves the OAuth path unnoticed.
    expect(container!.textContent).toContain('By continuing, you agree to our');
  });

  it('legal links open in a new tab without leaking the referrer', async () => {
    await render(SignUpPage);
    const legal = [...container!.querySelectorAll('a')].filter((a) =>
      [TERMS_URL, PRIVACY_URL].includes(a.getAttribute('href') ?? ''),
    );
    expect(legal.length).toBeGreaterThanOrEqual(2);
    for (const a of legal) {
      // target=_blank without rel=noreferrer hands the opened page a
      // window.opener handle back into the authenticated app.
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel') ?? '').toContain('noreferrer');
    }
  });

  it('sign-up tells the API the terms were accepted', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ ok: true, redirect: '/verify' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await render(SignUpPage);

    const set = (id: string, value: string) => {
      const el = container!.querySelector<HTMLInputElement>(`#${id}`)!;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      act(() => {
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    set('name', 'Ada Lovelace');
    set('email', 'ada@example.com');
    set('password', 'Correct-Horse-99');

    // Tick the consent checkbox, then submit. Base UI's visible root is a
    // <span role="checkbox"> that ignores a synthetic .click(); the hidden
    // native input behind it is what actually drives the state.
    act(() => {
      container!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    expect(
      container!.querySelector('[data-slot="checkbox"]')!.getAttribute('aria-checked'),
      'consent checkbox did not tick - the rest of this test would be vacuous',
    ).toBe('true');
    await act(async () => {
      container!.querySelector<HTMLFormElement>('form')!.requestSubmit();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // The server rejects a signup without this field, so a client that never
    // sends it cannot create an account at all.
    expect(JSON.parse(init.body as string)).toMatchObject({ terms: true });
  });

  it('login success prefers a pending Gumroad redemption over the API redirect', async () => {
    sessionStorage.setItem('dosya_redemption_claim', VALID_CLAIM);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, redirect: '/files' }),
    })));
    await render(LoginPage);

    setInput('#email', 'buyer@example.test');
    setInput('#password', 'Correct-Horse-99');
    await submitForm();

    expect(navigate).toHaveBeenCalledWith('/redeem');
  });

  it('sign-up success preserves the pending Gumroad claim but still sends the buyer to email verification', async () => {
    sessionStorage.setItem('dosya_redemption_claim', VALID_CLAIM);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, redirect: '/verify' }),
    })));
    await render(SignUpPage);

    setInput('#name', 'Ada Lovelace');
    setInput('#email', 'ada@example.com');
    setInput('#password', 'Correct-Horse-99');
    act(() => {
      container!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    await submitForm();

    expect(navigate).toHaveBeenCalledWith('/verify');
    expect(sessionStorage.getItem('dosya_redemption_claim')).toBe(VALID_CLAIM);
  });

  it('email verification success resumes a pending Gumroad redemption', async () => {
    sessionStorage.setItem('dosya_redemption_claim', 'R'.repeat(40));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, redirect: '/create-workspace' }),
    })));
    await render(VerifyPage, '/verify?email=buyer%40example.test');

    setInput('input[inputmode="numeric"]', '123456');
    await submitForm();

    expect(navigate).toHaveBeenCalledWith('/redeem');
  });

  it('2FA success resumes a pending Gumroad redemption', async () => {
    sessionStorage.setItem('dosya_redemption_claim', VALID_CLAIM);
    api.mockResolvedValueOnce({ ok: true, redirect: '/files' });
    await render(Login2faPage);

    setInput('input[inputmode="numeric"]', '123456');
    const button = [...container!.querySelectorAll('button')].find((el) => el.textContent?.includes('Verify'))!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledWith('/redeem');
  });

  async function renderDashboard(entry = '/') {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<div>Dashboard page</div>} />
              <Route path="/files" element={<div>Files page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('continues an authenticated root landing with a pending Gumroad claim', async () => {
    sessionStorage.setItem('dosya_redemption_claim', 'R'.repeat(40));
    bootDashboard.mockResolvedValueOnce({
      authed: true,
      redirect: null,
      themePref: null,
      activeWorkspaceId: 'ws_1',
    });

    await renderDashboard('/');

    expect(navigate).toHaveBeenCalledWith('/redeem', { replace: true });
  });

  it('does not continue an unauthenticated root landing with a pending Gumroad claim', async () => {
    sessionStorage.setItem('dosya_redemption_claim', VALID_CLAIM);
    bootDashboard.mockResolvedValueOnce({
      authed: false,
      redirect: '/login',
      themePref: null,
      activeWorkspaceId: null,
    });

    await renderDashboard('/');

    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
    expect(navigate).not.toHaveBeenCalledWith('/redeem', { replace: true });
  });

  it('does not continue authenticated non-root pages with a pending Gumroad claim', async () => {
    sessionStorage.setItem('dosya_redemption_claim', VALID_CLAIM);
    bootDashboard.mockResolvedValueOnce({
      authed: true,
      redirect: null,
      themePref: null,
      activeWorkspaceId: 'ws_1',
    });

    await renderDashboard('/files');

    expect(navigate).not.toHaveBeenCalledWith('/redeem', { replace: true });
  });
});
