import { SWATCHES } from '@/lib/palette';

/**
 * Per-person colours come from the brand's identity swatches (the set used for
 * workspace and avatar colours), assigned by rank and never cycled: a family
 * holds at most six people and the set has seven. Light and dark fills are
 * both from the palette; which one applies follows the document theme.
 */
export function personColor(index: number, dark: boolean): string {
  const sw = SWATCHES[index % SWATCHES.length];
  return dark ? sw.dark : sw.light;
}

/** The label colour that meets AA on personColor (avatar initials). */
export function personInk(index: number, dark: boolean): string {
  const sw = SWATCHES[index % SWATCHES.length];
  return dark ? sw.darkInk : sw.lightInk;
}

/** A person's colour, faded: reserved space they have not used yet. */
export function tint(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

export function isDarkTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/** One stretch of the pool: someone's used storage, or their reserved space they have not used yet. */
export type PoolSegment = { key: string; bytes: number; color: string };
