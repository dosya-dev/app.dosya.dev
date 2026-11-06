// @vitest-environment node
// The reference the phone's native face reader is checked against: what the
// web ONNX Runtime pipeline reads from three fixed JPEGs. Skipped exactly when
// pipeline.parity.test.ts is (sharp or the models absent).
//   WRITE_MOBILE_PARITY=1 recreates the JPEGs and reference.json;
//   without it the committed reference.json must equal what is computed now.
//
// Near ties: two decoders (libjpeg-turbo here, ImageIO on iOS) round a few
// pixels differently, which moves YuNet scores by up to ~6e-4. Where a face's
// NMS winner beats an overlapping candidate by less than TIE_MARGIN, either
// could win on the phone, so the reference also lists those candidates
// (`alts`, each with its own box and signature) and the phone may match any
// one of them. A face scoring within TIE_MARGIN of the MIN_SCORE floor may be
// dropped by another decoder, so it is marked `optional`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { alignInput, decodeCell, DETECT_SIZE, FACE_STRIDE, l2Normalize, letterbox, MIN_FACE_PX, MIN_SCORE, readFaces, VECTOR_LEN, type Pixels } from './pipeline';
import { loadOrtModels } from './models';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const models = process.env.FACE_MODELS_DIR ?? path.join(homedir(), 'Desktop/Projects/dosya.dev-personas-notes/face-models');
const files = {
  tractWasm: path.join(repo, 'packages/face-reader/dist/face_reader_bg.wasm'),
  yunet: path.join(models, 'face_detection_yunet_2023mar.onnx'),
  sface: path.join(models, 'face_recognition_sface_2021dec_f16.onnx'),
  ortWasm: path.join(models, 'ort-wasm-simd-threaded-1.29.0.asyncify.wasm'),
  yunet320: path.join(models, 'yunet-2023mar-320.onnx'),
  sfaceOrt: path.join(models, 'sface-2021dec-f16-batch.onnx'),
};
const fixtures = path.join(repo, 'packages/face-reader/test/fixtures');
const parityDir = path.join(repo, 'apps/mobile/modules/dosya-face-reader/parity');
const SOURCES: Record<string, string> = {
  'crew.jpg': 'nasa-crew-public-domain.jpg',
  'exp73.jpg': 'nasa-exp73-crew-public-domain.jpg',
  'sts116.jpg': 'nasa-sts116-crew-public-domain.jpg',
};

/**
 * Score window for a near tie and for the floor (see the header): ~1.7x the
 * largest decoder shift measured (6e-4, macOS ImageIO against sharp).
 */
const TIE_MARGIN = 1e-3;

type Box = [number, number, number, number];
interface Candidate {
  box: Box;
  score: number;
  sig: number[];
}
interface Face extends Candidate {
  /** Overlapping candidates within TIE_MARGIN of this face's score: any one may win NMS instead. */
  alts?: Candidate[];
  /** Within TIE_MARGIN of the MIN_SCORE floor: another decoder may not find it. */
  optional?: true;
}
interface Reference {
  version: 1;
  tieMargin: number;
  files: Record<string, { width: number; height: number; faces: Face[] }>;
}
type SharpInstance = {
  resize(o: { width: number; height: number; fit: 'inside' }): SharpInstance;
  jpeg(o: { quality: number }): SharpInstance;
  toBuffer(): Promise<Buffer>;
  raw(): { toBuffer(o: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }> };
};
type Sharp = (b: Buffer) => SharpInstance;
let sharp: Sharp | null = null;
try {
  sharp = createRequire(import.meta.url)('sharp') as Sharp;
} catch {
  sharp = null;
}
const present = sharp !== null && Object.values(files).every((p) => existsSync(p)) && existsSync(fixtures);

