/**
 * RTL core-screen sweep. The ten most string-heavy screens (files list, file
 * detail panel, share modal, activity, workspace settings, profile appearance,
 * billing, integrations index, Vault unlock gate, sign in) render in Arabic,
 * Hebrew and Persian with no leftover English, no physical-direction class and
 * no unflipped directional icon, with <html dir="rtl">. Each one then switches
 * to German: dir returns to ltr and the German text is in place.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Locale } from "@/i18n/locales";
import { physicalClassesIn, renderInLocale, unflippedIcons, type Rendered } from "../../tests/helpers/i18n-sweep";

const apiMock = vi.fn();
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, API_BASE: "", api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock("@/components/file-viewer", () => ({ FileViewer: () => <div />, default: () => <div /> }));
vi.mock("@/components/file-preview-image", () => ({ FilePreviewImage: ({ fileName }: { fileName: string }) => <img alt={fileName} /> }));
vi.mock("@/components/turnstile-widget", () => ({ TurnstileWidget: () => <div data-testid="turnstile" /> }));
vi.mock("@/components/onboarding/first-run-home", () => ({ FirstRunHome: () => null }));
vi.mock("@/lib/upload-runner", () => ({ cancelAll: () => {} }));
vi.mock("@/lib/logout", () => ({ logoutAndRedirect: () => {}, logoutAndRedirectTo: () => {} }));
const getBillingStatus = vi.fn();
vi.mock("@/api/family", () => ({
  getFamily: vi.fn().mockResolvedValue({ ok: true, role: "none", limit: 5, eligible: false, ineligible_reason: "free_plan", pool: { used_bytes: 0, limit_bytes: 1, used_label: "0 B", limit_label: "5 GB" }, plan: { id: "free", name: "Free" }, payer: null, members: [] }),
  inviteFamilyMember: vi.fn(), revokeFamilyInvite: vi.fn(), removeFamilyMember: vi.fn(), leaveFamily: vi.fn(),
  previewFamilyJoin: vi.fn(), acceptFamilyJoin: vi.fn(),
}));
vi.mock("@/api/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/billing")>();
  return { ...actual, getBillingStatus: () => getBillingStatus(), getCatalog: vi.fn().mockResolvedValue(null) };
});
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ can: () => false, isOwner: false, loading: false }),
}));
vi.mock("@/components/cloud-import/provider-picker-dialog", () => ({ ProviderPickerDialog: () => null }));
vi.mock("@/components/cloud-import/connected-accounts-card", () => ({ ConnectedAccountsCard: () => null }));
vi.mock("@/components/cloud-import/cloud-connect-notice", () => ({ CloudConnectNotice: () => null }));
vi.mock("@/components/cloud-import/import-progress-card", () => ({ ImportProgressCard: () => null }));
vi.mock("@/components/folder-picker-dialog", () => ({ FolderPickerDialog: () => null }));
vi.mock("@/stores/remote-downloads", () => ({ useRemoteDownloads: { getState: () => ({ refresh: () => {} }) } }));

const { ApiError } = await import("@/api/client");
const { useLocale } = await import("@/lib/i18n");
const { useWorkspace } = await import("@/stores/workspace");
const { useE2ee } = await import("@/stores/e2ee");
const { default: FilesPage } = await import("@/pages/files");
const { FileDetailPanel } = await import("@/components/file-detail-panel");
const { ShareModal, clearShareDefaultsCache } = await import("@/components/share-modal");
const { default: ActivityPage } = await import("@/pages/activity");
const { default: SettingsPage } = await import("@/pages/settings");
const { default: ProfilePage } = await import("@/pages/profile");
const { default: BillingPage } = await import("@/pages/billing");
const { default: IntegrationsPage } = await import("@/pages/integrations");
const { UnlockGate } = await import("@/components/e2ee/unlock-gate");
const { default: LoginPage } = await import("@/pages/login");
const de = (await import("@/i18n/messages/de.json")).default as Record<string, string>;
const en = (await import("@/i18n/messages/en.json")).default as Record<string, string>;

vi.setConfig({ testTimeout: 30_000 });

const RTL: Locale[] = ["ar", "he", "fa"];
const NOW = Math.floor(Date.now() / 1000);
const GB = 1024 ** 3;
const TB = 1024 ** 4;

let shown: Rendered | null = null;
let switchTo: ((l: Locale) => Promise<void>) | null = null;
function LocaleHandle() {
  const { setLocale } = useLocale();
  useEffect(() => {
    switchTo = setLocale;
  }, [setLocale]);
  return null;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const w = window as unknown as { PointerEvent?: typeof MouseEvent; MouseEvent: typeof MouseEvent };
  if (!w.PointerEvent) w.PointerEvent = w.MouseEvent;
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  switchTo = null;
  apiMock.mockReset();
  getBillingStatus.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  document.getElementById("toast-root")?.remove();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await Promise.resolve(); });

// ---------------------------------------------------------------- fixtures
function file(over: Record<string, unknown> = {}) {
  return {
    id: "file_1", name: "Alpha.zip", size_bytes: 2048, mime_type: "application/zip", extension: "zip",
    region: "us", created_at: 1_700_000_000, updated_at: 1_700_000_100, current_version: 3,
    lock_mode: "none", is_hidden: 0, hidden_mode: "none", uploaded_by: "u1", uploader_name: "Alice",
    share_count: 2, comment_count: 1, is_synced: 0, origin: null, captured_at: null, ...over,
  };
}
const LISTING = {
  ok: true,
  folders: [{
    id: "folder_1", name: "Beta", created_at: 1_700_000_000, updated_at: 1_700_000_000, file_count: 4,
    lock_mode: "none", is_hidden: 0, hidden_mode: "none", is_synced: 0, total_size_bytes: 4096,
    content_updated_at: 1_700_000_000, region: "us", uploader_name: "Alice", share_count: 0, comment_count: 0, origin: "desktop",
  }],
  files: [file(), file({ id: "file_2", name: "Gamma.zip", current_version: 1 })],
  breadcrumbs: [],
  pagination: { page: 1, per_page: 100, total_files: 2, total_pages: 1 },
};
const ACTIVITY_ROW = (action: string, over: Record<string, unknown> = {}) => ({
  id: action, action, entity_type: "file", entity_id: "f1", metadata: null, created_at: NOW - 600,
  user_name: "Ada Lovelace", user_id: "u1", user_email: "ada@example.com", user_avatar: null, resource_name: "report.pdf", ...over,
});
const WS_SETTINGS = {
  max_file_size_gb: 5, max_storage_per_member_gb: 50, max_total_storage_gb: 100, max_concurrent_uploads: 5,
  allowed_extensions: null, blocked_extensions: null, ip_allowlist: null, ip_blocklist: null,
  country_allowlist: null, country_blocklist: null, allowed_email_domains: null, available_regions: null,
  session_timeout_minutes: 30, download_rate_limit: null, disable_share_links: 0, force_share_password: 0,
  share_max_expiry_days: 7, default_share_expiry_days: null, require_2fa: 0, disable_password_login: 0, record_upload_origin: 1,
};
const ROLES = [
  { id: "role_owner", name: "Owner", is_default: 0, is_builtin: true, is_custom: false, permissions: { upload_files: true, manage_roles: true, manage_settings: true } },
  { id: "role_member", name: "Member", is_default: 1, is_builtin: true, is_custom: false, permissions: { upload_files: true } },
];
const USER = {
  id: "u1", name: "Zeynep Kaya", email: "jane@example.test", initials: "JD", avatar_url: null, preferred_language: "en",
  created_at: 1_790_672_400, email_verified_at: 1_790_672_400, workspace_count: 2, has_password: true,
};
const BILLING = {
  ok: true,
  plan: { id: "pro", name: "Pro", storage_bytes: 2 * TB, storage_label: "2 TB", price_monthly: 2499, price_yearly: null },
  usage: { used_bytes: 612 * GB, used_label: "612 GB", limit_bytes: 3 * TB, limit_label: "3 TB", pct: 20 },
  subscription: { status: "active", current_period_end: 1_800_000_000, has_subscription: true, cancel_at_period_end: false, grace_period_end: null },
  interval: "month",
  items: [{ kind: "plan", ref_id: "pro", quantity: 1, storage_bytes: 2 * TB, total_bytes: 2 * TB, total_label: "2 TB", interval: "month" }],
  referral_bonus_bytes: 10 * GB,
  license_grants: [],
  invoices: [{ id: "in_1", period_start: 1_794_000_000, period_end: 1_797_000_000, amount: 2499, status: "paid", pdf_url: "https://stripe.test/i.pdf" }],
};

type Api = (path: string) => Promise<unknown>;
const byPrefix = (table: Record<string, unknown>, fallback: unknown = { ok: true }): Api => async (path) => {
  const key = path.split("?")[0];
  for (const [prefix, value] of Object.entries(table)) if (key === prefix || key.startsWith(prefix)) return value;
  return fallback;
};

interface Screen {
  name: string;
  /** A key whose text must appear (in the language shown). */
  key: string;
  api: Api;
  ui: () => React.ReactElement;
  entry?: string;
  before?: () => void;
}

