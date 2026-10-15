import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * The API's reset doors now withhold the session when the account has a
 * second factor enrolled and answer `{ ok: true, requires_2fa: true,
 * redirect: "/login/2fa" }` with the challenge cookie set, exactly as login
 * does. This page used to send every successful reset to /login?reset=1,
 * which would have made the person type their brand-new password straight
 * back in - and then still land on the 2FA page.
 */

// PublicNav probes /api/me on mount.
const meApi = vi.fn();
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/api/client', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  API_BASE: '',
  api: (...args: unknown[]) => meApi(...args),
}));
vi.mock('@/components/turnstile-widget', () => ({
  TurnstileWidget: () => <div data-testid="turnstile" />,
}));

import ResetPasswordPage from './reset-password';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('reset-password page - where a successful reset goes', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    meApi.mockRejectedValue(new Error('Not authenticated'));
    window.location.hash = '#token=tok_reset';
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    navigate.mockClear();
    meApi.mockReset();
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  async function render() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/reset-password']}>
          <ResetPasswordPage />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
  }

  function setInput(selector: string, value: string) {
    const el = container!.querySelector<HTMLInputElement>(selector)!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function resetWith(apiAnswer: Record<string, unknown>) {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => apiAnswer }));
    vi.stubGlobal('fetch', fetchMock);
    await render();
    setInput('#new-password', 'Correct-Horse-99');
    setInput('#confirm-password', 'Correct-Horse-99');
    await act(async () => {
      container!.querySelector<HTMLFormElement>('form')!.requestSubmit();
      await Promise.resolve();
    });
    expect(fetchMock, 'the reset request was never sent - the rest of this test would be vacuous').toHaveBeenCalled();
  }

  it('sends an account with a second factor to the 2FA page, not back to the password form', async () => {
    await resetWith({ ok: true, requires_2fa: true, method: 'totp', redirect: '/login/2fa' });
    expect(navigate).toHaveBeenCalledWith('/login/2fa');
  });

  it('sends an account without a second factor to login with the reset banner, as before', async () => {
    await resetWith({ ok: true, redirect: '/create-workspace' });
    expect(navigate).toHaveBeenCalledWith('/login?reset=1');
  });
});
