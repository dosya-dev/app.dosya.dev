import { activityPhrase } from "@/lib/activity-labels";
import { byteCount, fixedNumber, formatDateParts, formatDateWith, formatRelative, formatShortDate, sizeUnits } from '@/lib/format-locale';
import { currentLocale, t } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';
import { EXTENSION_FAMILY, FILE_FAMILY, SWATCH_BY_NAME, defaultSwatch } from '@/lib/palette';
import { ARCHIVE_BROWSABLE_EXTS, AUDIO_EXTS, BOOK_READABLE_EXTS, IMAGE_PREVIEW_EXTS, VIDEO_EXTS, isOfficeExt } from '@/lib/preview-formats.generated';

/**
 * `now` (unix seconds) is injectable so the formatting is testable.
 *
 * `utc` reads the calendar date in UTC instead of the viewer's zone. It exists
 * for values that are NOT real instants: an EXIF capture date is a wall clock
 * with no zone, stored and grouped as though it were UTC, so reading it
 * locally moves a 23:00 photo onto the next day - and made this label disagree
 * with the very tooltip above it. The relative labels below the cutoff are
 * durations and have no zone to get wrong.
 */
export function timeAgo(
  ts: number,
  now: number = Math.floor(Date.now() / 1000),
  opts: { utc?: boolean } = {},
): string {
  return formatRelative(ts, now, opts);
}

/**
 * Forward-looking sibling of timeAgo, for deadlines rather than history.
 *
 * timeAgo cannot do this job: it computes `now - ts`, so a future timestamp
 * yields a negative diff and falls through to "just now" - which is how a link
 * expiring in twelve days came to render as though it had already lapsed.
 */
export function timeUntil(ts: number, now: number = Math.floor(Date.now() / 1000)): string {
  const diff = ts - now;
  if (diff <= 0) return t('common.status.expired');
  if (diff < 60) return t('common.label.inUnderAMinute');
  if (diff < 3600) return t('integrations-webhooks.label.inMathfloorM', { MathFloor: Math.floor(diff / 60) });
  if (diff < 86400) return t('integrations-webhooks.label.inMathfloorH', { MathFloor: Math.floor(diff / 3600) });
  const days = Math.ceil(diff / 86400);
  if (days <= 60) return t('common.label.inDays', { days });
  return formatShortDate(ts, now);
}

/**
 * The "Expires ..." line under an invite or share link. Built on timeUntil, not
 * timeAgo: timeAgo turns every future expiry into "just now", which made live
 * invite links read as already lapsed.
 */
export function expiryLabel(ts: number | null | undefined, now: number = Math.floor(Date.now() / 1000)): string {
  if (!ts) return t('common.label.noExpiry');
  if (ts - now <= 0) return t('common.status.expired');
  return t('common.label.expiresDate', { date: timeUntil(ts, now) });
}

export function humanSize(b: number): string {
  const u = sizeUnits();
  if (b < 1024) return `${byteCount(b)} ${u.B}`;
  if (b < 1048576) return `${fixedNumber(b / 1024, 0)} ${u.KB}`;
  if (b < 1073741824) return `${fixedNumber(b / 1048576, 1)} ${u.MB}`;
  return `${fixedNumber(b / 1073741824, 2)} ${u.GB}`;
}

/**
 * Compact size for dashboard stat tiles. Unlike humanSize this drops the
 * decimal in the MB range, but it still has to degrade below a megabyte -
 * reporting a 500 KB account as "0 MB used" reads as "nothing is stored".
 */
export function humanSizeShort(b: number): string {
  const u = sizeUnits();
  if (b < 1024) return `${byteCount(b)} ${u.B}`;
  if (b < 1048576) return `${fixedNumber(b / 1024, 0)} ${u.KB}`;
  if (b < 1073741824) return `${fixedNumber(b / 1048576, 0)} ${u.MB}`;
  return `${fixedNumber(b / 1073741824, 1)} ${u.GB}`;
}

export function extOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

/**
 * File-type colour. The extension-to-family map and the family-to-colour map both live
 * in the shared palette now, so a `.xlsx` and a "spreadsheet" can no longer be coloured
 * by two different lookups that disagree.
 */
export function colorFor(name: string, scheme: 'light' | 'dark' = 'light'): string {
  const family = EXTENSION_FAMILY[extOf(name)] ?? 'other';
  const swatch = SWATCH_BY_NAME[FILE_FAMILY[family] ?? 'graphite'];
  return swatch[scheme];
}

