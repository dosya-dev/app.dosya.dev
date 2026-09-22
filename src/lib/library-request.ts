/**
 * The Library view's request shapes and the one merge rule, kept pure so
 * they are unit tested without React. Mirrors files-request.ts for the
 * listing. Serves the Photos, Videos and Documents feeds - one request
 * shape, kind picked at the call site.
 *
 * The API (GET /api/library?kind=…) returns items already grouped by month
 * with the month's FULL count on the first page and a keyset cursor. A
 * month may continue from one page into the next; `mergeLibraryPages` joins
 * those into one group so the header is never repeated.
 */
import type { FileItem } from '@/lib/file-types';

export const LIBRARY_PAGE_SIZE = 60;
export const LIBRARY_QUERY_ROOT = 'library';

export type LibraryKind = 'photos' | 'videos' | 'documents';
export type LibrarySort = 'taken_desc' | 'taken_asc' | 'uploaded_desc';

/** The sidebar's type filters that open the library; every other filter is the folder listing. */
export function kindForFilter(filter: string): LibraryKind | null {
  if (filter === 'images') return 'photos';
  if (filter === 'videos') return 'videos';
  if (filter === 'documents') return 'documents';
  return null;
}

export const KIND_COPY: Record<LibraryKind, {
  title: string; noun: string; nounPlural: string; searchPlaceholder: string; emptyTitle: string; emptyDescription: string; primaryDateLabel: string;
}> = {
  photos: { title: 'Photos', noun: 'photo', nounPlural: 'photos', searchPlaceholder: 'Search photos...', emptyTitle: 'No photos yet', emptyDescription: 'Photos you upload or sync to any folder will show up here, by month.', primaryDateLabel: 'Date taken' },
  videos: { title: 'Videos', noun: 'video', nounPlural: 'videos', searchPlaceholder: 'Search videos...', emptyTitle: 'No videos yet', emptyDescription: 'Videos you upload or sync to any folder will show up here, by month.', primaryDateLabel: 'Date created' },
  documents: { title: 'Documents', noun: 'document', nounPlural: 'documents', searchPlaceholder: 'Search documents...', emptyTitle: 'No documents yet', emptyDescription: 'Documents you upload or sync to any folder will show up here, by month.', primaryDateLabel: 'Date created' },
};

/** The wire sort values are the same for every kind; only the label of the primary date differs. */
export function sortOptionsFor(kind: LibraryKind): { value: LibrarySort; label: string }[] {
  const d = KIND_COPY[kind].primaryDateLabel;
  return [
    { value: 'taken_desc', label: `${d} · newest` },
    { value: 'taken_asc', label: `${d} · oldest` },
    { value: 'uploaded_desc', label: 'Date uploaded · newest' },
  ];
}

export function plural(kind: LibraryKind, n: number): string {
  const c = KIND_COPY[kind];
  return `${n.toLocaleString()} ${n === 1 ? c.noun : c.nounPlural}`;
}

/** A listing row plus what the library feed adds. Assignable to FileItem, so the viewer and every action accept it. */
export interface LibraryItem extends FileItem {
  folder_id: string | null;
  /** Effective date, unix seconds: photos EXIF → source date → upload; videos and documents source date → upload. */
  taken_at: number;
  /**
   * Whether `taken_at` came from EXIF `captured_at` - a wall clock with no
   * zone - rather than from `source_created_at`/`created_at`, which are real
   * epochs. The server decides this per ROW, because the COALESCE behind
   * `taken_at` falls through: a screenshot or a stripped PNG is a photo whose
   * date is an ordinary epoch. Under `sort=uploaded_desc` it is false for
   * every row, EXIF photos included, because that mode returns the upload
   * instant rather than the capture date.
   */
  taken_is_wall_clock?: boolean;
}

/**
 * Should this row's date be read in UTC (the camera's own digits) or in the
 * viewer's zone? Purely the server's per-row flag - never the kind. The server
 * groups the feed by the same distinction, so following it is what keeps a
 * caption inside the month header it is printed under.
 *
 * The per-kind guess survives ONLY as the fallback for a server old enough not
 * to send the flag, where it is right for every photo that has EXIF and wrong
 * by the local offset for the ones that do not - exactly the behaviour that
 * shipped before the flag existed, and no worse.
 */
export function takenIsWallClockOf(item: LibraryItem, kind: LibraryKind): boolean {
  const flag = item.taken_is_wall_clock;
  // Coerced rather than returned as-is: the contract says a JSON boolean, and
  // a server that regressed to SQLite's 1/0 should still be read for what it
  // means instead of leaking a number into a boolean prop.
  return flag === undefined || flag === null ? kind === 'photos' : !!flag;
}

export interface LibraryPage {
  ok: boolean;
  kind?: LibraryKind;
  months: { key: string; label: string; files: LibraryItem[] }[];
  next_cursor: string | null;
  /** First page only. */
  counts?: Record<string, number>;
  /** First page only. */
  total?: number;
  can_lock?: boolean;
  can_hide?: boolean;
}

export interface LibraryView {
  workspaceId: string;
  kind: LibraryKind;
  sort: LibrarySort;
  q: string;
}

