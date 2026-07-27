/**
 * SPIKE — throwaway de-risking page for the E2EE web client (feat/e2ee-core).
 *
 * Proves `@dosya-dev/e2ee-core` (libsodium-wrappers-sumo WASM, Argon2id,
 * WebCrypto-backed HPKE, @cloudflare/voprf-ts) actually runs inside a real
 * Chromium tab under apps/web's Vite build/dev-server — NOT just Node/vitest
 * or the workerd runtime. This is the last unproven runtime for the E2EE
 * design before any real UI is built on top of it.
 *
 * A later task that builds the real E2EE unlock/upload UI REMOVES this page,
 * its route, and the Playwright spec (`tests/e2e/e2ee-browser-check.spec.ts`).
 * Do not build real product UI on top of this file.
 *
 * On mount, runs an in-browser crypto round-trip and writes a
 * machine-readable JSON result into `#e2ee-result` so a Playwright test can
 * assert on it without any UI-specific selectors.
 */
import { useEffect, useState } from 'react';
import {
  getSodium,
  aeadEncrypt,
  aeadDecrypt,
  deriveKEK,
  generateSignKeyPair,
  sign,
  verify,
  oprfBlind,
  encryptFile,
  decryptFile,
  randomBytes,
  utf8,
  toHex,
  eq,
  type FileManifest,
} from '@dosya-dev/e2ee-core';
// VOPRF server role, imported directly so the whole blind -> evaluate ->
// finalize round trip is provable from a single browser tab, with no
// network dependency on apps/api. Mirrors apps/api's
// src/lib/e2ee/voprf-server.ts, but with an ephemeral, spike-only key.
import { Oprf, VOPRFServer, EvaluationRequest, generatePublicKey, randomPrivateKey } from '@cloudflare/voprf-ts';
import { CryptoNoble } from '@cloudflare/voprf-ts/crypto-noble';

Oprf.Crypto = CryptoNoble;
const OPRF_SUITE = Oprf.Suite.RISTRETTO255_SHA512;

type StepResult = {
  name: string;
  pass: boolean;
  ms: number;
  detail?: string;
  error?: string;
};

type SpikeResult = {
  ready: boolean;
  userAgent: string;
  steps: StepResult[];
  allPassed: boolean;
};

