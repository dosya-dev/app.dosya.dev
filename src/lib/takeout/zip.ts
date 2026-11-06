/**
 * Reading a Google Takeout zip straight from the user's disk.
 *
 * A Takeout part is up to 50 GB, so nothing here reads the whole file: the
 * listing costs two reads (the tail, then the central directory), and each
 * entry is a File.slice() of the bytes it occupies. A stored entry (Takeout
 * stores most photos and videos flat) is that slice as-is, with no copy;
 * a deflated one is inflated by the browser's own DecompressionStream.
 *
 * The parsing follows apps/api/src/lib/zip/central-directory.ts, which opens
 * stored zips on the server; that module cannot be imported across the app
 * seam. Zip64 matters here more than there: every 50 GB part is a Zip64
 * archive, and so is any entry over 4 GiB.
 */

export interface ZipEntry {
  /** Full path inside the archive, "/" separated. */
  name: string;
  isDir: boolean;
  /** Real bytes once inflated. */
  size: number;
  /** Bytes as stored in the archive. */
  storedSize: number;
  /** 0 = stored, 8 = deflate. Anything else cannot be read. */
  method: number;
  localHeaderOffset: number;
  crc32: number;
  encrypted: boolean;
  /** Unix ms from the DOS timestamp (read as local time), or null. */
  mtime: number | null;
}

/** Why an archive or entry cannot be read; the page words each one. */
export type ZipErrorCode = 'not-zip' | 'damaged' | 'too-many' | 'encrypted' | 'unsupported';

export class ZipError extends Error {
  constructor(readonly code: ZipErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ZipError';
  }
}

const EOCD_SIG = 0x06054b50;
const CD_ENTRY_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const SATURATED = 0xffffffff;
const MAX_TAIL = 22 + 0xffff;
/** A directory this large would be millions of entries; refuse rather than hang the tab. */
const MAX_DIRECTORY_BYTES = 256 * 1024 * 1024;

/** Reads `length` bytes at `offset` from the archive. */
export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

export const fileReader = (file: Blob): RangeReader => async (offset, length) =>
  new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());

function need(b: Uint8Array, off: number, len: number): void {
  if (off < 0 || off + len > b.length) throw new ZipError('damaged', 'a record runs past its end');
}
const u16 = (b: Uint8Array, off: number): number => { need(b, off, 2); return b[off] | (b[off + 1] << 8); };
const u32 = (b: Uint8Array, off: number): number => {
  need(b, off, 4);
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
};
const u64 = (b: Uint8Array, off: number): number => {
  const value = u32(b, off + 4) * 0x100000000 + u32(b, off);
  if (!Number.isSafeInteger(value)) throw new ZipError('damaged', 'a size is out of range');
  return value;
};

function findBackwards(b: Uint8Array, sig: number): number {
  for (let i = b.length - 4; i >= 0; i--) {
    if (b[i] === (sig & 0xff) && b[i + 1] === ((sig >>> 8) & 0xff)
      && b[i + 2] === ((sig >>> 16) & 0xff) && b[i + 3] === ((sig >>> 24) & 0xff)) return i;
  }
  return -1;
}

function dosToMs(time: number, date: number): number | null {
  if (date === 0) return null;
  const day = date & 0x1f;
  const month = (date >> 5) & 0x0f;
  if (month < 1 || month > 12 || day < 1) return null;
  return new Date(((date >> 9) & 0x7f) + 1980, month - 1, day, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2).getTime();
}

const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐'
  + '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8').decode(bytes);
  let out = '';
  for (const byte of bytes) out += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
  return out;
}

/** The saturated fields' real values, from the entry's Zip64 extra record. */
function zip64Extra(
  cd: Uint8Array, at: number, length: number,
  fixed: { size: number; storedSize: number; localHeaderOffset: number },
) {
  const end = at + length;
  while (at + 4 <= end) {
    const id = u16(cd, at);
    const size = u16(cd, at + 2);
    const dataAt = at + 4;
    if (dataAt + size > end) break;
    if (id === ZIP64_EXTRA_ID) {
      let read = dataAt;
      // Each value is present only if its 32-bit field was saturated, in this order.
      const take = () => {
        if (read + 8 > dataAt + size) throw new ZipError('damaged', 'a Zip64 record is short');
        const v = u64(cd, read);
        read += 8;
        return v;
      };
      const out = { ...fixed };
      if (fixed.size === SATURATED) out.size = take();
      if (fixed.storedSize === SATURATED) out.storedSize = take();
      if (fixed.localHeaderOffset === SATURATED) out.localHeaderOffset = take();
      return out;
    }
    at = dataAt + size;
  }
  throw new ZipError('damaged', 'a Zip64 record is missing');
}

