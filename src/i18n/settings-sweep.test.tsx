/**
 * Settings, branding, teams, the role editor and API analytics in Turkish: every
 * heading, row, table header, dialog, tooltip and toast has no English left.
 * Server text (role names, activity rows, API errors) and user content (names,
 * emails, folder names) stays as sent.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, API_BASE: '', api: (...args: unknown[]) => apiMock(...args) };
});

const SettingsPage = (await import('@/pages/settings')).default;
const { BrandingCard } = await import('@/pages/settings');
const BrandingPage = (await import('@/pages/settings/branding')).default;
const TeamsPage = (await import('@/pages/teams')).default;
const RoleCreatePage = (await import('@/pages/role-create')).default;
const ApiAnalyticsPage = (await import('@/pages/api-analytics')).default;
const { useWorkspace } = await import('@/stores/workspace');
const { toast } = await import('@/lib/toast');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;

// Text that comes from helpers outside this unit (lib/helpers timeAgo / expiryLabel / actionLabel,
// lib/invite-failures, lib/date-format); they are listed in the report as needing a change outside the list.
const FROM_OTHER_UNITS: RegExp[] = [];
const mine = (texts: string[]) => texts.filter((t) => !FROM_OTHER_UNITS.some((re) => re.test(t)));

let shown: Rendered | null = null;
vi.setConfig({ testTimeout: 20_000 });
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  useWorkspace.setState({ activeId: 'ws1' });
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function show(ui: React.ReactElement, url = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  shown = await renderInLocale(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter></QueryClientProvider>, 'tr',
  );
  await flush(); await flush(); await flush();
  return shown;
}

function clickText(text: string, which: 'first' | 'last' = 'last') {
  // The last match by default: a dialog is portalled after the page it opened over.
  const matches = [...document.querySelectorAll<HTMLElement>('button, a, [role="tab"]')].filter((n) => n.textContent?.trim() === text);
  const el = which === 'first' ? matches[0] : matches.pop();
  expect(el, `no button/link "${text}"`).toBeDefined();
  return act(async () => { el!.click(); });
}
function clickLabel(label: string) {
  const el = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  expect(el, `no element labelled "${label}"`).not.toBeNull();
  return act(async () => { el!.click(); });
}
async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const byPlaceholder = (p: string) => document.querySelector<HTMLInputElement>(`input[placeholder="${p}"], textarea[placeholder="${p}"]`)!;
const text = () => document.body.textContent ?? '';

const NOW = Math.floor(Date.now() / 1000);

function mockApi(table: Record<string, unknown>) {
  apiMock.mockImplementation(async (path: string) => {
    const key = path.split('?')[0];
    if (key in table) {
      const v = table[key];
      if (v instanceof Error) throw v;
      return v;
    }
    return { ok: true };
  });
}

// ── Settings ────────────────────────────────────────────────────────

const WS_SETTINGS = {
  max_file_size_gb: 5, max_storage_per_member_gb: 50, max_total_storage_gb: 100, max_concurrent_uploads: 5,
  allowed_extensions: null, blocked_extensions: null, ip_allowlist: '["1.2.3.4"]', ip_blocklist: null,
  country_allowlist: null, country_blocklist: null, allowed_email_domains: null, available_regions: null,
  session_timeout_minutes: 30, download_rate_limit: null, disable_share_links: 0, force_share_password: 0,
  share_max_expiry_days: 7, default_share_expiry_days: null, require_2fa: 0, disable_password_login: 0, record_upload_origin: 1,
};
const ROLES = [
  { id: 'role_owner', name: 'Owner', is_default: 0, is_builtin: true, is_custom: false, permissions: { upload_files: true, manage_roles: true, manage_settings: true } },
  { id: 'role_member', name: 'Member', is_default: 1, is_builtin: true, is_custom: false, permissions: { upload_files: true } },
  { id: 'role_x', name: 'Zzz reviewer', is_default: 0, is_builtin: false, is_custom: true, permissions: { download_files: true } },
];
const MEMBERS = [
  { membership_id: 'm1', user_id: 'u1', name: 'Zeynep Kaya', email: 'zeynep@example.test', role_id: 'role_owner', is_you: true },
  { membership_id: 'm2', user_id: 'u2', name: 'Ali Demir', email: 'ali@example.test', role_id: 'role_member' },
];
function settingsTable(over: { ws?: Record<string, unknown>; perms?: Record<string, boolean>; branding?: unknown } = {}) {
  return {
    '/api/workspaces/ws1': {
      ok: true,
      workspace: { id: 'ws1', name: 'Acme', icon_initials: 'AC', icon_color: '#123456', icon_image_url: null, default_region: 'weur', plan: 'pro', storage_used_bytes: 300 * 1073741824 },
      settings: WS_SETTINGS, is_owner: true, plan: 'pro', plan_limits: { storage_gb: 200 },
      allocation: { plan_gb: 200, allocated_gb: 250, remaining_gb: 0 },
      ...over.ws,
    },
    '/api/roles': { ok: true, roles: ROLES },
    '/api/team': { ok: true, members: MEMBERS },
    '/api/me/permissions': {
      ok: true, user_id: 'u1', role_id: 'role_owner', role_name: 'Owner', is_builtin: true, root_folder_id: null, root_folder_name: null,
      permissions: over.perms ?? { manage_settings: true, change_workspace_name: true, change_workspace_icon: true, change_max_file_size: true, change_storage_per_member: true, change_total_storage_cap: true, change_max_concurrent_uploads: true, change_allowed_file_types: true, change_blocked_file_types: true },
    },
    '/api/workspaces/ws1/branding': over.branding ?? { ok: true, enabled: true, revoked: false, can_edit: true, is_owner: true, branding: { brand_name: null } },
  };
}
// Role names come from the server as sent.
const serverRoles = (texts: string[]) => mine(texts).filter((t) => !/^(Owner|Member)$/.test(t));

describe('settings page in Turkish', () => {
  it('owner view: group headings, sections, warnings and the roles matrix', async () => {
    mockApi(settingsTable());
    const r = await show(<SettingsPage />);
    expect(r.container.querySelector('nav')?.textContent).toContain(tr['settings.label.general']);
    expect(r.container.querySelector('nav')?.textContent).toContain(tr['common.label.members']);
    expect(r.container.querySelector('nav')?.textContent).toContain(tr['settings.label.danger']);
    expect(r.container.textContent).toContain(tr['settings.heading.workspaceSettings']);
    expect(r.container.textContent).toContain('Zzz reviewer');
    expect(serverRoles(r.leftover())).toEqual([]);
  });

  it('a viewer sees translated permission tooltips', async () => {
    mockApi(settingsTable({ perms: {}, ws: { is_owner: false } }));
    const r = await show(<SettingsPage />);
    const titles = [...document.querySelectorAll('[title]')].map((e) => e.getAttribute('title'));
    expect(titles.length).toBeGreaterThan(5);
    expect(serverRoles(r.leftover())).toEqual([]);
  });

  it('the branding card in its three disabled states', async () => {
    for (const branding of [
      { ok: true, enabled: true, revoked: true, can_edit: true },
      { ok: true, enabled: false, revoked: false, can_edit: true },
      { ok: true, enabled: true, revoked: false, can_edit: false },
    ]) {
      mockApi({ '/api/workspaces/ws1/branding': branding });
      const r = await show(<BrandingCard wsId="ws1" />);
      expect(r.leftover()).toEqual([]);
      expect(r.container.textContent).toContain(tr['common.label.branding']);
      shown!.unmount(); shown = null;
    }
  });

  it('access-list, transfer and leave dialogs', async () => {
    mockApi(settingsTable());
    const r = await show(<SettingsPage />);
    await clickText(tr['common.action.manage']);
    expect(text()).toContain(tr['settings.label.noEntries']);
    expect(serverRoles(r.leftover())).toEqual([]);
    await clickText(tr['common.cancel']);
    await clickText(tr['settings.action.transfer']);
    expect(text()).toContain(tr['settings.description.selectAMemberToBecomeTheNewOwnerYouWillBecome']);
    expect(serverRoles(r.leftover())).toEqual([]);
    await clickText(tr['common.cancel']);
    await clickText(tr['common.action.leave']);
    expect(text()).toContain(tr['settings.heading.leaveWorkspace.leaveWorkspace']);
    expect(serverRoles(r.leftover())).toEqual([]);
  });

  it('saving toasts in Turkish', async () => {
    const ok = vi.spyOn(toast, 'success').mockImplementation(() => undefined as never);
    mockApi(settingsTable());
    await show(<SettingsPage />);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === tr['common.save']);
    await act(async () => { buttons[0].click(); });
    await flush();
    expect(ok).toHaveBeenCalledWith(tr['common.feedback.saved'], tr['settings.feedback.yourWorkspaceSettingsHaveBeenUpdated']);
  });

  it('a failed save toasts in Turkish', async () => {
    const bad = vi.spyOn(toast, 'error').mockImplementation(() => undefined as never);
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return { ok: false };
      return (settingsTable() as Record<string, unknown>)[path.split('?')[0]] ?? { ok: true };
    });
    await show(<SettingsPage />);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === tr['common.save']);
    await act(async () => { buttons[0].click(); });
    await flush();
    expect(bad).toHaveBeenCalledWith(tr['common.error.couldnTSave'], tr['settings.error.yourWorkspaceSettingsWereNotUpdated']);
  });

  it('failing to load shows the Turkish message', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/workspaces/ws1')) return { ok: false };
      return { ok: true, roles: [], members: [] };
    });
    const r = await show(<SettingsPage />);
    expect(r.container.textContent).toContain(tr['settings.error.failedToLoadSettings']);
    expect(r.leftover()).toEqual([]);
  });
});

// ── Branding ────────────────────────────────────────────────────────

const PAID = {
  ok: true, enabled: true, can_edit: true, revoked: false, is_owner: true,
  branding: {
    brand_name: 'Kaya Studio', logo_url: null as string | null, brand_color: '#B4472E',
    share_handle: null as string | null, handle_set_at: null as number | null,
    apply_share: true, apply_email: true, hide_save_cta: false,
  },
};
// The preview replica draws the sender's note and the legal line from literals the catalog does not have.
const PREVIEW_UNCATALOGUED = [/^Note from /, /^Hosted by/, /^Privacy$/];
const brandingMine = (texts: string[]) => mine(texts).filter((t) => !PREVIEW_UNCATALOGUED.some((re) => re.test(t)));

describe('branding page in Turkish', () => {
  it('the editable page', async () => {
    mockApi({ '/api/workspaces/ws1/branding': PAID });
    const r = await show(<BrandingPage />);
    expect(r.container.textContent).toContain(tr['settings.heading.branding']);
    expect(brandingMine(r.leftover())).toEqual([]);
  });

  it('notices for revoked, unpaid and read-only', async () => {
    for (const patch of [{ revoked: true }, { enabled: false }, { can_edit: false }]) {
      mockApi({ '/api/workspaces/ws1/branding': { ...PAID, ...patch } });
      const r = await show(<BrandingPage />);
      expect(r.container.querySelector('[role="status"]')).not.toBeNull();
      expect(brandingMine(r.leftover())).toEqual([]);
      shown!.unmount(); shown = null;
    }
  });

  it('a claimed handle', async () => {
    mockApi({ '/api/workspaces/ws1/branding': { ...PAID, branding: { ...PAID.branding, share_handle: 'kaya', handle_set_at: NOW } } });
    const r = await show(<BrandingPage />);
    expect(r.container.textContent).toContain(tr['settings.error.yourHandleIsPermanentAndCannotBeChangedHereContactSupport']);
    expect(brandingMine(r.leftover())).toEqual([]);
  });

  it('empty name notice, validation messages and the handle states', async () => {
    mockApi({ '/api/workspaces/ws1/branding': { ...PAID, branding: { ...PAID.branding, brand_name: null, brand_color: null } },
      '/api/workspaces/ws1/branding/handle/available': { ok: true, available: true } });
    const r = await show(<BrandingPage />);
    expect(r.container.textContent).toContain(tr['settings.error.aBrandNameIsRequiredForAnyBrandingToTakeEffect']);
    const handle = document.getElementById('share-handle') as HTMLInputElement;
    for (const v of ['Kaya', 'ka--ya', 'k', '-bad']) {
      await typeInto(handle, v);
      expect(brandingMine(r.leftover())).toEqual([]);
    }
    expect(text()).toContain(tr['settings.description.useLowercaseLettersNumbersAndHyphensStartingAndEndingWithA']);
    await typeInto(handle, 'kayas');
    expect(text()).toContain(tr['profile.status.checking']);
    await act(async () => { await new Promise((res) => setTimeout(res, 450)); });
    expect(text()).toContain(tr['settings.description.thatHandleIsAvailable']);
    expect(brandingMine(r.leftover())).toEqual([]);
    await clickText(tr['settings.action.claimHandle']);
    expect(text()).toContain(tr['settings.heading.claimThisHandle']);
    expect(brandingMine(r.leftover())).toEqual([]);
  });

  it('a long name and a bad colour show Turkish problems', async () => {
    mockApi({ '/api/workspaces/ws1/branding': PAID });
    const r = await show(<BrandingPage />);
    await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="' + tr['settings.accessibility.brandName'] + '"]')!, 'x'.repeat(60));
    await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="' + tr['settings.accessibility.brandColour'] + '"]')!, 'nope');
    await clickText(tr['settings.action.saveBranding']);
    expect(brandingMine(r.leftover())).toEqual([]);
    expect(text()).toContain(tr['settings.description.useASixDigitHexColourThatStartsWith']);
  });

  it('the reset dialog and its toast', async () => {
    const ok = vi.spyOn(toast, 'success').mockImplementation(() => undefined as never);
    mockApi({ '/api/workspaces/ws1/branding': PAID });
    const r = await show(<BrandingPage />);
    await clickText(tr['settings.action.resetToDosya']);
    expect(text()).toContain(tr['settings.heading.resetToDosya']);
    expect(brandingMine(r.leftover())).toEqual([]);
    await clickText(tr['settings.action.reset']);
    await flush();
    expect(ok).toHaveBeenCalledWith(tr['settings.feedback.reset'], tr['settings.feedback.yourNameColourAndLogoWereCleared']);
  });

  it('save toasts', async () => {
    const ok = vi.spyOn(toast, 'success').mockImplementation(() => undefined as never);
    mockApi({ '/api/workspaces/ws1/branding': PAID });
    await show(<BrandingPage />);
    await clickText(tr['settings.action.saveBranding']);
    await flush();
    expect(ok).toHaveBeenCalledWith(tr['common.feedback.saved'], tr['settings.feedback.yourBrandingHasBeenUpdated']);
  });

  it('the recipient view: share page, password gate, phone and the email tab', async () => {
    mockApi({
      '/api/workspaces/ws1/branding': PAID,
      '/api/workspaces/ws1/branding/preview-email': { ok: true, html: '<p>x</p>', from: 'Kaya <noreply@dosya.dev>', subject: 'Hello' },
    });
    const r = await show(<BrandingPage />);
    await clickText(tr['common.view']);
    expect(text()).toContain(tr['settings.heading.whatRecipientsSee']);
    expect(brandingMine(r.leftover())).toEqual([]);
    await clickLabel(tr['common.label.passwordProtected']);
    expect(brandingMine(r.leftover())).toEqual([]);
    expect(text()).toContain(tr['settings.heading.thisFileIsPasswordProtected']);
    await clickText(tr['settings.action.phone']);
    expect(brandingMine(r.leftover())).toEqual([]);
    await clickText(tr['settings.action.email']);
    expect(text()).toContain(tr['settings.description.renderingTheEmail']);
    expect(brandingMine(r.leftover())).toEqual([]);
    await act(async () => { await new Promise((res) => setTimeout(res, 450)); });
    await flush();
    expect(text()).toContain('Hello');
    expect(brandingMine(r.leftover())).toEqual([]);
  });
});

// ── Teams ───────────────────────────────────────────────────────────

const TEAM_ROLES = [
  { id: 'role_owner', name: 'Owner', is_builtin: true, is_custom: false, permissions: {} },
  { id: 'role_admin', name: 'Admin', is_builtin: true, is_custom: false, permissions: {} },
  { id: 'role_member', name: 'Member', is_builtin: true, is_custom: false, permissions: {} },
  { id: 'role_viewer', name: 'Viewer', is_builtin: true, is_custom: false, permissions: {} },
  { id: 'role_x', name: 'Zzz reviewer', is_builtin: false, is_custom: true, permissions: {} },
];
const member = (over: Record<string, unknown>) => ({
  membership_id: 'm', user_id: 'u', role_id: 'role_member', joined_at: NOW - 86400 * 3, name: 'N', email: 'n@example.test',
  is_you: false, avatar_url: null, last_active_at: NOW - 3600, root_folder_id: null, root_folder_name: null, ...over,
});
const TEAM_MEMBERS = [
  member({ membership_id: 'm1', user_id: 'u1', role_id: 'role_owner', name: 'Zeynep Kaya', email: 'zeynep@example.test', is_you: true }),
  member({ membership_id: 'm2', user_id: 'u2', role_id: 'role_admin', name: 'Ali Demir', email: 'ali@example.test', root_folder_id: 'f1', root_folder_name: 'Zzz folder' }),
  member({ membership_id: 'm3', user_id: 'u3', role_id: 'role_viewer', name: 'Can Yilmaz', email: 'can@example.test', last_active_at: null }),
  member({ membership_id: 'm4', user_id: 'u4', role_id: 'role_x', name: 'Deniz Acar', email: 'deniz@example.test', root_folder_id: 'f2' }),
];
function teamTable(over: Record<string, unknown> = {}) {
  return {
    '/api/team': {
      ok: true, members: TEAM_MEMBERS, workspace: { name: 'Acme' },
      invites: [{ id: 'i1', email: 'new@example.test', role_id: 'role_member', created_at: NOW, expires_at: NOW + 86400 * 3, invited_by_name: null, invite_url: 'https://x/i1' }],
      activity: [{ user_id: 'u1', user_name: 'Zeynep Kaya', action: 'file.upload', meta: { name: 'a.txt' }, created_at: NOW - 60, avatar_url: null }],
      stats: { members: 4, pending: 1, shares_this_week: 2 },
    },
    '/api/team/invite-link': { ok: true, links: [
      { id: 'l1', url: 'https://x/l1', role_id: 'role_member', role_name: 'Member', max_uses: 5, use_count: 1, expires_at: NOW + 86400 },
      { id: 'l2', url: 'https://x/l2', role_id: 'role_viewer', role_name: 'Viewer', max_uses: null, use_count: 0, expires_at: null },
    ] },
    '/api/roles': { ok: true, roles: TEAM_ROLES },
    '/api/me/permissions': { ok: true, user_id: 'u1', role_id: 'role_owner', role_name: 'Owner', is_builtin: true, root_folder_id: null, root_folder_name: null, permissions: { manage_roles: true, invite_members: true, view_activity: true } },
    '/api/folders': { ok: true, folders: [] },
    ...over,
  };
}
// The invite-link expiry label comes from lib/helpers expiryLabel (not this unit).
const TEAM_OTHER = [/^Expires in /];
const teamMine = (texts: string[]) => mine(texts).filter((t) => !TEAM_OTHER.some((re) => re.test(t)));

describe('team page in Turkish', () => {
  it('members, invites, links, activity and the role guide', async () => {
    mockApi(teamTable());
    const r = await show(<TeamsPage />);
    expect(r.container.textContent).toContain(tr['common.heading.team']);
    expect(r.container.textContent).toContain('Zeynep Kaya');
    expect(r.container.textContent).toContain('Zzz reviewer');
    expect(teamMine(r.leftover())).toEqual([]);
  });

  it('a viewer without permissions sees the narrower headings', async () => {
    mockApi(teamTable({ '/api/me/permissions': { ok: true, user_id: 'u3', role_id: 'role_viewer', role_name: 'Viewer', is_builtin: true, root_folder_id: null, root_folder_name: null, permissions: {} } }));
    const r = await show(<TeamsPage />);
    expect(r.container.textContent).toContain(tr['teams.label.yourRecentActivity']);
    expect(teamMine(r.leftover())).toEqual([]);
  });

  it('the only-member state with the invite button', async () => {
    mockApi(teamTable({ '/api/team': { ok: true, members: [TEAM_MEMBERS[0]], invites: [], activity: [], stats: { members: 1, pending: 0, shares_this_week: 0 } }, '/api/team/invite-link': { ok: true, links: [] } }));
    const r = await show(<TeamsPage />);
    expect(r.container.textContent).toContain(tr['teams.tooltip.youAreTheOnlyMember']);
    expect(r.container.textContent).toContain(tr['teams.action.inviteSomeone']);
    expect(r.container.textContent).toContain(tr['teams.label.noPendingInvites']);
    expect(r.container.textContent).toContain(tr['teams.label.noActiveInviteLinks']);
    expect(r.container.textContent).toContain(tr['common.empty.noActivityYet']);
    expect(teamMine(r.leftover())).toEqual([]);
  });

  it('a failed load', async () => {
    const { ApiError } = await import('@/api/client');
    mockApi(teamTable({ '/api/team': new ApiError(500, 'boom') }));
    const r = await show(<TeamsPage />);
    expect(r.container.textContent).toContain(tr['teams.error.couldNotLoadTeamMembers']);
    expect(teamMine(r.leftover())).toEqual([]);
  });

  it('remove, revoke, folder-access and profile dialogs', async () => {
    mockApi(teamTable());
    const r = await show(<TeamsPage />);
    // remove: the red X next to Ali
    const xs = [...document.querySelectorAll<HTMLElement>('button.text-destructive')].filter((b) => b.textContent === '');
    await act(async () => { xs[0].click(); });
    expect(text()).toContain(tr['team.heading.removeMember']);
    expect(teamMine(r.leftover())).toEqual([]);
    await clickText(tr['common.cancel']);
    // folder access (anchor set for Ali, so the "what this changes" note shows)
    const folderBtn = document.querySelector<HTMLElement>(`button[title="${tr['teams.action.setFolderAccess']}"]`)!;
    await act(async () => { folderBtn.click(); });
    expect(text()).toContain(tr['teams.heading.folderAccess']);
    expect(text()).toContain(tr['teams.label.whatThisChangesForThem']);
    expect(teamMine(r.leftover())).toEqual([]);
    await clickText(tr['common.action.clear']);
    expect(text()).toContain(tr['common.action.chooseFolder']);
    expect(teamMine(r.leftover())).toEqual([]);
    await clickText(tr['common.cancel']);
    // revoke an invite
    await clickText(tr['common.action.revoke'], 'first');
    expect(text()).toContain(tr['teams.heading.revokeInvite']);
    expect(teamMine(r.leftover())).toEqual([]);
    await clickText(tr['common.cancel']);
    // member profile
    const nameBtn = [...document.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Can Yilmaz')!;
    await act(async () => { nameBtn.click(); });
    expect(text()).toContain(tr['common.heading.profile']);
    expect(teamMine(r.leftover())).toEqual([]);
  });

  it('the invite dialog: email tab and link tab', async () => {
    mockApi(teamTable({ '/api/team/invite-link': { ok: true, links: [], link: { url: 'https://x/new' } } }));
    const r = await show(<TeamsPage />);
    await clickText(tr['teams.action.inviteToWorkspace']);
    expect(byPlaceholder(tr['teams.placeholder.colleagueCompanyComPressEnterToAdd'])).not.toBeNull();
    expect(teamMine(r.leftover())).toEqual([]);
    // submit nothing: the error is Turkish
    await clickText(tr['team.action.sendInvite']);
    expect(text()).toContain(tr['common.error.addAtLeastOneEmailAddress']);
    await clickText(tr['teams.action.inviteLink']);
    expect(text()).toContain(tr['teams.label.roleForNewMembers']);
    expect(teamMine(r.leftover())).toEqual([]);
    await clickText(tr['teams.action.createInviteLink']);
    await flush();
    expect(text()).toContain(tr['teams.label.shareThisLink']);
    expect(teamMine(r.leftover())).toEqual([]);
  });

  it('toasts: resent and revoked', async () => {
    const ok = vi.spyOn(toast, 'success').mockImplementation(() => undefined as never);
    mockApi(teamTable());
    await show(<TeamsPage />);
    await clickText(tr['common.action.resend']);
    await flush();
    expect(ok).toHaveBeenCalledWith(tr['teams.feedback.inviteResent'], tr['teams.feedback.theInvitationEmailWasSentToInvemailAgain'].replace('{invEmail}', 'new@example.test'));
    await clickText(tr['common.action.revoke'], 'first');
    await clickText(tr['common.action.revoke']);
    await flush();
    expect(ok).toHaveBeenCalledWith(tr['teams.feedback.inviteRevoked'], tr['teams.feedback.theInvitationIsNoLongerValid']);
  });
});

// ── Role editor ─────────────────────────────────────────────────────

const ROLE_EDIT = {
  id: 'role_x', name: 'Zzz reviewer', is_builtin: false, is_custom: true,
  permissions: { upload_files: true, download_files: true, manage_roles: false },
  allowed_ips: '10.0.0.1', active_hours: JSON.stringify({ tz: 'Etc/UTC', days: [1, 2], from: '09:00', to: '17:00' }),
  requests_per_minute: 60, egress_bytes_per_day: 1073741824, max_file_size_bytes: 1048576, max_concurrent_transfers: 3,
};
const roleTable = (perms: Record<string, boolean> = { manage_roles: true, upload_files: true, download_files: true }) => ({
  '/api/roles': { ok: true, roles: [
    { ...ROLE_EDIT, id: 'role_owner', name: 'Owner', is_builtin: true, is_custom: false, allowed_ips: null, active_hours: null, requests_per_minute: null, egress_bytes_per_day: null, max_file_size_bytes: null, max_concurrent_transfers: null },
    ROLE_EDIT,
  ] },
  '/api/me/permissions': { ok: true, user_id: 'u1', role_id: 'role_owner', role_name: 'Owner', is_builtin: true, root_folder_id: null, root_folder_name: null, permissions: perms },
});
// Role names come from the server as sent.
const roleMine = (texts: string[]) => mine(texts).filter((t) => !/^(Owner|Admin|Member|Viewer)$/.test(t));

describe('role editor in Turkish', () => {
  it('create mode with the matrix, conditions, limits and the existing roles', async () => {
    mockApi(roleTable());
    const r = await show(<RoleCreatePage />, '/role-create');
    expect(r.container.textContent).toContain(tr['role-create.label.createCustomRole']);
    expect(r.container.textContent).toContain(tr['role-create.label.permissions']);
    expect(r.container.textContent).toContain(tr['role-create.label.usageLimits']);
    expect(roleMine(r.leftover())).toEqual([]);
  });

  it('edit mode with active hours and locked permissions', async () => {
    mockApi(roleTable({ manage_roles: false, upload_files: true }));
    const r = await show(<RoleCreatePage />, '/role-create?edit=role_x');
    expect(r.container.textContent).toContain(tr['role-create.label.editCustomRole']);
    expect(r.container.textContent).toContain(tr['common.label.mon']);
    expect(r.container.textContent).toContain(tr['common.label.to']);
    expect(r.container.textContent).toContain(tr['role-create.error.youDonTHoldThisPermissionSoYouCanTGrantIt']);
    expect(roleMine(r.leftover())).toEqual([]);
  });

  it('view mode', async () => {
    mockApi(roleTable());
    const r = await show(<RoleCreatePage />, '/role-create?view=role_x');
    expect(r.container.textContent).toContain(tr['role-create.label.viewRolePermissions']);
    expect(r.container.textContent).toContain(tr['role-create.label.enabled']);
    expect(r.container.textContent).toContain(tr['role-create.label.disabled']);
    expect(roleMine(r.leftover())).toEqual([]);
  });

  it('a missing name is refused in Turkish', async () => {
    mockApi(roleTable());
    const r = await show(<RoleCreatePage />, '/role-create');
    await clickText(tr['role-create.action.createRole']);
    expect(r.container.textContent).toContain(tr['role-create.error.roleNameIsRequired']);
    expect(roleMine(r.leftover())).toEqual([]);
  });

  it('the delete dialog and its toast', async () => {
    const ok = vi.spyOn(toast, 'success').mockImplementation(() => undefined as never);
    mockApi(roleTable());
    const r = await show(<RoleCreatePage />, '/role-create');
    const trash = [...document.querySelectorAll<HTMLElement>('button.text-destructive')].find((b) => b.textContent === '')!;
    await act(async () => { trash.click(); });
    expect(text()).toContain(tr['role-create.heading.deleteRole']);
    expect(roleMine(r.leftover())).toEqual([]);
    await clickText(tr['role-create.action.deleteRole']);
    await flush();
    expect(ok).toHaveBeenCalledWith(tr['role-create.feedback.roleDeleted'], tr['role-create.feedback.theRoleHasBeenRemoved']);
  });

  it('the existing-roles header reads the middle dot in Turkish and never the entity', async () => {
    mockApi(roleTable());
    const r = await show(<RoleCreatePage />, '/role-create');
    const header = [...r.container.querySelectorAll('p')].find((p) => /\u00b7\s*\d+$/.test(p.textContent ?? '') && /^\s*\S/.test(p.textContent ?? '') && p.className.includes('uppercase') && (p.textContent ?? '').includes(tr['role-create.label.existingRolesMiddotExistingrolescount'].split('\u00b7')[0].trim()));
    expect(header, 'no existing-roles header').toBeDefined();
    expect(header!.textContent).toBe(`${tr['role-create.label.existingRolesMiddotExistingrolescount'].split('\u00b7')[0].trim()} \u00b7 2`);
    expect(header!.textContent).toContain('\u00b7');
    expect(r.container.textContent).not.toContain('&middot;');
    expect(r.container.textContent).not.toContain('&amp;');
  });

  it('the existing-roles header in English is exactly "Existing roles", a middle dot and the count', async () => {
    mockApi(roleTable());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const en = await renderInLocale(
      <QueryClientProvider client={qc}><MemoryRouter initialEntries={['/role-create']}><RoleCreatePage /></MemoryRouter></QueryClientProvider>, 'en',
    );
    shown = en;
    const container = en.container;
    await flush(); await flush(); await flush();
    const header = [...container.querySelectorAll('p')].find((p) => (p.textContent ?? '').startsWith('Existing roles'));
    expect(header, 'no existing-roles header').toBeDefined();
    // The old JSX text "Existing roles &middot; {count}" rendered a single spaces on each side.
    expect(header!.textContent).toBe('Existing roles \u00b7 2');
  });
});

// ── API analytics ───────────────────────────────────────────────────

const LOGS = [
  { t: NOW - 60, action: 'files.list', source: 'rest', status: 200, ip: '203.0.113.5', country: 'AU', user_agent: 'curl/8', api_key_id: 'k1', api_key_name: 'Zzz key' },
  { t: NOW - 120, action: 's3.GetObject', source: 's3', status: 500, ip: '203.0.113.6', country: 'DE', user_agent: 'aws-cli', api_key_id: 'k1', api_key_name: 'Zzz key' },
];
function analyticsTable(over: Record<string, unknown> = {}) {
  return {
    '/api/me/api-keys': { ok: true, keys: [{ id: 'k1', name: 'Zzz key' }] },
    '/api/me/api-analytics/series': { ok: true, range: '24h', bucket_seconds: 3600, series: [{ t: NOW - 3600, total: 3, errors: 1 }], totals: { total: 3, errors: 1 } },
    '/api/me/api-analytics/logs': { ok: true, logs: LOGS, has_more: true },
    ...over,
  };
}

describe('API analytics in Turkish', () => {
  it('stat tiles, legend, the log table and load more', async () => {
    mockApi(analyticsTable());
    const r = await show(<ApiAnalyticsPage />);
    expect(r.container.textContent).toContain(tr['common.heading.apiAnalytics']);
    expect(r.container.textContent).toContain(tr['common.label.requests']);
    expect(r.container.textContent).toContain(tr['api-analytics.label.errors']);
    expect(r.container.textContent).toContain(tr['common.action.loadMore']);
    expect(r.container.textContent).toContain(tr['api-analytics.label.ipAddress']);
    expect(r.leftover()).toEqual([]);
  });

  it('range tabs and the key filter', async () => {
    mockApi(analyticsTable());
    const r = await show(<ApiAnalyticsPage />);
    expect(r.container.textContent).toContain(tr['common.label.sevenDays']);
    expect(r.container.textContent).toContain(tr['common.label.thirtyDays']);
    expect(r.container.textContent).toContain(tr['api-analytics.label.allKeys']);
    expect(r.leftover()).toEqual([]);
  });

  it('the empty states', async () => {
    mockApi(analyticsTable({
      '/api/me/api-analytics/series': { ok: true, range: '24h', bucket_seconds: 3600, series: [], totals: { total: 0, errors: 0 } },
      '/api/me/api-analytics/logs': { ok: true, logs: [], has_more: false },
    }));
    const r = await show(<ApiAnalyticsPage />);
    expect(r.container.textContent).toContain(tr['api-analytics.label.noRequestsInThisPeriod']);
    expect(r.container.textContent).toContain(tr['api-analytics.label.noRequestsLoggedInThisPeriod']);
    expect(r.leftover()).toEqual([]);
  });

  it('the error state with its retry button', async () => {
    const { ApiError } = await import('@/api/client');
    mockApi(analyticsTable({ '/api/me/api-analytics/series': new ApiError(500, 'boom') }));
    const r = await show(<ApiAnalyticsPage />);
    expect(r.container.textContent).toContain(tr['common.retry']);
    expect(r.leftover()).toEqual([]);
  });
});
