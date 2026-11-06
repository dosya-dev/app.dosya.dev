/**
 * Activity feed, comments, dashboards, referrals, data-rights and
 * account-deletion text in Turkish: no English left, and the activity mapper
 * (lib/activity-labels.ts) reads exactly like the generated English table.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { leftoverEnglish, renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const workspaceDashboardMock = vi.fn();
vi.mock('@/api/workspace-dashboard', () => ({ getWorkspaceDashboard: (...a: unknown[]) => workspaceDashboardMock(...a) }));

const referralsMock = vi.fn();
vi.mock('@/api/referrals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/referrals')>();
  return { ...actual, getReferralSummary: (...a: unknown[]) => referralsMock(...a) };
});

vi.mock('@/components/comments/mention-composer', () => ({
  MentionComposer: ({ placeholder }: { placeholder: string }) => <textarea placeholder={placeholder} />,
}));
vi.mock('@/components/file-preview-image', () => ({ FilePreviewImage: ({ fallback }: { fallback?: React.ReactNode }) => <>{fallback}</> }));
vi.mock('@/components/onboarding/first-run-home', () => ({ FirstRunHome: () => null }));

const { ApiError } = await import('@/api/client');
const { default: ActivityPage } = await import('@/pages/activity');
const { default: CommentsPage } = await import('@/pages/comments');
const { default: DashboardPage } = await import('@/pages/dashboard');
const { default: WorkspaceDashboardPage } = await import('@/pages/workspace-dashboard');
const { default: ReferralsPage } = await import('@/pages/referrals');
const labels = await import('@/lib/activity-labels');
const generated = await import('@/lib/activity-catalog.generated');
const dataRights = await import('@/lib/data-rights');
const deletion = await import('@/lib/account-deletion');
const { classifyDeleteError } = deletion;
const { loadMessages } = await import('@/lib/i18n');
const { useWorkspace } = await import('@/stores/workspace');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  workspaceDashboardMock.mockReset();
  referralsMock.mockReset();
});

/**
 * Leftover English that is not a defect of this unit. The strict matcher reads
 * "{name} plan" messages as English, so the Turkish "Mevcut plan" and "Sınırsız
 * plan" (asserted present below) and a server-named "Pro plan" are reported;
 * plan names and the storage-breakdown names are server text (rule 6); the
 * friend status words come from api/referrals.ts, outside this unit.
 */
const NOT_THIS_UNIT = new Set(['Mevcut plan', 'Sınırsız plan', 'Free', 'Images', 'Pro plan', 'Counted']);
const unexpected = (r: Rendered) => r.leftover().filter((x) => !NOT_THIS_UNIT.has(x));

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function show(ui: React.ReactElement, route = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  shown = await renderInLocale(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></QueryClientProvider>,
    'tr',
  );
  await flush();
  await flush();
  return shown;
}
const NOW = Math.floor(Date.now() / 1000);

// ------------------------------------------------------------ the mapper
describe('activity labels mapper', () => {
  const codes = [...new Set([
    ...Object.keys(generated.ACTION_LABELS),
    ...Object.values(generated.CATEGORY_ACTIONS).flat().map((o) => o.value),
    'some_future_action',
  ])];

  it('English phrase equals the generated phrase for every action code', () => {
    expect(codes.length).toBeGreaterThan(60);
    for (const code of codes) expect(labels.activityPhrase(code), code).toBe(generated.actionPhrase(code));
  });

  it('English option and category labels equal the generated ones', () => {
    for (const c of generated.ACTIVITY_CATEGORIES) {
      expect(labels.localizedCategories().find((x) => x.value === c.value)).toEqual(c);
    }
    for (const list of Object.values(generated.CATEGORY_ACTIONS)) {
      for (const o of list) expect(labels.localizedOption(o)).toEqual(o);
    }
    expect(labels.localizedActionsFor([])).toEqual(generated.actionsForCategories([]));
    expect(labels.localizedActionsFor(['files', 'nope'])).toEqual(generated.actionsForCategories(['files', 'nope']));
  });

  it('an unknown action code keeps the server text', () => {
    expect(labels.activityPhrase('some_future_action')).toBe('some future action');
  });

  it('English device names equal parseUA', () => {
    const uas = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Edg/120.0',
      'Mozilla/5.0 (X11; Linux x86_64)',
      '',
    ];
    for (const ua of uas) expect(labels.describeDevice(ua)).toEqual(generated.parseUA(ua));
  });
});