describe.skipIf(!present)('mobile parity reference', () => {
  it('matches the web ONNX pipeline on the three parity JPEGs', async () => {
    const write = process.env.WRITE_MOBILE_PARITY === '1';
    if (write) {
      mkdirSync(parityDir, { recursive: true });
      for (const [name, src] of Object.entries(SOURCES)) {
        // sharp drops EXIF/metadata unless asked to keep it.
        const jpg = await sharp!(readFileSync(path.join(fixtures, src))).resize({ width: 1600, height: 1600, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer();
        writeFileSync(path.join(parityDir, name), jpg);
      }
    }
    const ortModels = await loadOrtModels(
      { wasm: new Uint8Array(readFileSync(files.ortWasm)), detector: new Uint8Array(readFileSync(files.yunet320)), embedder: new Uint8Array(readFileSync(files.sfaceOrt)) },
      { gpu: false },
    );
    const computed: Reference = { version: 1, tieMargin: TIE_MARGIN, files: {} };
    for (const name of Object.keys(SOURCES)) {
      const { data, info } = await sharp!(readFileSync(path.join(parityDir, name))).raw().toBuffer({ resolveWithObject: true });
      const rgba = info.channels === 4 ? data : Buffer.from(await toRgba(data, info.width * info.height, info.channels));
      const out = await readFaces({ px: rgba, width: info.width, height: info.height, channels: 4 }, ortModels);
      const faces: Face[] = [];
      for (let i = 0; i < out.length / FACE_STRIDE; i++) {
        const o = i * FACE_STRIDE;
        faces.push({ box: [out[o], out[o + 1], out[o + 2], out[o + 3]], score: out[o + 4], sig: Array.from(out.subarray(o + 5, o + FACE_STRIDE)) });
      }
      await markNearTies({ px: rgba, width: info.width, height: info.height, channels: 4 }, faces, ortModels);
      computed.files[name] = { width: info.width, height: info.height, faces };
    }
    const refPath = path.join(parityDir, 'reference.json');
    if (write) {
      writeFileSync(refPath, JSON.stringify(computed));
      expect(Object.keys(computed.files)).toHaveLength(3);
      for (const [name, f] of Object.entries(computed.files)) expect(f.faces.length, name).toBeGreaterThan(0);
      return;
    }
    const ref = JSON.parse(readFileSync(refPath, 'utf8')) as Reference;
    expect(ref.version).toBe(1);
    expect(ref.tieMargin).toBe(TIE_MARGIN);
    expect(Object.keys(computed.files).sort()).toEqual(Object.keys(ref.files).sort());
    for (const [name, want] of Object.entries(ref.files)) {
      const got = computed.files[name];
      expect([got.width, got.height], name).toEqual([want.width, want.height]);
      expect(got.faces.length, name).toBe(want.faces.length);
      const same = (g: Candidate, w: Candidate, label: string) => {
        for (let k = 0; k < 4; k++) expect(Math.abs(g.box[k] - w.box[k]), `${label} box ${k}`).toBeLessThan(0.01);
        let dot = 0;
        for (let k = 0; k < 128; k++) dot += g.sig[k] * w.sig[k];
        expect(dot, label).toBeGreaterThanOrEqual(0.9999);
      };
      want.faces.forEach((w, i) => {
        const g = got.faces[i];
        same(g, w, `${name} face ${i}`);
        expect(g.optional, `${name} face ${i} optional`).toBe(w.optional);
        expect(g.alts?.length ?? 0, `${name} face ${i} alts`).toBe(w.alts?.length ?? 0);
        (w.alts ?? []).forEach((a, j) => {
          same(g.alts![j], a, `${name} face ${i} alt ${j}`);
          // The scores decide which candidates count as a tie.
          expect(Math.abs(g.alts![j].score - a.score), `${name} face ${i} alt ${j} score`).toBeLessThan(1e-6);
        });
      });
    }
  }, 120_000);
});

function iou(a: Box, b: Box): number {
  const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (ix <= 0 || iy <= 0) return 0;
  return (ix * iy) / (a[2] * a[3] + b[2] * b[3] - ix * iy);
}

/**
 * Adds `alts` and `optional` to the faces readFaces found (see the header).
 * Re-runs YuNet and scores every anchor cell as decodeCell does, but without
 * its floor, so a rival just under MIN_SCORE is seen too; boxes are clamped
 * as decodeYunet clamps them.
 */
async function markNearTies(img: Pixels, faces: Face[], models: Awaited<ReturnType<typeof loadOrtModels>>): Promise<void> {
  const f = Math.fround;
  const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
  const { input, scale } = letterbox(img);
  const outs = await models.detect(input);
  const cands: { box: Box; score: number; landmarks: [number, number][] }[] = [];
  for (const stride of [8, 16, 32]) {
    const cols = DETECT_SIZE / stride;
    const cls = outs[`cls_${stride}`];
    const obj = outs[`obj_${stride}`];
    const bbox = outs[`bbox_${stride}`];
    const kps = outs[`kps_${stride}`];
    for (let idx = 0; idx < cols * cols; idx++) {
      const score = f(Math.sqrt(f(clamp01(f(cls[idx])) * clamp01(f(obj[idx])))));
      if (score < MIN_SCORE - TIE_MARGIN) continue;
      const b = Array.prototype.slice.call(bbox, idx * 4, idx * 4 + 4) as number[];
      const k = Array.prototype.slice.call(kps, idx * 10, idx * 10 + 10) as number[];
      // Scores of 1 only to get the geometry past decodeCell's floor.
      const cell = decodeCell(1, 1, b, k, Math.floor(idx / cols), idx % cols, stride);
      if (!cell) continue;
      // Copy of the clamp and MIN_FACE_PX drop in decodeYunet (pipeline.ts): keep in step.
      // Not exported from there, as that would touch the web, mobile and desktop copies.
      const x0 = Math.min(Math.max(cell.x / scale, 0), img.width);
      const y0 = Math.min(Math.max(cell.y / scale, 0), img.height);
      const x1 = Math.min(Math.max((cell.x + cell.w) / scale, 0), img.width);
      const y1 = Math.min(Math.max((cell.y + cell.h) / scale, 0), img.height);
      if (x1 - x0 < MIN_FACE_PX || y1 - y0 < MIN_FACE_PX) continue;
      cands.push({ box: [x0, y0, x1 - x0, y1 - y0], score, landmarks: cell.landmarks.map(([x, y]) => [x / scale, y / scale]) });
    }
  }
  for (const face of faces) {
    if (face.score < MIN_SCORE + TIE_MARGIN) face.optional = true;
    const rivals = cands
      .filter((c) => iou(c.box, face.box) > 0.3 && c.score >= face.score - TIE_MARGIN)
      .filter((c) => !(c.score === face.score && c.box.every((v, k) => Math.abs(v - face.box[k]) < 1e-3)))
      .sort((a, b) => b.score - a.score);
    if (rivals.length === 0) continue;
    const one = 3 * 112 * 112;
    const batch = new Float32Array(rivals.length * one);
    rivals.forEach((r, i) => batch.set(alignInput(img, r.landmarks), i * one));
    const feats = await models.embed(batch, rivals.length);
    face.alts = rivals.map((r, i) => ({
      box: r.box,
      score: r.score,
      sig: Array.from(l2Normalize(Array.prototype.slice.call(feats, i * VECTOR_LEN, (i + 1) * VECTOR_LEN) as number[])),
    }));
  }
}

async function toRgba(rgb: Buffer, n: number, channels: number): Promise<Uint8Array> {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = rgb[i * channels];
    out[i * 4 + 1] = rgb[i * channels + 1];
    out[i * 4 + 2] = rgb[i * channels + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}
