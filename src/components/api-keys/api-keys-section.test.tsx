import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { ApiKey } from '@/lib/api-keys';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { ApiKeysSection } = await import('./api-keys-section');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // base-ui Radio and Checkbox forward a click to their hidden input with
  // `new PointerEvent('click')`, which jsdom lacks - without this the click
  // is swallowed and the selection never changes (see lock-modal.test.tsx).
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

const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);
const WS = [{ id: 'ws_1', name: 'Design Studio' }];

const key = (over: Partial<ApiKey> = {}): ApiKey => ({
  id: 'key_x', name: 'x', scope: 'full', key_prefix: 'abcd1234', created_at: NOW - DAY,
  last_used_at: null, expires_at: null, s3_access_key_id: null, surfaces: null,
  workspace_id: null, root_folder_id: null, allowed_ips: null, active_hours: null,
  ...over,
});

describe('ApiKeysSection', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let onChanged: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/folders/')) return { ok: true, folder: { name: 'Archive' } };
      return { ok: true };
    });
    onChanged = vi.fn<() => void>();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function render(keys: ApiKey[]) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <ApiKeysSection keys={keys} workspaces={WS} onChanged={onChanged} />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
  }

  const $ = <T extends Element = HTMLElement>(sel: string, from: ParentNode = container!) => from.querySelector<T>(sel)!;
  const $$ = (sel: string, from: ParentNode = container!) => [...from.querySelectorAll<HTMLElement>(sel)];
  const row = (id: string) => $(`[data-testid="key-row"][data-key-id="${id}"]`);
  const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
  const type = async (el: HTMLInputElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const expand = async (id: string) => click($('[data-testid="key-expand"]', row(id)));
  const expanded = (id: string) => $(`[data-testid="key-details"][data-key-id="${id}"]`);
  const posts = () => apiMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST' && c[0] === '/api/me/api-keys');
  const lastPostBody = () => JSON.parse(String((posts().at(-1)![1] as RequestInit).body));

  // ── the list ──

  it('shows when each key was last used, and flags one nobody has touched in 90 days', async () => {
    await render([
      key({ id: 'k_fresh', name: 'fresh', last_used_at: NOW - 4 * 60 }),
      key({ id: 'k_never', name: 'never used' }),
      key({ id: 'k_old', name: 'forgotten', last_used_at: NOW - 187 * DAY }),
    ]);
    expect($('[data-testid="last-used"]', row('k_fresh')).textContent).toBe('4m ago');
    expect($('[data-testid="last-used"]', row('k_never')).textContent).toBe('Never');
    expect($('[data-testid="last-used"]', row('k_old')).dataset.stale).toBe('true');
    expect($('[data-testid="last-used"]', row('k_fresh')).dataset.stale).toBeUndefined();
  });

  it('summarises the list: how many keys, how many unrestricted, how many stale', async () => {
    await render([
      key({ id: 'a', name: 'a' }),
      key({ id: 'b', name: 'b', scope: 'read', last_used_at: NOW - 100 * DAY }),
      key({ id: 'c', name: 'c', workspace_id: 'ws_1' }),
    ]);
    const strip = $('[data-testid="summary-strip"]').textContent!;
    expect(strip).toContain('3 keys');
    expect(strip).toContain('1 unrestricted');
    expect(strip).toContain('1 unused for 90+ days');
  });

  it('filters rows by name or prefix, and by "unrestricted only"', async () => {
    await render([
      key({ id: 'a', name: 'rclone backup', key_prefix: 'a3f9zzzz' }),
      key({ id: 'b', name: 'CI uploader', key_prefix: '71cdzzzz', scope: 'upload' }),
    ]);
    await type($('[data-testid="key-search"]') as HTMLInputElement, 'a3f9');
    expect($$('[data-testid="key-row"]').map((r) => r.dataset.keyId)).toEqual(['a']);

    await type($('[data-testid="key-search"]') as HTMLInputElement, '');
    await click($('[data-testid="filter-unrestricted"]'));
    expect($$('[data-testid="key-row"]').map((r) => r.dataset.keyId)).toEqual(['a']);
  });

  it('expands a row into its full configuration instead of truncating it', async () => {
    await render([key({
      id: 'k', name: 'reporting', scope: 'read', surfaces: 'webdav,s3', workspace_id: 'ws_1', root_folder_id: 'f_1',
      allowed_ips: '10.0.0.0/8, 192.168.0.0/16', active_hours: '{"tz":"UTC","days":[1,2,3,4,5],"from":"09:00","to":"17:00"}',
      expires_at: NOW + 10 * DAY,
    })]);
    expect(container!.querySelector('[data-testid="key-details"]')).toBeNull();
    await expand('k');
    const text = expanded('k').textContent!;
    expect(text).toContain('Read only');
    expect(text).toContain('WebDAV, S3 gateway');
    expect(text).toContain('Design Studio / Archive');
    expect(text).toContain('2 ranges');
    expect(text).toContain('Mon–Fri 09:00–17:00 (UTC)');
    expect(text).toMatch(/Expires/);
  });

  // ── S3 rules carried over from the old column (bounty report 2026-09-05) ──

  it('does not offer to enable S3 for a key whose protocols exclude the gateway, and says why', async () => {
    await render([key({ id: 'k_api', name: 'api only', surfaces: 'api' }), key({ id: 'k_none', name: 'none', surfaces: '' })]);
    for (const id of ['k_api', 'k_none']) {
      await expand(id);
      const s3 = $('[data-testid="s3-status"]', expanded(id));
      expect(s3.textContent).toContain('Not allowed');
      expect(expanded(id).querySelector('[data-testid="s3-enable"]')).toBeNull();
    }
  });

  it('shows Expired instead of Enable for a key past its expiry', async () => {
    await render([key({ id: 'k_old', name: 'expired', expires_at: 1_000 })]);
    await expand('k_old');
    expect($('[data-testid="s3-status"]', expanded('k_old')).textContent).toContain('Expired');
    expect(expanded('k_old').querySelector('[data-testid="s3-enable"]')).toBeNull();
  });

  it('offers Enable for a key that allows S3, and Show once credentials exist', async () => {
    await render([
      key({ id: 'k_all', name: 'all', surfaces: null }),
      key({ id: 'k_live', name: 'minted', surfaces: 's3', s3_access_key_id: 'DOSYAAAAAAAAAAAAAAAAA' }),
    ]);
    await expand('k_all');
    expect(expanded('k_all').querySelector('[data-testid="s3-enable"]')).not.toBeNull();

    await expand('k_live');
    expect(expanded('k_live').querySelector('[data-testid="s3-enable"]')).toBeNull();
    await click($('[data-testid="s3-show"]', expanded('k_live')));
    expect(document.body.textContent).toContain('https://api.dosya.dev/s3');
    expect(document.body.textContent).toContain('us-east-1');
  });

  // ── revoking ──

  it('asks before revoking a single key, then deletes it and reloads', async () => {
    await render([key({ id: 'k', name: 'doomed' })]);
    await expand('k');
    await click($('[data-testid="revoke"]', expanded('k')));
    expect(apiMock.mock.calls.some((c) => c[0] === '/api/me/api-keys/k')).toBe(false);
    expect(document.body.textContent).toContain('Revoke doomed?');
    await click(document.body.querySelector('[data-testid="confirm-revoke"]'));
    expect(apiMock).toHaveBeenCalledWith('/api/me/api-keys/k', expect.objectContaining({ method: 'DELETE' }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('revokes several selected keys at once', async () => {
    await render([key({ id: 'a', name: 'a' }), key({ id: 'b', name: 'b' }), key({ id: 'c', name: 'c' })]);
    await click($('[data-testid="key-select"]', row('a')));
    await click($('[data-testid="key-select"]', row('c')));
    expect($('[data-testid="bulk-revoke"]').textContent).toContain('2');
    await click($('[data-testid="bulk-revoke"]'));
    await click(document.body.querySelector('[data-testid="confirm-revoke"]'));
    const deleted = apiMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE').map((c) => c[0]);
    expect(deleted.sort()).toEqual(['/api/me/api-keys/a', '/api/me/api-keys/c']);
  });

  // ── creating ──

  it('opens with a name and a permission choice only; restrictions stay behind one disclosure', async () => {
    await render([]);
    await click($('[data-testid="new-key"]'));
    expect(document.body.querySelector('[data-testid="create-name"]')).not.toBeNull();
    expect(document.body.querySelectorAll('[data-testid^="scope-"] [role="radio"]').length).toBe(3);
    expect(document.body.querySelector('[data-testid="create-ips"]')).toBeNull();

    await click(document.body.querySelector('[data-testid="restrictions-toggle"]'));
    expect(document.body.querySelector('[data-testid="create-ips"]')).not.toBeNull();
  });

  it('reads the key back as a sentence that follows the permission picked', async () => {
    await render([]);
    await click($('[data-testid="new-key"]'));
    const summary = () => document.body.querySelector('[data-testid="create-summary"]')!.textContent!;
    expect(summary()).toContain('read, upload, move and delete anything');
    await click(document.body.querySelector('[data-testid="scope-read"] [role="radio"]'));
    expect(summary()).toContain('list and download files');
  });

  it('posts only what was set, then shows the new key once', async () => {
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/me/api-keys' && init?.method === 'POST') return { ok: true, key: { plain_key: 'dos_plain_secret_value' } };
      return { ok: true };
    });
    await render([]);
    await click($('[data-testid="new-key"]'));
    await type(document.body.querySelector('[data-testid="create-name"]') as HTMLInputElement, 'CI uploader');
    await click(document.body.querySelector('[data-testid="scope-upload"] [role="radio"]'));
    await click(document.body.querySelector('[data-testid="create-submit"]'));

    expect(lastPostBody()).toEqual({ name: 'CI uploader', scope: 'upload' });
    expect(document.body.querySelector('[data-testid="plain-key"]')!.textContent).toBe('dos_plain_secret_value');
    expect(onChanged).toHaveBeenCalled();
  });

  it('sends expires_in_days when an expiry is picked', async () => {
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/me/api-keys' && init?.method === 'POST') return { ok: true, key: { plain_key: 'dos_x' } };
      return { ok: true };
    });
    await render([]);
    await click($('[data-testid="new-key"]'));
    await type(document.body.querySelector('[data-testid="create-name"]') as HTMLInputElement, 'short lived');
    await click(document.body.querySelector('[data-testid="restrictions-toggle"]'));
    await click(document.body.querySelector('[data-testid="expiry-30"] [role="radio"]'));
    await click(document.body.querySelector('[data-testid="create-submit"]'));
    expect(lastPostBody()).toEqual({ name: 'short lived', scope: 'full', expires_in_days: 30 });
  });

  it('refuses to submit without a name and does not call the API', async () => {
    await render([]);
    await click($('[data-testid="new-key"]'));
    await click(document.body.querySelector('[data-testid="create-submit"]'));
    expect(posts().length).toBe(0);
  });

  it('"Duplicate settings" opens the form pre-filled from an existing key', async () => {
    await render([key({ id: 'k', name: 'reporting', scope: 'read', surfaces: 'webdav', allowed_ips: '10.0.0.0/8' })]);
    await expand('k');
    await click($('[data-testid="duplicate"]', expanded('k')));
    expect((document.body.querySelector('[data-testid="create-name"]') as HTMLInputElement).value).toBe('reporting copy');
    expect(document.body.querySelector('[data-testid="create-summary"]')!.textContent).toContain('list and download files');
    // Restrictions came across, so the tier is already open and the count says so.
    expect((document.body.querySelector('[data-testid="create-ips"]') as HTMLTextAreaElement).value).toBe('10.0.0.0/8');
  });
});