// -------------------------------------------------------------- activity page
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
const row = (over: Record<string, unknown>) => ({
  id: String(Math.random()), action: 'file_uploaded', entity_type: 'file', entity_id: 'f1', metadata: null,
  created_at: NOW - 600, user_name: 'Ada Lovelace', user_id: 'u1', user_email: 'ada@example.com', user_avatar: null,
  resource_name: 'report.pdf', ...over,
});
const feed = [
  row({ action: 'file_version_uploaded', user_agent: CHROME_MAC, source_ip: '1.2.3.4', meta: { geo: { country: 'AU', city: 'Sydney' } }, outcome: 'success', source: 'rclone' }),
  row({ action: 'folder_created', entity_type: 'folder', entity_id: 'fo1', resource_name: 'Q3 plans' }),
  row({ action: 'link_revoked' }),
  row({ action: 'member_invited', entity_type: 'user', entity_id: null, resource_name: 'bob@example.com' }),
  row({ action: 'comment_added' }),
  row({ action: 'workspace_settings_changed', entity_type: 'workspace', entity_id: null, resource_name: null }),
  row({ action: 'member_left', entity_type: 'user', entity_id: null, resource_name: null }),
  row({ action: 'file_moved', outcome: 'failure', on_behalf_of: 'u9', obo_name: 'Grace', meta: { file_count: 3, via: 'api', old_name: 'a', new_name: 'b', email: 'x@y.z' } }),
  row({ action: 'totally_new_code', resource_name: null }),
];
const activityApi = (list: unknown[], total = 45) => async (path: string) => {
  if (path.startsWith('/api/activity')) {
    return { ok: true, activities: list, members: [{ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' }],
      pagination: { page: 1, per_page: 30, total, total_pages: 2 } };
  }
  return { ok: true };
};
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); };
const buttonWith = (text: string) => [...document.body.querySelectorAll('button, [role="button"], [role="menuitemcheckbox"]')].find((b) => b.textContent?.trim().includes(text));

describe('Activity page in Turkish', () => {
  it('rows, header, filters and pagination have no leftover English', async () => {
    apiMock.mockImplementation(activityApi(feed));
    const r = await show(<ActivityPage />);
    const text = document.body.textContent ?? '';
    expect(text).toContain(tr['activity.heading.activityLog']);
    // one sentence per category, with an actor and with a subject
    expect(text).toContain(`Ada Lovelace ${tr['common.label.uploadedANewVersionOf']} report.pdf`);
    expect(text).toContain(`Ada Lovelace ${tr['common.label.createdFolder']} Q3 plans`);
    expect(text).toContain(`Ada Lovelace ${tr['common.label.revokedLinkFor']} report.pdf`);
    expect(text).toContain(`Ada Lovelace ${tr['common.label.commentedOn']} report.pdf`);
    // no subject
    expect(text).toContain(`Ada Lovelace ${tr['common.label.changedSettings']}`);
    expect(text).toContain(`Ada Lovelace ${tr['common.label.activityLeftTheWorkspaceFragment']}`);
    // an unknown code is shown as the server sent it
    expect(text).toContain('Ada Lovelace totally new code');
    expect(text).toContain(tr['common.label.pagePageOfPaginationtotalPages'].replace('{page}', '1').replace('{pageCount}', '2'));
    expect(unexpected(r)).toEqual([]);
  });

  it('opened row detail and the filter menus translate', async () => {
    apiMock.mockImplementation(activityApi(feed));
    const r = await show(<ActivityPage />);
    await click([...document.body.querySelectorAll('[role="button"]')][0]);
    expect(document.body.textContent).toContain(tr['common.label.when']);
    expect(document.body.textContent).toContain(tr['common.label.device']);
    expect(document.body.textContent).toContain(`${tr['common.label.chromeM'].replace('{m}', '120')}`);
    expect(unexpected(r)).toEqual([]);
    await click(buttonWith(tr['activity.placeholder.allCategories']));
    expect(document.body.textContent).toContain(tr['common.label.sharing']);
    expect(document.body.textContent).toContain(tr['common.label.members']);
    expect(unexpected(r)).toEqual([]);
  });

  it('empty and error states translate', async () => {
    apiMock.mockImplementation(activityApi([], 0));
    const r = await show(<ActivityPage />);
    expect(document.body.textContent).toContain(tr['activity.label.noActivityFound']);
    expect(unexpected(r)).toEqual([]);
    shown!.unmount();
    apiMock.mockRejectedValue(new Error(''));
    const e = await show(<ActivityPage />);
    expect(document.body.textContent).toContain(tr['activity.error.couldNotLoadTheActivityLog']);
    expect(document.body.textContent).toContain(tr['activity.error.theActivityLogCouldNotBeLoaded']);
    expect(unexpected(e)).toEqual([]);
  });
});

