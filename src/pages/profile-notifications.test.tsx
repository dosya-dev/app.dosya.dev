import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * The settings screen writes what the user actually moved.
 *
 * A unit test of the endpoint cannot catch a screen that renders 14 rows and
 * PUTs the wrong key for one of them, and that is the exact failure this page
 * has already shipped twice: 18 toggles keyed to types the server had stopped
 * storing, and a desktop build that PUT its whole map and overwrote the switch
 * the user had just moved. So every assertion below is about the request that
 * leaves the page.
 */

const calls: { path: string; options?: RequestInit }[] = [];
let getResponse: unknown;
const state = { failNextWrite: false };

vi.mock('@/api/client', () => ({
  API_BASE: '',
  ApiError: class ApiError extends Error {},
  api: async (path: string, options?: RequestInit) => {
    calls.push({ path, options });
    if (!options || options.method === undefined) return getResponse;
    if (state.failNextWrite) {
      state.failNextWrite = false;
      return { ok: false, error: 'nope' };
    }
    return { ok: true };
  },
}));

vi.mock('@/lib/web-push', () => ({ enableWebPush: async () => 'enabled' }));

import { NotificationsSection } from './profile';

const group = (over: Record<string, unknown> = {}) => ({
  key: 'files',
  label: 'File activity',
  description: 'Uploads, deletions, new versions and locks on files you own.',
  enabled: true,
  alwaysOn: 'none' as const,
  note: null,
  options: [] as { key: string; label: string; description: string; enabled: boolean }[],
  ...over,
});

const RESPONSE = {
  ok: true,
  channels: { in_app: true, email: true, push: true },
  groups: [
    group({ key: 'security', label: 'Security and sign-in', alwaysOn: 'some', note: 'Some messages in this group are always sent and cannot be switched off.' }),
    group({
      key: 'files',
      options: [
        { key: 'type:files_uploaded', label: 'Uploads to your workspace', description: 'Off unless you ask for it.', enabled: false },
      ],
    }),
    group({ key: 'product', label: 'Product updates', enabled: false }),
  ],
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('NotificationsSection', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    calls.length = 0;
    getResponse = RESPONSE;
    state.failNextWrite = false;
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
    await act(async () => {
      root!.render(<NotificationsSection />);
      await Promise.resolve();
    });
  }

  const rowFor = (key: string) => container!.querySelector(`[data-testid="notif-group-${key}"]`)!;
  const switches = (el: Element) => [...el.querySelectorAll('button[role="switch"]')] as HTMLButtonElement[];
  const puts = () => calls.filter((c) => c.options?.method === 'PUT').map((c) => JSON.parse(String(c.options!.body)));

  it('renders one row per group the server sent, and nothing it did not', async () => {
    await render();
    const rows = [...container!.querySelectorAll('[data-testid^="notif-group-"]')];
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'notif-group-security', 'notif-group-files', 'notif-group-product',
    ]);
    // The label and description come from the response, not from this file.
    expect(rowFor('security').textContent).toContain('Security and sign-in');
    expect(rowFor('files').textContent).toContain('Uploads, deletions, new versions and locks');
  });

  // The whole point of the group model: the key written is the key the
  // delivery gate reads. A legacy type key here is the bug this plan closes.
  it('PUTs the group key, alone', async () => {
    await render();
    await act(async () => { switches(rowFor('product'))[0].click(); });
    expect(puts()).toEqual([{ preferences: { product: true } }]);
  });

  it('PUTs the opt-in key for a sub-switch, not its group', async () => {
    await render();
    const sub = switches(rowFor('files'))[1];
    await act(async () => { sub.click(); });
    expect(puts()).toEqual([{ preferences: { 'type:files_uploaded': true } }]);
  });

  // One key per request. A whole-map PUT is a stale-map race with any other
  // session the user has open, and it is what made every desktop toggle a
  // no-op until the server learned to ignore echoed keys.
  it('sends exactly one key per request, whatever else is on screen', async () => {
    await render();
    await act(async () => { switches(rowFor('security'))[0].click(); });
    await act(async () => { switches(rowFor('product'))[0].click(); });
    for (const body of puts()) expect(Object.keys(body.preferences)).toHaveLength(1);
  });

  it('shows a group whose value came from a default exactly like a stored one', async () => {
    await render();
    // `files` and `security` are both on; nothing in the markup says which of
    // them is a default. The user cannot tell, and should not.
    expect(switches(rowFor('files'))[0].getAttribute('aria-checked')).toBe('true');
    expect(switches(rowFor('security'))[0].getAttribute('aria-checked')).toBe('true');
    expect(switches(rowFor('product'))[0].getAttribute('aria-checked')).toBe('false');
  });

  it('says so when a group contains types that are always sent', async () => {
    await render();
    expect(rowFor('security').textContent).toContain('always sent');
    expect(rowFor('files').textContent).not.toContain('always sent');
  });

  it('reverts the switch when the server refuses the write', async () => {
    await render();
    const sw = switches(rowFor('files'))[0];
    expect(sw.getAttribute('aria-checked')).toBe('true');

    state.failNextWrite = true;
    await act(async () => { sw.click(); });
    expect(switches(rowFor('files'))[0].getAttribute('aria-checked')).toBe('true');
  });
});
