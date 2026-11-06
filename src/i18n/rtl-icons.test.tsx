/**
 * Direction-carrying UI in right-to-left: every directional icon mirrors,
 * disclosure chevrons rotate without composing with the mirror, the file viewer's
 * arrow keys follow the reading direction, and the context menu opens with its
 * inline-end edge at the cursor.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DIRECTIONAL_ICONS, renderInLocale, unflippedIcons, type Rendered } from "../../tests/helpers/i18n-sweep";

const apiMock = vi.fn();
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, API_BASE: "", api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock("@/components/file-preview-image", () => ({
  FilePreviewImage: ({ fileName }: { fileName: string }) => <img alt={fileName} />,
}));
vi.mock("@/components/pdf-viewer/pdf-viewer", () => ({ PdfViewer: () => null, default: () => null }));
const COMMENT = vi.hoisted(() => ({
  id: "c1", file_id: "f1", folder_id: null, workspace_id: "w1", user_id: "u9", parent_id: null, body: "hello",
  is_edited: 0, created_at: 1, updated_at: 1, user_name: "Sam", user_email: "s@x.co", user_avatar: null,
  anchor_ms: null, anchor_page: null, anchor_version: null, mention_user_ids: null, mentions: [],
}));
vi.mock("@/components/comments/api", () => ({
  listComments: vi.fn().mockResolvedValue([COMMENT, { ...COMMENT, id: "c2", parent_id: "c1" }]), postComment: vi.fn(), deleteComment: vi.fn(),
  editComment: vi.fn(), searchMentionable: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/components/onboarding/setup-pill", () => ({ SetupPill: () => null }));
vi.mock("@/lib/upload-runner", () => ({ enqueue: () => {}, enqueueByFolder: () => 0, cancelAll: () => {} }));
vi.mock("@/components/cloud-import/provider-picker-dialog", () => ({ ProviderPickerDialog: () => null }));
vi.mock("@/components/cloud-import/connected-accounts-card", () => ({ ConnectedAccountsCard: () => null }));
vi.mock("@/components/cloud-import/cloud-connect-notice", () => ({ CloudConnectNotice: () => null }));
vi.mock("@/components/cloud-import/import-progress-card", () => ({ ImportProgressCard: () => null }));

const { FileViewer } = await import("@/components/file-viewer");
const { FilesSidebar } = await import("@/components/files-sidebar");
const { DashboardSidebar } = await import("@/components/layout/dashboard-sidebar");
const { DashboardTopbar } = await import("@/components/layout/dashboard-topbar");
const { SidebarProvider } = await import("@/components/ui/sidebar");
const { ShareModal } = await import("@/components/share-modal");
const { CommentsPanel } = await import("@/components/comments/comments-panel");
const { useFileComments } = await import("@/components/comments/use-file-comments");
const { ContextMenu } = await import("@/components/context-menu");
const { FolderTree } = await import("@/components/folder-tree");
const { TourLayout } = await import("@/components/tour/tour-layout");
const { TOUR_STEPS } = await import("@/components/tour/tour-steps");
const { PurposePicker } = await import("@/components/onboarding/purpose-picker");
const IntegrationsPage = (await import("@/pages/integrations")).default;
const { useWorkspace } = await import("@/stores/workspace");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((q: string) => ({
    matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  apiMock.mockReset();
});

const noop = () => {};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const router = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={["/files"]}>{ui}</MemoryRouter>
  </QueryClientProvider>
);

function row(id: string, name: string) {
  return {
    id, name, size_bytes: 10, mime_type: "text/plain", extension: "txt", region: "us", created_at: 0,
    updated_at: 0, current_version: 1, lock_mode: "none", is_hidden: 0, uploaded_by: "u1",
    uploader_name: "Alice", share_count: 0, comment_count: 0, is_synced: 0,
  };
}

function seedApi() {
  useWorkspace.setState({ activeId: "ws_1" });
  apiMock.mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.startsWith("/api/workspaces")) {
      return {
        ok: true,
        workspaces: [{ id: "ws_1", name: "Acme", slug: "acme", icon_initials: "AC", icon_color: "#000", icon_image_url: null, role_id: "role_owner" }],
      };
    }
    return { ok: false, jobs: [] };
  });
}

function CommentsHarness() {
  const thread = useFileComments("f1", "w1");
  return <CommentsPanel fileId="f1" workspaceId="w1" currentVersion={1} viewingVersion={1} thread={thread} activeCommentId={null} />;
}

const SCREENS: Record<string, () => React.ReactElement> = {
  topbar: () => router(<SidebarProvider><DashboardTopbar /></SidebarProvider>),
  sidebar: () => router(<SidebarProvider open onOpenChange={noop}><DashboardSidebar /></SidebarProvider>),
  "files sidebar": () => router(<FilesSidebar onFilterChange={noop} onFavouriteClick={noop} onGroupClick={noop} />),
  "file viewer": () => (
    <FileViewer file={row("f1", "a.txt") as never} files={[row("f1", "a.txt"), row("f2", "b.txt")] as never}
      workspaceId="w1" onClose={noop} onNavigate={noop} onRefresh={noop} />
  ),
  "share modal": () => <ShareModal open target={{ kind: "file", fileIds: ["f1"] }} name="report.pdf" onClose={noop} />,
  comments: () => router(<CommentsHarness />),
  "integrations index": () => router(<IntegrationsPage />),
  onboarding: () => router(
    <>
      <PurposePicker onPick={noop} onSkip={noop} />
      <TourLayout step={TOUR_STEPS[1]} index={1} total={TOUR_STEPS.length} onBack={noop} onNext={noop} onSkip={noop} preview={null} />
    </>,
  ),
};

describe("directional icons mirror in Arabic", () => {
  for (const [name, make] of Object.entries(SCREENS)) {
    it(name, async () => {
      seedApi();
      mounted = await renderInLocale(make(), "ar");
      await flush();
      expect(document.body.textContent?.length).toBeGreaterThan(0);
      expect(unflippedIcons(document.body)).toEqual([]);
    });
  }

  it("the file viewer's previous and next buttons carry a directional icon each", async () => {
    seedApi();
    mounted = await renderInLocale(SCREENS["file viewer"](), "ar");
    await flush();
    const icons = [...document.querySelectorAll("svg")].filter((s) => /lucide-chevron-(left|right)/.test(s.getAttribute("class") ?? ""));
    expect(icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of icons) expect(icon.getAttribute("class")).toContain("rtl:-scale-x-100");
  });
});

describe("disclosure chevron", () => {
  const folders = new Map([
    [null, [{ id: "a", name: "Open", has_children: true, file_count: 0 }, { id: "b", name: "Closed", has_children: true, file_count: 0 }]],
    ["a", []],
  ]) as never;
  const chevronClasses = () => [...document.querySelectorAll("svg.lucide-chevron-right")].map((s) => s.getAttribute("class") ?? "");

  it("rotates 90 degrees while open and turns around in RTL only while closed", async () => {
    mounted = await renderInLocale(
      <FolderTree childrenByParent={folders} expanded={new Set(["a"])} loading={new Set()} rootKey="r"
        selectedId={null} onSelect={noop} onToggle={noop} />,
      "ar",
    );
    const [open, closed] = chevronClasses();
    expect(open).toContain("rotate-90");
    expect(open).not.toContain("rtl:rotate-180");
    expect(open).not.toContain("-scale-x-100");
    expect(closed).toContain("rtl:rotate-180");
    expect(closed).not.toContain("rotate-90");
    expect(unflippedIcons(document.body)).toEqual([]);
  });
});

describe("file viewer arrow keys", () => {
  const press = (key: string) => act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  async function open(locale: "ar" | "en", startId: string) {
    seedApi();
    const files = [row("f1", "a.txt"), row("f2", "b.txt"), row("f3", "c.txt")];
    const onNavigate = vi.fn();
    mounted = await renderInLocale(
      <FileViewer file={files.find((f) => f.id === startId) as never} files={files as never} workspaceId="w1"
        onClose={noop} onNavigate={onNavigate} onRefresh={noop} />,
      locale,
    );
    await flush();
    return onNavigate;
  }

  it("ArrowLeft opens the next file in Arabic and ArrowRight the previous", async () => {
    const onNavigate = await open("ar", "f2");
    await press("ArrowLeft");
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "f3" }));
    await press("ArrowRight");
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "f1" }));
  });

  it("ArrowRight opens the next file in English and ArrowLeft the previous", async () => {
    const onNavigate = await open("en", "f2");
    await press("ArrowRight");
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "f3" }));
    await press("ArrowLeft");
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "f1" }));
  });

  it("does nothing past the ends of the list", async () => {
    const onNavigate = await open("ar", "f3");
    await press("ArrowLeft");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("context menu", () => {
  const items = [{ label: "Open", onClick: noop }];
  const menu = () => document.body.querySelector<HTMLElement>(".fixed.z-\\[9000\\]")!;

  it("opens with its right edge at the cursor in Arabic", async () => {
    mounted = await renderInLocale(<ContextMenu items={items} position={{ x: 100, y: 50 }} onClose={noop} />, "ar");
    await flush();
    expect(menu().style.right).toBe(`${window.innerWidth - 100}px`);
    expect(menu().style.left).toBe("");
    expect(menu().style.top).toBe("50px");
  });

  it("opens with its left edge at the cursor in English", async () => {
    mounted = await renderInLocale(<ContextMenu items={items} position={{ x: 100, y: 50 }} onClose={noop} />, "en");
    await flush();
    expect(menu().style.left).toBe("100px");
    expect(menu().style.right).toBe("");
  });

  it("stays inside the viewport near the left edge in Arabic", async () => {
    mounted = await renderInLocale(<ContextMenu items={items} position={{ x: window.innerWidth - 2, y: 50 }} onClose={noop} />, "ar");
    await flush();
    expect(parseFloat(menu().style.right)).toBeGreaterThanOrEqual(8);
  });
});

// Source guard: a directional icon rendered in JSX outside the demo (LTR on
// purpose) and the media controls carries a mirror class.
const ICON_RE = new RegExp(
  `<(${["ChevronLeft", "ChevronRight", "ChevronsLeft", "ChevronsRight", "ArrowLeft", "ArrowRight", "ArrowUpRight",
    "CornerDownRight", "Reply", "Send", "LogOut", "LogIn", "PanelLeft", "PanelLeftIcon", "PanelRight"].join("|")})\\b([\\s\\S]*?)/>`,
  "g",
);
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("page and component sources", () => {
  it("every directional icon mirrors (the demo and media controls excepted)", () => {
    const root = resolve(__dirname, "..");
    const missing: string[] = [];
    for (const file of walk(root)) {
      const rel = relative(root, file);
      if (rel.startsWith(join("components", "demo")) || rel.startsWith(join("components", "audio")) || rel.startsWith(join("components", "video"))) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(ICON_RE)) {
        if (!/rtl:-scale-x-100|rtl:rotate-180/.test(m[0])) missing.push(`${rel}: <${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("DIRECTIONAL_ICONS still names the icons this task flips", () => {
    for (const n of ["lucide-chevron-left", "lucide-send", "lucide-log-out", "lucide-corner-down-right"]) {
      expect(DIRECTIONAL_ICONS).toContain(n);
    }
  });
});
