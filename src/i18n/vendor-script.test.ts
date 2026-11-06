import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { intlTag, localeDir, RTL_LOCALES } from "./locales";

const webRoot = resolve(__dirname, "../..");
const script = resolve(webRoot, "scripts/vendor-i18n.mjs");

type Built = { files: Record<string, string>; shipped: string[]; skipped: Record<string, string[]> };

// The script is a plain ESM module (shebang, import.meta, top-level await), so run it in node,
// not through the test transformer. A thrown error comes back as a rejection.
async function buildOutputs(opts: Record<string, unknown>): Promise<Built> {
  const code = `
    import { buildOutputs } from ${JSON.stringify(script)};
    try {
      const r = await buildOutputs(${JSON.stringify(opts)});
      process.stdout.write(JSON.stringify({ ok: true, files: r.files, shipped: r.shipped, skipped: r.skipped }));
    } catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: e.message })); }
  `;
  const r = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
  if (!r.ok) throw new Error(r.error);
  return r;
}
const desktopRoot = resolve(webRoot, "../desktop");
const realCatalogDir = resolve(webRoot, "../../packages/i18n/web");

function tempCatalog(): string {
  const dir = mkdtempSync(join(tmpdir(), "web-i18n-"));
  for (const f of readdirSync(realCatalogDir)) if (f.endsWith(".json")) cpSync(join(realCatalogDir, f), join(dir, f));
  return dir;
}

// Monorepo-only: when apps/web is mirrored alone there is no packages/ or apps/desktop to read.
const inMonorepo = existsSync(realCatalogDir) && existsSync(desktopRoot);

