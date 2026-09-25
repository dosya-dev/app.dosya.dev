import { describe, it, expect } from 'vitest';
import { cradle, BAR_HEIGHT, CHANNEL } from './cradle';

// The replica's tab bar box: 402pt phone minus 10pt side padding, the 56pt
// orbit button centred 28pt in from the right edge.
const BOX = { width: 382, height: 56, discCx: 382 - 28, discR: 28 };

describe('cradle (port of the mobile app geometry)', () => {
  it('scoops the bar around the orbit button at the replica width', () => {
    const c = cradle(BOX);
    expect(c.scooped).toBe(true);
    // The scoop is an arc of radius button + channel, struck from the button's centre.
    expect(c.path).toContain(`A ${BOX.discR + CHANNEL},${BOX.discR + CHANNEL} 0 0,0`);
    // The bar is BAR_HEIGHT tall, centred in the button-height box.
    const top = (BOX.height - BAR_HEIGHT) / 2;
    expect(c.path.startsWith(`M ${BAR_HEIGHT / 2},${top} `)).toBe(true);
    // Icons stop short of the bite: the channel plus the button's full diameter.
    expect(c.tabRight).toBe(BOX.discR + CHANNEL + BOX.discR);
  });

  it('falls back to a plain capsule when the arc cannot be struck', () => {
    const c = cradle({ ...BOX, width: 40, discCx: 40 - 28 });
    expect(c.scooped).toBe(false);
    expect(c.tabRight).toBe(0);
    expect(c.path).toContain('0 0,1');
    expect(c.path).not.toContain('0 0,0');
  });

  it('draws nothing before layout gives it a width', () => {
    expect(cradle({ ...BOX, width: 0 })).toEqual({ path: '', tabRight: 0, scooped: false });
  });
});
