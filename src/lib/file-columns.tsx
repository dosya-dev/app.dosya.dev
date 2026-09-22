/**
 * Table column definitions for the files list and the library table layout.
 * Moved out of pages/files.tsx so the library table (task W2/W3) can reuse
 * the same column set instead of redefining it - see ADR in the plan brief.
 */
import type { FileItem, FolderItem } from '@/lib/file-types';
import { humanSize, extOf, originLabel } from '@/lib/helpers';
import type { SortKey } from '@/lib/list-sort';
import { KIND_COPY, takenIsWallClockOf, type LibraryKind, type LibraryItem } from '@/lib/library-request';
import { formatCell, useDateFormat } from '@/lib/date-format';

/**
 * A date cell: the relative label (or the absolute string when "Exact dates"
 * is on) with the exact local date/time always available in the title. One
 * component rather than a formatting call so every cell follows the
 * preference live, without the column tables being rebuilt.
 */
export function DateCell({ ts, wallClock }: { ts: number; wallClock?: boolean }) {
  const exact = useDateFormat((s) => s.exact);
  const { text, title } = formatCell(ts, { exact, wallClock });
  return <span title={title}>{text}</span>;
}

// Every table column doubles as a sort key (the API whitelists them all).
// `taken` sorts in the folder listing (Contract 5); in the library table the
// same key is the kind's primary date and never sorts by header, because
// library ordering goes through its own LibrarySort.
export type ColumnKey = SortKey;

/**
 * Unix seconds for the "Date taken" cell of a listing row: the EXIF capture
 * date when the row carries one, else the same source-or-upload date the
 * Created column shows - the next term of the server's COALESCE, so the column
 * is never blank and never disagrees with the order it sorts in.
 *
 * `captured_at` is read as UTC, exactly as the server reads it
 * (`strftime('%s', substr(captured_at, 1, 19))`, apps/api/src/lib/list-sort.ts).
 * Date.parse() treats a bare "YYYY-MM-DD HH:MM:SS" as LOCAL, which shifted
 * every EXIF row by the viewer's offset while the plain rows beside it stayed
 * put - so in a mixed folder the column contradicted the order it sorts in.
 */
export function takenAtOf(f: FileItem): number {
  const ms = capturedAtMs(f.captured_at);
  return ms === null ? f.created_at : Math.floor(ms / 1000);
}

/**
 * True when `takenAtOf` returned a wall clock rather than a real instant -
 * see DateFormatOptions. Only EXIF rows are wall clocks; the fallback is the
 * listing's ordinary created date.
 */
export function takenIsWallClock(f: FileItem): boolean {
  return capturedAtMs(f.captured_at) !== null;
}

function capturedAtMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // substr(1,19) server-side: "YYYY-MM-DD HH:MM:SS", no sub-seconds, no zone.
  const ms = Date.parse(`${raw.slice(0, 19).replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : null;
}

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
  width?: string;
  render: (f: FileItem) => React.ReactNode;
  renderFolder?: (f: FolderItem) => React.ReactNode;
}

export const ALL_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', defaultVisible: true, width: 'flex-1 min-w-40', render: () => null /* handled separately */ },
  { key: 'size', label: 'Size', defaultVisible: true, width: 'w-20', render: (f) => humanSize(f.size_bytes), renderFolder: (f) => humanSize(f.total_size_bytes) },
  { key: 'created', label: 'Created', defaultVisible: true, width: 'w-24', render: (f) => <DateCell ts={f.created_at} />, renderFolder: (f) => <DateCell ts={f.created_at} /> },
  { key: 'modified', label: 'Modified', defaultVisible: false, width: 'w-24', render: (f) => <DateCell ts={f.updated_at} />, renderFolder: (f) => <DateCell ts={f.content_updated_at} /> },
  { key: 'taken', label: 'Date taken', defaultVisible: false, width: 'w-24', render: (f) => <DateCell ts={takenAtOf(f)} wallClock={takenIsWallClock(f)} /> },
  { key: 'type', label: 'Type', defaultVisible: false, width: 'w-28', render: (f) => f.mime_type, renderFolder: () => 'Folder' },
  { key: 'extension', label: 'Extension', defaultVisible: false, width: 'w-16', render: (f) => (f.extension || extOf(f.name) || '-').toUpperCase() },
  { key: 'version', label: 'Version', defaultVisible: false, width: 'w-16', render: (f) => f.current_version > 1 ? `v${f.current_version}` : '-' },
  { key: 'uploader', label: 'Uploader', defaultVisible: false, width: 'w-28', render: (f) => f.uploader_name ?? '-', renderFolder: (f) => f.uploader_name ?? '-' },
  { key: 'region', label: 'Region', defaultVisible: false, width: 'w-20', render: (f) => f.region || '-', renderFolder: (f) => f.region === 'multi' ? 'Multiple' : (f.region || '-') },
  { key: 'origin', label: 'Origin', defaultVisible: true, width: 'w-20', render: (f) => originLabel(f.origin), renderFolder: (f) => originLabel(f.origin) },
  { key: 'shares', label: 'Shares', defaultVisible: false, width: 'w-14', render: (f) => f.share_count > 0 ? String(f.share_count) : '-', renderFolder: (f) => f.share_count > 0 ? String(f.share_count) : '-' },
  { key: 'comments', label: 'Comments', defaultVisible: false, width: 'w-14', render: (f) => f.comment_count > 0 ? String(f.comment_count) : '-', renderFolder: (f) => f.comment_count > 0 ? String(f.comment_count) : '-' },
];

export const DEFAULT_VISIBLE: Set<ColumnKey> = new Set(ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key));

export const TABLE_COLUMNS_KEY = 'dosya_table_columns';

export function loadSavedColumns(): Set<ColumnKey> {
  try {
    const saved = localStorage.getItem(TABLE_COLUMNS_KEY);
    if (!saved) return new Set(DEFAULT_VISIBLE);
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_VISIBLE);
    // The cast this used to do was a lie: localStorage is user-writable and
    // outlives any column rename, so an unknown key silently produced a table
    // whose headers and cells disagreed. Keep only keys that still exist, and
    // fall back rather than render an empty table.
    const known = new Set<string>(ALL_COLUMNS.map((c) => c.key));
    const valid = parsed.filter((k): k is ColumnKey => typeof k === 'string' && known.has(k));
    // Name is not optional - a table without it is just a table of dates and
    // sizes with no way to tell the rows apart - so it rides along with
    // whatever the user actually saved, valid or not.
    return valid.length > 0 ? new Set<ColumnKey>(['name', ...valid]) : new Set(DEFAULT_VISIBLE);
  } catch {}
  return new Set(DEFAULT_VISIBLE);
}

/**
 * The library table layout: ALL_COLUMNS plus a library-only `taken` column,
 * labelled per kind ("Date taken" for photos, "Date created" for
 * videos/documents - mirrors KIND_COPY's primaryDateLabel) and rendering
 * LibraryItem.taken_at.
 *
 * The library feed's `created_at` is COALESCE(source_created_at, created_at)
 * (display-time.ts), and `taken_at` resolves through the same expression for
 * videos and documents - so for those two kinds `created` and `taken` are
 * byte-equal, and showing both would be two columns naming the same value
 * twice, one of them mislabelled ("Created" reading as upload time when it
 * is not). `created` is dropped for videos and documents, with `taken` in
 * its place. Photos differ: `taken_at` there prefers EXIF over the source
 * date, so the two genuinely disagree - `created` stays, and `taken` is
 * inserted right after it.
 */
export function libraryColumnsFor(kind: LibraryKind): ColumnDef[] {
  const takenColumn: ColumnDef = {
    key: 'taken',
    label: KIND_COPY[kind].primaryDateLabel,
    defaultVisible: true,
    width: 'w-24',
    // Per ROW, never per kind: `taken_at` is a COALESCE that falls through, so
    // a photo without EXIF carries a real epoch and belongs in the viewer's
    // zone (see takenIsWallClockOf). Keying on the kind put those on the wrong
    // side of midnight and made this column disagree with both the tiles and
    // the folder listing's own Date taken.
    render: (f) => {
      const item = f as LibraryItem;
      return <DateCell ts={item.taken_at} wallClock={takenIsWallClockOf(item, kind)} />;
    },
  };
  // The folder listing's own "Date taken" column is replaced by the library's
  // kind-labelled one, which renders the feed's resolved taken_at.
  const columns = ALL_COLUMNS.filter((c) => c.key !== 'taken');
  const createdIdx = columns.findIndex((c) => c.key === 'created');
  if (kind === 'photos') {
    columns.splice(createdIdx + 1, 0, takenColumn);
  } else {
    // Videos and documents: `taken` takes `created`'s slot outright.
    columns.splice(createdIdx, 1, takenColumn);
  }
  return columns;
}