// Each case parses all 39 real language files (some twice), which takes seconds under a full parallel run.
describe.skipIf(!inMonorepo)("vendor-i18n buildOutputs", { timeout: 30_000 }, () => {
  it("builds the outputs from the real catalog without writing files", async () => {
    const out = await buildOutputs({ webRoot, desktopRoot, catalogDir: realCatalogDir });
    expect(Object.keys(out.files)).toContain("src/i18n/keys.ts");
    expect(Object.keys(out.files)).toContain("src/i18n/messages/en.json");
    expect(Object.keys(out.files)).toContain("src/i18n/messages/pt-BR.json");
  });

  it("emits the direction table and the Intl tag map, and the vendored locales.ts is that output", async () => {
    const out = await buildOutputs({ webRoot, desktopRoot, catalogDir: realCatalogDir });
    expect(out.files["src/i18n/locales.ts"]).toBe(readFileSync(join(webRoot, "src/i18n/locales.ts"), "utf8"));
    expect(RTL_LOCALES).toEqual(["ar", "he", "fa"]);
    expect(localeDir("he")).toBe("rtl");
    expect(localeDir("de")).toBe("ltr");
    expect(intlTag("ar")).toBe("ar-u-nu-latn");
    expect(intlTag("en")).toBeUndefined();
    expect(intlTag("fa")).toBe("fa");
  });

  it("rejects an RTL entry that is not shipped", async () => {
    await expect(buildOutputs({ webRoot, desktopRoot, catalogDir: realCatalogDir, rtl: ["xx"] })).rejects.toThrow(/xx/);
  });

  it("rejects, naming the key, when a language file has a key the catalog lacks", async () => {
    const dir = tempCatalog();
    const tr = JSON.parse(readFileSync(join(dir, "tr.json"), "utf8"));
    tr["bogus.extra.key"] = "x";
    writeFileSync(join(dir, "tr.json"), JSON.stringify(tr));
    await expect(buildOutputs({ webRoot, desktopRoot, catalogDir: dir })).rejects.toThrow(/bogus\.extra\.key/);
  });

  // A root with no committed shipped.json, so the drop guard does not see the real one.
  const freshRoot = () => mkdtempSync(join(tmpdir(), "web-root-"));
  const catalogKey = (dir: string): string =>
    JSON.parse(readFileSync(join(dir, "en.catalog.json"), "utf8")).strings.find((x: { translate?: boolean }) => x.translate !== false).key;

  it("computes the shipped list and writes it to shipped.json, matching the vendored file", async () => {
    const out = await buildOutputs({ webRoot, desktopRoot, catalogDir: realCatalogDir });
    expect(out.files["src/i18n/shipped.json"]).toBe(readFileSync(join(webRoot, "src/i18n/shipped.json"), "utf8"));
    expect(out.shipped).toEqual(JSON.parse(out.files["src/i18n/shipped.json"]));
    for (const l of ["tr", "de", "ar", "he", "fa", "lt"]) expect(out.shipped).toContain(l);
  });

  it("leaves out a language missing one key, and keeps it as a candidate", async () => {
    const dir = tempCatalog();
    const de = JSON.parse(readFileSync(join(dir, "de.json"), "utf8"));
    delete de[catalogKey(dir)];
    writeFileSync(join(dir, "de.json"), JSON.stringify(de));
    const out = await buildOutputs({ webRoot: freshRoot(), desktopRoot, catalogDir: dir });
    expect(out.shipped).not.toContain("de");
    expect(out.skipped.de.join(" ")).toMatch(/missing 1 keys/);
    expect(out.files["src/i18n/loaders.ts"]).not.toContain("de:");
    expect(out.files["src/i18n/messages/de.json"]).toBeUndefined();
  });

  it("ships a candidate language as soon as it is complete (a copy of Indonesian, which like Chinese has only the other plural, ships as zh-Hans)", async () => {
    const dir = tempCatalog();
    cpSync(join(dir, "id.json"), join(dir, "zh-Hans.json"));
    const out = await buildOutputs({ webRoot: freshRoot(), desktopRoot, catalogDir: dir });
    expect(out.shipped).toContain("zh-Hans");
    expect(out.files["src/i18n/locales.ts"]).toContain('"zh-Hans": "简体中文"');
  });

  it("leaves out a language whose message drops a placeholder", async () => {
    const dir = tempCatalog();
    const cat = JSON.parse(readFileSync(join(dir, "en.catalog.json"), "utf8"));
    const withArg = cat.strings.find((x: { source: string }) => /\{[a-zA-Z]+\}/.test(x.source));
    const fr = JSON.parse(readFileSync(join(dir, "fr.json"), "utf8"));
    fr[withArg.key] = "sans argument";
    writeFileSync(join(dir, "fr.json"), JSON.stringify(fr));
    const out = await buildOutputs({ webRoot: freshRoot(), desktopRoot, catalogDir: dir });
    expect(out.shipped).not.toContain("fr");
    expect(out.skipped.fr.join(" ")).toContain(withArg.key);
  });

  it("refuses to drop a shipped language without --allow-drop", async () => {
    const root = freshRoot();
    mkdirSync(join(root, "src/i18n"), { recursive: true });
    writeFileSync(join(root, "src/i18n/shipped.json"), JSON.stringify(["de", "fr"]));
    const dir = tempCatalog();
    const de = JSON.parse(readFileSync(join(dir, "de.json"), "utf8"));
    delete de[catalogKey(dir)];
    writeFileSync(join(dir, "de.json"), JSON.stringify(de));
    await expect(buildOutputs({ webRoot: root, desktopRoot, catalogDir: dir })).rejects.toThrow(/without --allow-drop.*de/);
    const allowed = await buildOutputs({ webRoot: root, desktopRoot, catalogDir: dir, allowDrop: ["de"] });
    expect(allowed.shipped).not.toContain("de");
  });

  it("pins Thai to the Gregorian calendar once it ships, and gives Chinese its exact script tag", async () => {
    const dir = tempCatalog();
    cpSync(join(dir, "id.json"), join(dir, "th.json"));
    const out = await buildOutputs({ webRoot: freshRoot(), desktopRoot, catalogDir: dir });
    expect(out.files["src/i18n/locales.ts"]).toContain('"th":"th-u-ca-gregory"');
    expect(intlTag("zh-Hant")).toBe("zh-Hant");
  });
});
