/**
 * The profile pages and the delete dialogs in Turkish: every tab's chrome, the
 * password / 2FA modals, the privacy section's states, and the account and
 * workspace deletion dialogs have no English left. Server text (notification
 * group labels, device names, API errors) stays as sent.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, API_BASE: '', api: (...args: unknown[]) => apiMock(...args) };
});
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobile.value }));

const ProfilePage = (await import('@/pages/profile')).default;
const { SessionsSection } = await import('@/pages/profile/sessions');
const { PasswordSection } = await import('@/pages/profile');
const { NAV } = await import('@/pages/profile/shared');
const { DeleteAccountNowDialog } = await import('@/components/delete-account-now-dialog');
const { DeleteWorkspaceDialog } = await import('@/components/delete-workspace-dialog');
const { PrivacySection } = await import('@/components/account/privacy-section');
const { IdentitySection, DeleteAccountSection } = await import('@/pages/profile');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;

// English that comes from helpers outside this unit (lib/data-rights.ts, lib/workspace-dashboard.ts,
// lib/account-deletion.ts); they are listed in the report as needing a change outside the list.
const FROM_OTHER_UNITS = [/^We must answer by /, /^Asked /, /^Owner$/, /\bOur deadline was\b/, /^These downloads expire/, / you uploaded, across /];
const mine = (texts: string[]) => texts.filter((t) => !FROM_OTHER_UNITS.some((re) => re.test(t)));

let shown: Rendered | null = null;
// The first render of a section pays for the lazy chunks of every page it imports.
vi.setConfig({ testTimeout: 20_000 });
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  mobile.value = false;
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function show(ui: React.ReactElement) {
  shown = await renderInLocale(<MemoryRouter>{ui}</MemoryRouter>, 'tr');
  await flush();
  await flush();
  return shown;
}

const USER = {
  id: 'u1', name: 'Zeynep Kaya', email: 'jane@example.test', initials: 'JD', avatar_url: null,
  preferred_language: 'en', created_at: 1_790_672_400, email_verified_at: 1_790_672_400,
  workspace_count: 2, has_password: true,
};
const SESSIONS = [
  { id: 's1', device: 'Chrome on Mac', kind: 'desktop', browser: 'Chrome', meta: 'Sydney, AU', is_current: true, created_at: 1 },
  { id: 's2', device: 'Phone app', kind: 'mobile', browser: 'App', meta: 'Perth, AU', is_current: false, created_at: 2 },
];
const ANSWER_REQUEST = {
  id: 'drq_1', kind: 'access', status: 'answered', requested_at: 1_790_672_400, due_at: 1_793_264_400,
  verified_at: 1_790_672_500, answered_at: 1_790_672_700, retry_at: null, note: null,
  export: {
    id: 'exp_1', created_at: 1_790_672_640, expires_at: 1_791_277_200, workspace_count: 1, file_count: 3,
    total_bytes: 3000, part_count: 1, manifest_bytes: 100,
    parts: [{ part: 1, workspace_id: 'w', workspace_name: 'Acme', filename: 'export-part-1.zip', file_count: 3, bytes: 3000 }],
  },
  had_export: true, code_pending: false,
};
const PENDING_REQUEST = {
  ...ANSWER_REQUEST, status: 'pending', answered_at: null, verified_at: null, export: null, had_export: false, code_pending: true,
};

function route(overrides: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    '/api/me': { ok: true, user: USER },
    '/api/me/2fa/status': { ok: true, method: null, totp_enabled: false, recovery_codes_remaining: 0 },
    '/api/me/sessions': { ok: true, sessions: SESSIONS },
    '/api/me/notifications': {
      ok: true,
      channels: { in_app: true, email: true, push: true },
      groups: [{ key: 'g1', label: 'Zzz group', description: 'Zzz description', enabled: true, alwaysOn: 'none', note: null, options: [] }],
    },
    '/api/cloud/accounts': { ok: true, accounts: [{ id: 'a1', provider: 'google', account_email: 'me@example.test', account_name: 'Me', created_at: 1_790_672_400 }] },
    '/api/cloud/providers': { providers: [{ id: 'google', label: 'Google Drive' }] },
    '/api/me/ai-connections': { ok: true, connections: [{ id: 'c1', clientName: 'Zzz client', workspaceId: 'w', workspaceName: 'Acme', scopes: ['files.read', 'account.read'], createdAt: 1_790_672_400 }] },
    '/api/workspaces': { ok: true, workspaces: [{ id: 'w', name: 'Acme', icon_initials: 'AC', icon_color: '#123456', role_id: 'role_owner', joined_at: 1_790_672_400 }] },
    '/api/me/data': { ok: true, request: null },
    '/api/me/delete-preview': {
      ok: true, workspaces: [{ id: 'w', name: 'Acme' }], file_count: 12, total_bytes: 10, blockers: [], window_days: 30, deletion_scheduled_for: null,
    },
    ...overrides,
  };
  apiMock.mockImplementation(async (path: string) => {
    const key = path.split('?')[0];
    if (key in table) return table[key];
    return { ok: true };
  });
}

function clickText(text: string) {
  // The last match: a dialog is portalled after the page it opened over.
  const el = [...document.querySelectorAll<HTMLElement>('button, a')].filter((n) => n.textContent?.trim() === text).pop();
  expect(el, `no button/link "${text}"`).toBeDefined();
  return act(async () => { el!.click(); });
}

function page(section: string) {
  return (
    <Routes>
      <Route path="/profile/:section?" element={<ProfilePage />} />
    </Routes>
  );
}
async function showSection(section: string) {
  shown = await renderInLocale(
    <MemoryRouter initialEntries={[`/profile/${section}`]}>{page(section)}</MemoryRouter>, 'tr',
  );
  await flush();
  await flush();
  return shown;
}

describe('profile pages in Turkish', () => {
  it('rail navigation labels and groups translate', async () => {
    route();
    const r = await showSection('identity');
    expect(r.container.querySelector('nav')?.getAttribute('aria-label')).toBe(tr['profile.accessibility.profileSections']);
    for (const n of NAV) expect(r.container.textContent).toContain(tr[n.labelKey]);
    expect(r.container.textContent).toContain(tr['profile.label.yourData']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('phone index translates', async () => {
    mobile.value = true;
    route();
    shown = await renderInLocale(<MemoryRouter initialEntries={['/profile']}>{page('')}</MemoryRouter>, 'tr');
    await flush(); await flush();
    expect(shown.container.textContent).toContain(tr['profile.label.privacyAndYourData']);
    expect(mine(shown.leftover())).toEqual([]);
  });

  it('phone section back link translates', async () => {
    mobile.value = true;
    route();
    shown = await renderInLocale(<MemoryRouter initialEntries={['/profile/sessions']}>{page('sessions')}</MemoryRouter>, 'tr');
    await flush(); await flush();
    expect(shown.container.textContent).toContain(tr['common.action.profile']);
    expect(mine(shown.leftover())).toEqual([]);
  });

  for (const section of ['identity', 'appearance', 'password', 'sessions', 'notifications', 'integrations', 'ai-apps', 'workspaces', 'delete']) {
    it(`${section} tab has no leftover English`, async () => {
      route();
      const r = await showSection(section);
      expect(r.container.querySelector('section'), `${section} did not render`).not.toBeNull();
      expect(mine(r.leftover())).toEqual([]);
    });
  }

  it('identity: member line, badges and the language field', async () => {
    route();
    const r = await showSection('identity');
    expect(r.container.textContent).toContain('Zeynep Kaya');
    expect(r.container.textContent).toContain(tr['profile.status.verified']);
    expect(r.container.textContent).not.toContain('Member since');
  });

  it('appearance keeps the language field', async () => {
    route();
    const r = await showSection('appearance');
    expect(r.container.textContent).toContain(tr['appearance.label.language']);
    expect(r.container.textContent).toContain(tr['common.option.dark']);
  });

  it('password tab without a password translates', async () => {
    route({ '/api/me': { ok: true, user: { ...USER, has_password: false } } });
    const r = await showSection('password');
    expect(r.container.textContent).toContain(tr['profile.status.notSet']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('password tab with authenticator on translates', async () => {
    route({ '/api/me/2fa/status': { ok: true, method: 'totp', totp_enabled: true, recovery_codes_remaining: 7 } });
    const r = await showSection('password');
    expect(r.container.textContent).toContain(tr['profile.description.enabledViaAuthenticatorApp']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('notifications keep the server group text and translate the chrome', async () => {
    route();
    const r = await showSection('notifications');
    expect(r.container.textContent).toContain('Zzz group');
    expect(r.container.textContent).toContain(tr['profile.heading.deliveryChannels']);
  });
});

describe('password modals in Turkish', () => {
  it('change-password modal', async () => {
    const r = await show(<PasswordSection tfa={null} onTfaChanged={() => {}} hasPassword />);
    await clickText(tr['profile.action.changePassword']);
    expect(document.querySelector(`input[placeholder="${tr['profile.placeholder.newPassword']}"]`)).not.toBeNull();
    expect(mine(r.leftover())).toEqual([]);
  });

  it('authenticator setup modal', async () => {
    apiMock.mockResolvedValue({ ok: true, secret: 'ABCDEF', uri: 'otpauth://totp/x?secret=ABCDEF' });
    const r = await show(<PasswordSection tfa={null} onTfaChanged={() => {}} hasPassword />);
    await clickText(tr['profile.action.enableAuthenticator']);
    await flush();
    expect(document.body.textContent).toContain(tr['profile.heading.setUpAuthenticatorApp']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('disable and regenerate modals', async () => {
    const r = await show(<PasswordSection tfa={{ method: 'totp', totp_enabled: true, recovery_codes_remaining: 4 }} onTfaChanged={() => {}} hasPassword />);
    await clickText(tr['profile.action.regenerateCodes']);
    expect(document.body.textContent).toContain(tr['profile.heading.regenerateRecoveryCodes']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('regenerate modal after the codes are issued', async () => {
    apiMock.mockResolvedValue({ ok: true, recovery_codes: ['aaaa-1111', 'bbbb-2222'] });
    const r = await show(<PasswordSection tfa={{ method: 'totp', totp_enabled: true, recovery_codes_remaining: 4 }} onTfaChanged={() => {}} hasPassword />);
    await clickText(tr['profile.action.regenerateCodes']);
    const pw = document.querySelector<HTMLInputElement>(`input[placeholder="${tr['profile.placeholder.currentPassword']}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(pw, 'secret-pass');
      pw.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clickText(tr['profile.action.regenerate']);
    await flush();
    expect(document.body.textContent).toContain('aaaa-1111');
    expect(document.body.textContent).toContain(tr['common.done']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('disable modal', async () => {
    const r = await show(<PasswordSection tfa={{ method: 'email', totp_enabled: false, recovery_codes_remaining: 0 }} onTfaChanged={() => {}} hasPassword />);
    await clickText(tr['profile.action.disable']);
    expect(document.body.textContent).toContain(tr['profile.heading.disableTwoFactorAuthentication']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('refused saves toast in Turkish', async () => {
    const { toast } = await import('@/lib/toast');
    const spy = vi.spyOn(toast, 'error').mockImplementation(() => undefined as never);
    await show(<PasswordSection tfa={null} onTfaChanged={() => {}} hasPassword />);
    await clickText(tr['profile.action.changePassword']);
    await clickText(tr['profile.label.changePassword']);
    expect(spy).toHaveBeenCalledWith(tr['profile.error.passwordTooShort'], tr['profile.error.passwordMustBeAtLeast8Characters'].replace('{min}', '8'));
    spy.mockRestore();
  });
});

describe('identity email dialog in Turkish', () => {
  it('password confirmation dialog', async () => {
    const r = await show(<IdentitySection user={USER} onSaved={() => {}} />);
    const input = document.querySelector<HTMLInputElement>('input.w-56')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'new@example.test');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clickText(tr['profile.action.change']);
    expect(document.body.textContent).toContain(tr['profile.heading.confirmYourPassword']);
    expect(mine(r.leftover())).toEqual([]);
  });
});

describe('sessions in Turkish', () => {
  it('keeps device names as sent', async () => {
    const r = await show(<SessionsSection sessions={SESSIONS as never} onChanged={() => {}} />);
    expect(r.container.textContent).toContain('Chrome on Mac');
    expect(r.container.textContent).toContain(tr['profile.status.current']);
    expect(r.container.textContent).toContain(tr['profile.action.revokeAllOtherSessions']);
    expect(mine(r.leftover())).toEqual([]);
  });
});

describe('privacy section in Turkish', () => {
  it('blank state and rights dialog', async () => {
    route();
    const r = await show(<PrivacySection now={() => 1_790_673_000} />);
    expect(r.container.textContent).toContain(tr['profile.label.getACopyOfYourData']);
    await act(async () => { document.querySelector<HTMLElement>('[data-testid="open-rights"]')!.click(); });
    expect(document.body.textContent).toContain(tr['profile.heading.yourRights']);
    expect(document.body.textContent).toContain(tr['profile.label.seeWhatWeHoldAccess']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('answered state translates', async () => {
    route({ '/api/me/data': { ok: true, request: ANSWER_REQUEST } });
    const r = await show(<PrivacySection now={() => 1_790_673_000} />);
    expect(r.container.textContent).toContain(tr['profile.label.yourReport']);
    expect(r.container.textContent).toContain(tr['profile.label.yourFiles']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('awaiting-code state and the code dialog translate', async () => {
    route({ '/api/me/data': { ok: true, request: PENDING_REQUEST } });
    const r = await show(<PrivacySection now={() => 1_790_673_000} />);
    expect(r.container.textContent).toContain(tr['profile.label.weEmailedYouACode']);
    await act(async () => { document.querySelector<HTMLElement>('[data-testid="open-code"]')!.click(); });
    expect(document.body.textContent).toContain(tr['profile.heading.enterYourCode']);
    expect(document.querySelector('[data-testid="code-input"]')?.getAttribute('aria-label')).not.toContain('confirmation code');
    expect(mine(r.leftover())).toEqual([]);
  });

  it('failed and building states translate', async () => {
    route({ '/api/me/data': { ok: true, request: { ...PENDING_REQUEST, status: 'failed', code_pending: false, verified_at: 1 } } });
    const r = await show(<PrivacySection now={() => 1_790_673_000} />);
    expect(r.container.textContent).toContain(tr['profile.error.weCouldNotFinishBuildingYourCopy']);
  });

  it('a load failure says so in Turkish', async () => {
    apiMock.mockRejectedValue(new Error('x'));
    const r = await show(<PrivacySection now={() => 1_790_673_000} />);
    expect(r.container.textContent).toContain(tr['profile.error.couldNotLoadYourDataRequestsReloadToTryAgain']);
  });
});

describe('delete dialogs in Turkish', () => {
  it('delete tab: scheduled state', async () => {
    route({ '/api/me/delete-preview': {
      ok: true, workspaces: [{ id: 'w', name: 'Acme' }], file_count: 12, total_bytes: 10, blockers: [], window_days: 30, deletion_scheduled_for: 4_000_000_000,
    } });
    const r = await show(<DeleteAccountSection user={USER} />);
    expect(r.container.textContent).toContain(tr['profile.label.deletionScheduled']);
    expect(r.container.textContent).toContain(tr['common.action.cancelDeletion']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('delete tab: summary names the file count in Turkish', async () => {
    route();
    const r = await show(<DeleteAccountSection user={USER} />);
    expect(r.container.textContent).not.toContain('Scheduled for 30 days later');
    expect(mine(r.leftover())).toEqual([]);
  });

  it('delete now dialog, password proof', async () => {
    const r = await show(
      <DeleteAccountNowDialog open onOpenChange={() => {}} preview={{ workspaces: [{ id: 'w', name: 'Acme' }], file_count: 12, total_bytes: 1, blockers: [], window_days: 30, deletion_scheduled_for: 4_000_000_000 }} scheduledFor={4_000_000_000} hasPassword onDeleted={() => {}} />,
    );
    expect(document.body.textContent).toContain(tr['profile.heading.deleteYourAccountNow']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('delete now dialog, emailed code proof', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const r = await show(
      <DeleteAccountNowDialog open onOpenChange={() => {}} preview={null} scheduledFor={4_000_000_000} hasPassword={false} onDeleted={() => {}} />,
    );
    await flush();
    expect(document.body.textContent).toContain(tr['profile.description.weEmailedYouACodeLengthDigitCodeEnterItToConfirm'].replace('{CODE_LENGTH}', '6'));
    expect(mine(r.leftover())).toEqual([]);
  });

  it('workspace deletion walks all three steps in Turkish', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/delete-preview')) return { ok: true, workspace_name: 'Zzz Team', file_count: 1200, total_bytes: 5000, folder_count: 3, member_count: 0, blockers: [] };
      return { ok: true, sent_to: 'owner@example.test' };
    });
    const r = await show(<DeleteWorkspaceDialog open onOpenChange={() => {}} workspaceId="ws" onDeleted={() => {}} />);
    await flush();
    expect(document.body.textContent).toContain(tr['settings.label.filesPermanentlyDeleted']);
    expect(mine(r.leftover())).toEqual([]);
    await clickText(tr['common.continue']);
    await flush();
    expect(document.body.textContent).toContain(tr['settings.action.sendANewCode']);
    expect(mine(r.leftover())).toEqual([]);
    const code = document.querySelector<HTMLInputElement>('input[placeholder="000000"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(code, '123456');
      code.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clickText(tr['common.continue']);
    expect(document.body.textContent).toContain(tr['settings.action.deleteForever']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('workspace deletion blockers translate', async () => {
    apiMock.mockResolvedValue({ ok: true, workspace_name: 'Zzz Team', file_count: 1, total_bytes: 1, folder_count: 0, member_count: 2, blockers: ['has_members', 'last_workspace'] });
    const r = await show(<DeleteWorkspaceDialog open onOpenChange={() => {}} workspaceId="ws" onDeleted={() => {}} />);
    await flush();
    expect(document.body.textContent).toContain(tr['settings.description.thisIsYourOnlyWorkspaceCreateAnotherOneFirstAn']);
    expect(mine(r.leftover())).toEqual([]);
  });
});
