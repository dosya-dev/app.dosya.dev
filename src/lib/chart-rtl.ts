/**
 * Chart axes follow the reading direction: in a right-to-left language time
 * runs from the right edge, so the x axis is reversed, the value axis moves to
 * the right edge, and the margins swap so the axis labels keep their room.
 * Recharts has no direction option of its own, so every chart spreads these.
 */
export function chartDirection(dir: 'ltr' | 'rtl') {
  const rtl = dir === 'rtl';
  return {
    xAxis: { reversed: rtl },
    yAxis: { orientation: rtl ? 'right' : 'left' } as { orientation: 'left' | 'right' },
    // rtl-ok: physical geometry, recharts margins are physical box sides; this is where they swap
    margin: rtl ? { top: 8, right: 0, left: 8, bottom: 0 } : { top: 8, right: 8, left: 0, bottom: 0 },
  };
}

/**
 * A donut starts at twelve o'clock and runs with the reading direction:
 * clockwise in a left-to-right language, counter-clockwise in a right-to-left
 * one, so the first (largest) slice starts on the side the legend reads from.
 * `sweep` signs the x offset of every point on the ring and `arcFlag` is the
 * SVG arc sweep flag that draws each arc the same way round. A tooltip placed
 * with `insetInlineStart` at the unsigned offset then lands on its slice in
 * both directions.
 */
export function donutDirection(dir: 'ltr' | 'rtl'): { sweep: 1 | -1; arcFlag: 0 | 1 } {
  const rtl = dir === 'rtl';
  return { sweep: rtl ? -1 : 1, arcFlag: rtl ? 0 : 1 };
}
