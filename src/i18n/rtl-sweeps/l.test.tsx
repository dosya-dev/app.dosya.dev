/**
 * RTL sweep, unit L: lib, hooks, stores and api must hold no unmarked physical
 * direction. src/components/demo is a vendored copy of the marketing demo
 * (demo-vendor-sync keeps the two trees byte-equal), so it cannot be converted
 * or marked here: the gate exempts it (VENDORED_LTR) on the condition that it
 * renders only inside a dir="ltr" wrapper, which these tests pin.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { VENDORED_LTR, scanTree } from "../../../scripts/rtl-codemod.mjs";

const webRoot = resolve(__dirname, "../../..");
const scan = scanTree(webRoot) as Record<string, unknown[]>;

const OWNED = ["src/lib/", "src/hooks/", "src/stores/", "src/api/"];
// Shared primitives owned by the foundation task, not by this unit.
const NOT_MINE = new Set(["src/lib/utils.ts"]);

describe("rtl sweep L", () => {
  it("has no physical direction left in lib, hooks, stores and api", () => {
    const left = Object.keys(scan).filter((f) => OWNED.some((p) => f.startsWith(p)) && !NOT_MINE.has(f));
    expect(left).toEqual([]);
  });

  // The deploy repo holds only apps/web, so the marketing tree is not there to compare.
  it.skipIf(!existsSync(resolve(webRoot, "../../src/components/demo")))("keeps the vendored demo byte-equal to the marketing source", () => {
    const repo = resolve(webRoot, "../..");
    const out = execFileSync("diff", ["-r", "src/components/demo", "apps/web/src/components/demo"], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(out).toBe("");
  });

  it("exempts only the vendored demo tree", () => {
    expect(VENDORED_LTR).toEqual(["src/components/demo/"]);
  });

  it("renders the demo only inside a dir=ltr wrapper", () => {
    const src = resolve(webRoot, "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) files.push(p);
      }
    };
    walk(src);
    const users = files.filter((f) => !relative(src, f).startsWith("components/demo/") && /components\/demo\//.test(readFileSync(f, "utf8")));
    expect(users.map((f) => relative(src, f))).toEqual(["pages/welcome.tsx"]);
    const welcome = readFileSync(resolve(src, "pages/welcome.tsx"), "utf8");
    // Every demo element is preceded by a dir="ltr" opening tag (an ancestor in the same expression).
    const demos = [...welcome.matchAll(/<(WebDemo|DesktopDemo|MobileDemo)\b/g)];
    expect(demos.length).toBe(4);
    for (const m of demos) {
      const before = welcome.slice(0, m.index);
      expect(before.lastIndexOf('dir="ltr"')).toBeGreaterThan(before.lastIndexOf("preview={"));
    }
  });
});
