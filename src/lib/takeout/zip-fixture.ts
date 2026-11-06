/**
 * A tiny zip writer for tests: stored or deflated entries, optionally laid
 * out as Zip64 (the shape every 50 GB Takeout part has) so the reader's
 * Zip64 paths run against real bytes rather than hand-built records.
 */
import { deflateRawSync } from 'node:zlib';

export interface FixtureEntry { name: string; data: Uint8Array | string; deflate?: boolean }

const enc = new TextEncoder();

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

class Out {
  parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array) { this.parts.push(b); this.length += b.length; }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

function le(size: number, value: number): Uint8Array {
  const b = new Uint8Array(size);
  const view = new DataView(b.buffer);
  if (size === 2) view.setUint16(0, value, true);
  else if (size === 4) view.setUint32(0, value >>> 0, true);
  else view.setBigUint64(0, BigInt(value), true);
  return b;
}
const cat = (...bs: Uint8Array[]) => { const o = new Out(); bs.forEach((b) => o.push(b)); return o.bytes(); };

export function makeZip(entries: FixtureEntry[], opts: { zip64?: boolean } = {}): Uint8Array {
  const out = new Out();
  const central = new Out();
  const z64 = !!opts.zip64;
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const stored = e.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = enc.encode(e.name);
    const crc = crc32(raw);
    const offset = out.length;
    out.push(cat(le(4, 0x04034b50), le(2, 20), le(2, 0x800), le(2, e.deflate ? 8 : 0), le(2, 0), le(2, 0x5021),
      le(4, crc), le(4, stored.length), le(4, raw.length), le(2, name.length), le(2, 0), name, stored));
    // Zip64 here saturates all three fields so every branch of the extra-record walk runs.
    const extra = z64 ? cat(le(2, 0x0001), le(2, 24), le(8, raw.length), le(8, stored.length), le(8, offset)) : new Uint8Array(0);
    central.push(cat(le(4, 0x02014b50), le(2, 45), le(2, 45), le(2, 0x800), le(2, e.deflate ? 8 : 0), le(2, 0), le(2, 0x5021),
      le(4, crc), le(4, z64 ? 0xffffffff : stored.length), le(4, z64 ? 0xffffffff : raw.length),
      le(2, name.length), le(2, extra.length), le(2, 0), le(2, 0), le(2, 0), le(4, 0),
      le(4, z64 ? 0xffffffff : offset), name, extra));
  }
  const cdOffset = out.length;
  const cd = central.bytes();
  out.push(cd);
  if (z64) {
    const z64At = out.length;
    out.push(cat(le(4, 0x06064b50), le(8, 44), le(2, 45), le(2, 45), le(4, 0), le(4, 0),
      le(8, entries.length), le(8, entries.length), le(8, cd.length), le(8, cdOffset)));
    out.push(cat(le(4, 0x07064b50), le(4, 0), le(8, z64At), le(4, 1)));
    out.push(cat(le(4, 0x06054b50), le(2, 0), le(2, 0), le(2, 0xffff), le(2, 0xffff), le(4, 0xffffffff), le(4, 0xffffffff), le(2, 0)));
  } else {
    out.push(cat(le(4, 0x06054b50), le(2, 0), le(2, 0), le(2, entries.length), le(2, entries.length), le(4, cd.length), le(4, cdOffset), le(2, 0)));
  }
  return out.bytes();
}
