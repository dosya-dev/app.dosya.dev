// Refreshes apps/web's vendored copy of the marketing demo components.
//
// Run this by hand when the marketing demos change. It is deliberately NOT
// part of any build: apps/web is synced to its deploy repo as ROOT, so the
// source path below does not exist on Cloudflare. A build-time copy would
// work locally and in CI and then silently vanish in production - the same
// trap that produced TS2307 for the e2ee packages. The vendored copy is
// checked in, and this script only makes refreshing it cheap.
//
//   node scripts/vendor-demos.mjs
import { cp, rm, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../../src/components/demo');
const dest = resolve(here, '../src/components/demo');

try {
  await access(source);
} catch {
  console.error(`Marketing demo source not found at ${source}.`);
  console.error('Run this from a full monorepo checkout, not the deploy repo.');
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await cp(source, dest, { recursive: true });
console.log(`Vendored demo components from ${source} to ${dest}`);