export function libraryQueryKey(view: LibraryView) {
  return [LIBRARY_QUERY_ROOT, view.workspaceId, view.kind, view.sort, view.q] as const;
}

/**
 * Minutes EAST of UTC for the viewer's clock (Contract 4). `getTimezoneOffset`
 * reports minutes WEST, so Istanbul in summer is -180 there and +180 here.
 */
export function viewerTzOffset(): number {
  return -new Date().getTimezoneOffset();
}

export function libraryRequestPath(
  view: LibraryView,
  cursor: string | null,
  tzOffset: number = viewerTzOffset(),
): string {
  const params = new URLSearchParams({
    workspace_id: view.workspaceId,
    kind: view.kind,
    limit: String(LIBRARY_PAGE_SIZE),
    sort: view.sort,
    // The server groups by month in THIS zone, so an 11pm photo lands in the
    // month the viewer took it in rather than UTC's.
    tz_offset: String(tzOffset),
  });
  if (view.q) params.set('q', view.q);
  if (cursor) params.set('cursor', cursor);
  return `/api/library?${params}`;
}

export interface MonthGroup {
  key: string;
  label: string;
  /** The month's full total from the server - right even while only part of the month is loaded. */
  count: number;
  files: LibraryItem[];
}

export interface Library {
  months: MonthGroup[];
  /** Every loaded item in stream order - what the viewer pages through and what Select all selects. */
  files: LibraryItem[];
  total: number;
  loaded: number;
  hasMore: boolean;
  canLock: boolean;
  canHide: boolean;
}

export function mergeLibraryPages(pages: LibraryPage[]): Library {
  const first = pages[0];
  const counts = first?.counts ?? {};
  const months: MonthGroup[] = [];
  const files: LibraryItem[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const m of page.months) {
      const fresh = m.files.filter((f) => !seen.has(f.id));
      for (const f of fresh) seen.add(f.id);
      const last = months[months.length - 1];
      if (last && last.key === m.key) last.files.push(...fresh);
      else months.push({ key: m.key, label: m.label, count: counts[m.key] ?? m.files.length, files: [...fresh] });
      files.push(...fresh);
    }
  }
  const lastPage = pages[pages.length - 1];
  return {
    months,
    files,
    total: first?.total ?? 0,
    loaded: files.length,
    hasMore: !!lastPage && lastPage.next_cursor != null,
    canLock: first?.can_lock ?? false,
    canHide: first?.can_hide ?? false,
  };
}

/**
 * "Jun 15, 2024" - the caption under a tile, in the viewer's own locale.
 *
 * The zone depends on what the value IS. A video's or document's `taken_at`
 * is a real instant (source date, else upload) and belongs in the viewer's
 * zone; the old fixed 'en-US' ignored their locale entirely. A photo's
 * `taken_at` comes from EXIF `captured_at` - a camera wall clock with no zone,
 * which the server reads as UTC and deliberately does NOT shift when it builds
 * the month header (apps/api/src/pages/api/library/index.ts). Formatting that
 * one locally captioned a 23:00 photo "Jul 1" under a "June" header, so
 * `wallClock` formats it back in UTC and returns the digits the camera
 * recorded. This is the one place a UTC pin is correct.
 */
export function formatItemDate(unixSeconds: number, opts: { wallClock?: boolean } = {}): string {
  const base: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return new Date(unixSeconds * 1000).toLocaleDateString(
    undefined,
    opts.wallClock ? { ...base, timeZone: 'UTC' } : base,
  );
}

// ── Per-kind layout preference (grid vs. table) ─────────────

export type LibraryLayout = 'grid' | 'list';

export const LIBRARY_LAYOUT_KEY = 'dosya_library_layout';

const LIBRARY_KINDS: LibraryKind[] = ['photos', 'videos', 'documents'];

/** Documents read better as a table from the first visit; photos and videos as a grid. */
export function defaultLayoutFor(kind: LibraryKind): LibraryLayout {
  return kind === 'documents' ? 'list' : 'grid';
}

function defaultLayouts(): Record<LibraryKind, LibraryLayout> {
  return {
    photos: defaultLayoutFor('photos'),
    videos: defaultLayoutFor('videos'),
    documents: defaultLayoutFor('documents'),
  };
}

export function loadLibraryLayouts(): Record<LibraryKind, LibraryLayout> {
  const defaults = defaultLayouts();
  try {
    const saved = localStorage.getItem(LIBRARY_LAYOUT_KEY);
    if (!saved) return defaults;
    const parsed: unknown = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
    const merged = { ...defaults };
    const record = parsed as Record<string, unknown>;
    for (const kind of LIBRARY_KINDS) {
      const value = record[kind];
      if (value === 'grid' || value === 'list') merged[kind] = value;
    }
    return merged;
  } catch {
    return defaults;
  }
}

export function saveLibraryLayout(kind: LibraryKind, layout: LibraryLayout): void {
  const current = loadLibraryLayouts();
  current[kind] = layout;
  try {
    localStorage.setItem(LIBRARY_LAYOUT_KEY, JSON.stringify(current));
  } catch {
    // Private windows, a full storage quota, or a locked-down environment
    // can all make this throw. The caller's in-memory UI state has already
    // moved on, so losing the persisted preference is fine - crashing the
    // page over it is not.
  }
}
