// Pinned east of UTC (UTC+3), so a 23:00 wall clock is "tomorrow" locally and
// the two readings cannot coincide the way they would on a UTC runner.
process.env.TZ = 'Asia/Istanbul';

import { describe, it, expect } from 'vitest';
import { formatCell } from './date-format';
import { timeAgo } from './helpers';

/** 2024-06-30T23:00:00Z - still June in UTC, already July in Istanbul. */
const WALL_CLOCK = Date.UTC(2024, 5, 30, 23, 0, 0) / 1000;
/** Far enough after it that timeAgo falls through to a calendar date. */
const NOW = WALL_CLOCK + 40 * 86_400;

describe('formatCell in a zone where the day differs', () => {
  it('the case is real here - UTC and local disagree about the date', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Istanbul');
    expect(new Date(WALL_CLOCK * 1000).getUTCDate()).toBe(30);
    expect(new Date(WALL_CLOCK * 1000).getDate()).toBe(1);
  });

  // The whole point of the wall-clock flag: an EXIF capture date has no zone,
  // so it must read the same on every surface. Passing the flag only to the
  // tooltip left the CELL going through timeAgo in the viewer's zone - so the
  // grid tile said Jun 30 and the table said Jul 1, which is the disagreement
  // the flag was added to end.
  it('renders a wall-clock date as the camera recorded it, not shifted', () => {
    const cell = formatCell(WALL_CLOCK, { exact: false, now: NOW, wallClock: true });
    expect(cell.text).toBe('Jun 30');
    expect(cell.title).toContain('30');
  });

  it('renders a real epoch in the viewer\'s own zone, as before', () => {
    const cell = formatCell(WALL_CLOCK, { exact: false, now: NOW });
    expect(cell.text).toBe('Jul 1');
  });

  it('agrees with the tooltip it sits under, in both modes', () => {
    for (const wallClock of [true, false]) {
      const relative = formatCell(WALL_CLOCK, { exact: false, now: NOW, wallClock });
      const exact = formatCell(WALL_CLOCK, { exact: true, now: NOW, wallClock });
      // "Jun 30" and "30 Jun 2024, 23:00" name the same day; the day number is
      // the part that used to differ between them.
      const day = wallClock ? '30' : '1';
      expect(relative.text).toContain(day);
      expect(exact.text).toContain(day);
      expect(relative.title).toBe(exact.title);
    }
  });

  it('leaves the relative labels alone - a duration has no time zone', () => {
    const justNow = formatCell(NOW - 30, { exact: false, now: NOW, wallClock: true });
    expect(justNow.text).toBe('just now');
    expect(formatCell(NOW - 7_200, { exact: false, now: NOW, wallClock: true }).text).toBe('2h ago');
  });
});

describe('timeAgo with an explicit UTC reading', () => {
  it('formats the fall-through calendar date in UTC when asked', () => {
    expect(timeAgo(WALL_CLOCK, NOW, { utc: true })).toBe('Jun 30');
    expect(timeAgo(WALL_CLOCK, NOW)).toBe('Jul 1');
  });

  it('adds the year from the same reading it formatted', () => {
    const twoYearsOn = WALL_CLOCK + 730 * 86_400;
    expect(timeAgo(WALL_CLOCK, twoYearsOn, { utc: true })).toBe('Jun 30, 2024');
  });
});
