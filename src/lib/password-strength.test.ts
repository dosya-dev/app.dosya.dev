import { describe, it, expect } from 'vitest';
import { scorePassword, MIN_PASSWORD_LENGTH } from './password-strength';

describe('scorePassword', () => {
  it('rejects anything shorter than the minimum length', () => {
    for (const pw of ['', 'a', 'Abc1!', '1234567']) {
      const r = scorePassword(pw);
      expect(r.acceptable).toBe(false);
      expect(r.score).toBe(0);
    }
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it('flags a long-enough but trivially weak password as weak', () => {
    // The exact case the audit called out: 8 digits passes a length check but
    // is the first thing any list tries.
    const r = scorePassword('12345678');
    expect(r.acceptable).toBe(true);
    expect(r.label).toBe('Weak');
    expect(r.warning).toBeTruthy();
  });

  it('warns on common passwords regardless of composition', () => {
    expect(scorePassword('Password1').warning).toBeTruthy();
    expect(scorePassword('qwertyui').warning).toBeTruthy();
  });

  it('warns on a single repeated character', () => {
    expect(scorePassword('aaaaaaaa').warning).toBeTruthy();
    expect(scorePassword('aaaaaaaa').label).toBe('Weak');
  });

  it('warns on a straight sequence run', () => {
    expect(scorePassword('abcdefgh').warning).toBeTruthy();
  });

  it('scores higher as character classes are added, and never lower', () => {
    // Length is weighted above composition on purpose, so at the 8-char floor
    // three classes and four classes land on the same rung - the guarantee is
    // monotonicity, not a distinct score per class.
    const lower = scorePassword('abcdefhj').score;   // one class
    const mixed = scorePassword('abcdEFHJ').score;   // two
    const digits = scorePassword('abcdEF13').score;  // three
    const symbols = scorePassword('abcdEF1!').score; // four
    expect(mixed).toBeGreaterThanOrEqual(lower);
    expect(digits).toBeGreaterThan(mixed);
    expect(symbols).toBeGreaterThanOrEqual(digits);
    expect(digits).toBeGreaterThan(lower);
  });

  it('rewards length', () => {
    expect(scorePassword('abcdEF1!xyzQR2@').score)
      .toBeGreaterThan(scorePassword('abcdEF1!').score);
  });

  it('gives a strong passphrase the top label', () => {
    const r = scorePassword('correct-horse-Battery-9-staple');
    expect(r.label).toBe('Strong');
    expect(r.acceptable).toBe(true);
    expect(r.warning).toBe('');
  });

  it('never returns a score outside 0..4', () => {
    for (const pw of ['', 'x', '12345678', 'a'.repeat(300), 'Aa1!'.repeat(50)]) {
      const { score } = scorePassword(pw);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(4);
    }
  });
});
