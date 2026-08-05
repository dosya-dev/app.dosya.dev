import { describe, it, expect } from 'vitest';
import { gbToBytes, mbToBytes, bytesToGb, bytesToMb } from './usage-units';

// Fix round 1 (task 5, review I1): before this file existed, the GB/MB ->
// bytes conversion lived inline in profile.tsx and role-create.tsx and was
// exercised by NO test at any level - not profile.test.tsx (which never
// renders ApiKeysSection), not the int suite (which POSTs an
// already-computed byte value, never calling the form's own math), not
// tsc -b (the bug class here is arithmetic, not a type error). A 1e9-for-2^30
// slip or a dropped Math.round would have been invisible repo-wide. These
// tests pin the exact arithmetic directly against the extracted helper.
describe('gbToBytes', () => {
  it('converts a round GB figure to exact bytes (2 GB -> 2147483648, GiB not decimal GB)', () => {
    expect(gbToBytes('2')).toBe(2147483648);
  });

  it('rounds a fractional GB figure to an integer (0.5 GB -> 536870912)', () => {
    const bytes = gbToBytes('0.5');
    expect(bytes).toBe(536870912);
    expect(Number.isInteger(bytes)).toBe(true);
  });

  it('passes 0 through as 0, not null - the server rejects zero, the client does not silently reinterpret it', () => {
    expect(gbToBytes('0')).toBe(0);
  });

  it('returns null for blank/whitespace-only input (no restriction)', () => {
    expect(gbToBytes('')).toBeNull();
    expect(gbToBytes('   ')).toBeNull();
  });

  it('passes a non-numeric string through as NaN rather than coercing to 0 or null', () => {
    expect(Number.isNaN(gbToBytes('not-a-number'))).toBe(true);
  });
});

describe('mbToBytes', () => {
  it('converts a round MB figure to exact bytes (1 MB -> 1048576, MiB not decimal MB)', () => {
    expect(mbToBytes('1')).toBe(1048576);
  });

  it('rounds a fractional MB figure to an integer', () => {
    const bytes = mbToBytes('0.5');
    expect(bytes).toBe(524288);
    expect(Number.isInteger(bytes)).toBe(true);
  });

  it('passes 0 through as 0, not null', () => {
    expect(mbToBytes('0')).toBe(0);
  });

  it('returns null for blank/whitespace-only input', () => {
    expect(mbToBytes('')).toBeNull();
    expect(mbToBytes('  ')).toBeNull();
  });

  it('passes a non-numeric string through as NaN', () => {
    expect(Number.isNaN(mbToBytes('nope'))).toBe(true);
  });
});

describe('bytesToGb / bytesToMb (the inverse, used to pre-fill role-create.tsx\'s edit form)', () => {
  it('round-trips an exact GB value through gbToBytes', () => {
    expect(gbToBytes(bytesToGb(2147483648))).toBe(2147483648);
  });

  it('round-trips an exact MB value through mbToBytes', () => {
    expect(mbToBytes(bytesToMb(1048576))).toBe(1048576);
  });

  it('trims floating-point noise for a byte value that is not an exact multiple of the unit', () => {
    // 1500000000 bytes is not an exact number of GiB - the displayed string
    // must not carry visible float garbage (e.g. "1.3969838619232178").
    expect(bytesToGb(1500000000)).toBe('1.396984');
  });
});
