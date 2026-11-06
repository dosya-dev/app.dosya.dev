import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { ShareModal, clearShareDefaultsCache, isExpiryLockedOnFree } = await import('./share-modal');
const { useWorkspace } = await import('@/stores/workspace');
const { useSession } = await import('@/stores/session');
const { MemoryRouter } = await import('react-router-dom');

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
/**
 * "Remove photo metadata" (migration 0183). The box sends `strip_metadata:
 * true`; untouched, the field is absent so an ordinary link is byte-for-byte
 * what it was before the option existed.
 */
describe('ShareModal remove photo metadata', () => {
  const bodyOf = (path: string) => {
    const call = apiMock.mock.calls.find(([p, init]) => String(p).includes(path) && (init as RequestInit | undefined)?.method === 'POST');
    expect(call, `POST to ${path}`).toBeTruthy();
    return JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
  };

  async function openAdvanced() {
    const toggle = [...document.body.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Advanced options')!;
    await act(async () => { toggle.click(); await Promise.resolve(); });
  }

  async function submit() {
    const button = [...document.body.querySelectorAll('button')]
      .find((b) => ['Send', 'Generate link'].includes(b.textContent?.trim() ?? ''))!;
    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });
  }

  async function tickStrip() {
    const box = document.body.querySelector('[data-testid="share-strip-metadata"]') as HTMLInputElement;
    expect(box, 'strip-metadata checkbox').toBeTruthy();
    await act(async () => { box.click(); await Promise.resolve(); });
  }

  it('sends strip_metadata: true on a link when the box is ticked', async () => {
    await render(7);
    const byLink = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'By link')!;
    await act(async () => { byLink.click(); await Promise.resolve(); });
    await openAdvanced();
    await tickStrip();
    await submit();
    expect(bodyOf('/api/files/f1/share').strip_metadata).toBe(true);
  });

  it('sends no strip_metadata when the box is untouched', async () => {
    await render(7);
    const byLink = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'By link')!;
    await act(async () => { byLink.click(); await Promise.resolve(); });
    await openAdvanced();
    await submit();
    expect(bodyOf('/api/files/f1/share')).not.toHaveProperty('strip_metadata');
  });

  it('carries the option on a share by email too', async () => {
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
    await tickStrip();
    await submit();
    expect(bodyOf('/api/files/f1/share-email').strip_metadata).toBe(true);
  });
});

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