// -------------------------------------------------------------- comments page
describe('Comments page in Turkish', () => {
  const comments = [
    { id: 'c1', file_id: 'f1', folder_id: null, workspace_id: 'ws_1', user_id: 'u2', parent_id: null, body: 'Looks good', is_edited: 1,
      created_at: NOW - 2 * 86_400, updated_at: NOW, user_name: 'Grace', user_email: 'g@x.y', user_avatar: null, anchor_ms: null, anchor_page: null, anchor_version: null, mention_user_ids: null, mentions: [] },
    { id: 'c2', file_id: 'f1', folder_id: null, workspace_id: 'ws_1', user_id: 'u1', parent_id: 'c1', body: 'Thanks', is_edited: 0,
      created_at: NOW - 60, updated_at: NOW, user_name: 'Ada', user_email: 'a@x.y', user_avatar: null, anchor_ms: null, anchor_page: null, anchor_version: null, mention_user_ids: null, mentions: [] },
  ];
  const commentsApi = (list: unknown[]) => async (path: string) => {
    if (path.startsWith('/api/me')) return { ok: true, user: { id: 'u1', name: 'Ada', email: 'a@x.y', avatar_url: null } };
    if (path.startsWith('/api/files/f1')) return { ok: true, file: { id: 'f1', name: 'brief.pdf', size_bytes: 2048, mime_type: 'application/pdf', extension: 'pdf', region: 'syd', created_at: NOW - 3600, updated_at: NOW - 60, uploader_name: 'Ada' } };
    if (path.startsWith('/api/comments')) return { ok: true, comments: list };
    return { ok: true };
  };

  it('conversation, details panel and reply bar have no leftover English', async () => {
    apiMock.mockImplementation(commentsApi(comments));
    const r = await show(<CommentsPage />, '/comments?file_id=f1&name=brief.pdf');
    const text = document.body.textContent ?? '';
    expect(text).toContain(tr['comments.label.fileConversation']);
    expect(text).toContain(tr['common.label.today']);
    expect(text).toContain(tr['comments.label.edited']);
    expect(text).toContain(tr['common.label.fileDetails']);
    expect(text).toContain(tr['common.label.uploadedBy']);
    expect(text).toContain(tr['common.action.viewFile']);
    expect(document.body.querySelector(`textarea[placeholder="${tr['comments.placeholder.writeAMessage']}"]`)).toBeTruthy();
    expect(document.body.querySelector(`[title="${tr['common.tooltip.reply']}"]`)).toBeTruthy();
    expect(unexpected(r)).toEqual([]);
    await click(document.body.querySelector(`[title="${tr['common.tooltip.reply']}"]`));
    expect(document.body.textContent).toContain('Yanıtlanan');
    expect(unexpected(r)).toEqual([]);
  });

  it('own comment actions, empty and loading states translate', async () => {
    apiMock.mockImplementation(commentsApi(comments));
    const r = await show(<CommentsPage />, '/comments?file_id=f1&name=brief.pdf');
    expect(document.body.querySelector(`[title="${tr['common.edit']}"]`)).toBeTruthy();
    expect(document.body.querySelector(`[title="${tr['common.delete']}"]`)).toBeTruthy();
    await click(document.body.querySelector(`[title="${tr['common.edit']}"]`));
    expect(document.body.textContent).toContain(tr['common.save']);
    expect(document.body.textContent).toContain(tr['common.cancel']);
    expect(unexpected(r)).toEqual([]);
    shown!.unmount();
    apiMock.mockImplementation(commentsApi([]));
    const e = await show(<CommentsPage />, '/comments?file_id=f1&name=brief.pdf');
    expect(document.body.textContent).toContain(tr['comments.label.noMessagesYet']);
    expect(document.body.textContent).toContain(tr['comments.description.startTheConversationOnThisFile']);
    expect(unexpected(e)).toEqual([]);
  });
});

