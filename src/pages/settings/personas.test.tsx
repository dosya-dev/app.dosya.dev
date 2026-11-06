import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
const clearKeyIfLastWorkspace = vi.fn(async (_u: string | null) => {});
vi.mock('@/lib/personas-device/wipe', () => ({ clearKeyIfLastWorkspace: (u: string | null) => clearKeyIfLastWorkspace(u) }));
vi.mock('@/lib/personas-device/engine-host', () => import('@/lib/personas-device/__fixtures__/fake-host'));
// The folder picker is tested on its own: a stand-in that picks "Holiday".
vi.mock('@/components/folder-picker-dialog', () => ({
  FolderPickerDialog: ({ title, onSelect }: { title?: string; onSelect: (id: string | null, name: string) => void }) => (
    <div role="dialog">{title}<button type="button" onClick={() => onSelect('d9', 'Holiday')}>pick Holiday</button></div>
  ),
}));

const { fakeHost, card, READY } = await import('@/lib/personas-device/__fixtures__/fake-host');
const { PersonasSection } = await import('./personas');

const TURN_OFF_TEXT = 'Your people, names and corrections for this workspace are deleted from all your devices.';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const w = window as unknown as { PointerEvent?: typeof MouseEvent; MouseEvent: typeof MouseEvent };
  if (!w.PointerEvent) w.PointerEvent = w.MouseEvent;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  clearKeyIfLastWorkspace.mockClear();
  fakeHost.reset({ ...READY, read: 3, total: 10 });
  fakeHost.engine.personas = [card('p1', 'Emma')];
  fakeHost.engine.skipped = ['d1'];
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/folders/')) {
      const id = path.split('/').pop();
      return Promise.resolve({ ok: true, folder: { name: id === 'd1' ? 'Work receipts' : `Folder ${id}` } });
    }
    return Promise.resolve({ ok: true });
  });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  document.body.innerHTML = '';
});

const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<MemoryRouter><PersonasSection wsId="ws1" /></MemoryRouter>); });
  await flush();
}

