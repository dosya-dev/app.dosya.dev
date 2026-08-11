#!/usr/bin/env node
// Vendor packages/audio-player's SOURCE into apps/web so the app is fully
// self-contained.
//
// WHY: same reason vendor-e2ee.mjs exists. CI (sync-public-repos.yml ->
// `sync-web`) pushes ONLY `apps/web/` to the deploy repo Cloudflare Pages
// builds, with apps/web as the repo ROOT. In that repo there is no
// `../../packages/` sibling, so a vite alias or tsconfig path pointing there
// resolves in the monorepo and fails on Cloudflare - TS2307, red build. The
// dev server would refuse it too: server.fs.strict is on and `allow` does not
// include ../../packages.
//
// Unlike the e2ee packages this one has no build step - it is plain
// TypeScript with no third-party dependency - so the vendored artifact is
// simply its src/ tree, which Vite compiles as ordinary project source.
//
// This is a MONOREPO-ONLY step. Re-run it whenever packages/audio-player
// changes, then commit vendor/.
import { cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const src = resolve(webRoot, '../../packages/audio-player/src');

if (!existsSync(src)) {
  console.error(`✖ missing ${src}`);
  process.exit(1);
}

const dest = resolve(webRoot, 'vendor/audio-player');
rmSync(dest, { recursive: true, force: true });
// Tests stay in the package - vendoring them would put them in the app's
// vitest include and run the same assertions twice.
cpSync(src, dest, { recursive: true, filter: (p) => !p.endsWith('.test.ts') });
console.log('✓ vendored audio-player -> apps/web/vendor/audio-player');