describe('Comments info line keeps file data untouched', () => {
  it('decodes only the catalog separators, never the file type', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/me')) return { ok: true, user: { id: 'u1', name: 'Ada', email: 'a@x.y', avatar_url: null } };
      if (path.startsWith('/api/files/f1')) return { ok: true, file: { id: 'f1', name: 'brief.pdf', size_bytes: 2048, mime_type: 'text/a&middot;b&amp;middot;c', extension: 'pdf', region: 'syd', created_at: NOW - 3600, updated_at: NOW - 60, uploader_name: 'Ada' } };
      return { ok: true, comments: [] };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    shown = await renderInLocale(
      <QueryClientProvider client={qc}><MemoryRouter initialEntries={['/comments?file_id=f1&name=brief.pdf']}><CommentsPage /></MemoryRouter></QueryClientProvider>,
      'en',
    );
    await flush();
    await flush();
    const { humanSize, timeAgo } = await import('@/lib/helpers');
    const line = [...document.body.querySelectorAll('p')].find((p) => p.textContent?.includes('text/a'));
    expect(line?.textContent).toBe(`${humanSize(2048)} \u00b7 text/a&middot;b&amp;middot;c \u00b7 ${timeAgo(NOW - 3600)}`);
  });
});

describe('Comments info line in English', () => {
  it('reads exactly as before: size, type and age joined by middle dots', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/me')) return { ok: true, user: { id: 'u1', name: 'Ada', email: 'a@x.y', avatar_url: null } };
      if (path.startsWith('/api/files/f1')) return { ok: true, file: { id: 'f1', name: 'brief.pdf', size_bytes: 2048, mime_type: 'application/pdf', extension: 'pdf', region: 'syd', created_at: NOW - 3600, updated_at: NOW - 60, uploader_name: 'Ada' } };
      return { ok: true, comments: [] };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    shown = await renderInLocale(
      <QueryClientProvider client={qc}><MemoryRouter initialEntries={['/comments?file_id=f1&name=brief.pdf']}><CommentsPage /></MemoryRouter></QueryClientProvider>,
      'en',
    );
    await flush();
    await flush();
    const { humanSize, timeAgo } = await import('@/lib/helpers');
    const line = [...document.body.querySelectorAll('p')].find((p) => p.textContent?.includes('application/pdf'));
    expect(line?.textContent).toBe(`${humanSize(2048)} \u00b7 application/pdf \u00b7 ${timeAgo(NOW - 3600)}`);
    expect(document.body.textContent).not.toMatch(/&(amp;)?middot;/);
  });
});

// ------------------------------------------------------------------ dashboard
const dash = (over: Record<string, unknown> = {}) => ({
  ok: true, user_name: 'Ada Lovelace', workspace_name: 'Studio',
  stats: { total_files: 12, files_this_week: 3, shared_externally: 2, total_bytes: 5_000_000, trash_bytes: 1000, storage_cap_bytes: 10_000_000, plan: 'free' },
  storage_breakdown: [{ name: 'Images', bytes: 3_000_000, color: '#22c55e' }],
  region_breakdown: [{ region: 'syd', bytes: 4_000_000, file_count: 7, color: '#3b82f6' }, { region: 'multi', bytes: 1_000_000, file_count: 1, color: '#f59e0b' }],
  recent_files: [{ id: 'f1', name: 'brief.pdf', size_bytes: 2048, created_at: NOW - 3600 }],
  team_stats: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@x.y', avatar_url: null, file_count: 9, total_bytes: 4_000_000 }, { user_id: 'u2', name: 'Grace', email: 'g@x.y', avatar_url: null, file_count: 1, total_bytes: 1_000_000 }],
  activity: [row({ action: 'file_version_uploaded', user_agent: CHROME_MAC, source_ip: '1.2.3.4', source: 'web', outcome: 'success' }), row({ action: 'member_left', resource_name: null, entity_type: 'user' })],
  ...over,
});
const dashApi = (d: unknown) => async (path: string) => {
  if (path.startsWith('/api/dashboard')) return d;
  if (path.startsWith('/api/me/permissions')) return { ok: true, permissions: { view_activity: true } };
  return { ok: true };
};

