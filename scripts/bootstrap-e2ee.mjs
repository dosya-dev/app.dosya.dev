#!/usr/bin/env node
// packages/e2ee-core and packages/e2ee-client build to a fully self-contained,
// bundled ESM dist/index.js (every third-party dep -- libsodium-wrappers-sumo,
// @hpke/core, @hpke/chacha20poly1305, @cloudflare/voprf-ts -- inlined by
// esbuild; e2ee-client's dist also inlines e2ee-core). apps/web consumes ONLY
// that committed dist (aliased directly in vite.config.ts/vitest.config.ts),
// so its own `npm ci` needs nothing from this script anymore.
//
// packages/test-harness's e2ee-*.int.test.ts files are different: they import
// e2ee-client's `src` directly (neither package is a root npm workspace
// member), and e2ee-client's src bare-imports "@dosya-dev/e2ee-core", which in
// turn bare-imports libsodium-wrappers-sumo/@hpke/*/@cloudflare/voprf-ts --
// specifiers Node/vite resolve starting from e2ee-core's OWN location
// (packages/e2ee-core/src/...), walking up through
// packages/e2ee-core/node_modules. A fresh root `npm ci` never populates that
// directory (it's not a workspace member), so the harness needs it bootstrapped
// separately. This script does that: `npm ci` in packages/e2ee-core and
// packages/e2ee-client gives each its own node_modules with those
// dependencies (and, for e2ee-client, a node_modules/@dosya-dev/e2ee-core
// symlink back to e2ee-core).
//
// Called from:
//   - .github/workflows/tests.yml, gate/api-integration only (gate/web no
//     longer needs it -- see above)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Prefer re-invoking the exact npm that's already running us
// (process.env.npm_execpath, set whenever this runs under an `npm run`/`npm
// ci` invocation) through the current Node binary directly -- no shell, no
// PATH lookup for "npm" (which is exactly what broke in CF's build
// environment: ENOENT / cwd quirks resolving a bare "npm" command). Fall back
// to a shell-resolved "npm ci" for the rare case this script is invoked some
// other way (e.g. directly via `node bootstrap-e2ee.mjs` with no npm parent).
function runNpmCi(cwd) {
  if (process.env.npm_execpath) {
    execFileSync(process.execPath, [process.env.npm_execpath, "ci"], { cwd, stdio: "inherit" });
    return;
  }
  execFileSync("npm ci", { cwd, stdio: "inherit", shell: true });
}

for (const pkg of ["e2ee-core", "e2ee-client"]) {
  const dir = path.join(repoRoot, "packages", pkg);
  console.log(`[bootstrap-e2ee-packages] npm ci in packages/${pkg}`);
  runNpmCi(dir);
}
