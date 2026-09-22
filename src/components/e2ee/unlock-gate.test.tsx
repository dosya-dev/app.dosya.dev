import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { UnlockGate } = await import('./unlock-gate');
const { useE2ee } = await import('@/stores/e2ee');
type E2eeEngine = import('@/stores/e2ee').E2eeEngine;

function fakeEngine(overrides: Partial<E2eeEngine> = {}): E2eeEngine {
  return {
    hasIdentity: async () => true,
    setup: async () => ({ recoveryKeyHex: 'ab12' }),
    unlock: async () => {},
    lock: () => {},
    createWorkspace: async () => {},
    setWorkspaceScope: async () => {},
    openWorkspace: async () => {},
    listFolder: async () => [],
    uploadFile: async () => {},
    downloadFile: async () => new Uint8Array(),
    listMembers: async () => [],
    inviteMember: async () => {},
    revokeMember: async () => {},
    listMyWorkspaces: async () => [],
    unlockWithRecoveryKey: async () => {},
    destroyIdentity: async () => {},
    ...overrides,
  };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  localStorage.clear();
  useE2ee.setState({ status: 'locked', error: null, hasIdentity: null, workspaces: [], busy: false, recoveryKeyOnce: null });
  apiMock.mockReset();
  apiMock.mockResolvedValue({ ok: true, method: null, totp_enabled: false });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<UnlockGate />); await Promise.resolve(); });
}

const button = (text: string, scope: ParentNode = document.body) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// F8 (field report, Contract 6).
describe('UnlockGate recovery paths', () => {
  it('"Use recovery key" reveals a key field and unlocks through the store', async () => {
    const seen: string[] = [];
    useE2ee.getState().__setEngine(fakeEngine({ unlockWithRecoveryKey: async (k) => { seen.push(k); } }));
    await mount();
    expect(container!.textContent).toContain('Unlock Vault');

    await act(async () => { button('Use recovery key', container!)!.click(); });
    const field = container!.querySelector('#e2ee-recovery-key') as HTMLInputElement | null;
    expect(field).not.toBeNull();
    type(field!, '  ab12-cd34 ef56 ');
    await act(async () => { field!.closest('form')!.requestSubmit(); });

    // The spacing and dashes belong to the paste, not to the key.
    expect(seen).toEqual(['ab12cd34ef56']);
    expect(useE2ee.getState().status).toBe('unlocked');
  });

  it('"Destroy vault and start over" asks for the password, calls the engine, and returns to setup', async () => {
    const calls: [string, string | undefined][] = [];
    useE2ee.getState().__setEngine(fakeEngine({ destroyIdentity: async (pw, code) => { calls.push([pw, code]); } }));
    await mount();

    await act(async () => { button('Destroy vault and start over', container!)!.click(); });
    // No 2FA on this account: only the password is asked for.
    expect(document.body.querySelector('#e2ee-destroy-password')).not.toBeNull();
    expect(document.body.querySelector('#e2ee-destroy-code')).toBeNull();

    type(document.body.querySelector('#e2ee-destroy-password') as HTMLInputElement, 'hunter22');
    // The button stays disabled until the consequences are acknowledged.
    expect((button('Destroy my vault') as HTMLButtonElement).disabled).toBe(true);
    act(() => { (document.body.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await act(async () => { button('Destroy my vault')!.click(); });

    expect(calls).toEqual([['hunter22', undefined]]);
    expect(useE2ee.getState().hasIdentity).toBe(false);
    // Back at first-time setup.
    expect(container!.textContent).toContain('Set up encryption');
  });

  // Fix round 1, MINOR (c): when the status probe says no 2FA but the server
  // refuses with 2fa_required anyway, the dialog has to grow the field - and
  // show the sentence, never the code.
  it('reveals the code field after a 2fa_required refusal, with human copy', async () => {
    const { ApiError } = await import('@/api/client');
    useE2ee.getState().__setEngine(fakeEngine({
      destroyIdentity: async () => { throw new ApiError(400, JSON.stringify({ error: '2fa_required' })); },
    }));
    await mount();
    await act(async () => { button('Destroy vault and start over', container!)!.click(); });
    type(document.body.querySelector('#e2ee-destroy-password') as HTMLInputElement, 'hunter22');
    act(() => { (document.body.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await act(async () => { button('Destroy my vault')!.click(); });

    expect(document.body.querySelector('#e2ee-destroy-code')).not.toBeNull();
    expect(document.body.textContent).not.toContain('2fa_required');
    expect(document.body.textContent).toMatch(/two-factor/i);
  });

  it('asks for a 2FA code as well when the account has one, and sends it', async () => {
    apiMock.mockResolvedValue({ ok: true, method: 'totp', totp_enabled: true });
    const calls: [string, string | undefined][] = [];
    useE2ee.getState().__setEngine(fakeEngine({ destroyIdentity: async (pw, code) => { calls.push([pw, code]); } }));
    await mount();

    await act(async () => { button('Destroy vault and start over', container!)!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(apiMock).toHaveBeenCalledWith('/api/me/2fa/status');
    const code = document.body.querySelector('#e2ee-destroy-code') as HTMLInputElement | null;
    expect(code).not.toBeNull();

    type(document.body.querySelector('#e2ee-destroy-password') as HTMLInputElement, 'hunter22');
    type(code!, '123456');
    act(() => { (document.body.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await act(async () => { button('Destroy my vault')!.click(); });
    expect(calls).toEqual([['hunter22', '123456']]);
  });
});
