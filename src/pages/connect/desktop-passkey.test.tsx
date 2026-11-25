// apps/web/src/pages/connect/desktop-passkey.test.tsx
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * /connect/desktop-passkey: the desktop app cannot run a passkey ceremony in
 * its own window, so it opens this page with a nonce. The page sends the nonce
 * with the verify call and hands the returned dosya:// callback to the OS, and
 * nothing else may receive that callback: it carries a session token.
 */
const webauthn = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', () => webauthn);
vi.mock('@/components/public-nav', () => ({ PublicNav: () => <nav /> }));

import ConnectDesktopPasskeyPage from './desktop-passkey';

const STATE = 's'.repeat(32);
const OPTIONS = { challenge: 'abc', rpId: 'dosya.dev' };
const ASSERTION = { id: 'cred', rawId: 'cred', response: {}, type: 'public-key' };
const CALLBACK = `dosya://auth/callback?token=t0k&state=${STATE}`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'location', { value: { ...window.location, href: 'https://app.dosya.dev/' }, writable: true });
});

describe('connect/desktop-passkey page', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let redirect: string;
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/api/auth/passkey/options')) return json({ ok: true, challenge_token: 'tok', options: OPTIONS });
    if (url.endsWith('/api/auth/passkey/verify')) return json({ ok: true, redirect });
    return json({ ok: false }, 404);
  });
  const verifyCall = () => fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/auth/passkey/verify')) as unknown as [string, RequestInit] | undefined;

  beforeEach(() => {
    fetchMock.mockClear();
    window.location.href = 'https://app.dosya.dev/';
    redirect = CALLBACK;
    webauthn.browserSupportsWebAuthn.mockReset().mockReturnValue(true);
    webauthn.startAuthentication.mockReset().mockResolvedValue(ASSERTION);
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  const mount = async (query = `?state=${STATE}`) => {
    root = createRoot(container!);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[`/connect/desktop-passkey${query}`]}>
          <ConnectDesktopPasskeyPage />
        </MemoryRouter>,
      );
    });
  };
  const button = () => container!.querySelector('button');
  const click = async () => { await act(async () => { button()!.click(); }); };

  it('sends the nonce and hands the callback to the app', async () => {
    await mount();
    expect(container!.textContent).toContain('Sign in to the dosya desktop app');
    await click();

    expect(JSON.parse(verifyCall()![1].body as string)).toEqual({ challenge_token: 'tok', response: ASSERTION, desktop_state: STATE });
    expect(window.location.href).toBe(CALLBACK);
    expect(container!.textContent).toContain('You can return to the desktop app');
  });

  it('waits for a click', async () => {
    await mount();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
  });

  it('refuses a redirect that is not the dosya callback', async () => {
    redirect = 'https://evil.example/steal?token=t0k';
    await mount();
    await click();

    expect(window.location.href).toBe('https://app.dosya.dev/');
    expect(container!.textContent).toContain('The server returned an unexpected callback');
    expect(container!.textContent).not.toContain('You can return to the desktop app');
  });

  it('refuses a lookalike of the dosya callback', async () => {
    redirect = 'dosya://auth/callback.evil/?token=t0k';
    await mount();
    await click();
    expect(window.location.href).toBe('https://app.dosya.dev/');
  });

  it('says nothing when the person cancels the OS prompt', async () => {
    webauthn.startAuthentication.mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotAllowedError' }));
    await mount();
    await click();

    expect(verifyCall()).toBeUndefined();
    expect(container!.querySelector('[role="alert"]')).toBeNull();
    expect(button()!.disabled).toBe(false);
  });

  it('shows an error and no button when the state is missing', async () => {
    await mount('');
    expect(container!.querySelector('[role="alert"]')).not.toBeNull();
    expect(container!.textContent).toContain('This link is incomplete');
    expect(button()).toBeNull();
  });

  it('treats a state the API would refuse as a bad link', async () => {
    await mount('?state=short');
    expect(container!.textContent).toContain('This link is incomplete');
    expect(button()).toBeNull();
  });

  it('says so in a browser without WebAuthn', async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(false);
    await mount();
    expect(container!.textContent).toContain('This browser does not support passkeys');
    expect(button()).toBeNull();
  });
});
