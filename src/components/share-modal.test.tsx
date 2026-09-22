import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { ShareModal, clearShareDefaultsCache } = await import('./share-modal');
const { useWorkspace } = await import('@/stores/workspace');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  useWorkspace.setState({ activeId: 'ws_1' });
  clearShareDefaultsCache();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
});

async function render(defaultDays: number | null | undefined, workspaceId?: string) {
  apiMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/settings')) {
      return { ok: true, settings: defaultDays === undefined ? null : { default_share_expiry_days: defaultDays } };
    }
    return { ok: true };
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ShareModal open target={{ kind: 'file', fileIds: ['f1'] }} name="report.pdf" workspaceId={workspaceId} onClose={() => {}} />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Contract 8 (2026-09-02 field report): the modal pre-fills its expiry from
// the workspace's default_share_expiry_days and falls back to 7 days.
describe('ShareModal default expiry', () => {
  it('pre-fills from the workspace default when it matches a preset', async () => {
    await render(30);
    expect(apiMock).toHaveBeenCalledWith('/api/workspaces/ws_1/settings');
    expect(document.body.textContent).toContain('30 days');
  });

  it('falls back to 7 days when the workspace has no default', async () => {
    await render(null);
    expect(document.body.textContent).toContain('7 days');
  });

  it('falls back to 7 days when the settings row is missing', async () => {
    await render(undefined);
    expect(document.body.textContent).toContain('7 days');
  });

  it('uses a custom date when the default is not one of the presets', async () => {
    await render(3);
    const input = document.body.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    const d = new Date(Date.now() + 3 * 86400 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(input!.value.startsWith(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)).toBe(true);
  });
});

// Fix round 1, MINOR (h): the default belongs to the workspace the TARGET
// lives in, not to whatever workspace the sidebar happens to have active, and
// re-reading it on every open is a round trip per share.
describe('ShareModal settings read', () => {
  it('asks the target\'s workspace, not the active one', async () => {
    await render(30, 'ws_other');
    expect(apiMock).toHaveBeenCalledWith('/api/workspaces/ws_other/settings');
    expect(apiMock).not.toHaveBeenCalledWith('/api/workspaces/ws_1/settings');
  });

  it('reads the setting once per workspace instead of on every open', async () => {
    await render(30);
    const first = apiMock.mock.calls.filter(([p]) => String(p).endsWith('/settings')).length;
    expect(first).toBe(1);

    // Re-open the same modal: the memo answers, no second request.
    if (root) await act(async () => { root!.unmount(); });
    root = null;
    await render(30);
    const total = apiMock.mock.calls.filter(([p]) => String(p).endsWith('/settings')).length;
    expect(total).toBe(1);
    expect(document.body.textContent).toContain('30 days');
  });
});

/**
 * "Never" has to be sent EXPLICITLY. The API applies the workspace's
 * `default_share_expiry_days` only when the payload names no expiry at all
 * (`hasExplicitExpiry` in apps/api/src/lib/share/create.ts), so omitting the
 * field for "Never" made the workspace default win - a link the user set to
 * never expire dying after N days, caused by the default-expiry feature
 * itself. `expires_in_days: 0` is the API's own spelling of "never"
 * (apps/api/src/lib/share/expiry.ts).
 */
describe('ShareModal "Never"', () => {
  const bodyOf = (path: string) => {
    const call = apiMock.mock.calls.find(([p, init]) => String(p).includes(path) && (init as RequestInit | undefined)?.method === 'POST');
    expect(call, `POST to ${path}`).toBeTruthy();
    return JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
  };

  async function pickNever() {
    const trigger = [...document.body.querySelectorAll('button')].find((b) => b.getAttribute('role') === 'combobox')!;
    expect(trigger, 'expiry select').toBeTruthy();
    await act(async () => { trigger.click(); await Promise.resolve(); });
    const option = [...document.body.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === 'Never')!;
    expect(option, 'Never option').toBeTruthy();
    // A bare click() opens nothing here: base-ui commits the choice on the
    // pointer sequence, so the test has to send the one a real click sends.
    await act(async () => {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      }
      await Promise.resolve();
    });
    expect([...document.body.querySelectorAll('button')]
      .find((b) => b.getAttribute('role') === 'combobox')?.textContent).toContain('Never');
  }

  async function submit() {
    const button = [...document.body.querySelectorAll('button')]
      .find((b) => ['Send', 'Generate link'].includes(b.textContent?.trim() ?? ''))!;
    expect(button, 'submit button').toBeTruthy();
    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });
  }

  it('sends expires_in_days: 0 for a link, even when the workspace sets a default', async () => {
    // A workspace default of 30 days is exactly the case that used to override
    // the user's choice.
    await render(30);
    const byLink = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'By link')!;
    await act(async () => { byLink.click(); await Promise.resolve(); });

    await pickNever();
    await submit();

    const body = bodyOf('/api/files/f1/share');
    expect(body.expires_in_days).toBe(0);
    expect(body).not.toHaveProperty('expires_at');
  });

  it('sends expires_in_days: 0 for a share by email too', async () => {
    await render(30);
    const input = document.body.querySelector('input[type="email"], input[placeholder*="mail" i]') as HTMLInputElement;
    expect(input, 'email input').toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'someone@example.com');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });

    await pickNever();
    await submit();

    const body = bodyOf('/api/files/f1/share-email');
    expect(body.expires_in_days).toBe(0);
    expect(body).not.toHaveProperty('expires_at');
  });

  it('still sends an absolute expiry for a dated choice', async () => {
    await render(null);
    const byLink = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'By link')!;
    await act(async () => { byLink.click(); await Promise.resolve(); });

    await submit(); // the 7-day fallback is already selected

    const body = bodyOf('/api/files/f1/share');
    expect(typeof body.expires_at).toBe('number');
    expect(body).not.toHaveProperty('expires_in_days');
  });
});