/** Every entry in the archive. Throws ZipError for anything that is not a readable zip. */
export async function readZipDirectory(read: RangeReader, fileSize: number): Promise<ZipEntry[]> {
  if (fileSize < 22) throw new ZipError('not-zip');
  const tailLength = Math.min(fileSize, MAX_TAIL);
  const tail = await read(fileSize - tailLength, tailLength);
  const eocd = findBackwards(tail, EOCD_SIG);
  if (eocd < 0) throw new ZipError('not-zip');

  let total = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  if (total === 0xffff || cdSize === SATURATED || cdOffset === SATURATED) {
    const locator = eocd - 20;
    if (locator < 0 || u32(tail, locator) !== ZIP64_LOCATOR_SIG) throw new ZipError('damaged', 'no Zip64 locator');
    const z64At = u64(tail, locator + 8);
    if (z64At + 56 > fileSize) throw new ZipError('damaged', 'Zip64 record outside the file');
    const z64 = await read(z64At, 56);
    if (u32(z64, 0) !== ZIP64_EOCD_SIG) throw new ZipError('damaged', 'bad Zip64 record');
    total = u64(z64, 32);
    cdSize = u64(z64, 40);
    cdOffset = u64(z64, 48);
  }
  if (cdSize > MAX_DIRECTORY_BYTES) throw new ZipError('too-many');
  if (cdOffset + cdSize > fileSize) throw new ZipError('damaged');

  const cd = await read(cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < total; i++) {
    if (u32(cd, at) !== CD_ENTRY_SIG) throw new ZipError('damaged', 'bad directory record');
    const flags = u16(cd, at + 8);
    const nameLength = u16(cd, at + 28);
    const extraLength = u16(cd, at + 30);
    const commentLength = u16(cd, at + 32);
    need(cd, at + 46, nameLength + extraLength + commentLength);
    const name = decodeName(cd.subarray(at + 46, at + 46 + nameLength), (flags & 0x800) !== 0);
    let sizes = { storedSize: u32(cd, at + 20), size: u32(cd, at + 24), localHeaderOffset: u32(cd, at + 42) };
    if (sizes.storedSize === SATURATED || sizes.size === SATURATED || sizes.localHeaderOffset === SATURATED) {
      sizes = zip64Extra(cd, at + 46 + nameLength, extraLength, sizes);
    }
    entries.push({
      name,
      isDir: name.endsWith('/') || (u32(cd, at + 38) & 0x10) !== 0,
      ...sizes,
      method: u16(cd, at + 10),
      crc32: u32(cd, at + 16),
      encrypted: (flags & 1) !== 0,
      mtime: dosToMs(u16(cd, at + 12), u16(cd, at + 14)),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * The entry's real bytes. Stored: a lazy slice of the archive, so a 4 GB
 * video costs nothing until it is uploaded. Deflated: inflated into a Blob,
 * which the browser spills to disk when it is large.
 */
export async function entryBlob(file: Blob, entry: ZipEntry): Promise<Blob> {
  if (entry.encrypted) throw new ZipError('encrypted');
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError('unsupported');
  const header = new Uint8Array(await file.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer());
  if (header.length < 30 || u32(header, 0) !== LOCAL_SIG) throw new ZipError('damaged', 'missing file header');
  const start = entry.localHeaderOffset + 30 + u16(header, 26) + u16(header, 28);
  if (start + entry.storedSize > file.size) throw new ZipError('damaged');
  const stored = file.slice(start, start + entry.storedSize);
  if (entry.method === 0) return stored;
  const inflated = await new Response(stored.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
  if (inflated.size !== entry.size) throw new ZipError('damaged', 'a file inflated to the wrong size');
  return inflated;
}
