#!/usr/bin/env node
// Vendor what on-device Personas needs INTO apps/web, for the same reason as
// scripts/vendor-e2ee.mjs: only apps/web travels to the deploy repo, so
// nothing may resolve through ../../packages at build time.
//
// - packages/personas-engine/dist -> vendor/personas-engine: the engine as
//   one ESM bundle plus .d.ts. @dosya-dev/e2ee-core stays an EXTERNAL import
//   there, so it resolves to the app's own vendored e2ee-core and the crypto
//   backend is shared (one libsodium init). Build it first:
//   (cd packages/personas-engine && npm run build)
// - packages/face-reader/dist/face_reader.{js,d.ts} -> vendor/face-reader:
//   the wasm-bindgen glue only. The 15 MB face_reader_bg.wasm is NOT
//   vendored; the reader worker fetches it from
//   /api/personas/models/face_reader_bg.wasm and checks its SHA-256 before
//   instantiating it with initSync. The glue's default-init fallback,
//   `new URL('face_reader_bg.wasm', import.meta.url)`, is replaced with a
//   throw: the app never uses it, and a bundler would otherwise go looking
//   for a wasm file that is deliberately not here.
//
// MONOREPO-ONLY step. Re-run whenever either package changes, then commit vendor/.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const packages = resolve(webRoot, '../../packages');

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

// The engine.
const engineDist = resolve(packages, 'personas-engine', 'dist');
if (!existsSync(resolve(engineDist, 'index.js'))) {
  fail(`missing ${engineDist} - build it first: (cd packages/personas-engine && npm run build)`);
}
const engineDest = resolve(webRoot, 'vendor', 'personas-engine');
rmSync(engineDest, { recursive: true, force: true });
cpSync(engineDist, engineDest, { recursive: true });
console.log('✓ vendored personas-engine -> apps/web/vendor/personas-engine');

// The face reader glue.
const readerDist = resolve(packages, 'face-reader', 'dist');
const readerDest = resolve(webRoot, 'vendor', 'face-reader');
const FALLBACK = "module_or_path = new URL('face_reader_bg.wasm', import.meta.url);";
const glue = readFileSync(resolve(readerDist, 'face_reader.js'), 'utf8');
if (glue.split(FALLBACK).length !== 2) fail('face_reader.js: the default-init wasm URL is not there exactly once; update this script');
rmSync(readerDest, { recursive: true, force: true });
mkdirSync(readerDest, { recursive: true });
writeFileSync(
  resolve(readerDest, 'face_reader.js'),
  glue.replace(FALLBACK, "throw new Error('face_reader: pass the verified wasm module to initSync');"),
);
cpSync(resolve(readerDist, 'face_reader.d.ts'), resolve(readerDest, 'face_reader.d.ts'));
console.log('✓ vendored face-reader glue -> apps/web/vendor/face-reader');
