import { describe, it, expect, beforeEach } from 'vitest';
import {
  EMPTY_STATE, addBookmark, hasBookmarkAt, loadReadingState, removeBookmark,
  saveReadingState, updateReadingState, type ReadingState,
} from './readingState';

/**
 * The reading-state rules, finally under a unit runner.
 *
 * The same logic ships in apps/mobile and apps/desktop, and neither can test it
 * this directly - mobile's copy is async file IO and desktop has no unit runner
 * at all. Web does, so the shared rules get pinned here.
 */
const state = (over: Partial<ReadingState> = {}): ReadingState => ({ ...EMPTY_STATE, ...over });

beforeEach(() => localStorage.clear());

describe('loadReadingState', () => {
  it('returns the empty state for a book never opened', () => {
    expect(loadReadingState('f1')).toEqual(EMPTY_STATE);
  });

  it('round-trips what was saved', () => {
    saveReadingState('f1', state({ location: 'epubcfi(/6/4)', percent: 0.25 }));
    const back = loadReadingState('f1');
    expect(back.location).toBe('epubcfi(/6/4)');
    expect(back.percent).toBe(0.25);
  });

  it('keeps books apart', () => {
    saveReadingState('f1', state({ location: 'a' }));
    saveReadingState('f2', state({ location: 'b' }));
    expect(loadReadingState('f1').location).toBe('a');
    expect(loadReadingState('f2').location).toBe('b');
  });

  it('treats an unrecognised shape as absent rather than repairing it', () => {
    // A half-understood state would put the reader at a position it cannot
    // trust, which is worse than starting at page one.
    localStorage.setItem('dosya.reader.f1', JSON.stringify({ version: 99, nonsense: true }));
    expect(loadReadingState('f1')).toEqual(EMPTY_STATE);
  });

  it('survives corrupt JSON', () => {
    localStorage.setItem('dosya.reader.f1', '{not json');
    expect(loadReadingState('f1')).toEqual(EMPTY_STATE);
  });
});

describe('bookmarks', () => {
  it('adds one and finds it by location', () => {
    const next = addBookmark(EMPTY_STATE, 'epubcfi(/6/4)', 'Chapter One');
    expect(next.bookmarks).toHaveLength(1);
    expect(hasBookmarkAt(next, 'epubcfi(/6/4)')?.label).toBe('Chapter One');
  });

  it('does not mutate the state it was given', () => {
    const before = EMPTY_STATE;
    addBookmark(before, 'loc', 'label');
    expect(before.bookmarks).toHaveLength(0);
  });

  it('gives every bookmark its own id', () => {
    let s = addBookmark(EMPTY_STATE, 'a', 'A');
    s = addBookmark(s, 'b', 'B');
    expect(new Set(s.bookmarks.map((b) => b.id)).size).toBe(2);
  });

  it('removes only the one asked for', () => {
    let s = addBookmark(EMPTY_STATE, 'a', 'A');
    s = addBookmark(s, 'b', 'B');
    const target = s.bookmarks[0].id;
    const after = removeBookmark(s, target);
    expect(after.bookmarks).toHaveLength(1);
    expect(after.bookmarks[0].label).toBe('B');
  });

  it('finds nothing at a location with no bookmark', () => {
    const s = addBookmark(EMPTY_STATE, 'a', 'A');
    expect(hasBookmarkAt(s, 'somewhere-else')).toBeUndefined();
  });
});

describe('updateReadingState', () => {
  it('reads, mutates and writes in one step', () => {
    updateReadingState('f1', (prev) => addBookmark(prev, 'a', 'A'));
    expect(loadReadingState('f1').bookmarks).toHaveLength(1);
  });

  it('does not clobber a bookmark with a later position write', () => {
    // This is the ordering the reader actually produces: a bookmark added
    // between page turns, then the debounced position flush landing after it.
    updateReadingState('f1', (prev) => addBookmark(prev, 'a', 'A'));
    updateReadingState('f1', (prev) => ({ ...prev, location: 'later', percent: 0.9 }));

    const final = loadReadingState('f1');
    expect(final.bookmarks).toHaveLength(1);
    expect(final.location).toBe('later');
  });

  it('does not lose a position to a later bookmark write', () => {
    updateReadingState('f1', (prev) => ({ ...prev, location: 'here', percent: 0.5 }));
    updateReadingState('f1', (prev) => addBookmark(prev, 'here', 'Here'));

    const final = loadReadingState('f1');
    expect(final.location).toBe('here');
    expect(final.bookmarks).toHaveLength(1);
  });
});
