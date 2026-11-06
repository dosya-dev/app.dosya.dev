/**
 * Media, charts, map and editors in right-to-left: players and timelines stay
 * left-to-right, prose panels follow the page, charts mirror their axes, the
 * map moves its zoom control, and the text editor picks its direction per file.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { physicalClassesIn, renderInLocale, type Rendered } from "../../tests/helpers/i18n-sweep";

// The Video.js player itself is not what these assertions are about.
vi.mock("@dosya-dev/video-player/react", () => ({
  DosyaVideo: ({ className }: { className?: string }) => <div data-testid="dp-root" className={className} />,
}));
vi.mock("@dosya-dev/video-player/skin.css", () => ({}));
vi.mock("@/components/audio/use-peaks", () => ({
  usePeaks: () => ({ peaks: new Float32Array(900).fill(0.5), state: "ready" }),
}));
vi.mock("@/components/audio/use-audio-tags", () => ({ useAudioTags: () => ({ tags: {}, artworkUrl: null }) }));

// Recharts is mocked so the axis props can be read back.
const axisProps: { x: Record<string, unknown>[]; y: Record<string, unknown>[]; chart: Record<string, unknown>[] } = { x: [], y: [], chart: [] };
vi.mock("recharts", () => {
  const Nothing = () => null;
  return {
    Bar: Nothing, CartesianGrid: Nothing, ReferenceLine: Nothing, Tooltip: Nothing,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    BarChart: ({ children, ...props }: { children: React.ReactNode }) => { axisProps.chart.push(props); return <div>{children}</div>; },
    XAxis: (props: Record<string, unknown>) => { axisProps.x.push(props); return null; },
    YAxis: (props: Record<string, unknown>) => { axisProps.y.push(props); return null; },
  };
});

// CodeMirror is mocked so the extensions the editor builds can be read back.
const cm = vi.hoisted(() => ({ extensions: [] as unknown[] }));
vi.mock("codemirror", () => {
  class EditorView {
    static lineWrapping = { lineWrapping: true };
    static perLineTextDirection = { of: (on: boolean) => ({ perLineTextDirection: on }) };
    constructor(config: { extensions: unknown[] }) { cm.extensions = config.extensions; }
    destroy() {}
  }
  return { EditorView, basicSetup: { basicSetup: true } };
});
vi.mock("@codemirror/theme-one-dark", () => ({ oneDark: { oneDark: true } }));
vi.mock("@codemirror/lang-javascript", () => ({ javascript: () => ({ lang: "js" }) }));
vi.mock("@codemirror/lang-markdown", () => ({ markdown: () => ({ lang: "md" }) }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { VideoPlayer } = await import("@/components/video/video-player");
const { AnchorProvider } = await import("@/components/comments/anchor-context");
const { Waveform } = await import("@/components/audio/waveform");
const { AudioPlayer } = await import("@/components/audio/audio-player");
const { TimelineChart } = await import("@/pages/share-analytics");
const { TextEditorOverlay } = await import("@/components/text-editor");
const { mountReportPopover } = await import("../../vendor/video-player/report/popover");
const { chartDirection, donutDirection } = await import("@/lib/chart-rtl");
const { AiIndexDonut } = await import("@/components/workspaces/ai-index-donut");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn(async () => {}) });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
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
  axisProps.x = []; axisProps.y = []; axisProps.chart = [];
  cm.extensions = [];
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

const file = (id: string, name: string) => ({ id, name, size_bytes: 1000, mime_type: "audio/mpeg", folder_id: null }) as never;

describe("video", () => {
  it("keeps the player root inside a left-to-right wrapper in ar", async () => {
    mounted = await renderInLocale(
      <AnchorProvider markers={[]} pending={null} onPendingApplied={() => {}} onSelectComment={() => {}}>
        <VideoPlayer file={file("f1", "clip.mp4")} stableRawUrl="/raw" downloadUrl="/dl" />
      </AnchorProvider>,
      "ar",
    );
    expect(document.documentElement.dir).toBe("rtl");
    const root = document.querySelector('[data-testid="dp-root"]')!;
    expect(root.closest('[dir="ltr"]')).not.toBeNull();
  });

  it("gives the report popover and shortcuts panel the page direction", () => {
    const css = read("src/index.css");
    expect(css).toMatch(/\[dir="rtl"\] :is\(\.dp-report, \.dp-keys-panel\) \{ direction: rtl; \}/);
    // The classes the rule is keyed on really are what the vendored player renders.
    const anchor = document.createElement("div");
    document.body.append(anchor);
    mountReportPopover(anchor, { reasons: ["playback"], submit: async () => ({ ok: true }) }, () => {});
    expect(anchor.querySelector(".dp-report")).not.toBeNull();
    expect(read("vendor/video-player/shortcuts.ts")).toContain("'dp-keys-panel'");
  });
});

describe("audio", () => {
  it("renders the transport and timeline rows inside left-to-right containers in ar, the queue tabs not", async () => {
    mounted = await renderInLocale(
      <AudioPlayer file={file("a", "one.mp3")} files={[file("a", "one.mp3"), file("b", "two.mp3")]}
        rawUrl="/raw" downloadUrl="/dl" version={undefined} onNavigate={() => {}} />,
      "ar",
    );
    const body = document.body;
    const skip = body.querySelector(".lucide-skip-back")!;
    expect(skip.closest('[dir="ltr"]')).not.toBeNull();
    expect(body.querySelector('[role="slider"]')!.closest('[dir="ltr"]')).not.toBeNull();
    expect(body.querySelector(".lucide-volume-2, .lucide-volume-x")!.closest('[dir="ltr"]')).not.toBeNull();
    expect(body.querySelector('[role="tab"]')!.closest('[dir="ltr"]')).toBeNull();
  });

  it("seeks back five seconds on ArrowLeft in ar (the timeline is physical)", async () => {
    const onSeek = vi.fn();
    mounted = await renderInLocale(
      <Waveform peaks={new Float32Array(100).fill(0.5)} position={30} duration={100} loop={null} onSeek={onSeek} />,
      "ar",
    );
    const slider = document.querySelector('[role="slider"]')!;
    act(() => { slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect(onSeek).toHaveBeenCalledWith(25);
    act(() => { slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(onSeek).toHaveBeenLastCalledWith(35);
    expect(slider.closest('[dir="ltr"]')).not.toBeNull();
  });

  it("lets lyrics lines pick their own direction", () => {
    expect(read("src/components/audio/lyrics-panel.tsx")).toMatch(/<li[^>]*\n\s+key=[^\n]*\n\s+dir="auto"/);
  });
});

describe("charts", () => {
  const link = { is_revoked: false, revoked_at: null } as never;
  const timeline = [{ day: "2026-10-01", opens: 1, downloads: 0 }] as never;

  it("reverses the x axis, moves the y axis right and swaps margins in ar, not in en", async () => {
    mounted = await renderInLocale(<TimelineChart timeline={timeline} link={link} range={30 as never} />, "ar");
    expect(axisProps.x.at(-1)).toMatchObject({ reversed: true });
    expect(axisProps.y.at(-1)).toMatchObject({ orientation: "right" });
    expect(axisProps.chart.at(-1)).toMatchObject({ margin: { left: 8, right: 0 } });
    mounted.unmount();
    axisProps.x = []; axisProps.y = []; axisProps.chart = [];
    mounted = await renderInLocale(<TimelineChart timeline={timeline} link={link} range={30 as never} />, "en");
    expect(axisProps.x.at(-1)).toMatchObject({ reversed: false });
    expect(axisProps.y.at(-1)).toMatchObject({ orientation: "left" });
    expect(axisProps.chart.at(-1)).toMatchObject({ margin: { left: 0, right: 8 } });
  });

  it("the api analytics chart uses the same direction props", () => {
    expect(chartDirection("rtl").xAxis.reversed).toBe(true);
    const src = read("src/pages/api-analytics.tsx");
    expect(src).toContain("reversed={axes.xAxis.reversed}");
    expect(src).toContain("orientation={axes.yAxis.orientation}");
    expect(src).toContain("margin={axes.margin}");
  });

  it("runs the AI index donut counter-clockwise in ar, its legend and tooltip on logical sides", async () => {
    const ws = (id: string, name: string, images: number) =>
      ({ id, name, enabled: true, indexed: images, pending: 0, images, documents: 0, images_max: 1, documents_max: 1, paused_reason: null });
    const rows = [ws("a", "Studio", 40), ws("b", "Personal", 30), ws("c", "Clients", 30)];
    const startX = () => Number(document.querySelector('[data-testid="ai-donut-slice"]')!.getAttribute("d")!.split(" ")[1]);
    const arcFlag = () => document.querySelector('[data-testid="ai-donut-slice"]')!.getAttribute("d")!.split(" ")[8];

    mounted = await renderInLocale(<AiIndexDonut workspaces={rows} />, "en");
    expect(startX()).toBeGreaterThan(70);
    expect(arcFlag()).toBe("1");
    mounted.unmount();

    mounted = await renderInLocale(<AiIndexDonut workspaces={rows} />, "ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(startX()).toBeLessThan(70);
    expect(arcFlag()).toBe("0");
    expect(donutDirection("rtl")).toEqual({ sweep: -1, arcFlag: 0 });
    const slice = document.querySelector<SVGElement>('[data-testid="ai-donut-slice"]')!;
    await act(async () => { slice.focus(); });
    const tip = document.querySelector<HTMLElement>('[data-testid="ai-donut-tooltip"]')!;
    expect(tip).not.toBeNull();
    expect(tip.style.left).toBe("");
    expect(tip.style.right).toBe("");
    expect(read("src/components/workspaces/ai-index-donut.tsx")).toContain("insetInlineStart: 0");
    expect(physicalClassesIn(document.body)).toEqual([]);
  });
});

describe("map", () => {
  it("places the zoom control bottom-left in rtl and re-adds it on a direction change", () => {
    const src = read("src/pages/map.tsx");
    expect(src).toContain("dir === 'rtl' ? 'bottom-left' : 'bottom-right'");
    expect(src).toMatch(/\}, \[dir\]\);/);
    expect(src).not.toMatch(/addControl\(new maplibregl\.NavigationControl\([^)]*\), 'bottom-right'\)/);
  });
});

describe("text editor", () => {
  async function open(name: string) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "שלום" }));
    mounted = await renderInLocale(
      <TextEditorOverlay file={{ id: "f", name, mime_type: "text/plain" }} rawUrl="/raw" workspaceId="w" onClose={() => {}} onSaved={() => {}} />,
      "he",
    );
    await flush();
  }

  it("turns on per-line direction for a .md file", async () => {
    await open("notes.md");
    expect(cm.extensions).toContainEqual({ perLineTextDirection: true });
    expect(document.querySelector(".cm-editor, [class*='cm-editor']")?.closest('[dir="ltr"]') ?? null).toBeNull();
  });

  it("turns on per-line direction for plain text", async () => {
    await open("todo.txt");
    expect(cm.extensions).toContainEqual({ perLineTextDirection: true });
  });

  it("makes a .ts file left-to-right", async () => {
    await open("index.ts");
    expect(cm.extensions).not.toContainEqual({ perLineTextDirection: true });
    expect(document.querySelector('[dir="ltr"]')).not.toBeNull();
  });
});

describe("wrappers", () => {
  it("wraps Pintura and ONLYOFFICE in a left-to-right container", () => {
    expect(read("src/components/file-viewer.tsx")).toMatch(/<div ref=\{editorContainerRef\} dir="ltr"/);
    expect(read("src/pages/editor.tsx")).toMatch(/<div dir="ltr"[^>]*>\s*<div id="oo-editor"/);
  });
});