describe('Dashboard in Turkish', () => {
  it('cards, activity rows and detail have no leftover English', async () => {
    apiMock.mockImplementation(dashApi(dash()));
    const r = await show(<DashboardPage />);
    const text = document.body.textContent ?? '';
    for (const k of ['common.label.totalFiles', 'common.label.sharedExternally', 'common.label.storageUsed', 'common.label.currentPlan', 'dashboard.heading.storageBreakdown', 'dashboard.heading.recentFiles', 'dashboard.heading.teamUsage', 'dashboard.heading.storageByRegion', 'common.action.uploadFiles', 'dashboard.action.upgradeNow']) {
      expect(text, k).toContain(tr[k]);
    }
    expect(text).toContain(`Ada Lovelace ${tr['common.label.uploadedANewVersionOf']} report.pdf`);
    expect(text).toContain(`Ada Lovelace ${tr['common.label.activityLeftTheWorkspaceFragment']}`);
    expect(unexpected(r)).toEqual([]);
    await click([...document.body.querySelectorAll('[role="button"]')][0]);
    expect(document.body.textContent).toContain(tr['common.label.device']);
    expect(unexpected(r)).toEqual([]);
  });

  it('paid plan, unlimited storage, empty lists and the error state translate', async () => {
    apiMock.mockImplementation(dashApi(dash({
      stats: { total_files: 4, files_this_week: 0, shared_externally: 0, total_bytes: 5_000_000, trash_bytes: 0, storage_cap_bytes: null, plan: 'pro' },
      storage_breakdown: [], region_breakdown: [], recent_files: [], team_stats: [], activity: [],
    })));
    const r = await show(<DashboardPage />);
    expect(document.body.textContent).toContain(tr['dashboard.label.unlimitedPlan']);
    expect(document.body.textContent).toContain(tr['common.empty.noActivityYet']);
    expect(document.body.textContent).toContain(tr['dashboard.empty.noFilesYet']);
    expect(document.body.textContent).toContain(tr['dashboard.label.noTeamMembersYet']);
    expect(unexpected(r)).toEqual([]);
    shown!.unmount();
    apiMock.mockImplementation(async () => { throw new Error('x'); });
    const e = await show(<DashboardPage />);
    expect(document.body.textContent).toContain(tr['dashboard.error.couldNotLoadYourDashboard']);
    expect(unexpected(e)).toEqual([]);
  });
});

