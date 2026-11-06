import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider, loadMessages } from './i18n';
import type { Locale } from '@/i18n/locales';
import { formatBytes, formatDate, formatNumber, formatRelative, formatShortDate } from './format-locale';
import { formatNumber as translatorNumber } from '@/i18n/translator';
import { intlTag } from '@/i18n/locales';
import { t } from './i18n';
import { formatExactDateTime } from './date-format';
import { humanSize, timeAgo } from './helpers';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
/** Makes `locale` the current language, the way main.tsx does at boot. */
async function useLocale(locale: Locale) {
  if (root) act(() => root!.unmount());
  const messages = await loadMessages(locale);
  const el = document.createElement('div');
  root = createRoot(el);
  await act(async () => { root!.render(<I18nProvider initial={locale} initialMessages={messages}><span /></I18nProvider>); });
}
afterEach(async () => { await useLocale('en'); });

const TS = 1718445600; // 2024-06-15T10:00:00Z

describe('formatBytes', () => {
  it('en: B / KB with one decimal / MB / GB, as the shared formatter writes them', async () => {
    await useLocale('en');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1073741824)).toBe('5.0 GB');
  });
  it('de: decimal comma', async () => {
    await useLocale('de');
    expect(formatBytes(1536)).toBe('1,5 KB');
  });
  it('fr: octets', async () => {
    await useLocale('fr');
    expect(formatBytes(1536)).toContain('Ko');
  });
});

describe('humanSize keeps its English output', () => {
  it('en digits are unchanged', async () => {
    await useLocale('en');
    expect(humanSize(0)).toBe('0 B');
    expect(humanSize(1023)).toBe('1023 B');
    expect(humanSize(1536)).toBe('2 KB');
    expect(humanSize(5 * 1073741824)).toBe('5.00 GB');
  });
  it('de: decimal comma on the MB tier', async () => {
    await useLocale('de');
    expect(humanSize(1572864)).toBe('1,5 MB');
  });
});

describe('formatDate', () => {
  it('en datetime equals formatExactDateTime', async () => {
    await useLocale('en');
    const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(TS * 1000));
    expect(formatDate(TS, 'datetime')).toBe(expected);
    expect(formatExactDateTime(TS)).toBe(expected);
  });
  it('en medium passes undefined to Intl', async () => {
    await useLocale('en');
    expect(formatDate(TS, 'medium')).toBe(new Date(TS * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
  });
  it('tr writes the Turkish month', async () => {
    await useLocale('tr');
    expect(formatDate(TS, 'long')).toContain('Haziran');
    expect(formatDate(TS, 'medium')).toContain('Haz');
  });
  it('accepts a Date and an ISO string', async () => {
    await useLocale('en');
    expect(formatDate(new Date(TS * 1000), 'medium')).toBe(formatDate(TS, 'medium'));
    expect(formatDate('2024-06-15T10:00:00Z', 'medium')).toBe(formatDate(TS, 'medium'));
  });
});

describe('formatNumber', () => {
  it('follows the language', async () => {
    await useLocale('en');
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString());
    await useLocale('de');
    expect(formatNumber(1234567)).toBe('1.234.567');
  });
});

describe('formatRelative', () => {
  const NOW = Date.UTC(2026, 9, 19, 12) / 1000;
  it('en buckets equal timeAgo', async () => {
    await useLocale('en');
    const cases: [number, string][] = [
      [30, 'just now'], [300, '5m ago'], [3 * 3600, '3h ago'], [2 * 86400, '2d ago'], [40 * 86400, 'Sep 9'],
    ];
    for (const [ago, text] of cases) {
      expect(formatRelative(NOW - ago, NOW)).toBe(text);
      expect(timeAgo(NOW - ago, NOW)).toBe(text);
    }
  });
  it('words come from the catalog in other languages', async () => {
    await useLocale('de');
    expect(formatRelative(NOW - 300, NOW)).not.toBe('5m ago');
    expect(formatRelative(NOW - 300, NOW)).toContain('5');
  });
});

describe('state holds raw values, never a sentence (Review Focus 6)', () => {
  it('an entry created under tr reads German after the switch to de', async () => {
    // What a store keeps: the raw timestamp and byte count, not their text.
    const entry = { createdAt: TS, bytes: 1572864 };
    const render = () => `${formatDate(entry.createdAt, 'long')} | ${formatBytes(entry.bytes)}`;
    await useLocale('tr');
    const inTurkish = render();
    expect(inTurkish).toContain('Haziran');
    await useLocale('de');
    const inGerman = render();
    expect(inGerman).toContain('Juni');
    expect(inGerman).toContain('1,5 MB');
    expect(inGerman).not.toBe(inTurkish);
  });
});

describe('right-to-left languages: digits and calendars (Review Focus 5)', () => {
  it('ar pins Western digits whatever the browser default is', async () => {
    await useLocale('ar');
    expect(intlTag('ar')).toBe('ar-u-nu-latn');
    expect(formatNumber(1234.5)).toBe('1,234.5');
  });

  it('ar: the ICU plural # and formatNumber agree on digits, and the translator and format-locale agree', async () => {
    await useLocale('ar');
    const msg = t('common.description.jobcompletedFilesPluralOneFileOtherFilesFromFrom', { jobCompleted_files: 1234, from: 'x' });
    expect(msg).toContain('1,234');
    expect(msg).not.toMatch(/[\u0660-\u0669]/);
    expect(translatorNumber('ar', 1234)).toBe(formatNumber(1234));
  });

  it('he keeps Western digits; en is untouched', async () => {
    await useLocale('he');
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(intlTag('en')).toBeUndefined();
    expect(intlTag('de')).toBe('de');
  });

  it('fa keeps Persian digits and the Solar Hijri calendar', async () => {
    await useLocale('fa');
    expect(formatNumber(1234.5)).toBe('\u06f1\u066c\u06f2\u06f3\u06f4\u066b\u06f5');
    const march15 = Date.UTC(2026, 2, 15, 12) / 1000;
    expect(formatShortDate(march15, march15, { utc: true })).not.toMatch(/1404|\u06f1\u06f4\u06f0\u06f4/);
  });

  it('formatShortDate compares years in the locale calendar: fa includes the year across a Nowruz boundary, en does not', async () => {
    const march15 = Date.UTC(2026, 2, 15, 12) / 1000; // 1404 Esfand
    const april10 = Date.UTC(2026, 3, 10, 12) / 1000; // 1405 Farvardin
    await useLocale('fa');
    expect(formatShortDate(march15, april10, { utc: true })).toMatch(/\u06f1\u06f4\u06f0\u06f4/);
    await useLocale('en');
    expect(formatShortDate(march15, april10, { utc: true })).toBe('Mar 15');
  });
});
