import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { IntegrationsSection, IdentitySection, PasswordSection, DeleteAccountSection } = await import('./profile');
const { toast } = await import('@/lib/toast');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('IntegrationsSection', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

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
      root!.render(
        <IntegrationsSection
          accounts={[
            { id: 'cca_1', provider: 'google', account_email: 'a@example.com', account_name: 'A', created_at: 0 },
          ]}
          providers={[{ id: 'google', label: 'Google Drive' }, { id: 'onedrive', label: 'OneDrive' }]}
          onChanged={() => {}}
        />,
      );
      await Promise.resolve();
    });
  }

  // This is exactly the trap called out in import-progress-card.tsx: two
  // label maps with different key spaces that agree everywhere except
  // Google. PROVIDER_LABELS is keyed by provider id ('google'); the wrong
  // map, IMPORT_SOURCE_LABELS, is keyed by files.import_source
  // ('google-drive') and returns undefined for 'google'. The lookup site in
  // profile.tsx has a `?? provider` fallback, so the wrong map doesn't blank
  // the heading - it renders the raw provider id ("google") instead of
  // "Google Drive", which is quieter than a blank and just as easy to miss
  // without a test pinned to the exact string.
  it('groups a connected google account under a "Google Drive" heading sourced from PROVIDER_LABELS', async () => {
    await render();

    const heading = container!.querySelector('[data-testid="provider-group-heading"]');
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toBe('Google Drive');
    expect(container!.textContent).toContain('a@example.com');
  });

  it('(MINOR 16) renders each provider\'s own icon and a fallback (never another provider\'s mark) for an unmapped one', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <IntegrationsSection
          accounts={[
            { id: 'cca_1', provider: 'google', account_email: 'g@example.com', account_name: 'G', created_at: 0 },
            { id: 'cca_2', provider: 'onedrive', account_email: 'o@example.com', account_name: 'O', created_at: 0 },
            { id: 'cca_3', provider: 'icloud', account_email: 'd@example.com', account_name: 'D', created_at: 0 },
          ]}
          providers={[{ id: 'google', label: 'Google Drive' }, { id: 'onedrive', label: 'OneDrive' }]}
          onChanged={() => {}}
        />,
      );
      await Promise.resolve();
    });

    const rows = [...container.querySelectorAll('p.text-xs.font-medium.truncate')];
    const rowFor = (email: string) =>
      rows.find((r) => r.textContent === email)!.closest('div.flex.items-center.justify-between')!;

    expect(rowFor('g@example.com').querySelector('img')?.getAttribute('src')).toBe('/google-color.svg');
    expect(rowFor('o@example.com').querySelector('img')?.getAttribute('src')).toBe('/onedrive-color.svg');
    // The unmapped provider must NOT silently render another provider's icon.
    expect(rowFor('d@example.com').querySelector('img')).toBeNull();
    expect(rowFor('d@example.com').querySelector('svg')).not.toBeNull();
  });

  it('renders one connect row per provider from the providers prop', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <IntegrationsSection
          accounts={[]}
          providers={[{ id: 'google', label: 'Google Drive' }, { id: 'onedrive', label: 'OneDrive' }]}
          onChanged={() => {}}
        />,
      );
      await Promise.resolve();
    });

    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links.some((h) => h?.endsWith('/api/cloud/connect/google'))).toBe(true);
    expect(links.some((h) => h?.endsWith('/api/cloud/connect/onedrive'))).toBe(true);
  });
});

// F5 (field report): the "Preferred language" selector saved nothing and
// changed nothing - the interface is English only today. A control that
// does nothing is a broken promise, so it is gone until localisation ships.
describe('IdentitySection', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('does not render a language selector', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <IdentitySection
          user={{
            id: 'u1', name: 'Ada', email: 'ada@example.com', email_verified: 1, avatar_url: null,
            preferred_language: 'en', has_password: true, plan: 'free', created_at: 0,
          } as never}
          onSaved={() => {}}
        />,
      );
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain('Preferred language');
    expect(container.querySelector('select, [role="combobox"]')).toBeNull();
    // The section itself still renders (the email field is an input, not text).
    expect([...container.querySelectorAll('input')].some((i) => i.value === 'ada@example.com')).toBe(true);
  });
});