// ----------------------------------------------------------- workspace dashboard
describe('Workspace dashboard in Turkish', () => {
  const wd = {
    total: { limit_bytes: 10_000_000, used_bytes: 4_000_000, free_bytes: 6_000_000 },
    sources: [{ kind: 'plan', label: 'Pro plan', bytes: 10_000_000, meta: {} }],
    owned: [{ id: 'w1', name: 'Studio', icon_initials: 'S', icon_color: '#000', icon_image_url: null, used_bytes: 4_000_000, share_pct: 100 }],
    shared: [{ id: 'w2', name: 'Agency', icon_initials: 'A', icon_color: '#111', icon_image_url: null, role_id: 'role_viewer', owner_name: 'Grace' }],
  };
  it('has no leftover English', async () => {
    workspaceDashboardMock.mockResolvedValue(wd);
    const r = await show(<WorkspaceDashboardPage />);
    for (const k of ['common.heading.workspaceDashboard', 'workspaces.action.getMoreStorage', 'workspaces.heading.yourStorage', 'workspaces.heading.workspacesYouOwn', 'workspaces.heading.whereYourSpaceComesFrom', 'workspaces.heading.sharedWithYou', 'common.label.total', 'common.label.viewer', 'workspaces.description.theseUseTheOwnerSStorageNotYours']) {
      expect(document.body.textContent, k).toContain(tr[k]);
    }
    expect(unexpected(r)).toEqual([]);
  });
  it('empty and failed states translate', async () => {
    workspaceDashboardMock.mockResolvedValue({ ...wd, owned: [], shared: [] });
    const r = await show(<WorkspaceDashboardPage />);
    expect(document.body.textContent).toContain(tr['workspaces.label.youDonTOwnAnyWorkspacesYet']);
    expect(unexpected(r)).toEqual([]);
    shown!.unmount();
    workspaceDashboardMock.mockRejectedValue(new Error('x'));
    const e = await show(<WorkspaceDashboardPage />);
    expect(document.body.textContent).toContain(tr['workspaces.error.failedToLoadWorkspaceDashboard']);
    expect(unexpected(e)).toEqual([]);
  });
  it('role labels translate and custom ids read as a custom role', async () => {
    const { roleLabel } = await import('@/lib/workspace-dashboard');
    shown = await renderInLocale(<div />, 'tr');
    expect(roleLabel('role_owner')).toBe(tr['common.label.owner']);
    expect(roleLabel('role_admin')).toBe(tr['common.label.admin']);
    expect(roleLabel('role_member')).toBe(tr['common.label.member']);
    expect(roleLabel('role_viewer')).toBe(tr['common.label.viewer']);
    expect(roleLabel('role_zzz')).toBe(tr['common.label.customRole']);
  });
});

// ------------------------------------------------------------------- referrals
describe('Referrals page in Turkish', () => {
  const summary = (over: Record<string, unknown> = {}) => ({
    ok: true, code: 'abc', link: 'https://dosya.dev/r/abc', credited_count: 2, max_rewards: 10, bonus_bytes: 10, bonus_label: '10 GB',
    friends: [{ email_masked: 'a***@x.y', status: 'credited', joined_at: NOW }], ...over,
  });
  it('has no leftover English', async () => {
    referralsMock.mockResolvedValue(summary());
    const r = await show(<ReferralsPage />);
    for (const k of ['common.heading.referFriends', 'common.label.yourInviteLink', 'common.copy', 'referrals.label.invitedFriends', 'referrals.description.aFriendCountsOnceTheirAccountIsAWeekOldAnd']) {
      expect(document.body.textContent, k).toContain(tr[k]);
    }
    expect(unexpected(r)).toEqual([]);
  });
  it('maxed-out, empty and failed states translate', async () => {
    referralsMock.mockResolvedValue(summary({ credited_count: 10, friends: [] }));
    const r = await show(<ReferralsPage />);
    expect(document.body.textContent).toContain(tr['referrals.description.youVeEarnedTheMaximumBonusThanksForSpreadingTheWord']);
    expect(document.body.textContent).toContain(tr['referrals.description.noInvitesYetShareYourLinkToGetStarted']);
    expect(unexpected(r)).toEqual([]);
    shown!.unmount();
    referralsMock.mockRejectedValue(new Error('x'));
    const e = await show(<ReferralsPage />);
    expect(document.body.textContent).toContain(tr['referrals.error.failedToLoadYourReferralsPleaseTryAgain']);
    expect(unexpected(e)).toEqual([]);
  });
});

