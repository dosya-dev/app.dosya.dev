import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { SecuritySection, WorkspaceInfoSection } = await import('./settings');
const { ShareModal } = await import('@/components/share-modal');
const { clearShareDefaultsCache } = await import('@/lib/share-defaults');
type WsData = Parameters<typeof SecuritySection>[0]['data'];
type WsSettings = NonNullable<WsData['settings']>;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
  clearShareDefaultsCache();
});

const settings: WsSettings = {
  max_file_size_gb: null, max_storage_per_member_gb: null, max_total_storage_gb: null, max_concurrent_uploads: null,
  allowed_extensions: null, blocked_extensions: null, ip_allowlist: null, ip_blocklist: null,
  country_allowlist: null, country_blocklist: null, allowed_email_domains: null, available_regions: null,
  session_timeout_minutes: null, download_rate_limit: null, disable_share_links: 0, force_share_password: 0,
  share_max_expiry_days: null, default_share_expiry_days: 30, require_2fa: 0, disable_password_login: 0,
  record_upload_origin: 1,
};

const wsData: WsData = {
  workspace: {
    id: 'ws1', name: 'W', icon_initials: 'W', icon_color: '#000', icon_image_url: null,
    default_region: 'auto', plan: 'pro',
  },
  settings, is_owner: true, plan: 'pro', roles: [], permissions: {},
};

async function render() {
  apiMock.mockResolvedValue({ ok: true, user_id: 'u1', role_id: 'r', role_name: 'Owner', is_builtin: true, root_folder_id: null, root_folder_name: null, permissions: { manage_settings: true } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={qc}>
        <SecuritySection data={wsData} wsId="ws1" onSaved={() => {}} />
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
}

// F5 (field report): "Require 2FA for all members" and "Disable password
// login" were toggles the server stored and never enforced. Showing them
// promised a control that did not exist; they stay out of the UI until the
// enforcement lands (the API fields are untouched).
describe('SecuritySection', () => {
  it('does not render the require-2FA or disable-password-login toggles', async () => {
    await render();
    expect(container!.textContent).not.toContain('Require 2FA');
    expect(container!.textContent).not.toContain('Disable password login');
    // The toggles that do work are still there.
    expect(container!.textContent).toContain('Disable public share links');
  });

  it('pre-selects the workspace\'s stored default share expiry', async () => {
    await render();
    expect(container!.textContent).toContain('Default share link expiry');
    expect(container!.textContent).toContain('30 days');
  });
});

// Fix round 2, MINOR 2: the share modal memoises the workspace default for the
// session. Saving a new default has to drop that memo, or the admin who just
// changed it keeps sharing with the old pre-fill until they reload.
describe('saving the default share expiry', () => {
  const settingsCalls = () => apiMock.mock.calls.filter(([p, init]) => String(p).endsWith('/settings') && !init).length;

  async function renderShareModal() {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const r = createRoot(c);
    await act(async () => {
      r.render(<ShareModal open target={{ kind: 'file', fileIds: ['f1'] }} name="a.pdf" workspaceId="ws1" onClose={() => {}} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => { r.unmount(); });
    c.remove();
  }

  it('drops the share modal\'s memo so the next share sees the new value', async () => {
    apiMock.mockImplementation(async (path: string) => (
      String(path).endsWith('/settings') ? { ok: true, settings: { default_share_expiry_days: 7 } } : { ok: true }
    ));

    await renderShareModal();
    expect(settingsCalls()).toBe(1);
    // Memoised: a second share does not ask again.
    await renderShareModal();
    expect(settingsCalls()).toBe(1);

    await render();
    const saveButtons = [...container!.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Save');
    // The default-expiry row is the second Save in the Selects card
    // (session timeout, share cap, default expiry, download rate).
    await act(async () => { saveButtons[2].click(); });
    expect(apiMock.mock.calls.some(([p, init]) => String(p) === '/api/workspaces/ws1/settings' && (init as RequestInit)?.method === 'PUT')).toBe(true);

    await renderShareModal();
    expect(settingsCalls()).toBe(2);
  });
});

// A workspace's location is chosen once, when it is created. Settings shows
// what was chosen; it no longer offers a default to change, nor a list of
// regions to restrict members to.
describe('WorkspaceInfoSection - location', () => {
  const located: WsData = { ...wsData, workspace: { ...wsData.workspace, default_region: 'ap-southeast-2' } };

  async function renderInfo(ws: WsData = located) {
    // Every permission this section knows about, so nothing is disabled and a
    // Save that should not exist cannot hide behind a greyed-out button.
    apiMock.mockResolvedValue({ ok: true, user_id: 'u1', role_id: 'r', role_name: 'Owner', is_builtin: true, root_folder_id: null, root_folder_name: null, permissions: { manage_settings: true, change_workspace_name: true, change_workspace_icon: true, change_workspace_region: true } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={qc}>
          <WorkspaceInfoSection data={ws} wsId="ws1" onSaved={() => {}} />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
  }

  it('shows the location read-only, with no way to change it', async () => {
    await renderInfo();
    expect(container!.textContent).toContain('Location');
    expect(container!.textContent).toContain('Sydney');
    expect(container!.textContent).toContain('(ap-southeast-2)');
    // The controls that used to write it are gone.
    expect(container!.textContent).not.toContain('Default upload region');
    expect(container!.textContent).not.toContain('Available regions');
    expect(container!.querySelectorAll('select')).toHaveLength(0);
  });

  // regionLabel falls back to the code it was given, so a workspace on a
  // legacy value used to read "weur (weur)".
  it('does not print an unlabelled code twice', async () => {
    await renderInfo({ ...wsData, workspace: { ...wsData.workspace, default_region: 'weur' } });
    expect(container!.textContent).toContain('weur');
    expect(container!.textContent).not.toContain('weur (weur)');
  });

  // Asserting on a mount with no writes would pass against the old code too.
  // Press every Save the section has, then read what actually went out.
  it('never sends default_region or available_regions, whatever is saved', async () => {
    await renderInfo();
    const saves = [...container!.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Save');
    expect(saves.length).toBeGreaterThan(0);
    for (const b of saves) await act(async () => { b.click(); await Promise.resolve(); });

    const bodies = apiMock.mock.calls
      .map(([, opts]) => String((opts as { body?: unknown } | undefined)?.body ?? ''))
      .filter(Boolean);
    // The section did write something - so the absences below mean something.
    expect(bodies.some((b) => b.includes('"name"'))).toBe(true);
    expect(bodies.some((b) => b.includes('icon_initials'))).toBe(true);
    expect(bodies.some((b) => b.includes('default_region'))).toBe(false);
    expect(bodies.some((b) => b.includes('available_regions'))).toBe(false);
  });
});