// The note (title + message) travels with the link and is shown to the
// recipient on the share page, so it goes in BOTH request bodies: the title
// used to be collected and never sent, and the message only went with an
// email. Blank fields are dropped rather than sent as "" so the API stores
// null; the ceilings mirror the API's 120 / 500.
describe('ShareModal note', () => {
  const bodyOf = (path: string) => {
    const call = apiMock.mock.calls.find(([p, init]) => String(p).includes(path) && (init as RequestInit | undefined)?.method === 'POST');
    expect(call, `POST to ${path}`).toBeTruthy();
    return JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
  };

  async function openAdvanced() {
    const toggle = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Advanced options')!;
    await act(async () => { toggle.click(); await Promise.resolve(); });
  }

  async function openLinkTab() {
    const byLink = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'By link')!;
    await act(async () => { byLink.click(); await Promise.resolve(); });
  }

  async function typeInto(testId: string, value: string) {
    const el = document.body.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
    expect(el, testId).toBeTruthy();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
    await act(async () => {
      setter.call(el, value);
      el!.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function addRecipient() {
    const input = document.body.querySelector('input[type="email"], input[placeholder*="mail" i]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'a@b.co');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
  }

  async function submit() {
    const button = [...document.body.querySelectorAll('button')]
      .find((b) => ['Send', 'Generate link'].includes(b.textContent?.trim() ?? ''))!;
    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });
  }

  it('shows the message field on the link tab too, with the share page hint', async () => {
    await render(7);
    await openLinkTab();
    await openAdvanced();
    expect(document.body.querySelector('[data-testid="share-message"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="share-title"]')).toBeTruthy();
    expect(document.body.textContent).toContain('Shown to the recipient on the share page');
    expect(document.body.textContent).toContain('0/120');
    expect(document.body.textContent).toContain('0/500');
  });

  it('sends a trimmed title and message with a link', async () => {
    await render(7);
    await openLinkTab();
    await openAdvanced();
    await typeInto('share-title', '  Q4 numbers  ');
    await typeInto('share-message', ' Page 4 has the split. ');
    await submit();
    const body = bodyOf('/api/files/f1/share');
    expect(body.title).toBe('Q4 numbers');
    expect(body.message).toBe('Page 4 has the split.');
  });

  it('sends neither field when both are left blank', async () => {
    await render(7);
    await openLinkTab();
    await openAdvanced();
    await typeInto('share-message', '   ');
    await submit();
    const body = bodyOf('/api/files/f1/share');
    expect(body).not.toHaveProperty('title');
    expect(body).not.toHaveProperty('message');
  });

  it('carries the title on a share by email too', async () => {
    await render(7);
    await addRecipient();
    await openAdvanced();
    await typeInto('share-title', 'Q4 numbers');
    await typeInto('share-message', 'See page 4.');
    await submit();
    const body = bodyOf('/api/files/f1/share-email');
    expect(body.title).toBe('Q4 numbers');
    expect(body.message).toBe('See page 4.');
  });
});

// The API clamps a Free creator's links to 7 days without refusing, so a
// "Never" pick came back as 7 days with nothing said. The picker now locks
// every option past the cap and says why.
describe('ShareModal on the Free plan', () => {
  afterEach(() => { useSession.setState({ user: null }); });

  async function renderFree(defaultDays: number | null) {
    useSession.setState({ user: { plan: { id: 'free', name: 'Free' } } as never });
    apiMock.mockImplementation(async (path: string) => (
      path.endsWith('/settings') ? { ok: true, settings: { default_share_expiry_days: defaultDays } } : { ok: true }
    ));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <ShareModal open target={{ kind: 'file', fileIds: ['f1'] }} name="report.pdf" onClose={() => {}} />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function openPicker() {
    const trigger = [...document.body.querySelectorAll('button')].find((b) => b.getAttribute('role') === 'combobox')!;
    await act(async () => { trigger.click(); await Promise.resolve(); });
    return [...document.body.querySelectorAll('[role="option"]')];
  }

  it('locks the options past 7 days and leaves the rest open', async () => {
    await renderFree(null);
    const options = await openPicker();
    const disabled = (label: string) => options.find((o) => o.textContent?.trim() === label)?.hasAttribute('data-disabled');
    expect(disabled('Never')).toBe(true);
    expect(disabled('30 days')).toBe(true);
    expect(disabled('90 days')).toBe(true);
    expect(disabled('Custom date…')).toBe(true);
    expect(disabled('7 days')).toBe(false);
    expect(disabled('24 hours')).toBe(false);
  });

  it('starts at 7 days even when the workspace default is longer', async () => {
    await renderFree(30);
    const trigger = [...document.body.querySelectorAll('button')].find((b) => b.getAttribute('role') === 'combobox')!;
    expect(trigger.textContent).toContain('7 days');
  });

  it('takes the longest preset inside a between-presets default instead of a custom date', async () => {
    await renderFree(3);
    expect(document.body.querySelector('input[type="datetime-local"]')).toBeNull();
    const trigger = [...document.body.querySelectorAll('button')].find((b) => b.getAttribute('role') === 'combobox')!;
    expect(trigger.textContent).toContain('24 hours');
  });

  it('says why under the picker, with a way to upgrade', async () => {
    await renderFree(null);
    expect(document.body.textContent).toContain('Free plan links last up to 7 days.');
    expect(document.body.querySelector('a[href="/billing?upgrade=1"]')).not.toBeNull();
  });
});

describe('isExpiryLockedOnFree', () => {
  it('locks only what outlives 7 days', () => {
    expect(isExpiryLockedOnFree('never')).toBe(true);
    expect(isExpiryLockedOnFree('2592000')).toBe(true);
    expect(isExpiryLockedOnFree('604800')).toBe(false);
    expect(isExpiryLockedOnFree('3600')).toBe(false);
    expect(isExpiryLockedOnFree('custom')).toBe(true);
  });
});
