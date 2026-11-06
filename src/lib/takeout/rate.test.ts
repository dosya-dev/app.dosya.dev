import { describe, expect, it } from 'vitest';
import { formatDuration, RateMeter, secondsLeft } from './rate';

describe('RateMeter', () => {
  it('says nothing until five seconds of samples', () => {
    const m = new RateMeter();
    m.add(0, 0);
    m.add(3_000, 3_000_000);
    expect(m.bps()).toBeNull();
    m.add(10_000, 10_000_000);
    expect(m.bps()).toBe(1_000_000);
  });

  it('measures over the last minute only', () => {
    const m = new RateMeter();
    m.add(0, 0);
    m.add(10_000, 100_000_000); // a fast start...
    for (let t = 20_000; t <= 200_000; t += 10_000) m.add(t, 100_000_000 + (t - 10_000) * 100); // ...then 100 KB/s
    expect(m.bps()).toBeCloseTo(100_000, -2);
  });

  it('starts from the first sample, so resumed bytes are not speed', () => {
    const m = new RateMeter();
    m.add(0, 4_000_000_000);
    m.add(10_000, 4_010_000_000);
    expect(m.bps()).toBe(1_000_000);
  });
});

describe('time left', () => {
  it('needs a speed', () => {
    expect(secondsLeft(1_000, null)).toBeNull();
    expect(secondsLeft(60_000_000, 1_000_000)).toBe(60);
  });

  it('reads in seconds, minutes, then hours and minutes', () => {
    expect(formatDuration(42)).toMatch(/40\s?sec/);
    expect(formatDuration(25 * 60)).toMatch(/25\s?min/);
    expect(formatDuration(2 * 3600 + 15 * 60)).toMatch(/2\s?hr.*15\s?min/);
    expect(formatDuration(3 * 3600)).toMatch(/^3\s?hr$/);
  });
});