async function timeStep(name: string, fn: () => Promise<string | void>): Promise<StepResult> {
  const t0 = performance.now();
  try {
    const detail = (await fn()) ?? undefined;
    return { name, pass: true, ms: performance.now() - t0, detail };
  } catch (err) {
    return {
      name,
      pass: false,
      ms: performance.now() - t0,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}

async function runSpike(): Promise<SpikeResult> {
  const steps: StepResult[] = [];

  // 1. Sodium WASM init.
  steps.push(
    await timeStep('sodium.ready', async () => {
      const s = await getSodium();
      if (typeof s.crypto_aead_xchacha20poly1305_ietf_encrypt !== 'function') {
        throw new Error('sodium loaded but AEAD binding missing');
      }
      return 'libsodium-wrappers-sumo WASM initialized';
    }),
  );

  // 2. AEAD round trip (XChaCha20-Poly1305).
  let aeadKey: Uint8Array | null = null;
  steps.push(
    await timeStep('aead.roundtrip', async () => {
      aeadKey = await randomBytes(32);
      const ad = utf8('spike-ad');
      const plaintext = utf8('the quick brown fox jumps over the lazy dog');
      const { nonce, ciphertext } = await aeadEncrypt(aeadKey, plaintext, ad);
      const decrypted = await aeadDecrypt(aeadKey, nonce, ciphertext, ad);
      if (!eq(decrypted, plaintext)) throw new Error('decrypted plaintext mismatch');
      return `${ciphertext.length}B ciphertext round-tripped`;
    }),
  );

  // 3. Argon2id KEK derivation — INTERACTIVE tier (memory-heavy tiers are
  // noted as a follow-up risk, not exercised here: see task instructions).
  steps.push(
    await timeStep('argon2id.deriveKEK(interactive)', async () => {
      const hardenedSecret = await randomBytes(32); // stand-in for a VOPRF output
      const salt = await randomBytes(16);
      const kek = await deriveKEK(hardenedSecret, salt, 'interactive');
      if (kek.length !== 32) throw new Error(`unexpected KEK length ${kek.length}`);
      return '32-byte KEK derived (Argon2id, OPSLIMIT/MEMLIMIT_INTERACTIVE)';
    }),
  );

  // 4. Ed25519 sign/verify.
  steps.push(
    await timeStep('ed25519.sign+verify', async () => {
      const kp = await generateSignKeyPair();
      const msg = utf8('sign me');
      const sig = await sign(msg, kp.privateKey);
      const ok = await verify(sig, msg, kp.publicKey);
      if (!ok) throw new Error('signature failed to verify');
      const bad = await verify(sig, utf8('tampered'), kp.publicKey);
      if (bad) throw new Error('verify() accepted a tampered message');
      return `${sig.length}-byte detached signature verified (+ tamper rejected)`;
    }),
  );

  // 5. VOPRF: client blind (e2ee-core) against a locally-constructed server
  // eval (@cloudflare/voprf-ts server role, imported directly into this
  // page) — proves the FULL blind -> evaluate -> finalize round trip,
  // including DLEQ proof verification, runs in-browser.
  steps.push(
    await timeStep('voprf.blind+finalize', async () => {
      const serverKey = await randomPrivateKey(OPRF_SUITE, CryptoNoble);
      const serverPublicKey = await generatePublicKey(OPRF_SUITE, serverKey);
      const server = new VOPRFServer(OPRF_SUITE, serverKey);

      const password = utf8('correct horse battery staple');
      const { blindedElement, finalize } = await oprfBlind(password, serverPublicKey);

      // "Server-side" evaluation, done locally in this tab for the spike.
      const request = EvaluationRequest.deserialize(OPRF_SUITE, blindedElement);
      const evaluation = await server.blindEvaluate(request);
      const evaluatedElement = evaluation.serialize();

      const output = await finalize(evaluatedElement);
      if (!(output instanceof Uint8Array) || output.length === 0) {
        throw new Error('finalize() returned empty output');
      }
      return `${output.length}-byte VOPRF output, DLEQ proof verified`;
    }),
  );

  // 6. File encrypt/decrypt round trip (chunked AEAD + manifest + Merkle root).
  steps.push(
    await timeStep('file.encryptFile+decryptFile', async () => {
      const dek = await randomBytes(32);
      const plaintext = new TextEncoder().encode('hello from the e2ee-core browser spike\n'.repeat(200));
      const { manifest, chunks } = await encryptFile({
        dek,
        dekId: 'spike-dek-1',
        fmt: 1,
        workspaceId: 'ws-spike',
        fileId: 'file-spike',
        version: 1,
        plaintext,
      });
      const byId = new Map(chunks.map((c) => [toHex(c.chunkId), c.ciphertext]));
      const decrypted = await decryptFile({
        dek,
        fmt: 1,
        workspaceId: 'ws-spike',
        dekId: 'spike-dek-1',
        manifest: manifest as FileManifest,
        getCiphertext: async (chunkId) => {
          const hit = byId.get(toHex(chunkId));
          if (!hit) throw new Error('missing chunk in spike lookup map');
          return hit;
        },
      });
      if (!eq(decrypted, plaintext)) throw new Error('decrypted file content mismatch');
      return `${chunks.length} chunk(s), ${manifest.totalSize}B round-tripped`;
    }),
  );

  return {
    ready: true,
    userAgent: navigator.userAgent,
    steps,
    allPassed: steps.every((s) => s.pass),
  };
}

export default function E2eeBrowserCheckPage() {
  const [result, setResult] = useState<SpikeResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    runSpike().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h1>e2ee-core browser spike</h1>
      <p>Throwaway diagnostic page — see apps/web/src/pages/e2ee-browser-check.tsx.</p>
      <pre id="e2ee-result">{result ? JSON.stringify(result) : ''}</pre>
    </div>
  );
}
