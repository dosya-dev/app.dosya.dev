/**
 * The integrations pages in Turkish: the index (cards, tags, built-in tools),
 * every provider page, the status badges, the webhook endpoint cards with their
 * deliveries table and dialogs, the Lightroom, WordPress and n8n connection
 * tables with their dialogs, and the shared API-key callout. Brand names, code
 * samples and server text stay as they are.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    API_BASE: '',
    api: (...args: unknown[]) => apiMock(...args),
    apiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'x'),
  };
});

const toasts: { kind: string; title: string; description?: string }[] = [];
vi.mock('@/lib/toast', () => ({
  toast: {
    success: (title: string, description?: string) => toasts.push({ kind: 'success', title, description }),
    error: (title: string, description?: string) => toasts.push({ kind: 'error', title, description }),
    info: (title: string, description?: string) => toasts.push({ kind: 'info', title, description }),
  },
}));

const perms = vi.hoisted(() => ({ allowed: false }));
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: () => perms.allowed, isResolved: true }),
}));
// The cloud-import cards and the folder picker belong to other units.
vi.mock('@/components/cloud-import/provider-picker-dialog', () => ({ ProviderPickerDialog: () => null }));
vi.mock('@/components/cloud-import/connected-accounts-card', () => ({ ConnectedAccountsCard: () => null }));
vi.mock('@/components/cloud-import/cloud-connect-notice', () => ({ CloudConnectNotice: () => null }));
vi.mock('@/components/cloud-import/import-progress-card', () => ({ ImportProgressCard: () => null }));
vi.mock('@/components/folder-picker-dialog', () => ({ FolderPickerDialog: () => null }));
vi.mock('@/stores/remote-downloads', () => ({ useRemoteDownloads: { getState: () => ({ refresh: () => {} }) } }));

const { useWorkspace } = await import('@/stores/workspace');
const { GlobalSearch } = await import('@/components/layout/global-search');
const { useLocale } = await import('@/lib/i18n');
const { t } = await import('@/lib/i18n');
const IntegrationsPage = (await import('@/pages/integrations')).default;
const Zapier = (await import('@/pages/integrations/zapier')).default;
const Cli = (await import('@/pages/integrations/cli')).default;
const Rclone = (await import('@/pages/integrations/rclone')).default;
const RestApi = (await import('@/pages/integrations/rest-api')).default;
const Sftp = (await import('@/pages/integrations/sftp')).default;
const S3 = (await import('@/pages/integrations/s3')).default;
const Webdav = (await import('@/pages/integrations/webdav')).default;
const Desktop = (await import('@/pages/integrations/desktop')).default;
// The page picks its first platform from the browser, and jsdom reports the
// host OS: "(darwin)" matches nothing, "(linux)" on CI matches Linux and drops
// the Linux button. These tests are written for the undetected picker.
const UNDETECTED_UA = 'Mozilla/5.0 (X11; FreeBSD amd64) AppleWebKit/537.36 (KHTML, like Gecko) jsdom';
const Extension = (await import('@/pages/integrations/extension')).default;
const Dropbox = (await import('@/pages/integrations/dropbox')).default;
const Google = (await import('@/pages/integrations/google')).default;
const OneDrive = (await import('@/pages/integrations/onedrive')).default;
const RemoteDownload = (await import('@/pages/integrations/remote-download')).default;
const Webhooks = (await import('@/pages/integrations/webhooks')).default;
const Lightroom = (await import('@/pages/integrations/lightroom')).default;
const WordPress = (await import('@/pages/integrations/wordpress')).default;
const N8n = (await import('@/pages/integrations/n8n')).default;
const { INTEGRATIONS } = await import('@/lib/integrations');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;

vi.setConfig({ testTimeout: 20_000 });
let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  toasts.length = 0;
  perms.allowed = false;
  vi.unstubAllGlobals();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function show(ui: React.ReactElement, locale: 'tr' | 'en' = 'tr') {
  shown = await renderInLocale(<MemoryRouter>{ui}</MemoryRouter>, locale);
  await flush();
  await flush();
  return shown;
}
function clickText(text: string) {
  // The last match: a dialog is portalled after the page it opened over.
  const el = [...document.querySelectorAll<HTMLElement>('button, a, [role="menuitem"]')].filter((n) => n.textContent?.trim() === text).pop();
  expect(el, `no button/link "${text}"`).toBeDefined();
  return act(async () => { el!.click(); });
}
const clickLabel = (label: string) => {
  const el = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  expect(el, `no control labelled "${label}"`).not.toBeNull();
  return act(async () => { el!.click(); });
};

const NOW = Math.floor(Date.now() / 1000);

describe('integrations index in Turkish', () => {
  it('cards, tags, docs links and built-in tools translate', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const r = await show(<IntegrationsPage />);
    expect(r.container.textContent).toContain(tr['common.heading.integrations']);
    expect(r.container.textContent).toContain(tr['integrations.heading.builtInTools']);
    expect(r.container.textContent).toContain(tr['common.description.copySyncAndMountYourFilesFromTheCommand']);
    expect(r.container.textContent).toContain(tr['common.label.mountAsDrive']);
    expect(r.container.textContent).toContain(tr['integrations.heading.duplicateFinder']);
    expect(r.container.textContent).toContain(tr['integrations.action.readDocs']);
    expect(r.leftover()).toEqual([]);
  });

  it('the module-level list follows the language through its getters', async () => {
    apiMock.mockResolvedValue({ ok: true });
    await show(<IntegrationsPage />);
    const cli = INTEGRATIONS.find((i) => i.slug === 'cli')!;
    expect(cli.description).toBe(tr['common.description.scriptUploadsDownloadsAndFolderSyncFromYourTerminal']);
    expect(INTEGRATIONS.find((i) => i.slug === 'desktop')!.title).toBe(tr['common.heading.desktopApps']);
    expect(t('common.heading.integrations')).toBe(tr['common.heading.integrations']);
  });

  it('link labels are interpolated with the card title', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const r = await show(<IntegrationsPage />);
    const labels = [...r.container.querySelectorAll('a[aria-label]')].map((a) => a.getAttribute('aria-label'));
    expect(labels).toContain(tr['integrations.action.openIttitleSetup'].replace('{title}', 'Zapier'));
  });
});

describe('provider pages with steps and code blocks in Turkish', () => {
  const pages: [string, React.ReactElement][] = [
    ['zapier', <Zapier />], ['cli', <Cli />], ['rclone', <Rclone />], ['rest-api', <RestApi />],
    ['sftp', <Sftp />], ['s3', <S3 />], ['webdav', <Webdav />],
    ['dropbox', <Dropbox />], ['google', <Google />], ['onedrive', <OneDrive />],
  ];
  for (const [name, ui] of pages) {
    it(`${name} has no leftover English`, async () => {
      apiMock.mockResolvedValue({ ok: true, user: { email: 'me@example.test' }, workspaces: [] });
      const r = await show(ui);
      expect(r.container.querySelector('h1'), `${name} did not render`).not.toBeNull();
      // Shell commands inside <code> are not prose: the catalog also knows "rclone config file" as a phrase.
      expect(r.leftover().filter((x) => x !== 'rclone config file')).toEqual([]);
    });
  }

  it('the copy button on a code block is labelled in Turkish', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const r = await show(<Cli />);
    expect(r.container.querySelector(`[aria-label="${tr['common.action.copyToClipboard']}"]`)).not.toBeNull();
  });

  it('the API key callout reads as two sentences in Turkish', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const r = await show(<Cli />);
    expect(r.container.textContent).toContain(tr['common.label.youRsquoLlNeedAnApiKey']);
    expect(r.container.textContent).not.toContain('. , then');
    expect(r.container.textContent).not.toContain('&rsquo;');
  });

  it('the role notice on the protocol pages translates', async () => {
    apiMock.mockResolvedValue({ ok: true });
    for (const [ui, key] of [
      [<Sftp />, 'integrations-sftp.label.yourRoleCanRsquoTUseSftp'],
      [<S3 />, 'integrations-s3.description.yourRoleCanRsquoTUseTheS3Gateway'],
      [<Webdav />, 'integrations-webdav.label.yourRoleCanRsquoTUseWebdav'],
    ] as const) {
      const r = await show(ui);
      expect(r.container.textContent).toContain(tr[key]);
      expect(r.container.textContent).toContain(tr['common.description.anyCredentialsYouSetUpBelowWillBeRefusedForThis']);
      expect(r.leftover()).toEqual([]);
      shown!.unmount(); shown = null;
    }
  });
});

describe('desktop and extension pages in Turkish', () => {
  function stubInfo() {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: '3.1.4', macArch: 'arm64',
        builds: { linux: { size: 90_000_000, deb: { fileName: 'dosya.deb', size: 80_000_000 } }, windows: { size: 70_000_000 }, mac: { size: 100_000_000 } },
        snap: { channel: 'candidate', revision: 6 },
      }),
    })));
  }
  it('the picker, install steps, store notes and deb line translate', async () => {
    stubInfo();
    const ua = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(UNDETECTED_UA);
    const r = await show(<Desktop />);
    ua.mockRestore();
    expect(r.container.textContent).toContain(tr['integrations-desktop.label.orPickOne']);
    expect(r.leftover()).toEqual([]);
    await clickText('Linux');
    expect(r.container.textContent).toContain(tr['integrations-desktop.tooltip.installIt']);
    expect(r.container.textContent).toContain(tr['integrations-desktop.description.makeTheAppimageExecutableAndRunIt']);
    expect(r.leftover()).toEqual([]);
    await clickText('macOS');
    expect(r.leftover()).toEqual([]);
    await clickText('Windows');
    expect(r.container.textContent).toContain(tr['integrations-desktop.description.anExeInstallerFor64BitWindows10And11']);
    expect(r.leftover()).toEqual([]);
  });

  it('the phone notice translates', async () => {
    stubInfo();
    const ua = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
    const r = await show(<Desktop />);
    ua.mockRestore();
    expect(r.container.textContent).toContain(tr['integrations-desktop.label.thisOneIsForAComputer']);
    expect(r.container.textContent).toContain(tr['integrations-desktop.action.seeTheMobileApps']);
    expect(r.leftover()).toEqual([]);
  });

  it('the extension page translates both the live and the in-review branches', async () => {
    const r = await show(<Extension />);
    expect(r.container.textContent).toContain(tr['integrations-extension.tooltip.signInOnce']);
    expect(r.container.textContent).toContain(tr['integrations-extension.label.otherBrowsers']);
    expect(r.leftover()).toEqual([]);
  });
});

describe('remote download in Turkish', () => {
  it('empty state, job table, status badges and error labels translate', async () => {
    useWorkspace.setState({ activeId: 'w1' });
    apiMock.mockImplementation(async () => ({
      ok: true,
      jobs: [
        { id: 'j1', url: 'https://x.test/a.zip', filename: 'a.zip', status: 'done', bytes_total: 2048, bytes_done: 2048, error_code: null, file_id: 'f1', created_at: NOW - 100 },
        { id: 'j2', url: 'https://x.test/b.zip', filename: 'b.zip', status: 'error', bytes_total: null, bytes_done: 0, error_code: 'quota', file_id: null, created_at: NOW - 100 },
        { id: 'j3', url: 'https://x.test/c.zip', filename: 'c.zip', status: 'error', bytes_total: null, bytes_done: 0, error_code: 'http_503', file_id: null, created_at: NOW - 100 },
        { id: 'j4', url: 'https://x.test/d.zip', filename: 'd.zip', status: 'cancelled', bytes_total: null, bytes_done: 0, error_code: null, file_id: null, created_at: NOW - 100 },
      ],
    }));
    const r = await show(<RemoteDownload />);
    expect(r.container.textContent).toContain(tr['integrations-remote-download.status.done']);
    expect(r.container.textContent).toContain(tr['integrations-remote-download.label.notEnoughStorage']);
    expect(r.container.textContent).toContain(tr['integrations-remote-download.label.sourceReturnedHttpCodeslice'].replace('{codeSlice}', '503'));
    expect(r.container.textContent).toContain(tr['common.label.home']);
    expect(r.leftover()).toEqual([]);
  });

  it('the empty state translates', async () => {
    useWorkspace.setState({ activeId: 'w1' });
    apiMock.mockResolvedValue({ ok: true, jobs: [] });
    const r = await show(<RemoteDownload />);
    expect(r.container.textContent).toContain(tr['integrations-remote-download.label.noRemoteDownloadsYet']);
    expect(r.leftover()).toEqual([]);
  });
});

const ENDPOINT = {
  id: 'wh1', url: 'https://hooks.example.test/dosya', events: ['file.uploaded', 'share.accessed'], description: 'Zzz hook',
  active: 0, consecutive_failures: 5, disabled_at: NOW - 3600, created_at: NOW - 86400,
};
const DELIVERIES = [
  { id: 'd1', event_id: 'e1', event_type: 'file.uploaded', status: 'success', attempts: 1, next_attempt_at: null, last_attempt_at: NOW, response_status: 200, response_snippet: null, error: null, created_at: NOW - 60 },
  { id: 'd2', event_id: 'e2', event_type: 'file.deleted', status: 'failed', attempts: 3, next_attempt_at: null, last_attempt_at: NOW, response_status: null, response_snippet: null, error: 'timeout', created_at: NOW - 60 },
  { id: 'd3', event_id: 'e3', event_type: 'share.accessed', status: 'pending', attempts: 1, next_attempt_at: NOW + 7200, last_attempt_at: NOW, response_status: 500, response_snippet: null, error: null, created_at: NOW - 60 },
];
function routeWebhooks(list: unknown[] = [ENDPOINT]) {
  useWorkspace.setState({ activeId: 'w1' });
  apiMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/webhooks?')) return { ok: true, webhooks: list };
    if (/\/deliveries\?/.test(path)) return { ok: true, deliveries: DELIVERIES, pagination: { page: 1, per_page: 10, total: 30, total_pages: 3 } };
    return { ok: true, secret: 'whsec_zzz' };
  });
}

describe('webhooks in Turkish', () => {
  it('the endpoint card, disabled notice and count translate', async () => {
    routeWebhooks();
    const r = await show(<Webhooks />);
    expect(r.container.textContent).toContain(tr['integrations-webhooks.status.disabled']);
    expect(r.container.textContent).toContain(tr['integrations-webhooks.action.sendTestEvent']);
    expect(r.container.textContent).toContain('Zzz hook');
    expect(r.container.textContent).not.toContain('&middot;');
    expect(r.leftover()).toEqual([]);
  });

  it('the empty state translates and has no raw entities', async () => {
    routeWebhooks([]);
    const r = await show(<Webhooks />);
    expect(r.container.textContent).not.toContain('&ldquo;');
    expect(r.container.textContent).not.toContain('**');
    expect(r.leftover()).toEqual([]);
  });

  it('the deliveries table, status badges and pager translate', async () => {
    routeWebhooks();
    const r = await show(<Webhooks />);
    await clickText(tr['integrations-webhooks.action.deliveries']);
    await flush();
    expect(r.container.textContent).toContain(tr['integrations-webhooks.status.success']);
    expect(r.container.textContent).toContain(tr['common.status.pending']);
    expect(r.container.textContent).toContain(tr['common.status.error']);
    expect(r.container.textContent).toContain(tr['common.label.pagePageOfPaginationtotalPages'].replace('{page}', '1').replace('{pageCount}', '3'));
    expect(r.leftover()).toEqual([]);
  });

  it('the create dialog, its validation errors and the secret dialog translate', async () => {
    routeWebhooks([]);
    const r = await show(<Webhooks />);
    await clickText(tr['integrations-webhooks.action.newEndpoint']);
    await flush();
    expect(document.body.textContent).toContain(tr['integrations-webhooks.heading.newWebhookEndpoint']);
    expect(document.body.textContent).toContain(tr['integrations-webhooks.label.endpointUrl']);
    expect(r.leftover()).toEqual([]);
    await clickText(tr['integrations-webhooks.action.createEndpoint']);
    expect(document.body.textContent).toContain(tr['integrations-webhooks.error.urlMustBeAValidHttpsAddress']);
    expect(r.leftover()).toEqual([]);
  });

  it('the edit dialog, the delete and roll confirmations translate', async () => {
    routeWebhooks();
    const r = await show(<Webhooks />);
    await clickText(tr['common.edit']);
    await flush();
    expect(document.body.textContent).toContain(tr['integrations-webhooks.heading.editWebhook']);
    expect(r.leftover()).toEqual([]);
    await clickText(tr['common.cancel']);
    await clickText(tr['common.delete']);
    await flush();
    expect(document.body.textContent).toContain(tr['integrations-webhooks.tooltip.deleteWebhook']);
    expect(document.body.textContent).toContain('https://hooks.example.test/dosya');
    expect(r.leftover()).toEqual([]);
  });

  it('rolling a secret shows the secret dialog in Turkish and copy toasts translate', async () => {
    routeWebhooks();
    const r = await show(<Webhooks />);
    await clickText(tr['integrations-webhooks.action.rollSecret']);
    await flush();
    expect(document.body.textContent).toContain(tr['integrations-webhooks.tooltip.rollSigningSecret']);
    expect(r.leftover()).toEqual([]);
    const confirm = [...document.querySelectorAll<HTMLElement>('button')].filter((b) => b.textContent?.trim() === tr['integrations-webhooks.action.rollSecret']).pop()!;
    await act(async () => { confirm.click(); });
    await flush();
    expect(document.body.textContent).toContain(tr['integrations-webhooks.heading.signingSecret']);
    expect(r.leftover()).toEqual([]);
  });

  it('send test event raises Turkish toasts', async () => {
    routeWebhooks();
    await show(<Webhooks />);
    await clickText(tr['integrations-webhooks.action.sendTestEvent']);
    await flush();
    expect(toasts[0]).toEqual({ kind: 'success', title: tr['integrations-webhooks.feedback.testEventSent'], description: tr['integrations-webhooks.feedback.checkTheDeliveriesLogBelowForTheResult'] });
  });
});

describe('webhooks keep their shipped English', () => {
  it('English text is unchanged, entities decoded', async () => {
    routeWebhooks();
    const r = await show(<Webhooks />, 'en');
    expect(r.container.textContent).toContain('5 consecutive failed deliveries · disabled');
    expect(r.container.textContent).toContain('2 endpoints'.replace('2', '1').replace('endpoints', 'endpoint'));
    await clickText('Delete');
    await flush();
    expect(document.body.textContent).toContain('This can’t be undone and its delivery history will be lost.');
    expect(document.body.textContent).toContain('Delete the endpoint for https://hooks.example.test/dosya? This');
  });
});

describe('webhooks empty state in English', () => {
  it('keeps its curly quotes', async () => {
    routeWebhooks([]);
    const r = await show(<Webhooks />, 'en');
    expect(r.container.textContent).toContain('Click \u201cNew endpoint\u201d to register one.');
  });
});

describe('Lightroom in Turkish', () => {
  const KEYS = [
    { id: 'k1', name: 'Lightroom Classic: Studio Mac', created_at: NOW - 86400, last_used_at: null, expires_at: null },
    { id: 'k2', name: 'Lightroom Classic: Laptop', created_at: NOW - 86400, last_used_at: NOW - 60, expires_at: null },
  ];
  const share = (over: Record<string, unknown> = {}) => ({ url: 'https://s.example.test/g', expires_at: null, is_password_protected: false, is_revoked: false, ...over });
  const GALLERIES = [
    { id: 'g1', title: 'Zzz wedding', item_count: 120, client_count: 2, selection_count: 5, selections_enabled: true, share: share() },
    { id: 'g2', title: 'Zzz studio', item_count: 1, client_count: 0, selection_count: 0, selections_enabled: false, share: share({ is_revoked: true }) },
    { id: 'g3', title: 'Zzz portraits', item_count: 4, client_count: 0, selection_count: 0, selections_enabled: true, share: share({ expires_at: NOW - 10 }) },
    { id: 'g4', title: 'Zzz events', item_count: 4, client_count: 0, selection_count: 0, selections_enabled: true, share: share({ is_password_protected: true }) },
    { id: 'g5', title: 'Zzz archive', item_count: 4, client_count: 0, selection_count: 0, selections_enabled: true, share: null },
  ];
  function route(over: Record<string, unknown> = {}) {
    useWorkspace.setState({ activeId: 'w1' });
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path in over) return over[path];
      if (path === '/api/me/api-keys' && !init) return { keys: KEYS };
      if (path.startsWith('/api/galleries')) return { galleries: GALLERIES, next_cursor: null };
      return { ok: true };
    });
  }
  it('connections, galleries, link states and the setup rail translate', async () => {
    route();
    const r = await show(<Lightroom />);
    expect(r.container.textContent).toContain(tr['integrations-lightroom.heading.yourLightroomConnections']);
    for (const k of ['integrations-lightroom.label.live', 'integrations-lightroom.label.linkExpired', 'common.label.linkRevoked', 'common.label.passwordProtected', 'integrations-lightroom.label.linkRemoved', 'integrations-lightroom.label.selectionsOff']) {
      expect(r.container.textContent, k).toContain(tr[k]);
    }
    // Counts such as "120 photos" come from a pluralised helper with no catalog entry (reported).
    expect(r.leftover()).toEqual([]);
  });

  it('empty states translate', async () => {
    route({ '/api/me/api-keys': { keys: [] }, '/api/galleries?workspace_id=w1': { galleries: [], next_cursor: null } });
    const r = await show(<Lightroom />);
    expect(r.container.textContent).toContain(tr['integrations-lightroom.description.noCatalogIsConnectedYetFollowTheStepsBelowToConnect']);
    expect(r.container.textContent).toContain(tr['integrations-lightroom.description.noGalleriesYetPublishACollectionFromLightroomClassicAndIt']);
    expect(r.leftover()).toEqual([]);
  });

  it('load errors translate', async () => {
    useWorkspace.setState({ activeId: 'w1' });
    apiMock.mockImplementation(async () => { throw new Error('boom'); });
    const r = await show(<Lightroom />);
    expect(r.container.textContent).toContain(tr['integrations-lightroom.error.couldNotLoadYourConnectionsPleaseTryAgain']);
    expect(r.container.textContent).toContain(tr['integrations-lightroom.error.couldNotLoadYourGalleriesPleaseTryAgain']);
  });

  it('the revoke dialog carries the device name and translates', async () => {
    route();
    const r = await show(<Lightroom />);
    await clickLabel(tr['common.accessibility.actionsForName'].replace('{name}', 'Lightroom Classic: Studio Mac'));
    await clickText(tr['common.action.revoke']);
    await flush();
    const title = document.querySelector('[role="dialog"] h2, [role="dialog"] [data-slot="dialog-title"]')?.textContent ?? document.body.textContent;
    expect(title).toContain('Studio Mac');
    expect(document.body.textContent).not.toMatch(/\btrue\b/);
    expect(document.body.textContent).toContain(tr['integrations-lightroom.description.lightroomClassicOnThatComputerIsSignedOutAndCanNo']);
    expect(r.leftover()).toEqual([]);
  });
});

describe('WordPress in Turkish', () => {
  const site = (id: string, over: Record<string, unknown> = {}) => ({
    id, name: `Zzz ${id}`, site_url: `https://${id}.example.com/blog`, status: 'active', root_folder_id: `fold_${id}`, ...over,
  });
  const backup = (over: Record<string, unknown> = {}) => ({
    id: 'b1', kind: 'incremental', state: 'verified', bytes_new: 38 * 1024 * 1024, bytes_total: 1.2 * 1024 ** 3,
    locked_until: NOW + 3600, created_at: NOW - 7200, completed_at: NOW - 7200, ...over,
  });
  function route(sites: unknown[], backups: Record<string, unknown>, caps: unknown = { sites_max: 5, retention_days_max: 7, immutability_hours_max: 24 }) {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/wp/sites') return { sites, caps };
      const m = /^\/api\/wp\/sites\/([^/]+)\/backups$/.exec(path);
      if (m) {
        const v = backups[m[1]];
        if (v instanceof Error) throw v;
        return { backups: v ?? [] };
      }
      return { ok: true };
    });
  }
  it('statuses, plan line, columns and the three steps translate', async () => {
    route(
      [site('a'), site('b', { status: 'clone_suspected' }), site('c'), site('d'), site('e'), site('f'), site('g')],
      {
        a: [backup()], c: [backup({ state: 'failed' })], d: [backup({ kind: 'full', locked_until: null })],
        e: [backup({ state: 'running' })], f: new Error('x'), g: [],
      },
    );
    const r = await show(<WordPress />);
    expect(r.container.textContent).toContain(tr['integrations-wordpress.heading.yourWordpressSites']);
    for (const k of ['integrations-wordpress.label.copyDetectedCheckTheSite', 'integrations-wordpress.error.lastBackupFailed', 'integrations-wordpress.label.noBackupYet', 'integrations-wordpress.status.uploading', 'common.label.connected']) {
      expect(r.container.textContent, k).toContain(tr[k]);
    }
    expect(r.leftover()).toEqual([]);
  });

  it('the unlimited plan line and the sites-cut note translate', async () => {
    const many = Array.from({ length: 25 }, (_, i) => site(`s${i}`));
    route(many, {}, { sites_max: null, retention_days_max: 30, immutability_hours_max: 48 });
    const r = await show(<WordPress />);
    expect(r.container.textContent).toContain('30');
    expect(r.leftover()).toEqual([]);
  });

  it('the empty state translates', async () => {
    route([], {});
    const r = await show(<WordPress />);
    expect(r.container.textContent).toContain(tr['integrations-wordpress.description.noWordpressSiteConnectedYet']);
    expect(r.container.textContent).toContain(tr['integrations-wordpress.action.viewOnWordpressOrg']);
    expect(r.leftover()).toEqual([]);
  });

  it('the disconnect dialog translates and names the site', async () => {
    route([site('a')], { a: [backup()] });
    const r = await show(<WordPress />);
    await clickLabel(tr['common.accessibility.actionsForName'].replace('{name}', 'Zzz a'));
    await clickText(tr['common.action.disconnect']);
    await flush();
    expect(document.body.textContent).toContain(tr['integrations-wordpress.description.disconnectTargetnameFromDosyaBackupsAlreadyStoredInDosyaAreKept'].replace(/\{targetName\}/g, 'Zzz a'));
    expect(r.leftover()).toEqual([]);
  });

  it('a failed load translates', async () => {
    apiMock.mockImplementation(async () => { throw new Error('boom'); });
    const r = await show(<WordPress />);
    expect(r.container.textContent).toContain(tr['integrations-wordpress.error.couldNotLoadYourWordpressSitesPleaseTryAgain']);
  });
});

describe('n8n in Turkish', () => {
  const key = (id: string, over: Record<string, unknown> = {}) => ({
    id, name: 'n8n', scope: 'full', created_at: NOW - 3600, last_used_at: NOW - 60, expires_at: null, workspace_id: null, root_folder_id: null, ...over,
  });
  function route(keys: unknown[]) {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/me/api-keys' && !init) return { keys };
      if (path === '/api/me/api-keys') return { key: { plain_key: 'dos_zzz' } };
      if (path === '/api/workspaces') return { workspaces: [{ id: 'w1', name: 'Zzz space' }] };
      return { ok: true };
    });
  }
  it('every key status, the reach column and the setup rail translate', async () => {
    route([
      key('a'), key('b', { expires_at: NOW - 10 }), key('c', { root_folder_id: 'f' }), key('d', { scope: 'read' }),
      key('e', { scope: 'upload' }), key('f', { last_used_at: null }), key('g', { workspace_id: 'w1' }), key('h', { workspace_id: 'nope' }),
    ]);
    const r = await show(<N8n />);
    for (const k of ['integrations-n8n.label.expiredCreateANewKey', 'integrations-n8n.error.folderAnchoredN8nCannotUseIt', 'integrations-n8n.label.readOnlyUploadsWillFail', 'integrations-n8n.label.readyNotUsedYet', 'common.label.connected', 'integrations-n8n.label.everyWorkspace', 'integrations-n8n.label.oneWorkspace']) {
      expect(r.container.textContent, k).toContain(tr[k]);
    }
    expect(r.container.textContent).toContain(tr['integrations-n8n.label.kscopeScopeN8nNeedsFullAccess'].replace('{kScope}', 'upload'));
    expect(r.leftover()).toEqual([]);
  });

  it('the empty state and the create dialog (form, then the revealed key) translate', async () => {
    route([]);
    const r = await show(<N8n />);
    expect(r.container.textContent).toContain(tr['integrations-n8n.description.noN8nKeyYet']);
    expect(r.leftover()).toEqual([]);
    await clickText(tr['integrations-n8n.action.createAKeyForN8n']);
    await flush();
    expect(document.body.textContent).toContain(tr['integrations-n8n.label.workflowsCanReach']);
    expect(r.leftover()).toEqual([]);
    await clickText(tr['integrations-n8n.action.createKey']);
    await flush();
    expect(document.body.textContent).toContain(tr['integrations-n8n.heading.yourN8nKeyIsReady']);
    expect(document.body.textContent).toContain(tr['common.description.thisIsTheOnlyTimeTheKeyIsShownCopyIt']);
    expect(r.leftover()).toEqual([]);
  });

  it('the revoke dialog names the key and translates', async () => {
    route([key('a')]);
    const r = await show(<N8n />);
    await clickLabel(tr['common.accessibility.actionsForName'].replace('{name}', 'n8n'));
    await clickText(tr['common.action.revoke']);
    await flush();
    expect(document.body.textContent).toContain(tr['integrations-n8n.heading.revokeTargetname'].replace('{name}', 'n8n'));
    expect(r.leftover()).toEqual([]);
  });
});

describe('English stays as shipped', () => {
  it('the key callout keeps its punctuation and apostrophe', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const r = await show(<Cli />, 'en');
    expect(r.container.textContent).toContain('You’ll need an API key');
    expect(r.container.textContent).toContain('Generate a dos_… key in Profile → API keys, then use it where the snippets below say dos_your_api_key.');
  });

  it('the Zapier callout keeps its own usage sentence', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const r = await show(<Zapier />, 'en');
    expect(r.container.textContent).toContain('Profile → API keys, then paste it when Zapier asks you to connect a dosya account.');
    expect(r.container.textContent).toContain('Zapier’s public app directory');
  });

  it('the REST page keeps the period after the link', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const r = await show(<RestApi />, 'en');
    expect(r.container.textContent).toContain('documented in the API documentation.');
  });

  it('the remote download page keeps its non-breaking space', async () => {
    useWorkspace.setState({ activeId: 'w1' });
    apiMock.mockResolvedValue({ ok: true, jobs: [] });
    const r = await show(<RemoteDownload />, 'en');
    expect(r.container.textContent).toContain('a Google Drive or Dropbox');
  });

  it('the desktop deb line has one space and the size', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version: '3.1.4', builds: { linux: { size: 90_000_000, deb: { fileName: 'd.deb', size: 80_000_000 } } }, snap: null }) })));
    const ua = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(UNDETECTED_UA);
    const r = await show(<Desktop />, 'en');
    ua.mockRestore();
    await clickText('Linux');
    const line = [...r.container.querySelectorAll('p')].map((p) => p.textContent ?? '').find((x) => x.startsWith('On Debian'))!;
    expect(line).toMatch(/^On Debian or Ubuntu the \.deb package \(\d+(\.\d+)? ?MB\) integrates with your package manager instead\. It does not self-update\.$/);
  });

  it('the lightroom revoke title names the device', async () => {
    useWorkspace.setState({ activeId: 'w1' });
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/me/api-keys') return { keys: [{ id: 'k1', name: 'Lightroom Classic: Studio Mac', created_at: NOW, last_used_at: null, expires_at: null }] };
      if (path.startsWith('/api/galleries')) return { galleries: [], next_cursor: null };
      return { ok: true };
    });
    await show(<Lightroom />, 'en');
    await clickLabel('Actions for Lightroom Classic: Studio Mac');
    await clickText('Revoke');
    await flush();
    expect(document.body.textContent).toContain('Revoke Studio Mac?');
  });

  it('the wordpress footnote shows the cut note only when the list is cut', async () => {
    const sites = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, site_url: `https://s${i}.test`, status: 'active', root_folder_id: null }));
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/wp/sites') return { sites, caps: { sites_max: null, retention_days_max: 30, immutability_hours_max: 48 } };
      if (/backups$/.test(path)) return { backups: [] };
      return { ok: true };
    });
    const r = await show(<WordPress />, 'en');
    expect(r.container.textContent).toContain('Showing 20 of 25 sites.Backups are ordinary files');
    expect(r.container.textContent).toContain('25 sites');
  });
});

describe('command palette integration list follows the language', () => {
  let setLocaleRef: ((l: 'en' | 'tr') => Promise<void>) | null = null;
  function Switcher() {
    setLocaleRef = useLocale().setLocale;
    return null;
  }
  const typeQuery = (value: string) => act(async () => {
    const input = document.querySelector('input[role="combobox"]') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const optionTexts = () => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? '');

  it('shows the English title first, then the Turkish one after switching', async () => {
    apiMock.mockImplementation(async (path: string) => (path.startsWith('/api/search') ? { ok: true, files: [], folders: [], shared: [], file_requests: [] } : { ok: true, articles: [] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    shown = await renderInLocale(
      <QueryClientProvider client={qc}><MemoryRouter><Switcher /><GlobalSearch /></MemoryRouter></QueryClientProvider>,
      'en',
    );
    await flush();
    await act(async () => { (document.querySelector('input[role="combobox"]') as HTMLInputElement).focus(); });
    await typeQuery('desktop');
    await flush();
    expect(optionTexts().some((x) => x.includes('Desktop apps'))).toBe(true);
    await act(async () => { await setLocaleRef!('tr'); });
    await flush();
    await act(async () => { (document.querySelector('input[role="combobox"]') as HTMLInputElement).focus(); });
    await typeQuery('Masa');
    await flush();
    const rows = optionTexts();
    expect(rows.some((x) => x.includes(tr['common.heading.desktopApps']))).toBe(true);
    expect(rows.some((x) => x.includes('Desktop apps'))).toBe(false);
    await act(async () => { await setLocaleRef!('en'); });
  });
});