/**
 * View-only links.
 *
 * lib/share/create.ts has accepted `lock_mode` since migration 0019, validates
 * it, and the CLI has always sent it as `--lock`. This dialog never sent the
 * field, so the only way to create a view-only link was from a terminal.
 */
describe('ShareModal view-only', () => {
  const bodyOf = (path: string) => {
    const call = apiMock.mock.calls.find(([p, init]) => String(p).includes(path) && (init as RequestInit | undefined)?.method === 'POST');
    expect(call, `POST to ${path}`).toBeTruthy();
    return JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
  };

  async function openAdvanced() {
    const toggle = [...document.body.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Advanced options')!;
    expect(toggle, 'advanced toggle').toBeTruthy();
    await act(async () => { toggle.click(); await Promise.resolve(); });
  }

  async function submit() {
    const button = [...document.body.querySelectorAll('button')]
      .find((b) => ['Send', 'Generate link'].includes(b.textContent?.trim() ?? ''))!;
    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });
  }

  async function tickViewOnly() {
    const box = document.body.querySelector('[data-testid="share-view-only"]') as HTMLInputElement;
    expect(box, 'view-only checkbox').toBeTruthy();
    await act(async () => { box.click(); await Promise.resolve(); });
    return box;
  }

  it('sends lock_mode: view_only on a link when the box is ticked', async () => {
    await render(7);
    const byLink = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'By link')!;
    await act(async () => { byLink.click(); await Promise.resolve(); });
    await openAdvanced();
    await tickViewOnly();
    await submit();
    expect(bodyOf('/api/files/f1/share').lock_mode).toBe('view_only');
  });

  it('sends no lock_mode when the box is untouched, so ordinary links are unchanged', async () => {
    await render(7);
    const byLink = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'By link')!;
    await act(async () => { byLink.click(); await Promise.resolve(); });
    await openAdvanced();
    await submit();
    expect(bodyOf('/api/files/f1/share')).not.toHaveProperty('lock_mode');
  });

  it('carries the lock on a share by email too', async () => {
    await render(7);
    const input = document.body.querySelector('input[type="email"], input[placeholder*="mail" i]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'someone@example.com');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    await openAdvanced();
    await tickViewOnly();
    await submit();
    expect(bodyOf('/api/files/f1/share-email').lock_mode).toBe('view_only');
  });
});

/**
 * The download cap (migration 0143). `download_count` has been counted since
 * 0001 and never limited, so a link could be forwarded and re-downloaded
 * indefinitely.
 */
describe('ShareModal download limit', () => {
  const bodyOf = (path: string) => {
    const call = apiMock.mock.calls.find(([p, init]) => String(p).includes(path) && (init as RequestInit | undefined)?.method === 'POST');
    expect(call, `POST to ${path}`).toBeTruthy();
    return JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
  };

  async function openLinkTabAdvanced() {
    const byLink = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'By link')!;
    await act(async () => { byLink.click(); await Promise.resolve(); });
    const toggle = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Advanced options')!;
    await act(async () => { toggle.click(); await Promise.resolve(); });
  }

  async function setCap(value: string) {
    const input = document.body.querySelector('[data-testid="share-max-downloads"]') as HTMLInputElement;
    expect(input, 'download limit input').toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function submit() {
    const button = [...document.body.querySelectorAll('button')]
      .find((b) => ['Send', 'Generate link'].includes(b.textContent?.trim() ?? ''))!;
    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });
  }

  it('sends max_downloads when a limit is typed', async () => {
    await render(7);
    await openLinkTabAdvanced();
    await setCap('5');
    await submit();
    expect(bodyOf('/api/files/f1/share').max_downloads).toBe(5);
  });

  it('sends no max_downloads when the field is left blank, meaning unlimited', async () => {
    await render(7);
    await openLinkTabAdvanced();
    await submit();
    expect(bodyOf('/api/files/f1/share')).not.toHaveProperty('max_downloads');
  });

  // A number input still lets "0" and whitespace through, and the API refuses
  // 0 outright - better to say so before the round trip.
  it('refuses 0 rather than sending a link nobody can use', async () => {
    await render(7);
    await openLinkTabAdvanced();
    await setCap('0');
    await submit();
    const posted = apiMock.mock.calls.some(([p, init]) => String(p).includes('/share') && (init as RequestInit | undefined)?.method === 'POST');
    expect(posted).toBe(false);
    expect(document.body.textContent).toContain('at least 1');
  });
});
