import { describe, it, expect } from 'vitest';
import { formatMs, anchorLabel, activeMentionIds, splitMentions, mentionQueryAt } from './format';

describe('formatMs / anchorLabel', () => {
  it('formats', () => {
    expect(formatMs(42_000)).toBe('0:42');
    expect(formatMs(3_725_000)).toBe('1:02:05');
    expect(anchorLabel({ anchor_ms: 42_000, anchor_page: null })).toBe('0:42');
    expect(anchorLabel({ anchor_ms: null, anchor_page: 4 })).toBe('p. 4');
    expect(anchorLabel({ anchor_ms: null, anchor_page: null })).toBeNull();
  });
});

describe('activeMentionIds', () => {
  it('keeps ids whose @Name is still in the text', () => {
    const picked = new Map([['u_a', 'Ayşe Kaya'], ['u_b', 'Ali Demir']]);
    expect(activeMentionIds('@Ayşe Kaya look', picked)).toEqual(['u_a']);
    expect(activeMentionIds('nobody', picked)).toEqual([]);
  });
  it('duplicate names: both ids survive while the name is present', () => {
    const picked = new Map([['u_a', 'Ali'], ['u_b', 'Ali']]);
    expect(activeMentionIds('@Ali hi', picked).sort()).toEqual(['u_a', 'u_b']);
  });
});

describe('splitMentions', () => {
  it('marks @Name runs for the given mentions only', () => {
    expect(splitMentions('hi @Ayşe Kaya and @Bob', [{ id: 'u_a', name: 'Ayşe Kaya' }])).toEqual([
      { text: 'hi ', mention: false },
      { text: '@Ayşe Kaya', mention: true },
      { text: ' and @Bob', mention: false },
    ]);
  });
  it('no mentions is one plain segment', () => {
    expect(splitMentions('plain', [])).toEqual([{ text: 'plain', mention: false }]);
  });
  it('duplicate names do not crash and every occurrence is marked', () => {
    const segs = splitMentions('@Ali @Ali', [{ id: 'u_a', name: 'Ali' }, { id: 'u_b', name: 'Ali' }]);
    expect(segs.filter((s) => s.mention)).toHaveLength(2);
  });
  it('the longest name wins at a position', () => {
    const segs = splitMentions('@Ali Demir', [{ id: 'a', name: 'Ali' }, { id: 'b', name: 'Ali Demir' }]);
    expect(segs).toEqual([{ text: '@Ali Demir', mention: true }]);
  });
});

describe('mentionQueryAt', () => {
  it('finds an @query right before the caret', () => {
    expect(mentionQueryAt('hi @ay', 6)).toEqual({ start: 3, query: 'ay' });
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' });
  });
  it('ignores emails and finished words', () => {
    expect(mentionQueryAt('me@x', 4)).toBeNull();
    expect(mentionQueryAt('@ay done', 8)).toBeNull();
  });
});
