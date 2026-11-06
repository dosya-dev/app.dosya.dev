/**
 * What a set of Takeout zips becomes in dosya, decided from the file lists
 * alone (no file is read here, so planning 100 GB takes a moment).
 *
 *   Takeout/Google Photos/Holiday 2024/IMG_1.jpg  ->  Google Takeout/Google Photos/Holiday 2024/IMG_1.jpg
 *   Takeout/Drive/Work/plan.docx                   ->  Google Takeout/Drive/Work/plan.docx
 *
 * Folder names stay Google's, so an album is a folder of the same name. In
 * the Photos tree the JSON files are never uploaded: their date and place
 * travel with the photo instead (see sidecar.ts). A photo that sits in an
 * album AND in a "Photos from 2024" folder is kept once, in the album.
 */
import { findSidecar } from './sidecar';
import type { ZipEntry } from './zip';

export const ROOT_FOLDER = 'Google Takeout';

export interface Archive { file: File; entries: ZipEntry[] }

export interface EntryRef { archive: number; entry: ZipEntry }

export type ItemKind = 'photo' | 'video' | 'file';

export interface PlanItem extends EntryRef {
  /** Stable across sessions: lets a re-selected set of zips resume. */
  key: string;
  /** Destination folder path under the chosen folder, ROOT_FOLDER first. */
  dir: string;
  name: string;
  kind: ItemKind;
  /** The JSON holding Google's date and place, when this is a photo or video that has one. */
  sidecar?: EntryRef;
}

export interface Plan {
  items: PlanItem[];
  bytes: number;
  photos: number;
  videos: number;
  albums: number;
  driveFiles: number;
  otherFiles: number;
  /** Photos and videos with a sidecar to read. */
  withSidecar: number;
  /** Year-folder copies left out because the same photo is in an album. */
  duplicatesSkipped: number;
}

const PHOTO_EXT = new Set(['jpg', 'jpeg', 'heic', 'heif', 'png', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf', 'avif']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', '3gp', 'avi', 'mkv', 'webm', 'mts', 'm2ts', 'wmv', 'mpg', 'mpeg']);

export function kindOf(name: string): ItemKind {
  const e = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (PHOTO_EXT.has(e)) return 'photo';
  if (VIDEO_EXT.has(e)) return 'video';
  return 'file';
}

/**
 * Google's year folders ("Photos from 2024", "Fotos von 2024", "Photos de 2024").
 * A folder only counts when it also holds no JSON of its own beyond sidecars:
 * an album carries a metadata file, so "Summer 2024" the album never matches.
 */
const YEAR_FOLDER = /^\D{0,40}(19|20)\d{2}$/;

const isJson = (name: string) => name.toLowerCase().endsWith('.json');

interface Folder { path: string; files: EntryRef[] }

/** The archive's top folder ("Takeout"), when every entry shares one. */
function commonTop(archives: Archive[]): string | null {
  let top: string | null = null;
  for (const a of archives) {
    for (const e of a.entries) {
      const first = e.name.split('/')[0];
      if (!e.name.includes('/')) return null;
      if (top === null) top = first;
      else if (top !== first) return null;
    }
  }
  return top;
}

