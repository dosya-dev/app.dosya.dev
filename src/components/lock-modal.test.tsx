import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The body reads the current lock on mount (GET) and writes it on apply
// (POST). Stub only `api`; keep ApiError/apiErrorMessage real.
const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));

const { LockModalBody } = await import('./lock-modal');
const { ApiError } = await import('@/api/client');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // base-ui forwards a click on the radio's span to its hidden input with
  // `new PointerEvent('click')`, which jsdom does not implement. Without this
  // the click is swallowed (jsdom reports listener errors instead of throwing)
  // and every selection assertion fails for the wrong reason.
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? 'mouse';
      }
    }
    (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
  }
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const folder = { id: 'fo1', name: 'Q3 Reports', type: 'folder' as const, file_count: 128, total_size_bytes: 2_040_109_466 };
const file = { id: 'f1', name: 'invoice-2026-08.pdf', type: 'file' as const, size_bytes: 2_516_582, extension: 'pdf' };

/** GET answers with `status`; POST answers with `post` (or rejects with it when it is an Error). */
function serve(status: Record<string, unknown>, post: unknown = { ok: true }) {
  apiMock.mockImplementation((_path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return post instanceof Error ? Promise.reject(post) : Promise.resolve(post);
    return Promise.resolve({ ok: true, lock_mode: 'none', locked_by: null, locked_by_name: null, locked_at: null, ...status });
  });
}

type LockTarget = import('./lock-modal').LockTarget;

async function mount(target: LockTarget, handlers: { onClose?: () => void; onDone?: () => void } = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(LockModalBody, { target, onClose: handlers.onClose ?? (() => {}), onDone: handlers.onDone ?? (() => {}) }));
  });
  await act(async () => { await flush(); });
  return container;
}

const radio = (mode: string) => container!.querySelector<HTMLElement>(`[data-testid="lock-mode-${mode}"] [role="radio"]`);
const button = (label: string) => [...container!.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;
const passwordInput = () => container!.querySelector<HTMLInputElement>('input[data-testid="lock-password"]');

async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush(); });
}

async function type(input: HTMLInputElement | null, value: string) {
  expect(input).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  });
}

describe('LockModalBody', () => {
  it('names the item straight away and keeps the options as placeholders while the current mode loads', async () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    await mount(folder);
    expect(container!.textContent).toContain('Q3 Reports');
    expect(container!.textContent).toContain('Folder · 128 files · 1.90 GB');
    expect(container!.querySelector('[data-testid="lock-skeleton"]')).not.toBeNull();
    expect(container!.querySelector('[role="radio"]')).toBeNull();
    expect(button('Apply')?.disabled).toBe(true);
  });

  it('describes a file by type and size', async () => {
    serve({});
    await mount(file);
    expect(container!.textContent).toContain('PDF · 2.4 MB');
    expect(container!.textContent).toContain('Anyone with access to it can open, download and edit it.');
    expect(container!.textContent).toContain('share links to it stop working');
  });

  it('preselects the current mode and leaves the button off until something would change', async () => {
    serve({ lock_mode: 'none' });
    await mount(folder);
    expect(radio('none')?.getAttribute('aria-checked')).toBe('true');
    expect(button('Remove lock')?.disabled).toBe(true);
    expect(passwordInput()).toBeNull();

    await click(radio('view_only'));
    expect(radio('view_only')?.getAttribute('aria-checked')).toBe('true');
    expect(button('Set view only')?.disabled).toBe(false);
  });

  it('reveals the password field inside the Password option and posts the lock', async () => {
    const onDone = vi.fn();
    const onClose = vi.fn();
    serve({ lock_mode: 'none' });
    await mount(folder, { onDone, onClose });

    await click(radio('full_lock'));
    expect(passwordInput()).not.toBeNull();
    expect(container!.querySelector('[data-testid="lock-mode-full_lock"]')!.textContent).toContain('At least 4 characters.');
    expect(button('Lock with password')?.disabled).toBe(true);

    await type(passwordInput(), 'abc');
    expect(button('Lock with password')?.disabled).toBe(true);
    await type(passwordInput(), 'abcd');
    expect(button('Lock with password')?.disabled).toBe(false);

    await click(button('Lock with password'));
    const post = apiMock.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
    expect(post?.[0]).toBe('/api/folders/fo1/lock');
    expect(JSON.parse((post?.[1] as { body: string }).body)).toEqual({ lock_mode: 'full_lock', password: 'abcd' });
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Locked with a password', expect.stringContaining('Q3 Reports'));
  });

  it('shows who set the lock and asks for a new password when the item is already password-locked', async () => {
    const now = Math.floor(Date.now() / 1000);
    serve({ lock_mode: 'full_lock', locked_by: 'u1', locked_by_name: 'Firat Kaya', locked_at: now - 2 * 86400 });
    await mount(file);
    expect(container!.textContent).toContain('Password lock · set by Firat Kaya, 2d ago');
    expect(radio('full_lock')?.getAttribute('aria-checked')).toBe('true');
    expect(container!.querySelector('label[for]')?.textContent).toBe('New password');
    expect(container!.textContent).toContain('At least 4 characters. Replaces the current one.');
    expect(button('Update password')?.disabled).toBe(true);

    await click(radio('none'));
    expect(button('Remove lock')?.disabled).toBe(false);
  });

  it('falls back to the mode the row already knows when the read fails', async () => {
    apiMock.mockRejectedValue(new Error('offline'));
    await mount({ ...file, lock_mode: 'full_lock' });
    expect(container!.textContent).toContain('Currently password-locked');
    expect(radio('full_lock')?.getAttribute('aria-checked')).toBe('true');
    expect(container!.querySelector('label[for]')?.textContent).toBe('New password');
    expect(button('Update password')?.disabled).toBe(true);
  });

  it('rejects a short password inline on Enter without posting', async () => {
    serve({ lock_mode: 'none' });
    await mount(file);
    await click(radio('full_lock'));
    await type(passwordInput(), 'ab');
    await act(async () => {
      passwordInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });
    expect(container!.textContent).toContain('Use at least 4 characters.');
    expect(passwordInput()?.getAttribute('aria-invalid')).toBe('true');
    expect(apiMock.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === 'POST')).toBe(false);
  });

  it('submits from the password field on Enter', async () => {
    serve({ lock_mode: 'none' });
    await mount(file);
    await click(radio('full_lock'));
    await type(passwordInput(), 'letmein');
    await act(async () => {
      passwordInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });
    const post = apiMock.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
    expect(post?.[0]).toBe('/api/files/f1/lock');
  });

  it('reports a failed update as a toast and stays open', async () => {
    const onClose = vi.fn();
    serve({ lock_mode: 'none' }, new ApiError(403, JSON.stringify({ error: "You don't have permission to lock files" })));
    await mount(file, { onClose });
    await click(radio('view_only'));
    await click(button('Set view only'));
    expect(toastError).toHaveBeenCalledWith("Couldn't update the lock", expect.stringContaining('permission'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
