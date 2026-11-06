/**
 * Locale-aware dates, numbers, sizes and relative times for the web app.
 *
 * Every function reads the CURRENT language at call time (lib/i18n.tsx) and
 * keeps no text: callers store timestamps, counts and byte sizes, and format
 * them while rendering, so a language switch never leaves a stale sentence.
 *
 * English stays as it was before i18n. For "en" Intl gets `undefined` (the
 * browser's locale), or the explicit tag a call site used to hard-code
 * ('en-US', 'en-GB'): pass that tag as `enTag` and English output does not
 * move. Other languages get their own locale. One Intl formatter is cached per
 * locale and per option set.
 */
import { currentLocale, t } from '@/lib/i18n';
import { intlTag, type Locale } from '@/i18n/locales';
import { formatBytes as translatorBytes } from '@/i18n/translator';

/** Numbers are Unix seconds (as the API sends them), strings are ISO dates. */
export type DateInput = number | string | Date;

const toDate = (value: DateInput): Date =>
  value instanceof Date ? value : typeof value === 'number' ? new Date(value * 1000) : new Date(value);

/** The tag for Intl: "en" keeps what the call site used before (undefined = browser locale). */
const tagFor = (locale: Locale, enTag?: string): string | undefined => (locale === 'en' ? enTag : intlTag(locale));

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(locale: Locale, opts: Intl.DateTimeFormatOptions, enTag?: string): Intl.DateTimeFormat {
  const key = `${locale}|${enTag ?? ''}|${JSON.stringify(opts)}`;
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(tagFor(locale, enTag), opts);
    dateFormatters.set(key, f);
  }
  return f;
}

const numberFormatters = new Map<string, Intl.NumberFormat>();
function numberFormatter(locale: Locale, opts: Intl.NumberFormatOptions | undefined, enTag?: string): Intl.NumberFormat {
  const key = `${locale}|${enTag ?? ''}|${opts ? JSON.stringify(opts) : ''}`;
  let f = numberFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(tagFor(locale, enTag), opts);
    numberFormatters.set(key, f);
  }
  return f;
}

export type DateStyle = 'short' | 'medium' | 'long' | 'datetime';

const STYLE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { year: 'numeric', month: 'numeric', day: 'numeric' },
  medium: { month: 'short', day: 'numeric', year: 'numeric' },
  long: { month: 'long', day: 'numeric', year: 'numeric' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
};

/** What a bare toLocaleString() prints: every date and time field, numeric. */
export const DATE_TIME_NUMERIC: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
};

/** A date in one of four standard shapes, in the current language. */
export function formatDate(value: DateInput, style: DateStyle): string {
  return dateFormatter(currentLocale(), STYLE_OPTIONS[style]).format(toDate(value));
}

/** A date with explicit Intl options, for the shapes the standard styles do not cover. */
export function formatDateWith(value: DateInput, opts: Intl.DateTimeFormatOptions, enTag?: string): string {
  const locale = currentLocale();
  // A date-only shape goes through toLocaleDateString, exactly as the call
  // sites did before (their tests watch that call; the engine caches the
  // formatter per locale and options). Anything with a time field uses the
  // cached Intl.DateTimeFormat, since toLocaleDateString would add a date.
  if (!TIME_FIELDS.some((k) => k in opts)) return toDate(value).toLocaleDateString(tagFor(locale, enTag), opts);
  return dateFormatter(locale, opts, enTag).format(toDate(value));
}

const TIME_FIELDS = ['hour', 'minute', 'second', 'dateStyle', 'timeStyle', 'dayPeriod', 'fractionalSecondDigits'];

/** The parts of a date, for call sites that assemble their own layout. */
export function formatDateParts(value: DateInput, opts: Intl.DateTimeFormatOptions, enTag?: string): Intl.DateTimeFormatPart[] {
  return dateFormatter(currentLocale(), opts, enTag).formatToParts(toDate(value));
}

export function formatNumber(n: number): string {
  return numberFormatter(currentLocale(), undefined).format(n);
}

