#!/usr/bin/env node
// packages/e2ee-core and packages/e2ee-client are consumed two ways:
//   - apps/web depends on them via `file:` links, and vite/vitest are aliased
//     straight to their committed dist/ (see apps/web/vite.config.ts).
//   - packages/test-harness's e2ee-*.int.test.ts files import their `src`
//     directly (they aren't root npm workspace members).
// Either way, e2ee-core's own dependencies (libsodium-wrappers-sumo,
// @hpke/core, @hpke/chacha20poly1305, @cloudflare/voprf-ts) are bare
// specifiers that Node/vite resolve starting from e2ee-core's OWN location
// (packages/e2ee-core/{dist,src}/...), walking up through
// packages/e2ee-core/node_modules. Neither apps/web's nor the harness's
// fresh `npm ci` populates that directory — it's not a workspace member of
// either installer — so a genuinely fresh install fails with
// "Failed to resolve import "libsodium-wrappers-sumo" from
// ".../packages/e2ee-core/dist/sodium.js"".
//
// Running `npm ci` HERE, directly in packages/e2ee-core and
// packages/e2ee-client, gives each its own node_modules with those
// dependencies (and, for e2ee-client, a node_modules/@dosya-dev/e2ee-core
// symlink back to e2ee-core, whose node_modules resolution then finds the
// same deps). That makes both consumption paths work regardless of where
// this script is invoked from.
//
// Called from:
//   - .github/workflows/tests.yml (gate/web, gate/api-integration)
//   - apps/web's `build` script (so the Cloudflare Pages build — which just
//     runs `npm run build` in apps/web and can't run extra dashboard steps —
//     bootstraps these packages itself)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

for (const pkg of ["e2ee-core", "e2ee-client"]) {
  const dir = path.join(repoRoot, "packages", pkg);
  console.log(`[bootstrap-e2ee-packages] npm ci in packages/${pkg}`);
  execFileSync("npm", ["ci"], { cwd: dir, stdio: "inherit" });
}
