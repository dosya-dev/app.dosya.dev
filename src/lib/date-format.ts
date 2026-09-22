/**
 * Date rendering for list cells, plus the "Exact dates" preference.
 *
 * Relative labels ("3d ago", "Jul 23") are quick to scan but lose the time of
 * day and, past a week, the exact day; a compliance or support question needs
 * the full timestamp. Every date cell therefore carries the exact local
 * date/time in its title, and the preference below swaps the cell text itself
 * to the absolute string for people who always want it.
 *
 * Formatting goes through Intl with `undefined` as the locale so it follows
 * the browser's language and time zone rather than a hard-coded en-US/UTC.
 */
import { create } from 'zustand';
import { timeAgo } from '@/lib/helpers';

export const EXACT_DATES_KEY = 'dosya_exact_dates';

let exactFormatter: Intl.DateTimeFormat | null = null;
let exactUtcFormatter: Intl.DateTimeFormat | null = null;

/**
 * `wallClock` marks a value that is NOT a real instant: an EXIF capture date
 * is the camera's wall clock with no zone at all, which the server stores as
 * a string and reads as UTC (list-sort.ts's `fileTakenExpr`). Rendering that
 * pseudo-epoch in the viewer's zone moves the photo by the local offset - a
 * 23:00 shot becomes "the next day" east of Greenwich - so it is formatted
 * back in UTC, which returns exactly the digits the camera recorded.
 */
export interface DateFormatOptions {
  wallClock?: boolean;
}

/** "15 Jun 2024, 10:00" in the viewer's locale and zone (medium date, short time). */
export function formatExactDateTime(unixSeconds: number, opts: DateFormatOptions = {}): string {
  if (opts.wallClock) {
    exactUtcFormatter ??= new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
    return exactUtcFormatter.format(new Date(unixSeconds * 1000));
  }
  exactFormatter ??= new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return exactFormatter.format(new Date(unixSeconds * 1000));
}

export interface DateCellText {
  /** What the cell shows. */
  text: string;
  /** What the cell's `title` carries - always the exact local date/time. */
  title: string;
}

export function formatCell(
  unixSeconds: number,
  opts: { exact: boolean; now?: number; wallClock?: boolean },
): DateCellText {
  const title = formatExactDateTime(unixSeconds, { wallClock: opts.wallClock });
  // The flag belongs to the VALUE, so it governs the cell as much as the
  // tooltip: passing it to only one of them let the same tile print Jun 30 on
  // hover and Jul 1 in the table.
  const text = opts.exact ? title : timeAgo(unixSeconds, opts.now, { utc: opts.wallClock });
  return { text, title };
}

export function loadExactDates(): boolean {
  try {
    return localStorage.getItem(EXACT_DATES_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveExactDates(exact: boolean): void {
  try {
    localStorage.setItem(EXACT_DATES_KEY, exact ? '1' : '0');
  } catch {
    // Private windows and full quotas can throw; the in-memory state has
    // already moved on, so losing the persisted preference is acceptable.
  }
}

interface DateFormatState {
  exact: boolean;
  setExact: (exact: boolean) => void;
}

/**
 * The live preference. Column render functions are module-level constants,
 * so the cell component subscribes here rather than threading a prop through
 * every table.
 */
export const useDateFormat = create<DateFormatState>((set) => ({
  exact: loadExactDates(),
  setExact: (exact) => {
    saveExactDates(exact);
    set({ exact });
  },
}));