export function labelFor(name: string): string {
  const e = extOf(name);
  return e ? e.toUpperCase() : t('common.label.fileBadge');
}

// The extension lists below come from packages/shared/src/files/preview-formats.ts
// (through a generated copy), the same lists the share page renders with, so a
// file previews the same way here and on its share link. tiff/dng are not
// images to preview: no browser decodes them and neither does the server.
export function isImage(name: string): boolean {
  return IMAGE_PREVIEW_EXTS.has(extOf(name));
}

const HEIC_EXTS = new Set(['heic', 'heif']);
/** True only for HEIC/HEIF - the one image format browsers can't render natively. */
export function isHeic(name: string): boolean {
  return HEIC_EXTS.has(extOf(name));
}

export function isVideo(name: string): boolean {
  return VIDEO_EXTS.has(extOf(name));
}

const TEXT_EXTS = new Set([
  'txt', 'md', 'json', 'xml', 'csv', 'log', 'yml', 'yaml', 'toml', 'ini', 'cfg',
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'cpp', 'h',
  'cs', 'php', 'swift', 'sh', 'bash', 'zsh', 'sql', 'html', 'css', 'scss', 'less',
  'env', 'gitignore', 'dockerfile', 'makefile',
]);
export function isText(name: string): boolean {
  return TEXT_EXTS.has(extOf(name));
}

// Files that open in the ONLYOFFICE editor at /editor/:fileId. Keep in sync
// with apps/api/src/lib/onlyoffice/formats.ts.
export function isOfficeFile(name: string): boolean {
  return isOfficeExt(extOf(name));
}

/**
 * Formats the ebook reader can open. foliate-js also handles mobi/azw3/fb2/cbz
 * and they are vendored, so they are listed rather than falling through to a
 * Download button that pretends the app cannot read them.
 *
 * .pdf is deliberately absent: foliate's PDF path wants a pdfjs build that is
 * not vendored, and this app renders PDFs natively.
 */
export function isBook(name: string): boolean {
  return BOOK_READABLE_EXTS.has(extOf(name));
}

// Deliberately narrow. `.cbz` and `.epub` are zips too, but both already route
// to the book reader, and claiming them here would take a working experience
// away and replace it with a file tree.
// `iso` and `img` open in the same pane: the API lists an ISO 9660 image the
// way it lists a zip, and refuses a raw .img with a sentence the pane shows.
export function isArchive(name: string): boolean {
  return ARCHIVE_BROWSABLE_EXTS.has(extOf(name));
}

export function isAudio(name: string): boolean {
  return AUDIO_EXTS.has(extOf(name));
}

// File type icon mapping → /file-icons/{icon}.svg
const EXT_ICON_MAP: Record<string, string> = {
  pdf: '001-pdf', xls: '002-xls', xlsx: '002-xls', doc: '003-doc', docx: '003-doc',
  ppt: '004-ppt', pptx: '004-ppt', txt: '005-txt', svg: '006-svg', sql: '007-sql',
  js: '008-js', ts: '008-js', jpg: '009-jpg', jpeg: '009-jpg', heic: '009-jpg', heif: '009-jpg', png: '010-png',
  ai: '011-ai', mp3: '012-mp3', wav: '012-mp3', ogg: '012-mp3', flac: '012-mp3',
  mp4: '013-mp4', gif: '014-gif', iso: '015-iso', exe: '016-exe', msi: '016-exe',
  apk: '017-apk', php: '018-php', avi: '019-avi', mov: '020-mov', css: '021-css',
  zip: '022-zip', '7z': '022-zip', tar: '022-zip', gz: '022-zip', rar: '026-rar',
  java: '023-java', eps: '024-eps', ics: '025-ics', xml: '027-xml',
  otp: '028-otp', ttf: '029-ttf', otf: '029-ttf', woff: '029-ttf', woff2: '029-ttf',
};

export function fileIconSrc(name: string): string {
  const ext = extOf(name);
  const icon = EXT_ICON_MAP[ext] ?? '005-txt';
  return `/file-icons/${icon}.svg`;
}

export function folderIconSrc(fileCount: number, isSynced?: boolean): string {
  if (isSynced) return '/sync.svg';
  return fileCount > 0 ? '/file-icons/folder-full.svg' : '/file-icons/folder-empty.svg';
}

