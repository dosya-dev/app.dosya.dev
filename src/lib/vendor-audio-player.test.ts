/**
 * apps/web/vendor/audio-player is a COPY of packages/audio-player/src, taken
 * by scripts/vendor-audio-player.mjs. It has to be a copy: CI syncs only
 * apps/web/ to the deploy repo Cloudflare Pages builds, so a path pointing at
 * ../../packages resolves in the monorepo and fails there.
 *
 * The cost of a copy is that it goes stale silently - the app keeps building
 * against yesterday's parser and the bug you just fixed is still shipping.
 * This fails the moment the two diverge, and the fix is always the same:
 * `node scripts/vendor-audio-player.mjs`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const VENDOR = join(__dirname, '../../vendor/audio-player');
const PACKAGE = join(__dirname, '../../../../packages/audio-player/src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    if (e.name.endsWith('.test.ts')) return [];
    return [full];
  });
}

describe('vendored audio-player', () => {
  // The deploy repo has apps/web only, so there is nothing to compare against
  // there. Skipping is correct; failing would break that build for no reason.
  const inMonorepo = existsSync(PACKAGE);

  it('matches packages/audio-player file for file', () => {
    if (!inMonorepo) return;
    const pkg = walk(PACKAGE).map((f) => relative(PACKAGE, f)).sort();
    const vendored = walk(VENDOR).map((f) => relative(VENDOR, f)).sort();
    expect(vendored).toEqual(pkg);
  });

  it('matches packages/audio-player byte for byte - re-run scripts/vendor-audio-player.mjs if this fails', () => {
    if (!inMonorepo) return;
    for (const f of walk(PACKAGE)) {
      const rel = relative(PACKAGE, f);
      expect(readFileSync(join(VENDOR, rel), 'utf8'), `${rel} is stale`).toBe(readFileSync(f, 'utf8'));
    }
  });
});
