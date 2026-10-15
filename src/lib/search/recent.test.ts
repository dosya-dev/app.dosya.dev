import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getRecents, recordRecent, clearAllRecents, type RecentItem } from './recent';

const r = (id: string): RecentItem => ({ id, kind: 'goto', title: id, href: `/${id}` });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('recents', () => {
  it('stores newest first, de-duplicates by id, keeps 8, shows 5', () => {
    for (let i = 0; i < 10; i++) recordRecent('u1', 'w1', r(`p${i}`));
    recordRecent('u1', 'w1', r('p5'));
    expect(getRecents('u1', 'w1').map((x) => x.id)).toEqual(['p5', 'p9', 'p8', 'p7', 'p6']);
    expect(getRecents('u1', 'w1', 100)).toHaveLength(8);
  });
  it('keeps users and workspaces apart', () => {
    recordRecent('u1', 'w1', r('a'));
    expect(getRecents('u1', 'w2')).toEqual([]);
    expect(getRecents('u2', 'w1')).toEqual([]);
  });
  it('does nothing without a user or workspace', () => {
    recordRecent(undefined, 'w1', r('a'));
    expect(localStorage.length).toBe(0);
    expect(getRecents(undefined, 'w1')).toEqual([]);
  });
  it('ignores corrupt or malformed storage', () => {
    localStorage.setItem('dosya.recent.u1.w1', '{not json');
    expect(getRecents('u1', 'w1')).toEqual([]);
    localStorage.setItem('dosya.recent.u1.w1', JSON.stringify([{ id: 1 }, r('ok'), null, 'x']));
    expect(getRecents('u1', 'w1').map((x) => x.id)).toEqual(['ok']);
  });
  it('drops rows whose href is not an in-app path', () => {
    localStorage.setItem('dosya.recent.u1.w1', JSON.stringify([
      { ...r('js'), href: 'javascript:alert(1)' }, { ...r('proto'), href: '//evil.com' }, { ...r('ok'), href: '/files?folder=x' },
    ]));
    expect(getRecents('u1', 'w1').map((x) => x.id)).toEqual(['ok']);
  });
  it('survives localStorage throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => recordRecent('u1', 'w1', r('a'))).not.toThrow();
    expect(getRecents('u1', 'w1')).toEqual([]);
  });
  it('clearAllRecents removes only recent keys', () => {
    recordRecent('u1', 'w1', r('a'));
    localStorage.setItem('other', '1');
    clearAllRecents();
    expect(getRecents('u1', 'w1')).toEqual([]);
    expect(localStorage.getItem('other')).toBe('1');
  });
});