// F8 (field report, Contract 7): an OAuth-created account has no password
// and used to be told to go through "Forgot password". It can now set one
// here; the API accepts a missing current_password while password_set_at is
// NULL.
describe('PasswordSection', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    apiMock.mockReset();
  });

  async function render(hasPassword: boolean) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<PasswordSection tfa={{ method: null, totp_enabled: false, recovery_codes_remaining: 0 }} onTfaChanged={() => {}} hasPassword={hasPassword} />);
      await Promise.resolve();
    });
  }

  const button = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  }

  it('shows "Set a password" without a current-password field and posts only the new password', async () => {
    apiMock.mockResolvedValue({ ok: true });
    await render(false);
    expect(container!.textContent).toContain('Set a password');
    expect(container!.textContent).not.toContain('Change password');

    await act(async () => { button('Set a password')!.click(); });
    expect(document.body.querySelector('input[placeholder="Current password"]')).toBeNull();
    type(document.body.querySelector('input[placeholder="New password"]') as HTMLInputElement, 'Str0ng!Pass');
    type(document.body.querySelector('input[placeholder="Confirm new password"]') as HTMLInputElement, 'Str0ng!Pass');
    await act(async () => { [...document.body.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Set a password').at(-1)!.click(); });

    const call = apiMock.mock.calls.find(([p]) => p === '/api/me/password') as [string, RequestInit] | undefined;
    expect(call).toBeTruthy();
    expect(call![1].method).toBe('PUT');
    // No key came back from the list, so there is nothing to ask about: keep.
    expect(JSON.parse(call![1].body as string)).toEqual({ new_password: 'Str0ng!Pass', revoke_api_keys: false });
  });

  // PUT /api/me/password revokes every API key unless told
  // `revoke_api_keys: false` (bug bounty 2026-11, report 08). The dialog
  // asks, and always sends the field explicitly.
  describe('"Also sign out apps and API keys"', () => {
    const NOW = Math.floor(Date.now() / 1000);
    const DAY = 86_400;
    const key = (id: string, over: Partial<{ last_used_at: number | null; expires_at: number | null }> = {}) => ({
      id, name: id, scope: 'full', key_prefix: 'abcd1234', created_at: NOW - 100 * DAY,
      last_used_at: NOW - DAY, expires_at: null, s3_access_key_id: null, surfaces: null,
      workspace_id: null, root_folder_id: null, allowed_ips: null, active_hours: null, ...over,
    });
    const box = () => document.body.querySelector('[data-testid="revoke-api-keys"]') as HTMLElement | null;
    const putBody = () => {
      const call = apiMock.mock.calls.find(([p]) => p === '/api/me/password') as [string, RequestInit] | undefined;
      return call ? JSON.parse(call[1].body as string) : undefined;
    };
    function mockApi(list: unknown, put: unknown = { ok: true, revoked_api_keys: 0 }) {
      apiMock.mockImplementation(async (path: string) => {
        if (path === '/api/me/api-keys') {
          if (list instanceof Error) throw list;
          return list;
        }
        if (path === '/api/me/password') return put;
        return { ok: true };
      });
    }
    beforeAll(() => {
      // base-ui Checkbox forwards a click with `new PointerEvent('click')`,
      // which jsdom lacks (same polyfill as api-keys-section.test.tsx).
      if (typeof window.PointerEvent === 'undefined') {
        class PointerEventPolyfill extends MouseEvent {
          pointerId = 0;
          pointerType = 'mouse';
        }
        (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
      }
    });
    async function open() {
      await render(true);
      await act(async () => { button('Change password')!.click(); });
      await act(async () => { await Promise.resolve(); });
    }
    async function submit() {
      type(document.body.querySelector('input[placeholder="Current password"]') as HTMLInputElement, 'old passphrase here');
      type(document.body.querySelector('input[placeholder="New password"]') as HTMLInputElement, 'a much longer passphrase 42');
      type(document.body.querySelector('input[placeholder="Confirm new password"]') as HTMLInputElement, 'a much longer passphrase 42');
      await act(async () => { [...document.body.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Change password').at(-1)!.click(); });
    }

    it('is ticked by default when a working key has gone 30 days unused, counts only working keys, and sends true', async () => {
      const success = vi.spyOn(toast, 'success');
      mockApi(
        { ok: true, keys: [key('busy'), key('quiet', { last_used_at: NOW - 31 * DAY }), key('expired', { expires_at: NOW - DAY })] },
        { ok: true, revoked_api_keys: 3 },
      );
      await open();
      expect(document.body.textContent).toContain('Also sign out apps and API keys (2 active)');
      expect(document.body.textContent).toContain('stop working until you create a new key for them');
      await submit();
      expect(putBody()).toMatchObject({ current_password: 'old passphrase here', revoke_api_keys: true });
      expect(success).toHaveBeenCalledWith('Password changed', 'Your password has been updated. We removed 3 API keys.');
      success.mockRestore();
    });

    it('is ticked by default for a key that was never used', async () => {
      mockApi({ ok: true, keys: [key('fresh', { last_used_at: null })] });
      await open();
      await submit();
      expect(putBody()).toMatchObject({ revoke_api_keys: true });
    });

    it('is unticked when every working key was used in the last 30 days, sends false, and the toast says nothing about keys', async () => {
      const success = vi.spyOn(toast, 'success');
      mockApi({ ok: true, keys: [key('a'), key('b', { last_used_at: NOW - 29 * DAY })] });
      await open();
      expect(document.body.textContent).toContain('(2 active)');
      await submit();
      expect(putBody()).toMatchObject({ revoke_api_keys: false });
      expect(success).toHaveBeenCalledWith('Password changed', 'Your password has been updated.');
      success.mockRestore();
    });

    it('can be ticked by hand', async () => {
      mockApi({ ok: true, keys: [key('a')] });
      await open();
      await act(async () => { box()!.click(); });
      await submit();
      expect(putBody()).toMatchObject({ revoke_api_keys: true });
    });

    it('is hidden with no working key, and the change keeps keys', async () => {
      mockApi({ ok: true, keys: [key('expired', { expires_at: NOW - DAY })] });
      await open();
      expect(box()).toBeNull();
      expect(document.body.textContent).not.toContain('Also sign out apps');
      await submit();
      expect(putBody()).toMatchObject({ revoke_api_keys: false });
    });

    it('is hidden when the key list cannot be read, and falls back to the server default (revoke)', async () => {
      mockApi(new Error('offline'));
      await open();
      expect(box()).toBeNull();
      await submit();
      expect(putBody()).toMatchObject({ revoke_api_keys: true });
    });
  });

  // Fix round 1, MINOR (f): the composition rules ("upper and lower case, a
  // number, and a special character") were removed from the shared policy -
  // it is a length check now - and the copy promised a rule the API no longer
  // enforces. Apple is a sign-in provider too.
  it('describes the password rule the API actually enforces', async () => {
    await render(true);
    await act(async () => { button('Change password')!.click(); });
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('special character');
    expect(text).not.toContain('upper and lower case');
    expect(text).toMatch(/at least 8 characters/i);
  });

  it('names every sign-in provider, Apple included, in the no-password copy', async () => {
    await render(false);
    expect(container!.textContent).toContain('Apple');
    expect(container!.textContent).not.toContain('Google or GitHub');
  });

  it('keeps "Change password" with the current-password field for accounts that have one', async () => {
    await render(true);
    expect(container!.textContent).toContain('Change password');
    await act(async () => { button('Change password')!.click(); });
    expect(document.body.querySelector('input[placeholder="Current password"]')).not.toBeNull();
  });
});


describe('DeleteAccountSection', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    apiMock.mockReset();
  });

  // Chrome's page translation (Sentry 149714040, a zh-TW user on /profile)
  // does not edit text in place: it detaches every text node and puts a
  // <font> holding the translated string where it was. React still owns the
  // detached node, so the next time it removes or reorders a bare text child
  // the browser throws NotFoundError from removeChild and the router's error
  // page replaces the profile. This mimics that rewrite exactly.
  function translate(el: Element) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
    for (const t of texts) {
      const font = document.createElement('font');
      font.textContent = `譯:${t.data}`;
      t.parentNode!.replaceChild(font, t);
    }
  }

  it('survives a translated DOM when the preview arrives with one workspace', async () => {
    let resolvePreview: (v: unknown) => void = () => {};
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/delete-preview') return new Promise((r) => { resolvePreview = r; });
      return Promise.resolve({ ok: true });
    });
    const uncaught: unknown[] = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container, { onUncaughtError: (e) => { uncaught.push(e); } });
    await act(async () => {
      // The section links to the privacy page, so it needs a router around it.
      root!.render(<MemoryRouter><DeleteAccountSection /></MemoryRouter>);
      await Promise.resolve();
    });
    const summary = container.querySelector('[data-testid="delete-summary"]');
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toContain('0 workspaces and 0 files');

    translate(container);

    await act(async () => {
      resolvePreview({
        ok: true,
        workspaces: [{ id: 'ws_1', name: 'Only' }],
        file_count: 1,
        total_bytes: 0,
        blockers: [],
        window_days: 30,
        deletion_scheduled_for: null,
      });
      await Promise.resolve();
    });

    expect(uncaught).toEqual([]);
    expect(container.querySelector('[data-testid="delete-summary"]')!.textContent)
      .toContain('1 workspace and 1 file');
  });
});
