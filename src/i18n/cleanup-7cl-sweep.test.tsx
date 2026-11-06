/**
 * Unit 7cl: the helpers in lib/ that used to return English (timeUntil,
 * expiryLabel, humanDuration, the activity verbs, the data-rights unit words,
 * the library nouns, the folder counts) read in Turkish with no English left,
 * and read exactly as before in English.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';
import { timeUntil, expiryLabel, actionLabel } from '@/lib/helpers';
import { humanDuration } from '@/lib/import-rate';
import { activityPhrase } from '@/lib/activity-labels';
import { KIND_COPY, plural as libraryPlural } from '@/lib/library-request';
import { purgeSummary, bulkPurgeStillEmptying, partialProgressNote } from '@/lib/folder-purge';
import { cooldownLabel, describeArchives, describeAnswer, describeOtherRequest, expiresLabel, type ExportSummary, type RequestState } from '@/lib/data-rights';
import { titleForPath } from '@/lib/page-title';
import { friendStatusLabel } from '@/api/referrals';

const NOW = 1_790_672_400;
const DAY = 86400;

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { shown?.unmount(); shown = null; });

async function showTexts(lines: () => string[], locale: 'en' | 'tr'): Promise<{ r: Rendered; lines: string[] }> {
  // The module-level t follows the provider's language, so the lines are read after the render.
  let out: string[] = [];
  const Probe = (): ReactElement => {
    out = lines();
    return <ul>{out.map((l, i) => <li key={i}>{l}</li>)}</ul>;
  };
  const r = await renderInLocale(<Probe />, locale);
  shown = r;
  return { r, lines: out };
}

const summary: ExportSummary = {
  id: 'e', created_at: NOW, expires_at: NOW + 7 * DAY, workspace_count: 2, file_count: 12, total_bytes: 3 * 1024 ** 3,
  part_count: 2, manifest_bytes: 1, parts: [],
};
const request: RequestState = {
  id: 'r', kind: 'access', status: 'answered', requested_at: NOW - 240, due_at: NOW + 30 * DAY, verified_at: NOW - 120,
  answered_at: NOW, retry_at: null, note: null, export: summary, had_export: true, code_pending: false,
};

const timeLines = () => [
  timeUntil(NOW + 30, NOW), timeUntil(NOW + 300, NOW), timeUntil(NOW + 5 * 3600, NOW),
  timeUntil(NOW + 3 * DAY, NOW), timeUntil(NOW + DAY, NOW),
  expiryLabel(NOW + 3 * DAY, NOW), expiryLabel(NOW + 300, NOW),
  humanDuration(240), humanDuration(4800), humanDuration(7200),
];
const VERB_CODES = ['file_uploaded', 'file_downloaded', 'file_deleted', 'file_restored', 'file_renamed', 'file_moved', 'file_copied', 'file_locked', 'file_unlocked', 'file_shared', 'member_invited', 'member_joined', 'member_removed', 'favourite_added', 'favourite_removed'];
const verbLines = () => VERB_CODES.map((c) => activityPhrase(c));
const dataLines = () => [
  describeAnswer(request, NOW), describeArchives(summary), cooldownLabel(NOW + 90, NOW) ?? '', cooldownLabel(NOW + 30, NOW) ?? '',
  cooldownLabel(NOW + 3 * 3600, NOW) ?? '', expiresLabel(NOW + 3 * DAY, NOW), expiresLabel(NOW + 3600, NOW),
  describeOtherRequest({ id: 'o', kind: 'objection', status: 'pending', requested_at: NOW, due_at: NOW + DAY, note: null }, NOW),
];
const countLines = () => [
  KIND_COPY.photos.noun, KIND_COPY.photos.nounPlural, KIND_COPY.videos.nounPlural, KIND_COPY.documents.noun,
  libraryPlural('photos', 3), libraryPlural('documents', 1),
  purgeSummary({ complete: false, cancelled: false, filesAffected: 5, remaining: 9, calls: 2 }, 'Big').body,
  bulkPurgeStillEmptying({ deleted: 1, failed: 0, incomplete: [{ name: 'A', filesAffected: 2, remaining: 3 }, { name: 'B', filesAffected: 1, remaining: 4 }] }).body,
  partialProgressNote([{ name: 'A', filesAffected: 2, remaining: 0 }, { name: 'B', filesAffected: 1, remaining: 0 }]),
  titleForPath('/save/abc'),
  friendStatusLabel('credited'), friendStatusLabel('pending'), friendStatusLabel('held'), friendStatusLabel('x'),
];

describe('lib helpers in Turkish', () => {
  it('timeUntil, expiryLabel and humanDuration', async () => {
    const { r, lines } = await showTexts(timeLines, 'tr');
    expect(lines.join(' ')).not.toMatch(/\bdays?\b|under a minute|Expires/);
    expect(r.leftover()).toEqual([]);
  });
  it('the lowercase activity verbs', async () => {
    const { r } = await showTexts(verbLines, 'tr');
    expect(r.leftover()).toEqual([]);
    expect(actionLabel('file_uploaded')).not.toBe('uploaded');
    expect(actionLabel('member_invited')).not.toBe('invited');
  });
  it('data-rights unit words', async () => {
    const { r, lines } = await showTexts(dataLines, 'tr');
    expect(lines.join(' ')).not.toMatch(/\b(minutes?|hours?|days?|seconds?|workspaces?|archives?|files?|objection|in less than a day)\b/);
    expect(r.leftover()).toEqual([]);
  });
  it('library nouns, folder counts, the save page title and referral statuses', async () => {
    const { r, lines } = await showTexts(countLines, 'tr');
    expect(lines.join(' ')).not.toMatch(/\b(photos?|documents?|folders?|Save to dosya|Counted|Under review)\b/);
    expect(r.leftover()).toEqual([]);
  });
});

describe('lib helpers in English stay as they were', () => {
  it('time and duration phrases', async () => {
    const { lines } = await showTexts(timeLines, 'en');
    expect(lines).toEqual([
      'in under a minute', 'in 5m', 'in 5h', 'in 3 days', 'in 1 day',
      'Expires in 3 days', 'Expires in 5m', '4m', '1h 20m', '2h',
    ]);
  });
  it('data-rights sentences', async () => {
    const { lines } = await showTexts(dataLines, 'en');
    expect(lines[1]).toContain('12 files you uploaded');
    expect(lines[1]).toContain('2 workspaces');
    expect(lines[1]).toContain('2 archives');
    expect(lines[2]).toBe('in 2 minutes');
    expect(lines[3]).toBe('in 30 seconds');
    expect(lines[4]).toBe('in 3 hours');
    expect(lines[5]).toBe('in 3 days');
    expect(lines[6]).toBe('in less than a day');
    expect(lines[7]).toContain('We have your objection');
  });
  it('verbs, nouns and folder counts', async () => {
    const { lines } = await showTexts(() => [...verbLines(), ...countLines()], 'en');
    expect(lines.slice(0, 15)).toEqual(['uploaded', 'downloaded', 'deleted', 'restored', 'renamed', 'moved', 'copied', 'locked', 'unlocked', 'shared', 'invited', 'joined', 'removed', 'favourited', 'unfavourited']);
    expect(lines.slice(15, 21)).toEqual(['photo', 'photos', 'videos', 'document', '3 photos', '1 document']);
    expect(lines[22]).toContain('2 folders');
    expect(lines[23]).toContain('2 folders');
    expect(lines[24]).toBe('Save to dosya');
    expect(lines.slice(25)).toEqual(['Counted', 'Waiting for activity', 'Under review', 'Not eligible']);
  });
});
