#!/usr/bin/env node
// Vendor the bundled e2ee package dists INTO apps/web so the app is fully
// self-contained.
//
// WHY: CI (.github/workflows/sync-public-repos.yml → the `sync-web` job) pushes
// ONLY `apps/web/` to the deploy repo dosya-dev/app.dosya.dev, which Cloudflare
// Pages builds with apps/web as the repo ROOT. In that repo there is no
// `../../packages/` sibling - so anything referencing `../../packages/*`
// (the `file:` deps in package.json, or tsconfig `paths` → ../../packages/*/dist)
// escapes the repo. npm ci silently creates a dangling symlink for the file:
// dep, then `tsc -b` / `vite build` can't find the module → TS2307 and the CF
// build fails. Committing dist inside packages/ cannot help: packages/ never
// travels with the apps/web-only sync.
//
// Copying each package's self-contained bundled dist into apps/web/vendor/
// keeps the import path in-tree (./vendor/...), so it survives the sync and
// builds on CF without the rest of the monorepo. The e2ee packages' dist is
// already a single bundled index.js (all third-party deps + e2ee-core inlined
// by esbuild) plus emitted .d.ts files; we copy the whole dist so the type
// re-exports (index.d.ts -> ./api.js, and e2ee-client -> @dosya-dev/e2ee-core)
// all resolve.
//
// This is a MONOREPO-ONLY step: it reads ../../packages/*/dist (which exists
// only in the monorepo) and writes the committed apps/web/vendor artifact.
// Re-run it whenever the e2ee packages change, then commit vendor/.
import { cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const packages = ['e2ee-core', 'e2ee-client'];

for (const name of packages) {
  const src = resolve(webRoot, '../../packages', name, 'dist');
  if (!existsSync(src)) {
    console.error(`✖ missing ${src} - build the package first: (cd packages/${name} && npm run build)`);
    process.exit(1);
  }
  const dest = resolve(webRoot, 'vendor', name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`✓ vendored ${name} -> apps/web/vendor/${name}`);
}
