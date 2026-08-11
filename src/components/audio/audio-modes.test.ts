import { describe, it, expect } from 'vitest';
import { nextLoopState, SPEEDS, nextSpeed } from './audio-modes';

describe('nextLoopState', () => {
  it('arms point A on the first press', () => {
    expect(nextLoopState({ stage: 0, a: null, loop: null }, 96)).toEqual({ stage: 1, a: 96, loop: null });
  });

  it('closes the loop on the second press', () => {
    expect(nextLoopState({ stage: 1, a: 96, loop: null }, 132)).toEqual({
      stage: 2, a: 96, loop: { a: 96, b: 132 },
    });
  });

  it('clears on the third press', () => {
    expect(nextLoopState({ stage: 2, a: 96, loop: { a: 96, b: 132 } }, 200)).toEqual({
      stage: 0, a: null, loop: null,
    });
  });

  it('keeps B at least two seconds after A so the loop cannot thrash', () => {
    expect(nextLoopState({ stage: 1, a: 96, loop: null }, 96.5).loop).toEqual({ a: 96, b: 98 });
  });

  it('handles a second press that lands before A by looping forward from A', () => {
    expect(nextLoopState({ stage: 1, a: 96, loop: null }, 20).loop).toEqual({ a: 96, b: 98 });
  });
});

describe('nextSpeed', () => {
  it('steps up and down through the offered rates', () => {
    expect(nextSpeed(1, 1)).toBe(1.25);
    expect(nextSpeed(1, -1)).toBe(0.75);
  });

  it('stops at the ends rather than wrapping from 2x back to 0.5x', () => {
    expect(nextSpeed(2, 1)).toBe(2);
    expect(nextSpeed(0.5, -1)).toBe(0.5);
  });

  it('snaps an unknown rate onto the scale', () => {
    expect(SPEEDS).toContain(nextSpeed(1.1, 1));
  });
});
