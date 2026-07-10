import { describe, it, expect } from 'vitest';
import { collectMatchRanges } from './find-matches';

function el(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

describe('collectMatchRanges', () => {
  it('returns no ranges for an empty query', () => {
    expect(collectMatchRanges(el('hello'), '')).toEqual([]);
  });

  it('finds all case-insensitive matches in a single text node', () => {
    const ranges = collectMatchRanges(el('Hello hello HELLO'), 'hello');
    expect(ranges.length).toBe(3);
    expect(ranges[0].toString().toLowerCase()).toBe('hello');
  });

  it('finds matches that live in separate sibling text nodes', () => {
    const ranges = collectMatchRanges(el('foo <span>bar</span> foo'), 'foo');
    expect(ranges.length).toBe(2);
  });

  it('finds a match spanning across element boundaries', () => {
    const ranges = collectMatchRanges(el('ab<span>cd</span>ef'), 'bcde');
    expect(ranges.length).toBe(1);
    expect(ranges[0].toString()).toBe('bcde');
  });
});
