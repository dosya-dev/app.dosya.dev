/**
 * RTL source gate, at zero. Every physical-direction utility or inline style in
 * src/ is either converted to its logical form or sits on a line (or under a
 * line) carrying `rtl-ok: <reason>`, and the reason begins with one of the
 * allowed reasons. The vendored marketing demo is the one exempt tree: it is
 * pinned to left-to-right by src/i18n/rtl-sweeps/l.test.tsx.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { ALLOWED_REASONS, checkGate, markedLines, reasonError, scanTree } from "../../scripts/rtl-codemod.mjs";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "rtl-gate-"));
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, "src", name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

describe("rtl gate (fixture tree)", () => {
  it("fails an unmarked ml-2 naming file and line", () => {
    const root = fixture({ "a.tsx": 'const x = 1;\nexport const A = () => <div className="ml-2" />;\n' });
    const errors = checkGate(scanTree(root));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("src/a.tsx:2");
    expect(errors[0]).toContain("ml-2");
  });

  it("passes with rtl-ok on the line or the line above", () => {
    const same = fixture({ "a.tsx": '<div className="ml-2" /> // rtl-ok: media timeline\n' });
    expect(checkGate(scanTree(same))).toEqual([]);
    const above = fixture({ "a.tsx": '// rtl-ok: media timeline\n<div className="ml-2" />\n' });
    expect(checkGate(scanTree(above))).toEqual([]);
  });

  it("counts inline style keys and textAlign as physical", () => {
    for (const body of ["{ paddingLeft: 4 }", "{ marginRight: 4 }", "{ left: 0 }", "{ right: 0 }", "{ textAlign: 'left' }"]) {
      const root = fixture({ "a.ts": `export const s = ${body};\n` });
      expect(checkGate(scanTree(root)), body).toHaveLength(1);
    }
  });

  it("scans css and ignores tests", () => {
    const root = fixture({ "a.css": ".a { margin-left: 4px }\n", "b.test.tsx": '<div className="ml-2" />\n' });
    expect(Object.keys(scanTree(root))).toEqual(["src/a.css"]);
  });

  it("allows no growth: two findings are two errors", () => {
    const root = fixture({ "a.tsx": '<div className="ml-2 mr-2" />\n', "b.tsx": '<div className="pl-2" />\n' });
    expect(checkGate(scanTree(root))).toHaveLength(3);
  });

  it("requires a reason after rtl-ok:", () => {
    const empty = fixture({ "a.tsx": '<div className="ml-2" /> // rtl-ok:\n' });
    expect(checkGate(scanTree(empty))).toHaveLength(1);
    const blank = fixture({ "a.tsx": '<div className="ml-2" /> // rtl-ok:   \n' });
    expect(checkGate(scanTree(blank))).toHaveLength(1);
  });

  it("ignores centering pairs and logical classes", () => {
    const root = fixture({ "a.tsx": '<div className="absolute left-1/2 -translate-x-1/2 ms-2 text-start" />\n' });
    expect(checkGate(scanTree(root))).toEqual([]);
  });

  it("skips the vendored demo tree and nothing else", () => {
    const root = fixture({
      "components/demo/A.tsx": '<div className="ml-2" />\n',
      "components/demos/B.tsx": '<div className="ml-2" />\n',
    });
    expect(Object.keys(scanTree(root))).toEqual(["src/components/demos/B.tsx"]);
  });
});

describe("rtl-ok reasons", () => {
  it("lists the allowed reasons", () => {
    expect(ALLOWED_REASONS).toEqual([
      "centering",
      "pointer coordinates",
      "canvas coordinates",
      "media timeline",
      "code",
      "map",
      "mirrored",
      "physical geometry",
      "rtl selector",
    ]);
  });

  it("accepts a reason that begins with an allowed one, as a whole word", () => {
    for (const r of ["media timeline", "media timeline, time runs left to right", "mirrored, rtl: counterpart on the same element", "code: a slot name", "Map marker", "physical geometry; symmetric triangle"]) {
      expect(reasonError(r), r).toBeNull();
    }
  });

  it("rejects an unknown reason and a prefix that is part of a longer word", () => {
    for (const r of ["because I said so", "rtl: counterpart on the same element", "codec", "mapping", "centered"]) {
      expect(reasonError(r), r).not.toBeNull();
    }
  });

  it("reads every marker with its reason from a fixture", () => {
    const root = fixture({ "a.tsx": '{/* rtl-ok: mirrored, a pair */}\n<div className="ml-2" /> // rtl-ok: media timeline\n' });
    expect(markedLines(root)).toEqual([
      { file: "src/a.tsx", line: 1, reason: "mirrored, a pair" },
      { file: "src/a.tsx", line: 2, reason: "media timeline" },
    ]);
  });
});

describe("rtl gate (real source)", () => {
  const webRoot = resolve(__dirname, "../..");

  it("has no physical-direction use outside an rtl-ok line", () => {
    expect(checkGate(scanTree(webRoot))).toEqual([]);
  });

  it("gives every rtl-ok line an allowed reason, and lists them for review", () => {
    const marked = markedLines(webRoot) as Array<{ file: string; line: number; reason: string }>;
    // The audit list: file:line and the reason, so a reviewer can read them all.
    process.stdout.write(`rtl-ok lines (${marked.length}):\n${marked.map((m) => `  ${m.file}:${m.line}  ${m.reason}`).join("\n")}\n`);
    expect(marked.length).toBeGreaterThan(0);
    const bad = marked.map((m) => ({ m, e: reasonError(m.reason) })).filter((x) => x.e);
    expect(bad.map((x) => `${x.m.file}:${x.m.line} ${x.e}`)).toEqual([]);
  });
});
