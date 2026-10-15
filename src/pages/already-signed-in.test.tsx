import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const meApi = vi.fn();
const api = vi.fn();
vi.mock('@/api/client', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  API_BASE: '',
  api: (...args: unknown[]) => (args[0] === '/api/me' ? meApi(...args) : api(...args)),
}));

// Turnstile injects a Cloudflare script and renders an iframe; neither is
// available in jsdom and neither is what these tests are about.
vi.mock('@/components/turnstile-widget', () => ({
  TurnstileWidget: () => <div data-testid="turnstile" />,
}));

// logoutAndRedirect cancels in-flight uploads; the runner spawns real XHRs.
vi.mock('@/lib/upload-runner', () => ({ cancelAll: () => {} }));

import LoginPage from './login';
import SignUpPage from './sign-up';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const USER = {
  id: 'usr_1',
  name: 'Firat Kaya',
  email: 'firat@example.com',
  avatar_url: null,
  deletion_scheduled_for: null,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  meApi.mockResolvedValue({ ok: true, user: USER });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  api.mockReset();
  meApi.mockReset();
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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const dialog = () => document.body.querySelector('[data-slot="dialog-content"]');

describe('the already-signed-in prompt on the auth pages', () => {
  it('offers the signed-in account on the login page', async () => {
    await render(LoginPage, '/login');
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain('Continue as Firat Kaya');
    expect(dialog()!.textContent).toContain('Log in with a different account');
  });

  it('offers the signed-in account on the sign-up page', async () => {
    await render(SignUpPage, '/sign-up');
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain('Continue as Firat Kaya');
    expect(dialog()!.textContent).toContain('Create a new account');
  });

  it('leaves the login form alone for a signed-out visitor', async () => {
    meApi.mockRejectedValue(new Error('Not authenticated'));
    await render(LoginPage, '/login');
    expect(dialog()).toBeNull();
    expect(container!.textContent).toContain('Welcome back');
  });

  // An OAuth failure banner is the only thing on the page worth reading;
  // covering it with a modal about a session is strictly worse.
  it('stays out of the way of an OAuth failure banner', async () => {
    await render(LoginPage, '/login?error=google_denied');
    expect(dialog()).toBeNull();
    expect(container!.textContent).toContain('Google sign-in was cancelled');
  });

  it('stays out of the way of the password-was-changed notice', async () => {
    await render(LoginPage, '/login?reset=1');
    expect(dialog()).toBeNull();
    expect(container!.textContent).toContain('Your password has been changed');
  });

  it('probes the session once for both the navbar and the dialog', async () => {
    await render(LoginPage, '/login');
    expect(meApi).toHaveBeenCalledTimes(1);
  });
});