/**
 * A count or fraction part shown as-is: the current language's digits (Persian
 * gets its own, Arabic keeps Western) but no grouping. English is String(n)
 * itself, whatever the browser's own locale is.
 */
export function localDigits(n: number): string {
  const locale = currentLocale();
  if (locale === 'en') return String(n);
  return numberFormatter(locale, { useGrouping: false }).format(n);
}

/** A number with explicit Intl options (currency, fraction digits), in the current language. */
export function formatNumberWith(n: number, opts?: Intl.NumberFormatOptions, enTag?: string): string {
  return numberFormatter(currentLocale(), opts, enTag).format(n);
}

const listFormatters = new Map<string, Intl.ListFormat>();
/**
 * Items joined the way `locale` lists them (separators, spacing and order are
 * the language's own, never a hard-coded ", "). English is pinned to 'en' so
 * the browser's locale does not leak in.
 */
export function formatList(locale: Locale, items: string[], opts: Intl.ListFormatOptions = { type: 'unit', style: 'short' }): string {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = listFormatters.get(key);
  if (!f) {
    f = new Intl.ListFormat(tagFor(locale, 'en'), opts);
    listFormatters.set(key, f);
  }
  return f.format(items);
}

/** Sizes as packages/shared writes them (KB with one decimal), in the current language. */
export function formatBytes(n: number): string {
  return translatorBytes(currentLocale(), n);
}

/** `n.toFixed(digits)` in English (unchanged), the language's own separator elsewhere. */
export function fixedNumber(n: number, digits: number): string {
  return currentLocale() === 'en'
    ? n.toFixed(digits)
    : numberFormatter(currentLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** Unit names: French writes octets, every other language keeps B, KB, MB, GB, TB. */
export function sizeUnits(): { B: string; KB: string; MB: string; GB: string; TB: string } {
  return currentLocale() === 'fr'
    ? { B: 'o', KB: 'Ko', MB: 'Mo', GB: 'Go', TB: 'To' }
    : { B: 'B', KB: 'KB', MB: 'MB', GB: 'GB', TB: 'TB' };
}

/** A whole byte count: unchanged in English, grouped in the language otherwise. */
export function byteCount(n: number): string {
  return currentLocale() === 'en' ? String(n) : formatNumber(n);
}

/**
 * "just now", "5m ago", "3h ago", "2d ago", then a short date ("Jul 23", with
 * the year only when it is not this year). `unixSeconds` and `now` are both
 * Unix seconds. `utc` reads the calendar date in UTC for wall-clock values
 * (an EXIF capture date has no zone).
 */
export function formatRelative(unixSeconds: number, now: number = Math.floor(Date.now() / 1000), opts: { utc?: boolean } = {}): string {
  const diff = now - unixSeconds;
  if (diff < 60) return t('common.label.justNow');
  if (diff < 3600) return t('common.label.minutesMAgo', { minutes: Math.floor(diff / 60) });
  if (diff < 86400) return t('common.label.hoursHAgo', { hours: Math.floor(diff / 3600) });
  if (diff < 604800) return t('common.label.daysDAgo', { days: Math.floor(diff / 86400) });
  return formatShortDate(unixSeconds, now, opts);
}

/** "Jul 23", or "Jul 23, 2024" when the year is not the current one. */
export function formatShortDate(unixSeconds: number, now: number = Math.floor(Date.now() / 1000), opts: { utc?: boolean } = {}): string {
  const d = new Date(unixSeconds * 1000);
  const nowDate = new Date(now * 1000);
  // Same year in the language's own calendar (fa counts Solar Hijri years).
  const yearOf = (date: Date): string | undefined =>
    dateFormatter(currentLocale(), opts.utc ? { year: 'numeric', timeZone: 'UTC' } : { year: 'numeric' }, 'en')
      .formatToParts(date)
      .find((p) => p.type === 'year')?.value;
  const year = yearOf(d);
  const thisYear = yearOf(nowDate);
  const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (year !== thisYear) o.year = 'numeric';
  if (opts.utc) o.timeZone = 'UTC';
  // Explicit 'en' keeps the English month names the hand-written table used.
  return dateFormatter(currentLocale(), o, 'en').format(d);
}
