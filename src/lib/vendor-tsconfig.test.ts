import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vite's oxc transform loads a tsconfig for EVERY .ts file it touches, walking
 * up from the file until it finds one that actually covers it. apps/web's own
 * tsconfig.json is a solution stub (`files: []` plus references) and
 * tsconfig.app.json includes only "src", so before vendor/ carried its own
 * config the walk escaped apps/web entirely and landed on the repo-root
 * tsconfig - which `extends: "astro/tsconfigs/strict"` and therefore needs the
 * ROOT node_modules. CI's web job runs `npm ci` inside apps/web and nowhere
 * else, so that extends was unresolvable there and every suite importing
 * @dosya-dev/audio-player died with "[TSCONFIG_ERROR] Failed to load tsconfig
 * ... Tsconfig not found", while dev machines - which do have the root deps -
 * passed. The bug is invisible from inside apps/web unless something asserts
 * the lookup terminates here, which is what these tests do.
 */

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vendorRoot = path.join(appRoot, 'vendor');

function vendoredTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return vendoredTsFiles(full);
    return entry.isFile() && full.endsWith('.ts') && !full.endsWith('.d.ts') ? [full] : [];
  });
}

function readTsconfig(file: string): Record<string, unknown> {
  // tsconfigs here are JSONC: strip line comments and trailing commas.
  const raw = readFileSync(file, 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw) as Record<string, unknown>;
}

/** A `files: []` + references config configures nothing; resolvers walk past it. */
function isSolutionStub(config: Record<string, unknown>): boolean {
  return Array.isArray(config.files) && config.files.length === 0 && !config.include;
}

/** The first tsconfig.json above `file` that a resolver would actually stop at. */
function nearestConfiguringTsconfig(file: string): string | null {
  let dir = path.dirname(file);
  for (;;) {
    const candidate = path.join(dir, 'tsconfig.json');
    if (existsSync(candidate) && !isSolutionStub(readTsconfig(candidate))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

describe('vendored TypeScript tsconfig resolution', () => {
  it('finds vendored .ts sources to guard', () => {
    expect(vendoredTsFiles(vendorRoot).length).toBeGreaterThan(0);
  });

  it('never escapes apps/web looking for a tsconfig', () => {
    const escaping = vendoredTsFiles(vendorRoot).filter((file) => {
      const found = nearestConfiguringTsconfig(file);
      return found === null || !found.startsWith(appRoot + path.sep);
    });
    expect(escaping.map((f) => path.relative(appRoot, f))).toEqual([]);
  });

  it('keeps the vendor tsconfig extends chain inside apps/web', () => {
    let config = path.join(vendorRoot, 'tsconfig.json');
    expect(existsSync(config)).toBe(true);
    // A bare specifier ("astro/tsconfigs/strict") is what broke CI; only
    // relative hops that land inside apps/web are safe here.
    for (let hop = 0; hop < 10; hop++) {
      const parent = readTsconfig(config).extends;
      if (parent === undefined) return;
      expect(typeof parent).toBe('string');
      expect(parent as string).toMatch(/^\.\.?\//);
      config = path.resolve(path.dirname(config), parent as string);
      expect(config.startsWith(appRoot + path.sep)).toBe(true);
      expect(existsSync(config)).toBe(true);
    }
    throw new Error('tsconfig extends chain did not terminate');
  });
});
