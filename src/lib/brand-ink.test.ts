import { describe, it, expect } from 'vitest';
import { brandInk, brandInkVar, INK_DARK_LUMINANCE, INK_LIGHT_LUMINANCE } from './brand-ink';
// The share page's own rule, the one this module reproduces. Imported, not
// copied, so a change there fails here instead of drifting.
import * as share from '../../../../src/lib/share/brand';

const SAMPLES = ['#22c55e', '#F97316', '#0B2545', '#1E3A8A', '#B4472E', '#FFFFFF', '#000000', '#777777'];

describe('brandInk', () => {
  it('uses the same two ink luminances as the share page', () => {
    expect(INK_DARK_LUMINANCE).toBe(share.INK_DARK_LUMINANCE);
    expect(INK_LIGHT_LUMINANCE).toBe(share.INK_LIGHT_LUMINANCE);
  });

  it.each(SAMPLES)('agrees with the share page on %s', (hex) => {
    const expected = share.brandInkFor(hex) === 'var(--sh-ink-dark)' ? 'dark' : 'light';
    expect(brandInk(hex)).toBe(expected);
  });

  it('pins the four reference colours', () => {
    expect(brandInk('#22c55e')).toBe('dark');
    expect(brandInk('#F97316')).toBe('dark');
    expect(brandInk('#0B2545')).toBe('light');
    expect(brandInk('#1E3A8A')).toBe('light');
  });

  it('gives a malformed colour the light ink, like the share page', () => {
    expect(brandInk('red')).toBe('light');
    expect(share.brandInkFor('red')).toBe('var(--sh-ink)');
  });

  it('answers with token references, never a literal', () => {
    expect(brandInkVar('#22c55e')).toMatch(/^var\(--[a-z-]+\)$/);
    expect(brandInkVar('#0B2545')).toMatch(/^var\(--[a-z-]+\)$/);
    expect(brandInkVar('#22c55e')).not.toBe(brandInkVar('#0B2545'));
  });
});
