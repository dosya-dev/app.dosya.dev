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
});
