import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { IntegrationsSection, IdentitySection, PasswordSection, ApiKeysSection } = await import('./profile');

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
    expect(JSON.parse(call![1].body as string)).toEqual({ new_password: 'Str0ng!Pass' });
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

describe('ApiKeysSection', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  const key = (over: Partial<Parameters<typeof ApiKeysSection>[0]['keys'][number]>) => ({
    id: 'key_x', name: 'x', scope: 'full', key_prefix: 'abcd', created_at: 1,
    s3_access_key_id: null, surfaces: null, workspace_id: null, root_folder_id: null,
    allowed_ips: null, active_hours: null, expires_at: null,
    ...over,
  });

  async function render(keys: ReturnType<typeof key>[]) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <ApiKeysSection keys={keys} workspaces={[]} onChanged={() => {}} />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
  }

  const rowFor = (name: string) =>
    [...container!.querySelectorAll('span.text-xs.font-medium.truncate')]
      .find((el) => el.textContent === name)!
      .closest('div.grid')!;

  // Bounty report 2026-09-05: the API minted S3 credentials for a key whose
  // surfaces excluded s3, and this button was how a user got there without
  // curl. The server now refuses; the page must stop offering it, and say
  // why, so the S3 column doesn't just go blank for those keys.
  it('does not offer "Enable" S3 for a key whose protocols exclude the S3 gateway', async () => {
    await render([
      key({ id: 'k_api', name: 'api only', surfaces: 'api' }),
      key({ id: 'k_none', name: 'no protocols', surfaces: '' }),
    ]);

    for (const name of ['api only', 'no protocols']) {
      const row = rowFor(name);
      expect(row.textContent).not.toContain('Enable');
      expect(row.textContent).toContain('Not allowed');
      expect(row.querySelector('[title*="S3"]')).not.toBeNull();
    }
  });

  // The API refuses to mint for an expired key (both doors already refuse the
  // key itself), so offering "Enable" here would only ever produce an error.
  it('shows "Expired" instead of "Enable" for a key past its expiry', async () => {
    await render([
      key({ id: 'k_old', name: 'expired key', surfaces: null, expires_at: 1_000 }),
      key({ id: 'k_future', name: 'future expiry', surfaces: null, expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    ]);

    expect(rowFor('expired key').textContent).not.toContain('Enable');
    expect(rowFor('expired key').textContent).toContain('Expired');
    expect(rowFor('future expiry').textContent).toContain('Enable');
  });

  it('still offers "Enable" for unrestricted keys and keys that include s3, and "Active" once minted', async () => {
    await render([
      key({ id: 'k_all', name: 'all protocols', surfaces: null }),
      key({ id: 'k_s3', name: 'api and s3', surfaces: 'api,s3' }),
      key({ id: 'k_live', name: 'minted', surfaces: 's3', s3_access_key_id: 'DOSYAAAAAAAAAAAAAAAAA' }),
    ]);

    expect(rowFor('all protocols').textContent).toContain('Enable');
    expect(rowFor('api and s3').textContent).toContain('Enable');
    expect(rowFor('minted').textContent).toContain('Active');
    expect(rowFor('minted').textContent).not.toContain('Enable');
  });

  it('shows the API gateway endpoint and region for an existing S3 key', async () => {
    await render([key({ name: 'minted', surfaces: 's3', s3_access_key_id: 'DOSYAAAAAAAAAAAAAAAAA' })]);

    await act(async () => { (rowFor('minted').querySelector('button') as HTMLButtonElement).click(); });

    expect(document.body.textContent).toContain('https://api.dosya.dev/s3');
    expect(document.body.textContent).toContain('us-east-1');
  });
});