const noop = () => {};
const SCREENS: Screen[] = [
  {
    name: "files list",
    key: "common.label.folders",
    api: async (path) => (path.startsWith("/api/cloud/imports") ? { ok: true, jobs: [] } : LISTING),
    ui: () => <FilesPage />,
    before: () => { localStorage.setItem("dosya_files_view", "grid"); },
  },
  {
    name: "file detail panel",
    key: "common.label.properties",
    api: async (path) => {
      if (path.includes("/versions")) {
        return { ok: true, current_version: 3, versions: [
          { id: "v3", version_number: 3, size_bytes: 30, uploader_name: null, created_at: 1_700_000_000 },
          { id: "v2", version_number: 2, size_bytes: 20, uploader_name: "Bob", created_at: 1_699_000_000 },
        ] };
      }
      if (path.endsWith("/share")) return { ok: true, links: [{ id: "l1", url: "https://x.test/s/1", view_count: 5, expires_at: null, is_revoked: 0, is_password_protected: 1 }] };
      return LISTING;
    },
    ui: () => <FileDetailPanel file={file() as never} onClose={noop} onDownload={noop} onCopy={noop} onDelete={noop} onShare={noop} onView={noop} onRefresh={noop} />,
  },
  {
    name: "share modal",
    key: "common.label.recipients",
    api: async (path) => (path.endsWith("/settings") ? { ok: true, settings: null } : { ok: true, excluded_count: 3 }),
    ui: () => <ShareModal open target={{ kind: "file", fileIds: ["f1"] }} name="report.pdf" onClose={noop} />,
    before: () => clearShareDefaultsCache(),
  },
  {
    name: "activity",
    key: "activity.heading.activityLog",
    api: async (path) => path.startsWith("/api/activity")
      ? {
          ok: true,
          activities: [ACTIVITY_ROW("file_uploaded"), ACTIVITY_ROW("folder_created", { entity_type: "folder", resource_name: "Q3 plans" }), ACTIVITY_ROW("link_revoked")],
          members: [{ id: "u1", name: "Ada Lovelace", email: "ada@example.com" }],
          pagination: { page: 1, per_page: 30, total: 45, total_pages: 2 },
        }
      : { ok: true },
    ui: () => <ActivityPage />,
  },
  {
    name: "settings",
    key: "settings.heading.workspaceSettings",
    api: byPrefix({
      "/api/workspaces/ws1/branding": { ok: true, enabled: true, revoked: false, can_edit: true, is_owner: true, branding: { brand_name: null } },
      "/api/workspaces/ws1": {
        ok: true,
        workspace: { id: "ws1", name: "Acme", icon_initials: "AC", icon_color: "#123456", icon_image_url: null, default_region: "weur", plan: "pro", storage_used_bytes: 300 * GB },
        settings: WS_SETTINGS, is_owner: true, plan: "pro", plan_limits: { storage_gb: 200 },
        allocation: { plan_gb: 200, allocated_gb: 250, remaining_gb: 0 },
      },
      "/api/roles": { ok: true, roles: ROLES },
      "/api/team": { ok: true, members: [{ membership_id: "m1", user_id: "u1", name: "Zeynep Kaya", email: "zeynep@example.test", role_id: "role_owner", is_you: true }] },
      "/api/me/permissions": {
        ok: true, user_id: "u1", role_id: "role_owner", role_name: "Owner", is_builtin: true, root_folder_id: null, root_folder_name: null,
        permissions: { manage_settings: true, change_workspace_name: true, change_workspace_icon: true },
      },
    }),
    ui: () => <SettingsPage />,
    before: () => useWorkspace.setState({ activeId: "ws1" }),
  },
  {
    name: "profile appearance",
    key: "appearance.label.language",
    api: byPrefix({ "/api/me": { ok: true, user: USER } }),
    ui: () => (
      <Routes>
        <Route path="/profile/:section?" element={<ProfilePage />} />
      </Routes>
    ),
    entry: "/profile/appearance",
  },
  {
    name: "billing",
    key: "billing.heading.invoices",
    api: async () => ({ ok: false }),
    ui: () => <BillingPage />,
    entry: "/billing",
    before: () => getBillingStatus.mockResolvedValue(BILLING),
  },
  {
    name: "integrations index",
    key: "common.heading.integrations",
    api: async () => ({ ok: true }),
    ui: () => <IntegrationsPage />,
  },
  {
    name: "Vault gate",
    key: "vault.heading.setUpEncryption",
    api: async (path) => {
      if (path === "/api/me") throw new ApiError(401, "{}");
      return { ok: true };
    },
    ui: () => <UnlockGate />,
    before: () => {
      useE2ee.setState({
        status: "locked", error: null, errorKey: null, hasIdentity: null, workspaces: [], activeWorkspaceId: null,
        entries: [], members: [], busy: false, recoveryKeyOnce: null,
      });
      useE2ee.getState().__setEngine({ hasIdentity: async () => false } as never);
    },
  },
  {
    name: "sign in",
    key: "common.heading.welcomeBack",
    api: async () => ({ ok: false }),
    ui: () => <LoginPage />,
    entry: "/login",
  },
];