const text = () => container!.textContent ?? '';
const switchFor = (label: string) => container!.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`);
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); };
const buttonIn = (scope: ParentNode, label: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label) ?? null;
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');

describe('Personas settings section', () => {
  it('shows the workspace switch, the device switch, skipped folders and the delete button, and nothing about region, owner, plan or consent', async () => {
    await mount();
    expect(switchFor('Personas in this workspace')!.getAttribute('aria-checked')).toBe('true');
    expect(switchFor('Read on this device')!.getAttribute('aria-checked')).toBe('true');
    expect(text()).toContain('Skipped folders');
    expect(text()).toContain('Work receipts');
    expect(container!.querySelector('button[aria-label="Stop skipping Work receipts"]')).toBeTruthy();
    expect(buttonIn(container!, 'Add folder')).toBeTruthy();
    expect(buttonIn(container!, 'Delete my people in this workspace')).toBeTruthy();
    expect(text()).not.toMatch(/region|owner|plan|agree|policy|server|cloudflare/i);
  });

  it('switching Personas off asks "Are you sure?" then turns it off on every device', async () => {
    await mount();
    await click(switchFor('Personas in this workspace'));
    const d = dialog()!;
    expect(d.textContent).toContain('Are you sure?');
    expect(d.textContent).toContain(TURN_OFF_TEXT);
    expect(fakeHost.engine.turnOff).not.toHaveBeenCalled();
    await click(buttonIn(d, 'Turn off and delete'));
    expect(fakeHost.engine.turnOff).toHaveBeenCalledTimes(1);
    // The device's cached key goes too when this was its last workspace (the helper decides).
    expect(clearKeyIfLastWorkspace).toHaveBeenCalledTimes(1);
    expect(switchFor('Personas in this workspace')!.getAttribute('aria-checked')).toBe('false');
  });

  it('Cancel keeps Personas on', async () => {
    await mount();
    await click(switchFor('Personas in this workspace'));
    await click(buttonIn(dialog()!, 'Cancel'));
    expect(fakeHost.engine.turnOff).not.toHaveBeenCalled();
  });

  it('"Delete my people in this workspace" asks the same and does the same', async () => {
    await mount();
    await click(buttonIn(container!, 'Delete my people in this workspace'));
    expect(dialog()!.textContent).toContain(TURN_OFF_TEXT);
    await click(buttonIn(dialog()!, 'Turn off and delete'));
    expect(fakeHost.engine.turnOff).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open with a message when turning off fails', async () => {
    fakeHost.engine.turnOff.mockRejectedValueOnce(new Error('offline'));
    await mount();
    await click(switchFor('Personas in this workspace'));
    await click(buttonIn(dialog()!, 'Turn off and delete'));
    expect(dialog()!.textContent).toContain('Something went wrong. Try again.');
    expect(clearKeyIfLastWorkspace).not.toHaveBeenCalled();
  });

  it('switching Personas on starts it at once (no consent step)', async () => {
    fakeHost.set({ status: { state: 'off' } });
    await mount();
    expect(switchFor('Personas in this workspace')!.getAttribute('aria-checked')).toBe('false');
    expect(switchFor('Read on this device')).toBeNull();
    await click(switchFor('Personas in this workspace'));
    expect(fakeHost.engine.turnOn).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it('"Read on this device" pauses and resumes reading here', async () => {
    await mount();
    await click(switchFor('Read on this device'));
    expect(fakeHost.engine.setPaused).toHaveBeenLastCalledWith(true);
    expect(switchFor('Read on this device')!.getAttribute('aria-checked')).toBe('false');
    await click(switchFor('Read on this device'));
    expect(fakeHost.engine.setPaused).toHaveBeenLastCalledWith(false);
  });

  it('says this browser cannot read photos, and has no device switch then', async () => {
    fakeHost.supported = false;
    await mount();
    expect(text()).toContain("This browser can't read photos. Your other devices can.");
    expect(switchFor('Read on this device')).toBeNull();
  });

  it('skips a folder picked in the folder picker, and stops skipping one', async () => {
    await mount();
    await click(buttonIn(container!, 'Add folder'));
    expect(dialog()!.textContent).toContain('Skipped folders');
    await click(buttonIn(dialog()!, 'pick Holiday'));
    expect(fakeHost.engine.skipFolder).toHaveBeenCalledWith('d9', true);
    expect(text()).toContain('Holiday');
    await click(container!.querySelector('button[aria-label="Stop skipping Work receipts"]'));
    expect(fakeHost.engine.skipFolder).toHaveBeenCalledWith('d1', false);
    expect(text()).not.toContain('Work receipts');
  });

  it('sends the user to the Vault step while Personas is locked or has no Vault', async () => {
    fakeHost.set({ status: { state: 'needs_unlock' } });
    await mount();
    expect(text()).toContain('Unlock with your Vault passphrase to open your people on this browser.');
    expect(container!.querySelector('a[href="/personas"]')!.textContent).toBe('Open Personas');
    act(() => root!.unmount()); container!.remove(); root = null;

    fakeHost.set({ status: { state: 'needs_identity' } });
    await mount();
    expect(text()).toContain('Personas uses your Vault passphrase to protect your people. Set it up to continue.');
  });

  it('has its heading and a link to how Personas protects privacy', async () => {
    await mount();
    expect(container!.querySelector('h1')!.textContent).toBe('Personas settings');
    const link = container!.querySelector<HTMLAnchorElement>('a[href="https://dosya.dev/biometric-data-policy"]')!;
    expect(link.textContent).toBe('How Personas protects your privacy');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('says so with a retry when the engine cannot answer', async () => {
    fakeHost.set({ status: null, error: new Error('offline') });
    await mount();
    expect(text()).toContain('Personas could not be loaded.');
    await click(buttonIn(container!, 'Try again'));
    expect(fakeHost.refresh).toHaveBeenCalled();
  });

  it('encodes the folder id in the name lookup', async () => {
    fakeHost.engine.skipped = ['a/b?c'];
    await mount();
    expect(apiMock).toHaveBeenCalledWith('/api/folders/a%2Fb%3Fc');
  });

  it('never asks a server Personas route', async () => {
    await mount();
    expect(apiMock.mock.calls.filter(([p]) => String(p).includes('personas'))).toEqual([]);
  });
});
