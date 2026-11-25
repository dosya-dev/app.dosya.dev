import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
const webauthn = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  platformAuthenticatorIsAvailable: vi.fn(async () => true),
  startRegistration: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', () => webauthn);
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ApiError } from '@/api/client';
import PasskeyPrompt from './passkey-prompt';
import { useUploads } from '@/stores/uploads';
import type { UploadItem } from '@/lib/upload-types';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const OPTIONS = { challenge: 'abc', rp: { id: 'app.dosya.dev', name: 'dosya' } };

describe('PasskeyPrompt', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let prompt: { ok: boolean; show: boolean; proof?: string };
  let optionsFail: boolean;

  const calls = (path: string, method?: string) => apiMock.mock.calls
    .filter(([p, o]) => p === path && (o as RequestInit | undefined)?.method === method) as [string, RequestInit][];

  beforeEach(() => {
    prompt = { ok: true, show: true, proof: 'password' };
    optionsFail = false;
    useUploads.setState({ items: [] });
    webauthn.browserSupportsWebAuthn.mockReset().mockReturnValue(true);
    webauthn.platformAuthenticatorIsAvailable.mockReset().mockResolvedValue(true);
    apiMock.mockReset().mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/me/passkeys/prompt' && !options?.method) return prompt;
      if (path === '/api/me/passkeys/options') {
        if (optionsFail) throw new ApiError(400, 'Confirmation code is required');
        return { ok: true, challenge_token: 'tok', options: OPTIONS };
      }
      return { ok: true };
    });
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function render(path = '/') {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<MemoryRouter initialEntries={[path]}><PasskeyPrompt /></MemoryRouter>);
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  const banner = () => document.querySelector('[data-testid="passkey-prompt"]');
  const button = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  const press = async (text: string) => {
    const b = button(text);
    expect(b, text).toBeTruthy();
    await act(async () => { b!.click(); await new Promise((r) => setTimeout(r, 0)); });
  };

  it('offers a passkey when the API says it is due', async () => {
    await render();
    expect(banner()?.textContent).toContain('Sign in faster with your face or fingerprint.');
  });

  it('stays hidden when the API says it is not due', async () => {
    prompt = { ok: true, show: false };
    await render();
    expect(banner()).toBeNull();
  });

  it('does not ask the API when this device has no built-in authenticator', async () => {
    webauthn.platformAuthenticatorIsAvailable.mockResolvedValue(false);
    await render();
    expect(banner()).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('stays out of the way on other pages', async () => {
    await render('/teams');
    expect(banner()).toBeNull();
  });

  it('stays out of the way during an upload', async () => {
    useUploads.setState({ items: [{ id: 'u1', status: 'uploading', fileSize: 10, bytesUploaded: 1 } as UploadItem] });
    await render();
    expect(banner()).toBeNull();
  });

  it('records Not now and goes away', async () => {
    await render();
    await press('Not now');
    expect(banner()).toBeNull();
    expect(calls('/api/me/passkeys/prompt', 'POST')).toHaveLength(1);
  });

  it('asks for the password when the account has one', async () => {
    await render();
    await press('Add passkey');
    expect(document.body.querySelector('input[type="password"]')).toBeTruthy();
    expect(calls('/api/me/passkeys/code', 'POST')).toHaveLength(0);
  });

  it('emails a code to an account with no password', async () => {
    prompt = { ok: true, show: true, proof: 'code' };
    await render();
    await press('Add passkey');
    expect(calls('/api/me/passkeys/code', 'POST')).toHaveLength(1);
    expect(document.body.querySelector('input[autocomplete="one-time-code"]')).toBeTruthy();
  });

  it('goes straight to naming the passkey just after a provider sign-in, with a click of its own for the prompt', async () => {
    prompt = { ok: true, show: true, proof: 'none' };
    await render();
    await press('Add passkey');
    expect(JSON.parse(calls('/api/me/passkeys/options', 'POST')[0][1].body as string)).toEqual({});
    expect(calls('/api/me/passkeys/code', 'POST')).toHaveLength(0);
    expect(button('Create passkey')).toBeTruthy();
    expect(webauthn.startRegistration).not.toHaveBeenCalled();
  });

  it('falls back to the emailed code once the sign-in is no longer recent', async () => {
    prompt = { ok: true, show: true, proof: 'none' };
    optionsFail = true;
    await render();
    await press('Add passkey');
    expect(calls('/api/me/passkeys/code', 'POST')).toHaveLength(1);
    expect(document.body.querySelector('input[autocomplete="one-time-code"]')).toBeTruthy();
  });
});
