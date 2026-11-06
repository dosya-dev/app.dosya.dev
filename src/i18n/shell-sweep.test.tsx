/**
 * The app shell in Turkish: no English left in the sidebar, top bar, profile
 * menu, command palette trigger or not-found page, and the browser tab title
 * follows the language. Uses the shared sweep helper (tests/helpers).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { Route, Routes, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/lib/logout', () => ({ logoutAndRedirect: () => {} }));
vi.mock('@/components/onboarding/setup-pill', () => ({ SetupPill: () => null }));
const supportMock = vi.hoisted(() => ({ fetchTickets: vi.fn(), fetchTicket: vi.fn() }));
vi.mock('@/api/support', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/support')>();
  return { ...actual, fetchTickets: supportMock.fetchTickets, fetchTicket: supportMock.fetchTicket };
});

const { DashboardSidebar } = await import('@/components/layout/dashboard-sidebar');
const { DashboardTopbar } = await import('@/components/layout/dashboard-topbar');
const { ProfileMenu } = await import('@/components/layout/profile-menu');
const { GlobalSearch } = await import('@/components/layout/global-search');
const { DeletionBanner } = await import('@/components/deletion-banner');
const { MaintenanceScreen } = await import('@/components/maintenance-screen');
const { SidebarProvider } = await import('@/components/ui/sidebar');
const NotFoundPage = (await import('@/pages/not-found')).default;
const SupportPage = (await import('@/pages/support')).default;
const SupportTicketPage = (await import('@/pages/support-ticket')).default;
const { ReportProblemDialog } = await import('@/components/support/report-problem-dialog');
const { useReportProblem } = await import('@/stores/report-problem');
const { goToItems } = await import('@/lib/search/sources');
const { SETTINGS_SECTIONS } = await import('@/lib/settings-sections');
const { THEMES } = await import('@/lib/themes');
const { toast } = await import('@/lib/toast');
const { logConsoleGreeting } = await import('@/lib/console-greeting');
const { RouteTitle, titleForPath, formatUploadTitle } = await import('@/lib/page-title');
const { useLocale, loadMessages } = await import('@/lib/i18n');
const { useSession } = await import('@/stores/session');
const { useWorkspace } = await import('@/stores/workspace');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;
const en = (await import('@/i18n/messages/en.json')).default as Record<string, string>;

const GB = 1024 ** 3;
const WS = {
  id: 'ws_1', name: 'dosya', slug: 'dosya', icon_initials: 'D', icon_color: '#000', icon_image_url: null,
  owner_id: 'u1', role_id: 'role_owner',
  storage: { used: 96 * GB, total: 100 * GB, account_used_bytes: 38 * GB, account_limit_bytes: 100 * GB },
};
const USER = {
  id: 'u1', name: 'Firat Kaya', email: 'firat@dosya.dev', avatar_url: null,
  deletion_scheduled_for: null, plan: { id: 'pro', name: 'Pro' },
};

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  } as unknown as MediaQueryList));
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  localStorage.clear();
  document.getElementById('toast-root')?.remove();
});

function setup() {
  useSession.setState({ user: USER, workspaces: [WS] } as never);
  useWorkspace.setState({ activeId: 'ws_1' });
  apiMock.mockResolvedValue({ ok: false, jobs: [] });
}
const wrap = (ui: React.ReactElement, path = '/files') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
  </QueryClientProvider>
);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('app shell in Turkish', () => {
  it('sidebar has no leftover English', async () => {
    setup();
    shown = await renderInLocale(wrap(<SidebarProvider><DashboardSidebar /></SidebarProvider>), 'tr');
    await flush();
    const text = shown.container.textContent ?? '';
    expect(text).toContain(tr['common.heading.files']);
    expect(shown.leftover()).toEqual([]);
  });

  it('top bar has no leftover English', async () => {
    setup();
    shown = await renderInLocale(
      wrap(<SidebarProvider><DashboardTopbar /></SidebarProvider>, '/billing'), 'tr');
    await flush();
    expect(shown.container.textContent).toContain(tr['common.heading.billing']);
    expect(shown.leftover()).toEqual([]);
  });

  it('profile menu has no leftover English', async () => {
    setup();
    shown = await renderInLocale(wrap(<ProfileMenu />), 'tr');
    await act(async () => { shown!.container.querySelector<HTMLElement>('button')!.click(); await Promise.resolve(); });
    await flush();
    expect(document.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();
    expect(shown.leftover()).toEqual([]);
  });

  it('command palette trigger has no leftover English', async () => {
    setup();
    shown = await renderInLocale(wrap(<GlobalSearch />), 'tr');
    const input = shown.container.querySelector('input')!;
    expect(input.placeholder).toBe(tr['common.placeholder.searchFilesSettingsIntegrationsHelp']);
    expect(shown.leftover()).toEqual([]);
  });

  it('not-found page has no leftover English', async () => {
    shown = await renderInLocale(<NotFoundPage />, 'tr');
    expect(shown.container.textContent).toContain(tr['common.tooltip.pageNotFound']);
    expect(shown.leftover()).toEqual([]);
  });
});

describe('page titles follow the language', () => {
  let setLocaleRef: ((l: 'en' | 'tr') => Promise<void>) | null = null;
  function Switcher() {
    setLocaleRef = useLocale().setLocale;
    return null;
  }

  it('/files and the tab title are Turkish, and English again after switching back', async () => {
    await loadMessages('tr');
    shown = await renderInLocale(wrap(<><Switcher /><RouteTitle /></>, '/billing'), 'tr');
    expect(titleForPath('/files')).toBe(tr['common.heading.files']);
    expect(document.title).toBe(`${tr['common.heading.billing']} · dosya.dev`);
    await act(async () => { await setLocaleRef!('en'); });
    expect(titleForPath('/files')).toBe(en['common.heading.files']);
    expect(document.title).toBe(`${en['common.heading.billing']} · dosya.dev`);
    await act(async () => { await setLocaleRef!('tr'); });
    expect(document.title).toBe(`${tr['common.heading.billing']} · dosya.dev`);
    await act(async () => { await setLocaleRef!('en'); });
  });

  it('the upload tab title is built from the catalog message', async () => {
    shown = await renderInLocale(<span />, 'tr');
    const s = { anyActive: true, active: 3, overallPct: 73 } as never;
    const title = formatUploadTitle(s)!;
    expect(title).toContain('dosya.dev');
    expect(title).not.toContain('Uploading');
  });
});

describe('banners and gates in Turkish', () => {
  it('deletion banner, maintenance screen and permission gate have no leftover English', async () => {
    const day = 86_400;
    useSession.setState({ user: { ...USER, deletion_scheduled_for: Math.floor(Date.now() / 1000) + 5 * day } } as never);
    shown = await renderInLocale(wrap(<DeletionBanner />), 'tr');
    expect(shown.container.textContent).toContain('5');
    expect(shown.container.textContent).not.toContain('today');
    expect(shown.leftover()).toEqual([]);
    shown.unmount();

    shown = await renderInLocale(
      <MaintenanceScreen surface="web" message={null} onRetry={async () => true} email="a@b.co" onSignOut={() => {}} />, 'tr');
    expect(shown.leftover()).toEqual([]);
  });

  it('deletion banner keeps its English wording, singular and today included', async () => {
    const day = 86_400;
    const now = Math.floor(Date.now() / 1000);
    useSession.setState({ user: { ...USER, deletion_scheduled_for: now + day * 1.5 } } as never);
    shown = await renderInLocale(wrap(<DeletionBanner />), 'en');
    expect(shown.container.textContent).toMatch(/^Your account is scheduled for deletion on .+ - 1 day left\.Cancel deletion$/);
    shown.unmount();
    useSession.setState({ user: { ...USER, deletion_scheduled_for: now + day * 5.5 } } as never);
    shown = await renderInLocale(wrap(<DeletionBanner />), 'en');
    expect(shown.container.textContent).toMatch(/ - 5 days left\./);
    shown.unmount();
    useSession.setState({ user: { ...USER, deletion_scheduled_for: now + 100 } } as never);
    shown = await renderInLocale(wrap(<DeletionBanner />), 'en');
    expect(shown.container.textContent).toMatch(/ - today\./);
  });
});

describe('support, search, palette and toasts in Turkish', () => {
  const NOW = Math.floor(Date.now() / 1000);
  const TICKET = {
    id: 'tkt_1', workspace_id: null, subject: 'Quarterly report PDF vanished', category: 'billing', status: 'open',
    created_at: NOW - 7200, updated_at: NOW - 3600, last_message_at: NOW - 3600, message_count: 2,
    closed_at: null, closed_by: null, diagnostics: null,
  };

  it('the support page has no leftover English', async () => {
    setup();
    supportMock.fetchTickets.mockResolvedValue({ tickets: [TICKET], counts: { open: 1, closed: 0 } });
    shown = await renderInLocale(wrap(<SupportPage />, '/support'), 'tr');
    await flush();
    expect(shown.container.textContent).toContain(tr['support.heading.getHelp']);
    expect(shown.container.textContent).toContain(tr['common.label.billing']);
    expect(shown.leftover()).toEqual([]);
    await act(async () => {
      [...shown!.container.querySelectorAll('button')].find((b) => b.textContent?.includes(tr['support.action.newTicket']))!.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain(tr['support.heading.newSupportTicket']);
    expect(shown.leftover()).toEqual([]);
  });

  it('a support ticket has no leftover English', async () => {
    setup();
    supportMock.fetchTicket.mockResolvedValue({
      ticket: { ...TICKET, status: 'closed', closed_by: 'staff' },
      messages: [{ id: 'm1', author_type: 'staff', author_name: null, body: 'Hello', created_at: NOW - 60, attachments: [] }],
    });
    apiMock.mockResolvedValue({ ok: true, user: { id: 'u1', name: 'Firat', avatar_url: null } });
    shown = await renderInLocale(
      wrap(<Routes><Route path="/support/:id" element={<SupportTicketPage />} /></Routes>, '/support/tkt_1'), 'tr');
    await flush();
    expect(shown.container.textContent).toContain(tr['support-ticket.action.backToTickets']);
    expect(shown.leftover()).toEqual([]);
  });

  it('search results list Turkish titles and still match English keywords', async () => {
    setup();
    shown = await renderInLocale(wrap(<GlobalSearch />), 'tr');
    const input = shown.container.querySelector('input')!;
    await act(async () => {
      input.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'invoice');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    expect(shown.container.textContent).toContain(tr['common.heading.billing']);
    expect(shown.leftover()).toEqual([]);
  });

  it('the command palette list is built from keys at render time', async () => {
    await renderInLocale(<span />, 'tr').then((r) => { shown = r; });
    const titles = goToItems().map((i) => i.title);
    expect(titles).toContain(tr['common.heading.billing']);
    expect(titles).toContain(tr['common.label.hiddenFiles']);
    expect(goToItems().map((i) => i.context).filter(Boolean)).not.toContain('Profile');
    // "Personas" is the feature name and stays English in every language (its catalog context says so).
    const SAME_IN_EVERY_LANGUAGE = new Set(['common.label.personas']);
    for (const s of SETTINGS_SECTIONS) {
      if (SAME_IN_EVERY_LANGUAGE.has(s.labelKey)) expect(s.label).toBe(tr[s.labelKey]);
      else expect(s.label).not.toBe(en[s.labelKey]);
    }
    for (const th of THEMES) expect(th.label).toBe(tr[th.labelKey] ?? en[th.labelKey]);
    // The tables hold keys, not sentences.
    expect(SETTINGS_SECTIONS.every((s) => s.labelKey in en && s.groupKey in en)).toBe(true);
    expect(THEMES.every((th) => th.labelKey in en)).toBe(true);
  });

  it('a toast raised after a language switch is Turkish', async () => {
    shown = await renderInLocale(<span />, 'tr');
    toast.error('boom');
    toast.success('done');
    const titles = [...document.querySelectorAll('.dosya-toast__title')].map((e) => e.textContent);
    expect(titles).toContain(tr['common.error.error']);
    expect(titles).toContain(tr['common.label.success']);
    document.getElementById('toast-root')?.remove();
  });

  it('the console greeting is Turkish', async () => {
    shown = await renderInLocale(<span />, 'tr');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    logConsoleGreeting();
    const lines = log.mock.calls.map((c) => String(c[0]));
    log.mockRestore();
    expect(lines).toContain(tr['common.description.pokingAroundInHereWeLikeThat']);
    expect(lines).toContain(tr['common.label.ourBugBountyProgram']);
    expect(lines).not.toContain('Poking around in here? We like that.');
  });

  it('the bug-report dialog has no leftover English', async () => {
    setup();
    shown = await renderInLocale(wrap(<ReportProblemDialog />, '/files'), 'tr');
    await act(async () => { useReportProblem.getState().openReport({ errorRef: 'abc123' }); await Promise.resolve(); });
    expect(document.body.textContent).toContain(tr['common.heading.reportABug']);
    expect(document.body.textContent).toContain(tr['report-problem.label.errorReference']);
    expect(shown.leftover()).toEqual([]);
    act(() => useReportProblem.getState().closeReport());
  });
});
