import { describe, it, expect } from 'vitest';
import { bucketLabel } from './api-analytics';

const T = 1753747200; // an arbitrary fixed timestamp — labels are shape-tested, not value-tested

describe('bucketLabel', () => {
  it('24h buckets label as HH:MM', () => {
    expect(bucketLabel(T, '24h')).toMatch(/^\d{2}:\d{2}$/);
  });
  it('7d buckets label as "Mon D HH:MM"', () => {
    expect(bucketLabel(T, '7d')).toMatch(/^[A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}$/);
  });
  it('30d buckets label as "Mon D"', () => {
    expect(bucketLabel(T, '30d')).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });
  it('midnight labels as 00:xx, never 24:xx', () => {
    // scan a day of hourly buckets; whatever the local timezone, one of them is local midnight
    for (let i = 0; i < 24; i++) {
      const label = bucketLabel(T + i * 3600, '24h');
      expect(label.startsWith('24')).toBe(false);
    }
    expect(new Set(Array.from({ length: 24 }, (_, i) => bucketLabel(T + i * 3600, '24h').slice(0, 2))).has('00')).toBe(true);
  });
});
