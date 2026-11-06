import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/personas-device/engine-host', () => import('@/lib/personas-device/__fixtures__/fake-host'));
const { fakeHost } = await import('@/lib/personas-device/__fixtures__/fake-host');
const { FirstRun } = await import('./first-run');
const { useE2ee } = await import('@/stores/e2ee');
type Engine = import('@dosya-dev/personas-engine').PersonasEngine;

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

const BODY = 'Personas reads faces on this device and groups photos of the same person. The result is encrypted with your own key, so dosya can never see it. Your other devices share it. Vault, hidden and locked photos are left out.';
const SETUP_LINE = 'Personas uses your Vault passphrase to protect your people. Set it up to continue.';
const UNLOCK_LINE = 'Unlock with your Vault passphrase to open your people on this browser.';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const initialE2ee = useE2ee.getState();

beforeEach(() => {
  fakeHost.reset({ state: 'off' });
  useE2ee.setState({ status: 'locked', hasIdentity: null, error: null, errorKey: null, busy: false, recoveryKeyOnce: null });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  useE2ee.setState(initialE2ee, true);
  document.body.innerHTML = '';
});

const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };

async function mount(state: 'off' | 'needs_identity' | 'needs_unlock') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><FirstRun wsId="ws1" state={state} engine={fakeHost.engine as unknown as Engine} /></MemoryRouter>);
  });
  await flush();
}

const text = () => document.body.textContent ?? '';
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('FirstRun, Personas off', () => {
  it('says what Personas does on this device and starts reading on the click', async () => {
    await mount('off');
    expect(container!.querySelector('h1')!.textContent).toBe('Find people in your photos');
    expect(text()).toContain(BODY);
    await act(async () => { button('Start reading on this device')!.click(); });
    await flush();
    expect(fakeHost.engine.turnOn).toHaveBeenCalledTimes(1);
  });

  it('says so when starting fails, and lets the user try again', async () => {
    fakeHost.engine.turnOn.mockRejectedValueOnce(new Error('offline'));
    await mount('off');
    await act(async () => { button('Start reading on this device')!.click(); });
    await flush();
    expect(container!.querySelector('[role="alert"]')!.textContent).toBe('Something went wrong. Try again.');
    expect(button('Start reading on this device')!.disabled).toBe(false);
  });

  it('links to how Personas protects privacy', async () => {
    await mount('off');
    const link = container!.querySelector<HTMLAnchorElement>('a[href="https://dosya.dev/biometric-data-policy"]')!;
    expect(link.textContent).toBe('How Personas protects your privacy');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('has no consent, region, owner, plan or policy text', async () => {
    await mount('off');
    expect(text()).not.toMatch(/agree|region|owner|plan|policy|Keep it off|European|Illinois|servers/i);
    expect(container!.querySelector('input[type="checkbox"], [role="checkbox"]')).toBeNull();
  });
});

describe('FirstRun, no Vault yet', () => {
  it('shows the same text plus the Vault line and the Vault setup, then opens Personas with the new identity', async () => {
    useE2ee.setState({
      hasIdentity: false,
      setup: vi.fn(async () => { useE2ee.setState({ status: 'unlocked', hasIdentity: true, recoveryKeyOnce: 'abcd-efgh' }); }),
    });
    await mount('needs_identity');
    expect(text()).toContain(BODY);
    expect(text()).toContain(SETUP_LINE);
    expect(button('Start reading on this device')).toBeUndefined();
    const [pass, confirm] = [...container!.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    type(pass, 'correct horse battery');
    type(confirm, 'correct horse battery');
    await act(async () => { button('Set up')!.click(); });
    await flush();
    expect(useE2ee.getState().setup).toHaveBeenCalledWith('correct horse battery');
    expect(fakeHost.unlockPersonas).toHaveBeenCalledWith('ws1');
    // The one-time recovery key is shown here too.
    expect(text()).toContain('abcd-efgh');
  });
});

describe('FirstRun, Vault locked', () => {
  it('asks for the Vault passphrase (or recovery key) and opens Personas after the unlock', async () => {
    useE2ee.setState({
      hasIdentity: true,
      unlock: vi.fn(async () => { useE2ee.setState({ status: 'unlocked' }); }),
    });
    await mount('needs_unlock');
    expect(text()).toContain(UNLOCK_LINE);
    expect(button('Use recovery key')).toBeTruthy();
    const pass = container!.querySelector<HTMLInputElement>('input[type="password"]')!;
    type(pass, 'my passphrase');
    await act(async () => { button('Unlock')!.click(); });
    await flush();
    expect(useE2ee.getState().unlock).toHaveBeenCalledWith('my passphrase');
    expect(fakeHost.unlockPersonas).toHaveBeenCalledWith('ws1');
  });

  it('opens Personas at once when the Vault is already unlocked in this tab', async () => {
    useE2ee.setState({ hasIdentity: true, status: 'unlocked' });
    await mount('needs_unlock');
    expect(fakeHost.unlockPersonas).toHaveBeenCalledWith('ws1');
  });

  it('says so when Personas cannot be opened after the unlock, with a retry', async () => {
    fakeHost.unlockPersonas.mockRejectedValueOnce(new Error('offline'));
    useE2ee.setState({ hasIdentity: true, status: 'unlocked' });
    await mount('needs_unlock');
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain('Something went wrong. Try again.');
    await act(async () => { button('Try again')!.click(); });
    await flush();
    expect(fakeHost.unlockPersonas).toHaveBeenCalledTimes(2);
  });
});
