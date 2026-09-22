import { describe, expect, it } from 'vitest';
import { hadActiveJobs, rememberActiveJobs } from './job-activity';

function memoryStorage(initial: Record<string, string> = {}): Storage & { writes: number } {
  const map = new Map(Object.entries(initial));
  return {
    writes: 0,
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem(k, v) { this.writes++; map.set(k, v); },
  };
}

describe('job activity flag', () => {
  it('answers false for a fresh browser and true after a refresh saw an active job', () => {
    const store = memoryStorage();
    expect(hadActiveJobs('remote', store)).toBe(false);
    rememberActiveJobs('remote', true, store);
    expect(hadActiveJobs('remote', store)).toBe(true);
    // The two kinds are independent.
    expect(hadActiveJobs('cloud', store)).toBe(false);
  });

  it('clears once a refresh sees nothing active, and writes only on a change', () => {
    const store = memoryStorage();
    rememberActiveJobs('cloud', true, store);
    rememberActiveJobs('cloud', true, store);
    expect(store.writes).toBe(1);
    rememberActiveJobs('cloud', false, store);
    expect(hadActiveJobs('cloud', store)).toBe(false);
    expect(store.writes).toBe(2);
    rememberActiveJobs('cloud', false, store);
    expect(store.writes).toBe(2);
  });

  it('treats corrupt storage, a throwing store, and no storage at all as "nothing active"', () => {
    expect(hadActiveJobs('remote', memoryStorage({ dosya_active_jobs: '{not json' }))).toBe(false);
    expect(hadActiveJobs('remote', memoryStorage({ dosya_active_jobs: '"a string"' }))).toBe(false);
    const throwing = { ...memoryStorage(), getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(hadActiveJobs('remote', throwing)).toBe(false);
    expect(() => rememberActiveJobs('remote', true, throwing)).not.toThrow();
    expect(hadActiveJobs('remote', null)).toBe(false);
    expect(() => rememberActiveJobs('remote', true, null)).not.toThrow();
  });
});
