import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
const webauthn = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', () => webauthn);
vi.mock('@/components/turnstile-widget', () => ({ TurnstileWidget: () => <div /> }));
vi.mock('@/components/public-nav', () => ({ PublicNav: () => <nav /> }));
vi.mock('@/components/already-signed-in-dialog', () => ({ AlreadySignedInDialog: () => null }));
vi.mock('@/hooks/use-session-probe', () => ({ useSessionAccount: () => null }));

import LoginPage from './login';
import { rememberPostAuthPath } from '@/lib/post-auth-path';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const LABEL = 'Sign in with a passkey';
const OPTIONS = { challenge: 'abc', rpId: 'dosya.dev' };
const ASSERTION = { id: 'cred', rawId: 'cred', response: {}, type: 'public-key' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('/login passkey button', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let verifyAnswer: () => Response;
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/api/auth/passkey/options')) return json({ ok: true, challenge_token: 'tok', options: OPTIONS });
    if (url.endsWith('/api/auth/passkey/verify')) return verifyAnswer();
    return json({ ok: false }, 404);
  });
  const callTo = (suffix: string) => fetchMock.mock.calls.find(([url]) => String(url).endsWith(suffix)) as unknown as [string, RequestInit] | undefined;

  beforeEach(() => {
    navigate.mockReset(); fetchMock.mockClear(); sessionStorage.clear();
    webauthn.browserSupportsWebAuthn.mockReset().mockReturnValue(true);
    webauthn.startAuthentication.mockReset().mockResolvedValue(ASSERTION);
    verifyAnswer = () => json({ ok: true, redirect: '/create-workspace' });
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  const mount = async () => {
    root = createRoot(container!);
    await act(async () => { root!.render(<MemoryRouter><LoginPage /></MemoryRouter>); });
  };
  const button = () => [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes(LABEL));
  const click = async () => { await act(async () => { button()!.click(); }); };

  it('runs the ceremony and follows the redirect the API returned', async () => {
    await mount();
    await click();

    expect(webauthn.startAuthentication).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    const verify = callTo('/api/auth/passkey/verify')!;
    expect(verify[1].credentials).toBe('include');
    expect(JSON.parse(verify[1].body as string)).toEqual({ challenge_token: 'tok', response: ASSERTION });
    expect(navigate).toHaveBeenCalledWith('/create-workspace');
  });

  it('prefers a remembered post-login path, as password login does', async () => {
    rememberPostAuthPath('/connect/extension?state=abc');
    await mount();
    await click();
    expect(navigate).toHaveBeenCalledWith('/connect/extension?state=abc');
  });

  it('says nothing when the person cancels the OS prompt', async () => {
    webauthn.startAuthentication.mockRejectedValue(Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' }));
    await mount();
    await click();

    expect(callTo('/api/auth/passkey/verify')).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
    expect(container!.querySelector('.text-destructive')).toBeNull();
    expect(button()!.disabled).toBe(false);
  });

  it('explains a ceremony that failed for any other reason', async () => {
    webauthn.startAuthentication.mockRejectedValue(Object.assign(new Error('boom'), { name: 'SecurityError' }));
    await mount();
    await click();
    expect(container!.textContent).toContain("We couldn't use a passkey on this device");
    expect(container!.textContent).not.toContain('boom');
  });

  it('shows the error the API sends', async () => {
    verifyAnswer = () => json({ ok: false, error: "We couldn't sign you in with that passkey." }, 401);
    await mount();
    await click();
    expect(container!.textContent).toContain("We couldn't sign you in with that passkey.");
    expect(navigate).not.toHaveBeenCalled();
  });

  it('hides the button in a browser without WebAuthn', async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(false);
    await mount();
    expect(button()).toBeUndefined();
  });

  it('does not raise a prompt until the button is clicked', async () => {
    await mount();
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
    expect(callTo('/api/auth/passkey/options')).toBeUndefined();
  });
});
