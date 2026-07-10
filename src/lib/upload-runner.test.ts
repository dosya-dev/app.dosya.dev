import { describe, it, expect } from 'vitest';
import { missingPartNumbers } from './upload-runner';

describe('missingPartNumbers', () => {
  it('returns all parts when none uploaded', () => {
    expect(missingPartNumbers(4, [])).toEqual([1, 2, 3, 4]);
  });
  it('skips already-uploaded parts, order preserved', () => {
    expect(missingPartNumbers(5, [1, 2, 4])).toEqual([3, 5]);
  });
  it('returns [] when all uploaded', () => {
    expect(missingPartNumbers(3, [1, 2, 3])).toEqual([]);
  });
  it('ignores out-of-range uploaded parts', () => {
    expect(missingPartNumbers(2, [1, 2, 7])).toEqual([]);
  });
});
