/**
 * Google Photos' JSON "sidecars": the file Takeout writes beside each photo
 * holding the date it was taken and where, which the photo's own EXIF often
 * lacks or gets wrong (a date corrected in Google Photos lives only here).
 *
 * Takeout names them inconsistently, and every rule below is a shape seen in
 * real exports:
 *   IMG_1.jpg  ->  IMG_1.jpg.supplemental-metadata.json   (2024 onwards)
 *              ->  IMG_1.jpg.json                         (older exports)
 *   long names are cut so the whole sidecar name fits 51 characters:
 *              ->  IMG_20190714_093000123_HDR.jpg.supplemental-me.json
 *   duplicates: IMG_1(1).jpg -> IMG_1.jpg.supplemental-metadata(1).json or IMG_1.jpg(1).json
 *   edits:      IMG_1-edited.jpg uses IMG_1.jpg's sidecar
 *   live photos: IMG_1.MP4 uses IMG_1.HEIC's sidecar
 */

export interface PhotoMeta {
  /** Wall clock in the viewer's zone, "YYYY-MM-DDTHH:MM:SS", as files.captured_at stores EXIF dates. */
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** The "-edited" suffix in the languages Takeout localises it into. */
const EDITED = /-(edited|bearbeitet|modifié|editado|modificato|bewerkt|redigerad|redigeret|redigert|muokattu|edytowane|upravené|upraveno|szerkesztett|editat|düzenlendi|編集済み|편집됨|已修改|已編輯)$/i;

const ext = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i) : ''; };
const stem = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };

/** IMG_1(2).jpg -> { name: 'IMG_1.jpg', dup: '(2)' }; edits stripped too. */
export function originalOf(mediaName: string): { name: string; dup: string } {
  const e = ext(mediaName);
  // Both orders occur: IMG_1(3)-edited.jpg and IMG_1-edited(3).jpg.
  let s = stem(mediaName);
  let dup = '';
  const takeDup = () => {
    const m = /^(.*)(\(\d+\))$/.exec(s);
    if (m && !dup) { s = m[1]; dup = m[2]; }
  };
  takeDup();
  s = s.replace(EDITED, '');
  takeDup();
  return { name: s + e, dup };
}

const SUPPLEMENTAL = '.supplemental-metadata';

/**
 * The sidecar for `mediaName` among the JSON names in its folder, or null.
 * `jsonNames` is a Set for the exact lookups; the cut-name rule walks it.
 */
export function findSidecar(mediaName: string, jsonNames: Set<string>, siblings?: readonly string[]): string | null {
  const direct = matchFor(mediaName, jsonNames);
  if (direct) return direct;
  // A live photo's video half, or a RAW beside its JPEG: borrow the sibling
  // with the same stem that has a sidecar of its own.
  if (siblings) {
    const want = stem(originalOf(mediaName).name).toLowerCase();
    for (const other of siblings) {
      if (other === mediaName || stem(originalOf(other).name).toLowerCase() !== want) continue;
      const found = matchFor(other, jsonNames);
      if (found) return found;
    }
  }
  return null;
}

function matchFor(mediaName: string, jsonNames: Set<string>): string | null {
  const { name, dup } = originalOf(mediaName);
  for (const candidate of [`${name}${SUPPLEMENTAL}${dup}.json`, `${name}${dup}.json`, `${mediaName}.json`]) {
    if (jsonNames.has(candidate)) return candidate;
  }
  // The cut-name rule: what is left of the sidecar name before "(n).json"
  // must be a prefix of "name.supplemental-metadata", and long enough that it
  // cannot be a different photo's name (at least the whole name and its dot,
  // or 30 characters of a name that was itself cut).
  const full = `${name}${SUPPLEMENTAL}`;
  const tail = `${dup}.json`;
  const min = Math.min(name.length + 1, 30);
  let best: string | null = null;
  for (const json of jsonNames) {
    if (!json.endsWith(tail)) continue;
    const head = json.slice(0, json.length - tail.length);
    if (head.length >= min && full.startsWith(head) && (!best || head.length > best.length - tail.length)) best = json;
  }
  return best;
}

/** A Takeout sidecar's JSON, read defensively: any field may be missing. */
export function parseSidecar(text: string): PhotoMeta | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const taken = (r.photoTakenTime ?? r.creationTime) as { timestamp?: unknown } | undefined;
  const seconds = Number(taken?.timestamp);
  // 0 is Google's "unknown"; anything before 1900 or in the future is noise.
  const valid = Number.isFinite(seconds) && seconds > 0 && seconds * 1000 < Date.now() + 86_400_000;
  const place = pickPlace(r.geoData) ?? pickPlace(r.geoDataExif);
  if (!valid && !place) return null;
  return {
    capturedAt: valid ? wallClock(seconds * 1000) : null,
    latitude: place?.lat ?? null,
    longitude: place?.lng ?? null,
  };
}

function pickPlace(geo: unknown): { lat: number; lng: number } | null {
  if (!geo || typeof geo !== 'object') return null;
  const g = geo as Record<string, unknown>;
  const lat = Number(g.latitude);
  const lng = Number(g.longitude);
  // Takeout writes 0.0, 0.0 for "no place".
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * Takeout stores the moment (UTC seconds); captured_at stores a wall clock
 * with no zone, as EXIF does. The viewer's own zone is the best guess at the
 * clock the photo was taken by: most libraries were shot near home.
 */
export function wallClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
