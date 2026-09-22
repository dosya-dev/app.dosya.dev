import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatCell, formatExactDateTime, loadExactDates, saveExactDates, EXACT_DATES_KEY, useDateFormat,
} from './date-format';
import { timeAgo } from './helpers';

// 2024-06-15T10:00:00Z - old enough that timeAgo renders a calendar date.
const TS = 1718445600;
const NOW = 1_756_800_000; // 2025-09-02

beforeEach(() => {
  localStorage.clear();
  useDateFormat.setState({ exact: false });
});

describe('formatExactDateTime', () => {
  it('is the full local date and time in the viewer\'s locale (medium date, short time)', () => {
    const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(TS * 1000));
    expect(formatExactDateTime(TS)).toBe(expected);
    // Sanity: a medium date always carries the year, a short time a colon.
    expect(formatExactDateTime(TS)).toContain('2024');
    expect(formatExactDateTime(TS)).toMatch(/\d:\d\d/);
  });
});

describe('formatCell', () => {
  it('relative mode: the cell shows the relative label and the title carries the exact date/time', () => {
    const cell = formatCell(TS, { exact: false, now: NOW });
    expect(cell.text).toBe(timeAgo(TS, NOW));
    expect(cell.title).toBe(formatExactDateTime(TS));
  });

  it('exact mode: the cell itself shows the absolute string', () => {
    const cell = formatCell(TS, { exact: true, now: NOW });
    expect(cell.text).toBe(formatExactDateTime(TS));
    expect(cell.title).toBe(formatExactDateTime(TS));
  });

  it('relative mode still says "just now" for fresh timestamps, with the exact time on hover', () => {
    const cell = formatCell(NOW - 5, { exact: false, now: NOW });
    expect(cell.text).toBe('just now');
    expect(cell.title).toBe(formatExactDateTime(NOW - 5));
  });
});

describe('exact-dates preference', () => {
  it('defaults to relative dates with nothing saved', () => {
    expect(loadExactDates()).toBe(false);
  });

  it('round-trips through localStorage', () => {
    saveExactDates(true);
    expect(localStorage.getItem(EXACT_DATES_KEY)).toBe('1');
    expect(loadExactDates()).toBe(true);
    saveExactDates(false);
    expect(loadExactDates()).toBe(false);
  });

  it('the store\'s setExact persists and updates state', () => {
    useDateFormat.getState().setExact(true);
    expect(useDateFormat.getState().exact).toBe(true);
    expect(loadExactDates()).toBe(true);
  });
});