const ORIGIN_KEYS: Record<string, MessageKey> = {
  web: 'common.label.web', desktop: 'common.label.desktop', mobile: 'common.label.mobileTitleCase',
  cli: 'common.heading.cli', import: 'common.label.import',
};
// Protocol names are the same in every language.
const ORIGIN_NAMES: Record<string, string> = { webdav: 'WebDAV', s3: 'S3', ftp: 'FTP' };

export function originLabel(origin: string | null | undefined): string {
  if (!origin) return '-';
  const key = ORIGIN_KEYS[origin];
  return key ? t(key) : (ORIGIN_NAMES[origin] ?? '-');
}

// "Hidden" is never binary from the viewer's own perspective - if they can
// see the row at all, they're someone it's NOT hidden from. This names who
// ELSE it's hidden from, and warns that hidden items drop out of share
// links - it must never read as "hidden from you".
export function hiddenTitle(hiddenMode: string | null | undefined): string {
  return hiddenMode === 'everyone'
    ? t('common.label.hiddenFromEveryoneNotIncludedInShareLinks')
    : t('common.label.hiddenFromSomePeopleNotIncludedInShareLinks');
}

/**
 * Avatar colour, from the shared identity swatches. Keyed on the user id so it is stable
 * for a person across sessions and devices.
 */
export function avatarColor(userId: string, scheme: 'light' | 'dark' = 'light'): string {
  return defaultSwatch(userId)[scheme];
}

export function initials(name: string | null | undefined): string {
  // Guard against null/undefined: activity rows from anonymous actions
  // (public share-link views/downloads) or deleted users have no name.
  const parts = (name ?? '').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return t('common.label.goodMorning');
  if (h < 18) return t('common.label.goodAfternoon');
  return t('common.label.goodEvening');
}

export function todayStr(): string {
  const d = new Date();
  if (currentLocale() === 'en') {
    // "Sunday, 19 October 2026": the English layout, kept as it was.
    const part = (type: string, o: Intl.DateTimeFormatOptions) =>
      formatDateParts(d, o, 'en').find((p) => p.type === type)?.value ?? '';
    const o = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } as const;
    return `${part('weekday', o)}, ${part('day', o)} ${part('month', o)} ${part('year', o)}`;
  }
  return formatDateWith(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const REGION_KEYS: Record<string, MessageKey> = {
  'us-east-1': 'common.label.usEast', 'us-west-1': 'common.label.usWest', 'us-west-2': 'common.label.usWest2',
  'eu-west-1': 'common.label.euWest', 'eu-central-1': 'common.label.euCentral',
  'ap-southeast-1': 'common.label.singapore', 'ap-southeast-2': 'common.label.sydney', 'ap-northeast-1': 'common.label.tokyo',
  'sa-east-1': 'common.label.saoPaulo', 'me-south-1': 'common.label.bahrain',
  'af-south-1': 'common.label.capeTown', 'auto': 'common.label.auto',
};

export function regionLabel(code: string): string {
  if (code === 'multi') return t('common.label.multipleRegions');
  const key = REGION_KEYS[code];
  return key ? t(key) : code;
}

/**
 * The verb phrase for an audit action. The table it reads is generated from
 * packages/shared/src/activity/catalog.ts - it used to be hand-written here
 * AND on the activity page AND in mobile AND (as bare names) in the endpoint,
 * so a new action code had to be added four times.
 */
export function actionLabel(action: string): string {
  return activityPhrase(action);
}

// Actions whose target no longer exists - linking to it would be a dead click.
const GONE_ACTIONS = new Set(['file_deleted', 'file_permanently_deleted', 'files_batch_deleted', 'folder_deleted']);

/**
 * Deep link for an activity row's target: files open in the viewer
 * (`/files?view=`), folders navigate into the folder (`/files?folder=`).
 * Null when the target isn't openable (deleted, or not a file/folder).
 */
export function activityLink(entityType: string | null | undefined, entityId: string | null | undefined, action: string): string | null {
  if (!entityId || GONE_ACTIONS.has(action)) return null;
  if (entityType === 'file') return `/files?view=${entityId}`;
  if (entityType === 'folder') return `/files?folder=${entityId}`;
  return null;
}

/** Compact absolute timestamp for feed rows, e.g. "Jul 23, 14:05". */
export function shortDateTime(ts: number): string {
  if (currentLocale() === 'en') {
    const d = new Date(ts * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${formatDateWith(d, { month: 'short', day: 'numeric' }, 'en')}, ${hh}:${mm}`;
  }
  return formatDateWith(ts, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