// ---------------------------------------------------- data rights + deletion
describe('data rights and account deletion text in Turkish', () => {
  const ASKED = Date.UTC(2026, 8, 29, 12) / 1000;
  const request = (over: Record<string, unknown> = {}) => ({
    id: 'r1', kind: 'access', status: 'answered', requested_at: ASKED, due_at: ASKED + 30 * 86400, verified_at: ASKED, answered_at: ASKED + 30,
    retry_at: null, code_pending: false, note: null, export: null, had_export: false, ...over,
  }) as import('@/lib/data-rights').RequestState;

  async function strings() {
    shown = await renderInLocale(<div />, 'tr');
    const dr = dataRights;
    const out: string[] = [
      dr.describeAnswer(request(), ASKED + 40),
      dr.describeAnswer(request({ answered_at: null }), ASKED + 40),
      dr.describeAnswer(request({ status: 'pending', answered_at: null }), ASKED + 30),
      dr.describeAnswer(request({ status: 'verified', note: 'x', answered_at: null }), ASKED + 30),
      dr.describeAnswer(request({ status: 'verified', note: null, export: { id: 'e', created_at: ASKED + 30, expires_at: ASKED + 9e5, workspace_count: 1, file_count: 2, total_bytes: 10, part_count: 1, manifest_bytes: 1, parts: [] } }), ASKED + 30),
      ...(['access', 'portability', 'erasure', 'restriction'] as const).map((kind) => dr.describeOtherRequest({ id: 'o', kind, status: 'pending', requested_at: ASKED, due_at: ASKED + 30 * 86400, note: null }, ASKED)),
      dr.deadlineLabel(ASKED + 30 * 86400),
      dr.describeArchives({ id: 'e', created_at: ASKED, expires_at: ASKED, workspace_count: 0, file_count: 0, total_bytes: 0, part_count: 0, manifest_bytes: 0, parts: [] }),
      dr.describeArchives({ id: 'e', created_at: ASKED, expires_at: ASKED, workspace_count: 2, file_count: 5, total_bytes: 2048, part_count: 1, manifest_bytes: 0, parts: [] }),
      dr.cooldownLabel(ASKED + 30, ASKED) ?? '',
      dr.cooldownLabel(ASKED + 600, ASKED) ?? '',
      dr.cooldownLabel(ASKED + 7200, ASKED) ?? '',
      dr.expiresLabel(ASKED + 3600, ASKED),
      dr.expiresLabel(ASKED + 3 * 86400, ASKED),
      ...['build_failed', 'request_closed', 'not_recorded'].map((code) => dr.errorCopy(new ApiError(500, JSON.stringify({ error: code }))).text),
    ];
    return out;
  }

  it('sentences carry the Turkish text and no leftover English', async () => {
    const out = await strings();
    const messages = await loadMessages('tr');
    expect(leftoverEnglish(out, 'tr', messages)).toEqual([]);
    expect(out[0]).toContain('29 Eylül');
    const asked = tr['profile.label.askedRequestrequestedAt'].replace('{requestRequested_at}', '29 Eylül');
    expect(out[0]).toBe(tr['profile.label.askedAnsweredInDurationlabel'].replace('{asked}', asked).replace('{durationLabel}', tr['profile.label.lessThanAMinute']));
    expect(out[1]).toBe(tr['profile.label.askedAnswered'].replace('{asked}', asked));
    expect(out[2]).toContain(tr['profile.label.lessThanAMinute']);
    expect(out).toContain(tr['profile.description.noFileArchivesWeFoundNoFilesUploadedByYou']);
    expect(out).toContain(tr['profile.error.yourCopyWasBuiltButWeCouldNotRecordTheAnswer']);
  });

  it('deletion blockers and failures translate', async () => {
    shown = await renderInLocale(<div />, 'tr');
    const messages = await loadMessages('tr');
    const blocker = deletion.describeBlocker({ kind: 'workspace_has_members', workspace_id: 'w', workspace_name: 'Studio', member_count: 3 });
    expect(blocker).toContain('Studio');
    const failures = [
      classifyDeleteError({ status: 429, message: 'request a new code' }).message,
      classifyDeleteError({ status: 429, message: 'slow down' }).message,
      classifyDeleteError({ status: 400, message: 'No deletion is scheduled' }).message,
      classifyDeleteError({ status: 403, message: 'nope' }).message,
      classifyDeleteError({ status: 400, message: 'bad' }).message,
      classifyDeleteError({ status: 500, message: '' }).message,
    ];
    expect(failures).toContain(tr['profile.description.thatPasswordIsNotCorrect']);
    expect(failures).toContain(tr['profile.error.couldNotDeleteYourAccountPleaseTryAgain']);
    expect(leftoverEnglish([blocker, ...failures], 'tr', messages)).toEqual([]);
    // a server message for a blocker is passed through untouched
    expect(classifyDeleteError({ status: 400, message: 'Studio still has 2 other members. Transfer it' }).message).toBe('Studio still has 2 other members. Transfer it');
  });
});
