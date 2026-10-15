/**
 * Which ink is readable on a workspace's brand colour, for the in-app replica
 * of the public share page (settings/branding-share-preview.tsx).
 *
 * The SAME rule as the share page's brandInkFor (src/lib/share/brand.ts at the
 * repo root, which this app cannot import at runtime): of two inks, whichever
 * has the higher WCAG contrast ratio against the colour, with the share page's
 * own two ink luminances. brand-ink.test.ts imports the root module and checks
 * the two agree, so they cannot drift apart silently.
 *
 * The luminances stay numbers because a hex literal here would trip the colour
 * ratchet. The inks themselves are the app's nearest tokens, read inside the
 * replica's dark scope: --brand-foreground for the dark ink and --foreground
 * for the light one.
 */

export const INK_DARK_LUMINANCE = 0.007056241959434463; // share.css --sh-ink-dark
export const INK_LIGHT_LUMINANCE = 0.8796088594224528; // share.css --sh-ink

const HEX = /^#([0-9a-fA-F]{6})$/;

/** WCAG relative luminance of a #rrggbb colour, or null when malformed. */
export function relativeLuminance(hex: string): number | null {
  const m = HEX.exec(hex);
  if (!m) return null;
  const channel = (i: number) => {
    const v = parseInt(m[1].slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** 'dark' or 'light': the higher-contrast ink. A malformed colour gets the light ink, as on the share page. */
export function brandInk(hex: string): 'dark' | 'light' {
  const l = relativeLuminance(hex);
  if (l === null) return 'light';
  return contrast(l, INK_DARK_LUMINANCE) >= contrast(l, INK_LIGHT_LUMINANCE) ? 'dark' : 'light';
}

/** The ink as a CSS value, for a style prop. Token references only. */
export function brandInkVar(hex: string): string {
  return brandInk(hex) === 'dark' ? 'var(--brand-foreground)' : 'var(--foreground)';
}
