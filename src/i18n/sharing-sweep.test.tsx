/**
 * Sharing, file requests, share analytics and cloud import in Turkish: no
 * English left on the share modal, the Shared page (both tabs), a link's
 * analytics, the file requests list, its create / recipients / edit dialogs,
 * the request detail page, and the cloud-import dialog, cards and toasts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const listAccountsMock = vi.fn();
const browseMock = vi.fn();
const disconnectMock = vi.fn();
vi.mock('@/api/cloud-import', () => ({
  listAccounts: (...a: unknown[]) => listAccountsMock(...a),
  browse: (...a: unknown[]) => browseMock(...a),
  disconnectAccount: (...a: unknown[]) => disconnectMock(...a),
}));

const toasts: { kind: string; title: string; description?: string }[] = [];
vi.mock('@/lib/toast', () => ({
  toast: {
    success: (title: string, description?: string) => toasts.push({ kind: 'success', title, description }),
    error: (title: string, description?: string) => toasts.push({ kind: 'error', title, description }),
    info: (title: string, description?: string) => toasts.push({ kind: 'info', title, description }),
  },
}));
// The files sidebar belongs to the Files screens, not to this unit.
vi.mock('@/components/files-sidebar', () => ({ FilesSidebar: () => null }));

const { ShareModal, clearShareDefaultsCache } = await import('@/components/share-modal');
const { default: SharedPage } = await import('@/pages/shared');
const { default: ShareAnalyticsPage } = await import('@/pages/share-analytics');
const { default: FileRequestsPage } = await import('@/pages/file-requests');
const { default: FileRequestDetailPage } = await import('@/pages/file-request-detail');
const { FileRequestEditDialog } = await import('@/components/file-request-edit-dialog');
const { ProviderPickerDialog } = await import('@/components/cloud-import/provider-picker-dialog');
const { ConnectedAccountsCard } = await import('@/components/cloud-import/connected-accounts-card');
const { CloudConnectNotice } = await import('@/components/cloud-import/cloud-connect-notice');
const { ImportProgressCard, describeJob } = await import('@/components/cloud-import/import-progress-card');
const { completionToast } = await import('@/lib/cloud-import-toasts');
const { useCloudImports } = await import('@/stores/cloud-imports');
const { useWorkspace } = await import('@/stores/workspace');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const w = window as unknown as { PointerEvent?: typeof MouseEvent; MouseEvent: typeof MouseEvent };
  if (!w.PointerEvent) w.PointerEvent = w.MouseEvent;
});
beforeEach(() => {
  useWorkspace.setState({ activeId: 'ws_1' });
  clearShareDefaultsCache();
  toasts.length = 0;
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  listAccountsMock.mockReset();
  browseMock.mockReset();
  disconnectMock.mockReset();
});

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
const buttonWith = (text: string) =>
  [...document.body.querySelectorAll('button, [role="tab"]')].find((b) => b.textContent?.trim().includes(text)) as HTMLElement | undefined;
async function click(text: string) {
  const el = buttonWith(text);
  expect(el, `button "${text}"`).toBeTruthy();
  await act(async () => { el!.click(); });
  await flush();
}

const NOW = Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------- share modal
describe('share modal in Turkish', () => {
  const settings = async (path: string) => (path.endsWith('/settings') ? { ok: true, settings: null } : { ok: true, excluded_count: 3 });

  it('email tab has no leftover English', async () => {
    apiMock.mockImplementation(settings);
    const r = await show(<ShareModal open target={{ kind: 'file', fileIds: ['f1'] }} name="report.pdf" onClose={() => {}} />);
    expect(document.body.textContent).toContain(tr['common.label.recipients']);
    expect(document.body.textContent).toContain(tr['common.label.sevenDays']);
    expect(r.leftover()).toEqual([]);
  });

  it('link tab with advanced options has no leftover English', async () => {
    apiMock.mockImplementation(settings);
    const r = await show(<ShareModal open target={{ kind: 'file', fileIds: ['f1'] }} name="report.pdf" onClose={() => {}} />);
    await click(tr['common.action.byLink']);
    await click(tr['common.action.advancedOptions']);
    expect(document.body.textContent).toContain(tr['files.label.downloadLimitOptional']);
    expect(r.leftover()).toEqual([]);
  });

  it('folder and bundle targets translate their sentences and the hidden-items notice', async () => {
    apiMock.mockImplementation(settings);
    const r = await show(<ShareModal open target={{ kind: 'folder', folderId: 'fo1' }} name="Holiday snaps" onClose={() => {}} />);
    await click(tr['common.action.byLink']);
    await click(tr['common.action.advancedOptions']);
    expect(r.leftover()).toEqual([]);
    expect(document.body.textContent).toMatch(/3/);
    shown!.unmount();
    const b = await show(<ShareModal open target={{ kind: 'bundle', fileIds: ['a', 'b'] }} name="Bundle" onClose={() => {}} />);
    expect(document.body.textContent).toContain(tr['files.description.oneLinkForAllOfThem']);
    expect(b.leftover()).toEqual([]);
  });

  it('validation errors and toasts translate', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith('/settings')) return { ok: true, settings: null };
      if (init?.method === 'POST') return { ok: true, link: { url: 'https://dosya.dev/s/x' } };
      return { ok: true };
    });
    const r = await show(<ShareModal open target={{ kind: 'file', fileIds: ['f1'] }} name="report.pdf" onClose={() => {}} />);
    await click(tr['sharing.action.send']);
    expect(document.body.textContent).toContain(tr['common.error.addAtLeastOneEmailAddress']);
    expect(r.leftover()).toEqual([]);
    await click(tr['common.action.byLink']);
    await click(tr['common.action.generateLink']);
    const link = toasts.find((t) => t.kind === 'success' || t.kind === 'info');
    expect(link).toBeTruthy();
    expect([tr['common.feedback.linkCopied'], tr['files.feedback.linkCreated']]).toContain(link!.title);
    expect(document.body.textContent).toContain(tr['sharing.label.shareLinkCreated']);
    expect(r.leftover()).toEqual([]);
  });
});

// ------------------------------------------------------------------ shared page
const fileRow = {
  link_id: 'l1', token: 't1', url: 'https://dosya.dev/s/t1', expires_at: null, view_count: 5, download_count: 2,
  is_revoked: 0, shared_at: NOW - 86_400, created_by: 'u1', file_id: 'f1', file_name: 'report.pdf',
  folder_name: null, is_folder: false, display_name: 'report.pdf', size_bytes: 12345, extension: '.pdf',
  region: 'syd', sharer_name: 'Jane', status: 'active', is_mine: true, is_password_protected: 1,
  lock_mode: 'view_only', access_mode: 'restricted', recipient_count: 2, title: 'Q3',
};
const expiringRow = { ...fileRow, link_id: 'l2', display_name: 'plan.docx', status: 'expiring', expires_at: NOW + 2 * 86_400, access_mode: 'public', is_password_protected: 0, lock_mode: 'none', download_count: 1 };
const expiredRow = { ...fileRow, link_id: 'l3', display_name: 'old.zip', status: 'expired', expires_at: NOW - 100, access_mode: 'public', size_bytes: null };
const revokedRow = { ...fileRow, link_id: 'l4', display_name: 'gone.png', status: 'revoked', is_revoked: 1, access_mode: 'public' };

describe('Shared page in Turkish', () => {
  const sharedApi = (withMe: unknown[], verified = true) => async (path: string) => {
    if (path.startsWith('/api/shares/with-me')) return { ok: true, links: withMe, email_verified: verified };
    if (path.startsWith('/api/shares')) return { ok: true, links: [fileRow, expiringRow, expiredRow, revokedRow] };
    return { ok: true };
  };

  it('by-me tab has no leftover English', async () => {
    apiMock.mockImplementation(sharedApi([]));
    const r = await show(<SharedPage />);
    expect(document.body.textContent).toContain(tr['shared-links.heading.overview']);
    expect(r.leftover()).toEqual([]);
  });

  it('revoke dialog has no leftover English', async () => {
    apiMock.mockImplementation(sharedApi([]));
    const r = await show(<SharedPage />);
    const revoke = document.body.querySelector(`[aria-label="${tr['shared.action.revokeShareLink']}"]`) as HTMLElement;
    expect(revoke).toBeTruthy();
    await act(async () => { revoke.click(); });
    expect(document.body.textContent).toContain(tr['shared-links.heading.revokeShareLink']);
    expect(r.leftover()).toEqual([]);
  });

  it('empty state and filtered-empty text translate', async () => {
    apiMock.mockImplementation(async (path: string) => (path.startsWith('/api/shares/with-me') ? { ok: true, links: [], email_verified: true } : { ok: true, links: [] }));
    const r = await show(<SharedPage />);
    expect(document.body.textContent).toContain(tr['shared.tooltip.nothingSharedYet']);
    expect(r.leftover()).toEqual([]);
  });

  it('with-me tab (rows, empty, unverified) has no leftover English', async () => {
    const row = {
      link_id: 'w1', url: 'https://dosya.dev/s/w1', display_name: 'brief.pdf', is_folder: false, is_bundle: false,
      size_bytes: 2048, extension: 'pdf', is_password_protected: 1, lock_mode: 'view_only', expires_at: null,
      revoked_at: null, status: 'active', shared_at: NOW, invited_at: NOW - 3600, verified_at: null, sender_name: 'Dana',
    };
    apiMock.mockImplementation(sharedApi([row, { ...row, link_id: 'w2', is_folder: true, size_bytes: null, status: 'revoked', verified_at: NOW }]));
    const r = await show(<SharedPage />);
    await click(tr['shared-links.action.withMe']);
    expect(document.body.textContent).toContain(tr['shared.label.notOpenedYet']);
    expect(r.leftover()).toEqual([]);
    shown!.unmount();
    apiMock.mockImplementation(sharedApi([], false));
    const u = await show(<SharedPage />);
    await click(tr['shared-links.action.withMe']);
    expect(document.body.textContent).toContain(tr['shared.tooltip.verifyYourEmailToSeeThese']);
    expect(u.leftover()).toEqual([]);
    shown!.unmount();
    apiMock.mockImplementation(sharedApi([]));
    const e = await show(<SharedPage />);
    await click(tr['shared-links.action.withMe']);
    expect(document.body.textContent).toContain(tr['shared.tooltip.nothingSharedWithYou']);
    expect(e.leftover()).toEqual([]);
  });
});

// -------------------------------------------------------------- share analytics
const analytics = (over: Record<string, unknown> = {}, link: Record<string, unknown> = {}) => ({
  ok: true,
  link: {
    link_id: 'lnk_1', url: 'https://dosya.dev/s/tok', display_name: 'report.pdf', is_folder: false, is_bundle: false,
    size_bytes: 1024, extension: '.pdf', region: 'ap-southeast-2', created_at: NOW - 86_400, created_by: 'u1',
    created_by_name: 'Ada', is_mine: false, expires_at: NOW + 5 * 86_400, is_revoked: false, revoked_at: null,
    is_password_protected: false, lock_mode: 'none', access_mode: 'public', status: 'active',
    view_count: 3, download_count: 1, title: 'Note', message: 'Hello', ...link,
  },
  range: 30,
  timeline: [{ day: '2026-09-01', opens: 3, downloads: 1 }],
  reach: { visitors: 2, truncated: true, devices: [{ label: 'Workstation', count: 2 }], browsers: [{ label: 'Chrome', count: 2 }] },
  recipients: null,
  log: {
    total: 2, offset: 0, limit: 50,
    rows: [
      { id: 'v1', visitor: 'a1b2', event: 'view', device: 'desktop', device_label: 'Chrome on Mac', country: 'TR', viewed_at: NOW - 3600 },
      { id: 'v2', visitor: 'e5f6', event: 'download', device: 'mobile', device_label: 'Safari on iPhone', country: null, viewed_at: NOW - 7200 },
    ],
  },
  gaps: { repeat_visits: 'returning visitors are deduped', per_recipient: 'opens are not attributable' },
  ...over,
});

describe('share analytics in Turkish', () => {
  const page = () => (
    <Routes><Route path="/shared/:id" element={<ShareAnalyticsPage />} /></Routes>
  );

  it('a public link with traffic has no leftover English', async () => {
    apiMock.mockResolvedValue(analytics());
    const r = await show(page(), '/shared/lnk_1');
    expect(document.body.textContent).toContain(tr['share-analytics.heading.accessOverTime']);
    expect(document.body.textContent).toContain(tr['share-analytics.description.countedFromTheFirst5000Visitors']);
    expect(r.leftover()).toEqual([]);
  });

  it('a password link and an empty log have no leftover English', async () => {
    apiMock.mockResolvedValue(analytics({ timeline: [], reach: { visitors: 0, truncated: false, devices: [], browsers: [] }, log: { total: 0, offset: 0, limit: 50, rows: [] } }, { is_password_protected: true, is_mine: true, view_count: 0, download_count: 0 }));
    const r = await show(page(), '/shared/lnk_1');
    expect(document.body.textContent).toContain(tr['share-analytics.label.noOneHasOpenedThisLink']);
    expect(r.leftover()).toEqual([]);
  });

  it('a restricted link (none opened, one opened) has no leftover English', async () => {
    const recips = [{ email: 'ada@x.com', verified_at: NOW, invited_at: NOW - 100 }, { email: 'bo@x.com', verified_at: null, invited_at: NOW - 100 }];
    apiMock.mockResolvedValue(analytics({ recipients: recips }, { access_mode: 'restricted', is_password_protected: true }));
    const r = await show(page(), '/shared/lnk_1');
    expect(document.body.textContent).toContain(tr['common.status.invited']);
    expect(r.leftover()).toEqual([]);
    shown!.unmount();
    apiMock.mockResolvedValue(analytics({ recipients: recips.map((x) => ({ ...x, verified_at: null })) }, { access_mode: 'restricted' }));
    const n = await show(page(), '/shared/lnk_1');
    expect(n.leftover()).toEqual([]);
  });

  it('a revoked link has no leftover English', async () => {
    apiMock.mockResolvedValue(analytics({}, { is_revoked: true, revoked_at: NOW - 3600, status: 'revoked', is_mine: true }));
    const r = await show(page(), '/shared/lnk_1');
    expect(document.body.textContent).toContain(tr['share-analytics.action.createANewLink']);
    expect(r.leftover()).toEqual([]);
  });

  it('the revoke dialog and the not-available page have no leftover English', async () => {
    apiMock.mockResolvedValue(analytics());
    const r = await show(page(), '/shared/lnk_1');
    await click(tr['common.action.revoke']);
    expect(document.body.textContent).toContain(tr['share-analytics.heading.revokeThisLink']);
    expect(r.leftover()).toEqual([]);
    shown!.unmount();
    apiMock.mockResolvedValue({ ok: true });
    const m = await show(page(), '/shared/lnk_1');
    expect(document.body.textContent).toContain(tr['share-analytics.error.thisShareLinkIsNotAvailable']);
    expect(m.leftover()).toEqual([]);
  });
});

// ----------------------------------------------------------------- file requests
const REQUEST = {
  id: 'fr_1', title: 'Q3 statements', url: 'https://x/t', is_revoked: 0, is_password_protected: 1,
  expires_at: NOW + 30 * 86_400, created_at: NOW - 86_400, created_by_name: 'Ada', upload_count: 2,
  message: null, folder_id: null, folder_name: null, allowed_extensions: null,
  max_file_size_bytes: null, max_files: null,
};

describe('file requests in Turkish', () => {
  const listApi = (requests: unknown[]) => async (path: string) => {
    if (path.includes('/recipients')) {
      return { ok: true, title: 'Q3 statements', recipients: [{ id: 'r1', email: 'a@x.com', sent_at: NOW - 100, uploaded_at: null }, { id: 'r2', email: 'b@x.com', sent_at: null, uploaded_at: NOW }] };
    }
    return path.startsWith('/api/file-requests') ? { ok: true, requests } : { ok: true };
  };

  it('list (active, expired, revoked) has no leftover English', async () => {
    apiMock.mockImplementation(listApi([REQUEST, { ...REQUEST, id: 'fr_2', title: null, expires_at: NOW - 100, upload_count: 0, is_password_protected: 0, created_by_name: null }, { ...REQUEST, id: 'fr_3', is_revoked: 1, expires_at: null }]));
    const r = await show(<FileRequestsPage />);
    expect(document.body.textContent).toContain(tr['file-requests.action.newRequest']);
    expect(r.leftover()).toEqual([]);
  });

  it('empty list has no leftover English', async () => {
    apiMock.mockImplementation(listApi([]));
    const r = await show(<FileRequestsPage />);
    expect(document.body.textContent).toContain(tr['file-requests.tooltip.noFileRequestsYet']);
    expect(r.leftover()).toEqual([]);
  });

  it('create dialog (email tab, link tab, advanced) has no leftover English', async () => {
    apiMock.mockImplementation(listApi([REQUEST]));
    const r = await show(<FileRequestsPage />);
    await click(tr['file-requests.action.newRequest']);
    expect(document.body.textContent).toContain(tr['file-requests.heading.requestFiles']);
    expect(r.leftover()).toEqual([]);
    await click(tr['common.action.byLink']);
    await click(tr['common.action.advancedOptions']);
    expect(document.body.textContent).toContain(tr['file-requests.description.generateALinkAnyoneCanUseToUploadFilesToYour']);
    expect(r.leftover()).toEqual([]);
  });

  it('recipients dialog has no leftover English', async () => {
    apiMock.mockImplementation(listApi([REQUEST]));
    const r = await show(<FileRequestsPage />);
    await click(tr['file-requests.action.recipients']);
    expect(document.body.textContent).toContain(tr['file-requests.action.resendAll']);
    expect(r.leftover()).toEqual([]);
  });

  it('edit dialog has no leftover English', async () => {
    const r = await show(
      <FileRequestEditDialog
        request={{ ...REQUEST, allowed_extensions: '.pdf', max_file_size_bytes: 5 * 1024 * 1024, max_files: 3 }}
        workspaceId="ws_1" onClose={() => {}} onSaved={() => {}}
      />,
    );
    expect(document.body.textContent).toContain(tr['common.heading.editRequest']);
    expect(document.body.textContent).toContain(tr['common.label.allowedExtensions']);
    expect(r.leftover()).toEqual([]);
  });

  it('edit dialog validation error translates', async () => {
    const r = await show(
      <FileRequestEditDialog request={{ ...REQUEST, is_password_protected: 0 }} workspaceId="ws_1" onClose={() => {}} onSaved={() => {}} />,
    );
    const pw = document.body.querySelector('input[type="password"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(pw, 'abc'); pw.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(tr['common.action.saveChanges']);
    expect(document.body.textContent).toContain(tr['common.error.passwordMustBeAtLeast8Characters'].replace('{min}', '8'));
    expect(r.leftover()).toEqual([]);
  });
});

describe('file request detail in Turkish', () => {
  const detail = (over: Record<string, unknown> = {}) => ({
    ok: true,
    request: { id: 'fr_1', workspace_id: 'ws_1', folder_id: null, folder_name: null, token: 't', url: 'https://x/t', title: 'Q3 statements', message: null, is_revoked: 0, is_password_protected: 1, expires_at: NOW + 30 * 86_400, allowed_extensions: null, max_file_size_bytes: null, max_files: null, upload_count: 2, created_at: NOW - 86_400, created_by_name: 'Ada' },
    uploads: [
      { id: 'u1', file_id: 'file_1', uploader_email: null, uploader_name: null, created_at: NOW - 100, file_name: 'invoice.pdf', size_bytes: 1000, mime_type: 'application/pdf', extension: '.pdf', updated_at: NOW, current_version: 1, lock_mode: 'none', is_hidden: 0, uploaded_by: null, region: null, origin: null },
    ],
    recipients: [{ id: 'r1', email: 'a@x.com', sent_at: NOW, uploaded_at: NOW - 50 }, { id: 'r2', email: 'b@x.com', sent_at: NOW, uploaded_at: null }],
    ...over,
  });
  const page = () => <Routes><Route path="/file-requests/:id" element={<FileRequestDetailPage />} /></Routes>;

  it('page with recipients open has no leftover English', async () => {
    apiMock.mockResolvedValue(detail());
    const r = await show(page(), '/file-requests/fr_1');
    await click(tr['file-request-detail.action.recipientsRecipientscount'].replace('{recipientCount}', '2'));
    expect(document.body.querySelector(`input[placeholder="${tr['file-request-detail.placeholder.searchUploads']}"]`)).toBeTruthy();
    expect(r.leftover()).toEqual([]);
  });

  it('empty page, not-found page, and the rename and delete dialogs have no leftover English', async () => {
    apiMock.mockResolvedValue(detail({ uploads: [], recipients: [] }));
    const e = await show(page(), '/file-requests/fr_1');
    expect(document.body.textContent).toContain(tr['common.label.noFilesUploadedYet']);
    expect(e.leftover()).toEqual([]);
    shown!.unmount();

    apiMock.mockResolvedValue(detail());
    const r = await show(page(), '/file-requests/fr_1');
    const del = document.body.querySelector(`button[title="${tr['common.delete']}"]`) as HTMLElement;
    await act(async () => { del.click(); });
    expect(document.body.textContent).toContain(tr['file-request-detail.heading.deleteFile']);
    expect(r.leftover()).toEqual([]);
    await click(tr['common.cancel']);
    const ren = document.body.querySelector(`button[title="${tr['common.action.rename']}"]`) as HTMLElement;
    await act(async () => { ren.click(); });
    expect(document.body.textContent).toContain(tr['file-request-detail.heading.renameFile']);
    expect(r.leftover()).toEqual([]);
    shown!.unmount();

    apiMock.mockResolvedValue({ ok: false });
    const n = await show(page(), '/file-requests/fr_1');
    expect(document.body.textContent).toContain(tr['file-request-detail.action.backToFileRequests']);
    expect(n.leftover()).toEqual([]);
  });
});

// ------------------------------------------------------------------ cloud import
const cloudJob = (over: Record<string, unknown> = {}) => ({
  id: 'job1', provider: 'google', account_email: 'me@x.com', workspace_id: 'ws_1', status: 'running',
  total_files: 10, total_bytes: 5_000_000, total_folders: 2, completed_files: 3, completed_bytes: 1_000_000,
  failed_files: 0, skipped_files: 0, error_message: null, created_at: 0, updated_at: 0, ...over,
});

describe('cloud import in Turkish', () => {
  it('provider picker (no account, browse, reconnect) has no leftover English', async () => {
    listAccountsMock.mockResolvedValue([]);
    const a = await show(<ProviderPickerDialog open onOpenChange={() => {}} provider="google" destFolderId={null} />);
    expect(document.body.textContent).toContain(tr['common.description.noAccountConnectedYet']);
    expect(a.leftover()).toEqual([]);
    shown!.unmount();

    listAccountsMock.mockResolvedValue([{ id: 'acc1', provider: 'google', account_email: 'me@x.com', account_name: 'Me', created_at: 0 }]);
    browseMock.mockResolvedValue({
      entries: [
        { id: 'e1', name: 'Reports2025', kind: 'folder', size: null },
        { id: 'e2', name: 'a.pdf', kind: 'file', size: 10, unsupported: true },
        { id: 'e3', name: 'sheet', kind: 'file', size: 10, exportAs: { ext: '.xlsx', mime: 'x' } },
      ],
      cursor: 'next',
    });
    const b = await show(<ProviderPickerDialog open onOpenChange={() => {}} provider="google" destFolderId={null} />);
    expect(document.body.textContent).toContain(tr['common.label.home']);
    expect(document.body.textContent).toContain(tr['common.action.loadMore']);
    expect(b.leftover()).toEqual([]);
    shown!.unmount();

    browseMock.mockResolvedValue({ entries: [], cursor: null });
    const c = await show(<ProviderPickerDialog open onOpenChange={() => {}} provider="google" destFolderId={null} />);
    expect(document.body.textContent).toContain(tr['common.description.thisFolderIsEmpty']);
    expect(c.leftover()).toEqual([]);
  });

  it('connected accounts card has no leftover English', async () => {
    listAccountsMock.mockResolvedValue([{ id: 'acc1', provider: 'google', account_email: 'me@x.com', account_name: 'Me', created_at: NOW - 3600 }]);
    const r = await show(<ConnectedAccountsCard provider="google" onImport={() => {}} />);
    expect(document.body.textContent).toContain(tr['common.label.connectedAccounts']);
    expect(r.leftover()).toEqual([]);
    disconnectMock.mockResolvedValue(undefined);
    await click(tr['common.action.disconnect']);
    expect(toasts[0].title).toBe(tr['common.feedback.accountDisconnected']);
  });

  it('connect notice has no leftover English', async () => {
    const r = await show(<CloudConnectNotice />, '/?cloud_error=token_failed');
    expect(document.body.textContent).toContain(tr['common.error.connectionFailedTheProviderDidNotAcceptTheSignInPlease']);
    expect(r.leftover()).toEqual([]);
  });

  it('progress card has no leftover English and formats its stats', async () => {
    useCloudImports.setState({ jobs: [cloudJob(), cloudJob({ id: 'job2', status: 'discovering', total_bytes: 2_000_000 })] as never, refresh: vi.fn().mockResolvedValue(undefined) });
    const r = await show(<ImportProgressCard />);
    expect(document.body.textContent).toContain(tr['common.cancel']);
    expect(r.leftover()).toEqual([]);
    expect(document.body.textContent).not.toMatch(/\btrue\b/);
  });

  it('job descriptions and completion toasts translate', async () => {
    await show(<div />);
    expect(describeJob(cloudJob({ status: 'cancelled' }) as never)).toBe(tr['common.label.importCancelled']);
    expect(describeJob(cloudJob({ status: 'failed' }) as never)).toBe(tr['common.error.importFailed']);
    expect(describeJob(cloudJob({ status: 'complete', failed_files: 2, skipped_files: 1 }) as never)).not.toMatch(/Imported|failed|skipped/);
    const done = completionToast(cloudJob({ status: 'complete', completed_files: 1, skipped_files: 2 }) as never)!;
    expect(done.title).toBe(tr['common.heading.importComplete']);
    expect(done.description).not.toMatch(/file|skipped/);
    const failed = completionToast(cloudJob({ status: 'failed' }) as never)!;
    expect(failed.title).toBe(tr['common.error.importFailed']);
    expect(failed.description).toContain('me@x.com');
    expect(failed.description).not.toMatch(/could not be completed/);
    expect(completionToast(cloudJob({ status: 'cancelled' }) as never)!.title).toBe(tr['common.heading.importCancelled']);
  });
});
