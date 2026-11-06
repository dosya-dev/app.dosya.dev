import { t } from '@/lib/i18n';

export interface Loop { a: number; b: number }

export interface LoopState {
  stage: number;
  a: number | null;
  loop: Loop | null;
}

/** Minimum loop length. Anything shorter thrashes the audio element. */
const MIN_LOOP = 2;

export const LOOP_OFF: LoopState = { stage: 0, a: null, loop: null };

/**
 * A-B cycles: press once to drop A, again to close the loop at the playhead,
 * a third time to clear it.
 */
export function nextLoopState(current: LoopState, position: number): LoopState {
  if (current.stage === 0) return { stage: 1, a: position, loop: null };
  if (current.stage === 1) {
    const start = current.a ?? 0;
    // A second press behind A would make an inverted region, so the loop
    // always runs forward from A by at least MIN_LOOP.
    return { stage: 2, a: start, loop: { a: start, b: Math.max(start + MIN_LOOP, position) } };
  }
  return LOOP_OFF;
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Step one rate along the scale. Clamps at the ends - wrapping 2x to 0.5x is a nasty surprise mid-sentence. */
export function nextSpeed(current: number, dir: number): number {
  let idx = SPEEDS.indexOf(current as (typeof SPEEDS)[number]);
  if (idx === -1) {
    // An off-scale rate snaps to the nearest offered one before stepping.
    idx = SPEEDS.reduce(
      (best, s, i) => (Math.abs(s - current) < Math.abs(SPEEDS[best] - current) ? i : best),
      0,
    );
  }
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, idx + dir))];
}

// `label` is a getter that translates on read, so the table holds no English and
// follows the language the moment it changes.
export const SLEEP_OPTIONS: { readonly label: string; minutes: number | null }[] = [
  { get label() { return t('common.label.fiveMinutes'); }, minutes: 5 },
  { get label() { return t('common.label.tenMinutes'); }, minutes: 10 },
  { get label() { return t('common.label.fifteenMinutes'); }, minutes: 15 },
  { get label() { return t('common.label.thirtyMinutes'); }, minutes: 30 },
  { get label() { return t('common.label.oneHour'); }, minutes: 60 },
  { get label() { return t('common.label.off'); }, minutes: null },
];
