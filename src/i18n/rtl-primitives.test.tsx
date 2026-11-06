/**
 * RTL behaviour of the UI primitives: sheet sides resolve through the page
 * direction, the sidebar uses inline-start rules, Base UI parts follow the
 * direction provider, and the global CSS carries the right-to-left rules.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar, SidebarProvider, SidebarRail } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { physicalClassesIn, renderInLocale, unflippedIcons, type Rendered } from "../../tests/helpers/i18n-sweep";

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

// jsdom has no matchMedia; the sidebar's mobile hook asks for it.
beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
});

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const sheetSide = () => document.querySelector('[data-slot="sheet-content"]')?.getAttribute("data-side");

describe("Sheet side", () => {
  it("start is the right edge in Arabic and the left edge in English", async () => {
    const ui = (
      <Sheet open>
        <SheetContent side="start"><SheetTitle>t</SheetTitle></SheetContent>
      </Sheet>
    );
    mounted = await renderInLocale(ui, "ar");
    expect(sheetSide()).toBe("right");
    mounted.unmount();
    mounted = await renderInLocale(ui, "en");
    expect(sheetSide()).toBe("left");
  });

  it("end is the opposite edge, and physical sides stay as given", async () => {
    mounted = await renderInLocale(
      <Sheet open><SheetContent side="end"><SheetTitle>t</SheetTitle></SheetContent></Sheet>,
      "ar",
    );
    expect(sheetSide()).toBe("left");
    mounted.unmount();
    mounted = await renderInLocale(
      <Sheet open><SheetContent side="left"><SheetTitle>t</SheetTitle></SheetContent></Sheet>,
      "ar",
    );
    expect(sheetSide()).toBe("left");
  });
});

describe("Sidebar", () => {
  it("positions by inline-start rules, with no physical edge classes", async () => {
    mounted = await renderInLocale(
      <SidebarProvider><Sidebar><div>menu</div></Sidebar></SidebarProvider>,
      "ar",
    );
    const container = document.querySelector('[data-slot="sidebar-container"]')!;
    expect(container.className).toContain("data-[side=left]:inset-s-0");
    expect(container.className).toContain("data-[side=right]:inset-e-0");
    expect(container.className).toContain("group-data-[side=left]:border-e");
    expect(container.getAttribute("data-side")).toBe("left");
    expect(physicalClassesIn(document.body)).toEqual([]);
  });

  it("the rail centre shift mirrors", async () => {
    mounted = await renderInLocale(
      <SidebarProvider><Sidebar><SidebarRail /></Sidebar></SidebarProvider>,
      "ar",
    );
    const rail = document.querySelector('[data-slot="sidebar-rail"]')!;
    expect(rail.className).toContain("ltr:-translate-x-1/2");
    expect(rail.className).toContain("rtl:translate-x-1/2");
    expect(rail.className).toContain("group-data-[side=left]:-inset-e-4");
  });
});

describe("Base UI direction", () => {
  const tabs = (
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">A</TabsTrigger>
        <TabsTrigger value="b">B</TabsTrigger>
        <TabsTrigger value="c">C</TabsTrigger>
      </TabsList>
      <TabsContent value="a">a</TabsContent>
    </Tabs>
  );

  const press = (key: string) =>
    act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

  it("ArrowLeft moves to the next tab in Arabic and to the last in English", async () => {
    mounted = await renderInLocale(tabs, "ar");
    const triggers = () => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
    await act(async () => triggers()[0].focus());
    await press("ArrowLeft");
    expect(document.activeElement).toBe(triggers()[1]);
    mounted.unmount();

    mounted = await renderInLocale(tabs, "en");
    await act(async () => triggers()[0].focus());
    await press("ArrowLeft");
    expect(document.activeElement).toBe(triggers()[2]);
  });
});

describe("flipped icons", () => {
  it("the dropdown submenu chevron flips", async () => {
    mounted = await renderInLocale(
      <DropdownMenu open>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>x</DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
      "ar",
    );
    const icon = document.querySelector('[data-slot="dropdown-menu-sub-trigger"] svg')!;
    expect(icon.getAttribute("class")).toContain("rtl:-scale-x-100");
    expect(unflippedIcons(document.body)).toEqual([]);
  });

  it("the breadcrumb separator flips", async () => {
    mounted = await renderInLocale(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>a</BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>b</BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
      "ar",
    );
    const icon = document.querySelector('[data-slot="breadcrumb-separator"] svg')!;
    expect(icon.getAttribute("class")).toContain("rtl:-scale-x-100");
    expect(unflippedIcons(document.body)).toEqual([]);
  });
});

describe("primitives rendered open are direction-clean", () => {
  it("has no physical classes and no unflipped icons", async () => {
    mounted = await renderInLocale(
      <TooltipProvider>
        <Dialog open><DialogContent><DialogTitle>d</DialogTitle></DialogContent></Dialog>
        <Sheet open><SheetContent side="start"><SheetTitle>s</SheetTitle></SheetContent></Sheet>
        <DropdownMenu open>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>x</DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip open><TooltipTrigger>t</TooltipTrigger><TooltipContent>tip</TooltipContent></Tooltip>
        <Progress value={40} />
        <Badge>b</Badge>
        <Button>go</Button>
        <Breadcrumb><BreadcrumbList><BreadcrumbItem>a</BreadcrumbItem><BreadcrumbSeparator /></BreadcrumbList></Breadcrumb>
        <SidebarProvider><Sidebar><div>menu</div></Sidebar></SidebarProvider>
      </TooltipProvider>,
      "ar",
    );
    expect(physicalClassesIn(document.body)).toEqual([]);
    expect(unflippedIcons(document.body)).toEqual([]);
  });
});

describe("global CSS", () => {
  const css = read("src/index.css");

  it("isolates code and technical values", () => {
    expect(css).toContain('[dir="rtl"] :is(pre, code, kbd, samp) { direction: ltr; unicode-bidi: isolate; }');
    expect(css).toContain(
      '[dir="rtl"] input:is([type=email], [type=url], [type=tel], [type=password], [type=number]) { direction: ltr; text-align: right; }',
    );
  });

  it("keeps the Latin-value text-align in a layer so utilities still win", () => {
    const rule = css.indexOf('[dir="rtl"] input:is([type=email]');
    const layer = css.lastIndexOf("@layer base {", rule);
    expect(layer).toBeGreaterThan(-1);
    // Nothing closes the layer between its opening and the rule.
    expect(css.slice(layer, rule)).not.toContain("}");
  });

  it("lets free text take its own direction", () => {
    expect(css).toContain(
      '[dir="rtl"] :is(input:not([type]), input[type=text], input[type=search], textarea) { unicode-bidi: plaintext; }',
    );
  });

  it("drops letter-spacing for Arabic and Persian only", () => {
    // The |= form also covers regional tags such as ar-EG, and the pseudo-elements.
    expect(css).toContain(':root:is([lang|="ar"], [lang|="fa"]) *,');
    expect(css).toContain(':root:is([lang|="ar"], [lang|="fa"]) *::before,');
    expect(css).toContain(':root:is([lang|="ar"], [lang|="fa"]) *::after { letter-spacing: normal; }');
    expect(css).not.toMatch(/\[lang\|?="he"\]/);
  });

  it("mirrors the slide animations", () => {
    expect(css).toMatch(/@keyframes panel-slide-in-rtl \{\s*from \{ transform: translateX\(-40px\)/);
    expect(css).toContain('[dir="rtl"] .animate-panel-slide-in { animation-name: panel-slide-in-rtl; }');
    expect(css).toMatch(/@keyframes indeterminate-slide-rtl/);
    expect(css).toContain('[dir="rtl"] .hairline { transform: translateX(100%); }');
    expect(css).toContain('[dir="rtl"] .hairline[data-state="running"] { transform: translateX(15%); }');
  });
});

describe("toast", () => {
  it("sits at the inline end", () => {
    toast.info("hello");
    const root = document.getElementById("toast-root")!;
    expect(root.style.cssText).toContain("inset-inline-end");
    expect(root.style.cssText).not.toMatch(/(^|;)\s*right:/);
  });
});

describe("slide-in direction on inline sides", () => {
  it("splits every inline-start and inline-end slide into ltr: and rtl: forms", () => {
    for (const file of ["dropdown-menu.tsx", "select.tsx"]) {
      const src = readFileSync(resolve(__dirname, "../components/ui", file), "utf8");
      expect(src, file).not.toMatch(/data-\[side=inline-(?:start|end)\]:slide-in-from-(?:left|right)/);
      for (const side of ["inline-end", "inline-start"]) {
        for (const dir of ["ltr", "rtl"]) {
          expect(src, `${file} ${side} ${dir}`).toContain(`data-[side=${side}]:${dir}:slide-in-from-`);
        }
      }
    }
  });
});