/**
 * Server and user text that the strict matcher reads as English but is data:
 * the built-in role names, the plan name and storage-breakdown names.
 */
const DATA_TEXT = new Set(["Owner", "Member", "Pro", "Free", "Pro plan", "Images", "Counted"]);

async function show(screen: Screen, locale: Locale) {
  useWorkspace.setState({ activeId: "ws_1" });
  screen.before?.();
  apiMock.mockImplementation(screen.api);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  shown = await renderInLocale(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[screen.entry ?? "/"]}>
        <LocaleHandle />
        {screen.ui()}
      </MemoryRouter>
    </QueryClientProvider>,
    locale,
  );
  for (let i = 0; i < 4; i++) await flush();
  return shown;
}

describe("core screens in right-to-left languages", () => {
  for (const screen of SCREENS) {
    for (const locale of RTL) {
      it(`${screen.name} in ${locale}`, async () => {
        const r = await show(screen, locale);
        const messages = (await import(`@/i18n/messages/${locale}.json`)).default as Record<string, string>;
        expect(document.documentElement.dir).toBe("rtl");
        expect(document.documentElement.lang).toBe(locale);
        expect(document.body.textContent).toContain(messages[screen.key]);
        expect(r.leftover().filter((t) => !DATA_TEXT.has(t))).toEqual([]);
        expect(physicalClassesIn(document.body)).toEqual([]);
        expect(unflippedIcons(document.body)).toEqual([]);
      });
    }

    it(`${screen.name} switches to German and back to left to right`, async () => {
      await show(screen, "ar");
      expect(document.documentElement.dir).toBe("rtl");
      await act(async () => { await switchTo!("de"); });
      for (let i = 0; i < 3; i++) await flush();
      expect(document.documentElement.dir).toBe("ltr");
      expect(document.documentElement.lang).toBe("de");
      expect(document.body.textContent).toContain(de[screen.key]);
      expect(document.body.textContent).not.toContain(en[screen.key] === de[screen.key] ? "\u0000" : en[screen.key]);
    });
  }
});
