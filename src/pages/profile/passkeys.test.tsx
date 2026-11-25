import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
const webauthn = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', () => webauthn);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast }));

import { ApiError } from '@/api/client';
import { PasskeysSection, defaultPasskeyName } from './passkeys';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const ATTESTATION = { id: 'cred', rawId: 'cred', response: {}, type: 'public-key' };
const OPTIONS = { challenge: 'abc', rp: { id: 'dosya.dev', name: 'dosya' } };
const ROW = { id: 'pk_1', name: 'Work laptop', backed_up: 1, created_at: 1_750_000_000, last_used_at: null };

describe('PasskeysSection', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let proof: 'password' | 'code';
  let passkeys: (typeof ROW)[];

  const calls = (path: string, method?: string) => apiMock.mock.calls
    .filter(([p, o]) => p === path && (method ? (o as RequestInit | undefined)?.method === method : true)) as [string, RequestInit][];

  beforeEach(() => {
    proof = 'password';
    passkeys = [ROW];
    toast.success.mockReset(); toast.error.mockReset();
    webauthn.browserSupportsWebAuthn.mockReset().mockReturnValue(true);
    webauthn.startRegistration.mockReset().mockResolvedValue(ATTESTATION);
    apiMock.mockReset().mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/me/passkeys' && !options?.method) return { ok: true, passkeys, proof };
      if (path === '/api/me/passkeys/options') return { ok: true, challenge_token: 'tok', options: OPTIONS };
      return { ok: true };
    });
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function render() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<PasskeysSection />); await Promise.resolve(); });
  }
  const button = (text: string) => [...document.body.querySelectorAll('button')].filter((b) => b.textContent?.trim() === text).at(-1);
  const press = async (text: string) => {
    const b = button(text);
    expect(b, text).toBeTruthy();
    await act(async () => { b!.click(); await Promise.resolve(); });
  };
  function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  }

  it('lists passkeys and explains what they do', async () => {
    await render();
    expect(container!.textContent).toContain('Work laptop');
    expect(container!.textContent).toContain('Synced');
    expect(container!.textContent).toContain('without a password or 2FA code');
    expect(container!.textContent).toContain('Vault still uses its own passphrase');
  });

  it('adds a passkey after the password, with the name the person chose', async () => {
    await render();
    await press('New passkey');
    expect(calls('/api/me/passkeys/code')).toEqual([]);

    type(document.body.querySelector('input[type="password"]') as HTMLInputElement, 'hunter22');
    await press('Continue');
    expect(JSON.parse(calls('/api/me/passkeys/options')[0][1].body as string)).toEqual({ password: 'hunter22' });
    // The OS prompt belongs to the next click, not the one that checked the password.
    expect(webauthn.startRegistration).not.toHaveBeenCalled();

    type(document.body.querySelector('input[aria-label="Name"]') as HTMLInputElement, '  Office key  ');
    await press('Create passkey');

    expect(webauthn.startRegistration).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    expect(JSON.parse(calls('/api/me/passkeys', 'POST')[0][1].body as string)).toEqual({ challenge_token: 'tok', response: ATTESTATION, name: 'Office key' });
    expect(toast.success).toHaveBeenCalled();
    expect(calls('/api/me/passkeys').filter(([, o]) => !o?.method)).toHaveLength(2);
  });

  it('mails a code first for an account with no password', async () => {
    proof = 'code';
    await render();
    await press('New passkey');
    expect(calls('/api/me/passkeys/code', 'POST')).toHaveLength(1);
    expect(document.body.querySelector('input[type="password"]')).toBeNull();

    type(document.body.querySelector('input[inputmode="numeric"]') as HTMLInputElement, '123456');
    await press('Continue');
    expect(JSON.parse(calls('/api/me/passkeys/options')[0][1].body as string)).toEqual({ code: '123456' });

    await press('Create passkey');
    expect(calls('/api/me/passkeys', 'POST')).toHaveLength(1);
  });

  it('opens no dialog when the code could not be sent', async () => {
    proof = 'code';
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/me/passkeys' && !options?.method) return { ok: true, passkeys, proof };
      throw new ApiError(500, JSON.stringify({ ok: false, error: 'Could not send the code. Try again.' }));
    });
    await render();
    await press('New passkey');
    expect(toast.error).toHaveBeenCalledWith(expect.any(String), 'Could not send the code. Try again.');
    expect(document.body.querySelector('input[inputmode="numeric"]')).toBeNull();
  });

  it('shows the API error for a wrong password and stays on that step', async () => {
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/me/passkeys' && !options?.method) return { ok: true, passkeys, proof };
      throw new ApiError(403, JSON.stringify({ ok: false, error: 'Password is incorrect' }));
    });
    await render();
    await press('New passkey');
    type(document.body.querySelector('input[type="password"]') as HTMLInputElement, 'nope');
    await press('Continue');
    expect(toast.error).toHaveBeenCalledWith(expect.any(String), 'Password is incorrect');
    expect(document.body.querySelector('input[type="password"]')).not.toBeNull();
    expect(webauthn.startRegistration).not.toHaveBeenCalled();
  });

  it('stays quiet and ready to retry when the OS prompt is cancelled', async () => {
    webauthn.startRegistration.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NotAllowedError' }));
    await render();
    await press('New passkey');
    type(document.body.querySelector('input[type="password"]') as HTMLInputElement, 'hunter22');
    await press('Continue');
    await press('Create passkey');

    expect(toast.error).not.toHaveBeenCalled();
    expect(calls('/api/me/passkeys', 'POST')).toEqual([]);

    await press('Create passkey');
    expect(calls('/api/me/passkeys', 'POST')).toHaveLength(1);
    expect(calls('/api/me/passkeys/options')).toHaveLength(1);
  });

  it('says when this device already holds a passkey for the account', async () => {
    webauthn.startRegistration.mockRejectedValueOnce(Object.assign(new Error('dup'), { name: 'InvalidStateError' }));
    await render();
    await press('New passkey');
    type(document.body.querySelector('input[type="password"]') as HTMLInputElement, 'hunter22');
    await press('Continue');
    await press('Create passkey');
    expect(toast.error).toHaveBeenCalledWith(expect.any(String), 'This device already has a passkey for your account.');
  });

  it('asks for proof again when saving failed, because the challenge is spent', async () => {
    await render();
    await press('New passkey');
    type(document.body.querySelector('input[type="password"]') as HTMLInputElement, 'hunter22');
    await press('Continue');
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/me/passkeys' && !options?.method) return { ok: true, passkeys, proof };
      throw new ApiError(400, JSON.stringify({ ok: false, error: 'This request has expired. Please try again.' }));
    });
    await press('Create passkey');
    expect(toast.error).toHaveBeenCalledWith(expect.any(String), 'This request has expired. Please try again.');
    expect(document.body.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('renames a passkey', async () => {
    await render();
    await press('Rename');
    type(document.body.querySelector('input[aria-label="Name"]') as HTMLInputElement, 'Desk key');
    await press('Save');
    const [, options] = calls('/api/me/passkeys/pk_1', 'PATCH')[0];
    expect(JSON.parse(options.body as string)).toEqual({ name: 'Desk key' });
  });

  it('removes a passkey only after the confirm modal', async () => {
    await render();
    await press('Remove');
    expect(calls('/api/me/passkeys/pk_1', 'DELETE')).toEqual([]);
    expect(document.body.textContent).toContain('Are you sure?');
    expect(document.body.querySelector('[role="dialog"] strong')?.textContent).toBe('Work laptop');

    await press('Remove');
    expect(calls('/api/me/passkeys/pk_1', 'DELETE')).toHaveLength(1);
    expect(calls('/api/me/passkeys').filter(([, o]) => !o?.method)).toHaveLength(2);
  });

  it('cannot start adding in a browser without WebAuthn, but can still remove', async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(false);
    await render();
    expect(button('New passkey')!.disabled).toBe(true);
    expect(container!.textContent).toContain('This browser does not support passkeys');
    expect(button('Remove')!.disabled).toBe(false);
  });
});

describe('defaultPasskeyName', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 5, 'iPhone'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 5, 'iPad'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130', 0, 'Mac'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36', 5, 'Android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 0, 'Windows'],
    ['Mozilla/5.0 (X11; CrOS x86_64 15000.0.0) AppleWebKit/537.36', 0, 'Chromebook'],
    ['Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/130.0', 0, 'Linux'],
    ['SomethingElse/1.0', 0, null],
  ])('%s', (ua, touch, want) => {
    expect(defaultPasskeyName(ua, touch)).toBe(want);
  });
});