export function buildPlan(archives: Archive[], opts: { dedupeAlbums: boolean } = { dedupeAlbums: true }): Plan {
  const top = commonTop(archives);
  const strip = (name: string) => (top !== null ? name.slice(top.length + 1) : name);

  // Every file, grouped by its folder across ALL parts: a photo and its
  // sidecar can land in different zips of one export.
  const folders = new Map<string, Folder>();
  const seenPaths = new Set<string>();
  archives.forEach((a, archive) => {
    for (const entry of a.entries) {
      if (entry.isDir) continue;
      const rel = strip(entry.name);
      if (!rel || seenPaths.has(rel)) continue;
      seenPaths.add(rel);
      const cut = rel.lastIndexOf('/');
      const path = cut < 0 ? '' : rel.slice(0, cut);
      (folders.get(path) ?? folders.set(path, { path, files: [] }).get(path)!).files.push({ archive, entry });
    }
  });

  const leaf = (ref: EntryRef) => ref.entry.name.slice(ref.entry.name.lastIndexOf('/') + 1);
  const product = (path: string) => path.split('/')[0];

  // A product is the Photos tree when its JSON files are sidecars of its
  // media, which works whatever language the folder is named in.
  const sidecars = new Map<EntryRef, EntryRef>();
  const photoProducts = new Set<string>();
  const unmatchedJson = new Map<string, number>();
  for (const folder of folders.values()) {
    const jsons = folder.files.filter((f) => isJson(leaf(f)));
    if (jsons.length === 0) continue;
    const byName = new Map(jsons.map((j) => [leaf(j), j]));
    const names = new Set(byName.keys());
    const media = folder.files.filter((f) => !isJson(leaf(f)));
    const mediaNames = media.map(leaf);
    const used = new Set<string>();
    for (const m of media) {
      if (kindOf(leaf(m)) === 'file') continue;
      const hit = findSidecar(leaf(m), names, mediaNames);
      if (hit) { sidecars.set(m, byName.get(hit)!); used.add(hit); }
    }
    if (used.size > 0) photoProducts.add(product(folder.path));
    unmatchedJson.set(folder.path, jsons.length - used.size);
  }

  const inPhotos = (path: string) => path !== '' && photoProducts.has(product(path));
  const isYearFolder = (path: string) =>
    inPhotos(path) && path.includes('/') && YEAR_FOLDER.test(path.slice(path.lastIndexOf('/') + 1)) && (unmatchedJson.get(path) ?? 0) === 0;

  // The same photo in an album and in a year folder: same name, size and CRC.
  const dupKey = (ref: EntryRef) => `${leaf(ref).toLowerCase()}|${ref.entry.size}|${ref.entry.crc32}`;
  const inAlbum = new Set<string>();
  if (opts.dedupeAlbums) {
    for (const folder of folders.values()) {
      if (!inPhotos(folder.path) || isYearFolder(folder.path)) continue;
      for (const f of folder.files) if (!isJson(leaf(f))) inAlbum.add(dupKey(f));
    }
  }

  const plan: Plan = { items: [], bytes: 0, photos: 0, videos: 0, albums: 0, driveFiles: 0, otherFiles: 0, withSidecar: 0, duplicatesSkipped: 0 };
  const sorted = [...folders.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const folder of sorted) {
    const photos = inPhotos(folder.path);
    const year = isYearFolder(folder.path);
    let albumMedia = false;
    for (const ref of folder.files) {
      const name = leaf(ref);
      if (photos && isJson(name)) continue;
      // Takeout's own index page at the top of every export.
      if (folder.path === '' && name.toLowerCase() === 'archive_browser.html') continue;
      if (year && inAlbum.has(dupKey(ref))) { plan.duplicatesSkipped++; continue; }
      const kind = photos ? kindOf(name) : 'file';
      const sidecar = sidecars.get(ref);
      const a = archives[ref.archive];
      plan.items.push({
        ...ref,
        key: `${a.file.name}|${a.file.size}|${ref.entry.name}`,
        dir: folder.path ? `${ROOT_FOLDER}/${folder.path}` : ROOT_FOLDER,
        name, kind,
        ...(sidecar ? { sidecar } : {}),
      });
      plan.bytes += ref.entry.size;
      if (kind === 'photo') plan.photos++;
      else if (kind === 'video') plan.videos++;
      else if (product(folder.path) === 'Drive') plan.driveFiles++;
      else plan.otherFiles++;
      if (sidecar) plan.withSidecar++;
      if (photos && !year && kind !== 'file') albumMedia = true;
    }
    if (albumMedia) plan.albums++;
  }
  return plan;
}

/**
 * Which export and which part a Takeout file is. Google names parts
 * takeout-20261030T081200Z-3-001.zip today, where 3 is the part and 001
 * numbers the zips within it; older exports were takeout-...Z-003.zip.
 */
export function parsePartName(fileName: string): { exportId: string; part: number } | null {
  const m = /^takeout-(\d{8}T\d{6}Z)-(?:(\d{1,4})-)?(\d{1,4})\.zip$/i.exec(fileName.trim());
  return m ? { exportId: m[1], part: Number(m[2] ?? m[3]) } : null;
}

/** Part numbers missing below the highest one chosen, per export. The last part cannot be known. */
export function missingParts(fileNames: string[]): { exportId: string; part: number }[] {
  const byExport = new Map<string, Set<number>>();
  for (const n of fileNames) {
    const p = parsePartName(n);
    if (p) (byExport.get(p.exportId) ?? byExport.set(p.exportId, new Set()).get(p.exportId)!).add(p.part);
  }
  const out: { exportId: string; part: number }[] = [];
  for (const [exportId, parts] of byExport) {
    const max = Math.max(...parts);
    for (let i = 1; i < max; i++) if (!parts.has(i)) out.push({ exportId, part: i });
  }
  return out;
}
