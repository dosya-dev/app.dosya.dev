/**
 * RTL sweep of the shared components (src/components outside ui, demo, audio and
 * video): the main screens render in Arabic with no physical-direction class
 * left, and in English with the layout classes they had before the conversion.
 */
import { createHash } from "node:crypto";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@/lib/library-request";
import type { UploadItem } from "@/lib/upload-types";
import { physicalClassesIn, renderInLocale, type Rendered } from "../../../tests/helpers/i18n-sweep";

const apiMock = vi.fn();
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock("@/components/file-preview-image", () => ({
  FilePreviewImage: ({ fileName }: { fileName: string }) => <img alt={fileName} />,
}));
vi.mock("@/components/comments/api", () => ({
  listComments: vi.fn().mockResolvedValue([]), postComment: vi.fn(), deleteComment: vi.fn(),
  editComment: vi.fn(), searchMentionable: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/components/pdf-viewer/pdf-viewer", () => ({ PdfViewer: () => null, default: () => null }));

const { LibraryView } = await import("@/components/library/library-view");
const { FilesSidebar } = await import("@/components/files-sidebar");
const { DashboardSidebar } = await import("@/components/layout/dashboard-sidebar");
const { SidebarProvider } = await import("@/components/ui/sidebar");
const { ShareModal } = await import("@/components/share-modal");
const { FileDetailPanel } = await import("@/components/file-detail-panel");
const { FileViewer } = await import("@/components/file-viewer");
const { default: UploadDock } = await import("@/components/uploads/upload-dock");
const { useWorkspace } = await import("@/stores/workspace");
const { useUploads } = await import("@/stores/uploads");
const { libraryColumnsFor } = await import("@/lib/file-columns");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((q: string) => ({
    matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

let mounted: Rendered | null = null;
beforeEach(() => {
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
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  apiMock.mockReset();
});

const noop = () => {};
const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function photo(id: string, over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id, name: `${id}.jpg`, size_bytes: 1, mime_type: "image/jpeg", extension: ".jpg", region: "eu",
    created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", is_hidden: 0,
    uploaded_by: "u1", uploader_name: "Me", share_count: 0, comment_count: 0, is_synced: 0,
    folder_id: null, taken_at: 1718445600, ...over,
  };
}
const fileRow = {
  id: "f1", name: "Backup.zip", size_bytes: 1024, mime_type: "application/zip", extension: "zip",
  region: "us", created_at: 0, updated_at: 0, current_version: 1, lock_mode: "none", is_hidden: 0,
  uploaded_by: "u1", uploader_name: "Alice", share_count: 0, comment_count: 0, is_synced: 0,
};
const textRow = { ...fileRow, id: "f2", name: "notes.txt", mime_type: "text/plain", extension: "txt" };

function libraryProps(layout: "grid" | "list") {
  return {
    months: [
      { key: "2024-07", label: "July 2024", count: 2, files: [photo("a"), photo("b")] },
      { key: "2024-06", label: "June 2024", count: 2, files: [photo("c"), photo("d", { lock_mode: "full_lock" })] },
    ],
    total: 25, loaded: 4, hasMore: true, isLoading: false, isLoadingMore: false, error: null,
    search: "", selected: new Set<string>(), favourites: new Set<string>(), unlockedFiles: new Map(),
    activeId: null, kind: "photos" as const, tileSize: "small" as const, layout,
    columns: libraryColumnsFor("photos"), uploadHref: "/uploads",
    onLoadMore: noop, onRetry: noop, onOpen: noop, onToggleSelect: noop, onSelectMany: noop,
    onFavourite: noop, onContextMenu: noop,
  };
}

const upload = (over: Partial<UploadItem>): UploadItem => ({
  id: "u1", session_id: null, fileName: "a.txt", fileSize: 100, mimeType: "t", workspace_id: "ws",
  folder_id: null, status: "queued", progress: 0, bytesUploaded: 0, part_size: null, total_parts: null,
  uploaded_parts: [], ...over,
});

const router = (ui: React.ReactElement) => (
  <QueryClientProvider client={queryClient()}>
    <MemoryRouter initialEntries={["/files"]}>{ui}</MemoryRouter>
  </QueryClientProvider>
);

const SCREENS: Record<string, () => React.ReactElement> = {
  "library grid": () => router(<LibraryView {...libraryProps("grid")} />),
  "library list": () => router(<LibraryView {...libraryProps("list")} />),
  "files sidebar": () => router(<FilesSidebar onFilterChange={noop} onFavouriteClick={noop} onGroupClick={noop} />),
  "dashboard sidebar": () =>
    router(<SidebarProvider open onOpenChange={noop}><DashboardSidebar /></SidebarProvider>),
  "share modal": () => <ShareModal open target={{ kind: "file", fileIds: ["f1"] }} name="report.pdf" onClose={noop} />,
  "file detail panel": () => (
    <FileDetailPanel file={fileRow as never} onClose={noop} onDownload={noop} onCopy={noop} onDelete={noop}
      onShare={noop} onView={noop} onRefresh={noop} />
  ),
  "file viewer": () => (
    <FileViewer file={textRow as never} files={[textRow] as never} workspaceId="w1" onClose={noop}
      onNavigate={noop} onRefresh={noop} />
  ),
  "upload dock": () => {
    useUploads.setState({ items: [upload({ id: "e1", status: "error", error: "x" }), upload({ id: "c1", status: "complete" })] });
    return router(<UploadDock />);
  },
};

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}

/**
 * Logical layout classes folded back to the physical spelling they replaced, and
 * rtl: additions dropped, so an English render can be compared with the render
 * from before the conversion.
 */
function legacyClasses(): string {
  const set = new Set<string>();
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    for (const c of (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)) {
      if (c.includes("rtl:")) continue;
      set.add(
        c
          .replace(/(^|:|!|-)ms-/g, "$1ml-").replace(/(^|:|!|-)me-/g, "$1mr-")
          .replace(/(^|:|!|-)ps-/g, "$1pl-").replace(/(^|:|!|-)pe-/g, "$1pr-")
          .replace(/(^|:|!|-)inset-s-/g, "$1left-").replace(/(^|:|!|-)inset-e-/g, "$1right-")
          .replace(/(^|:|!|-)text-start(?![-\w])/g, "$1text-left").replace(/(^|:|!|-)text-end(?![-\w])/g, "$1text-right")
          .replace(/(^|:|!|-)rounded-ss/g, "$1rounded-tl").replace(/(^|:|!|-)rounded-se/g, "$1rounded-tr")
          .replace(/(^|:|!|-)rounded-es/g, "$1rounded-bl").replace(/(^|:|!|-)rounded-ee/g, "$1rounded-br")
          .replace(/(^|:|!|-)rounded-s(?![-\w])/g, "$1rounded-l").replace(/(^|:|!|-)rounded-s-/g, "$1rounded-l-")
          .replace(/(^|:|!|-)rounded-e(?![-\w])/g, "$1rounded-r").replace(/(^|:|!|-)rounded-e-/g, "$1rounded-r-")
          .replace(/(^|:|!|-)border-s(?![a-z])/g, "$1border-l").replace(/(^|:|!|-)border-e(?![a-z])/g, "$1border-r"),
      );
    }
  }
  return [...set].sort().join(" ");
}

const digest = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/** sha1 prefix of legacyClasses() per screen, recorded before the conversion. */
const EN_BASELINE: Record<string, string> = {
  "library grid": "ee124b9953ba",
  "library list": "9de60fd4e05a",
  // Back to the pre-Personas value: the Personas row renders only when the
  // owner's plan includes Personas or it is on (R66), and this sweep mocks
  // neither. With the row it read "6f197352048c".
  "files sidebar": "9cdf889e4e9e",
  "dashboard sidebar": "888ce3a8d418",
  "share modal": "06e52b676afe",
  "file detail panel": "7d9c8ee83962",
  "file viewer": "26d424cc5866",
  "upload dock": "bab4f2dee635",
};

describe("shared components in Arabic", () => {
  for (const [name, make] of Object.entries(SCREENS)) {
    it(`${name}: no physical-direction class left`, async () => {
      mounted = await renderInLocale(make(), "ar");
      await settle();
      expect(document.body.textContent?.length).toBeGreaterThan(0);
      expect(physicalClassesIn(document.body)).toEqual([]);
    });
  }
});

describe("shared components in English", () => {
  for (const [name, make] of Object.entries(SCREENS)) {
    it(`${name}: same class-derived layout as before`, async () => {
      mounted = await renderInLocale(make(), "en");
      await settle();
      const got = digest(legacyClasses());
      expect(got).toBe(EN_BASELINE[name]);
    });
  }
});
