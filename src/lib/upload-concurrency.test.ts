import { describe, it, expect, beforeEach } from 'vitest';
import {
  getUserConcurrency, setUserConcurrency, effectiveConcurrency,
  DEFAULT_CONCURRENCY, MAX_USER_CONCURRENCY,
} from './upload-concurrency';

describe('upload-concurrency', () => {
  beforeEach(() => localStorage.clear());

  it('defaults when unset or invalid', () => {
    expect(getUserConcurrency()).toBe(DEFAULT_CONCURRENCY);
    localStorage.setItem('upload_concurrency', 'abc');
    expect(getUserConcurrency()).toBe(DEFAULT_CONCURRENCY);
    localStorage.setItem('upload_concurrency', '0');
    expect(getUserConcurrency()).toBe(DEFAULT_CONCURRENCY);
  });

  it('persists and clamps to [1, MAX]', () => {
    setUserConcurrency(2);
    expect(getUserConcurrency()).toBe(2);
    setUserConcurrency(99);
    expect(getUserConcurrency()).toBe(MAX_USER_CONCURRENCY);
    setUserConcurrency(0);
    expect(getUserConcurrency()).toBe(1);
  });

  it('effectiveConcurrency takes min of user and workspace caps', () => {
    expect(effectiveConcurrency(3, 5)).toBe(3);
    expect(effectiveConcurrency(5, 2)).toBe(2);
  });

  it('workspace cap of 0/null/undefined means unlimited (user cap wins)', () => {
    expect(effectiveConcurrency(3, 0)).toBe(3);
    expect(effectiveConcurrency(3, null)).toBe(3);
    expect(effectiveConcurrency(3, undefined)).toBe(3);
  });

  it('never returns below 1', () => {
    expect(effectiveConcurrency(0, 0)).toBe(1);
  });
});
