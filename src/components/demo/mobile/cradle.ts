/**
 * The tab pill's outline with a scoop cut out for the orbit button.
 *
 * A straight port of apps/mobile/src/orbit/cradle.ts so the marketing replica
 * draws the exact same shape the app does: the bar's right edge curves away
 * from the button along an arc struck from the button's own centre, leaving
 * a channel of constant width between the two. Keep the two in step.
 */

/** Matches the old flat bar's icon row; the button is taller and overhangs it. */
export const BAR_HEIGHT = 48;
/** The constant width of the channel between the bar and the button. */
export const CHANNEL = 6;

export interface Cradle {
  /** An SVG path for the bar, in the box's own coordinates. */
  path: string;
  /** Padding the tab row needs on its right so no icon lands under the scoop. */
  tabRight: number;
  /** False when the scoop could not be struck and the bar is a plain capsule. */
  scooped: boolean;
}

export function cradle(o: {
  width: number;
  /** The box's height, which is the button's diameter - it overhangs the bar. */
  height: number;
  /** The button's centre, in the box's coordinates. */
  discCx: number;
  discR: number;
  barHeight?: number;
  channel?: number;
}): Cradle {
  const barH = Math.min(o.barHeight ?? BAR_HEIGHT, o.height);
  const channel = o.channel ?? CHANNEL;
  const top = (o.height - barH) / 2;
  const bot = top + barH;
  const r = barH / 2;

  if (!(o.width > 0) || !(barH > 0)) return { path: '', tabRight: 0, scooped: false };

  const ring = o.discR + channel;
  const reach = ring * ring - r * r;
  const xEdge = reach > 0 ? o.discCx - Math.sqrt(reach) : Number.NaN;

  const scooped = Number.isFinite(xEdge) && xEdge > r + 2;

  if (!scooped) {
    return { path: capsule(o.width, top, bot, r), tabRight: 0, scooped: false };
  }

  const x = round(xEdge);
  const path =
    `M ${round(r)},${round(top)} ` +
    `L ${x},${round(top)} ` +
    `A ${round(ring)},${round(ring)} 0 0,0 ${x},${round(bot)} ` +
    `L ${round(r)},${round(bot)} ` +
    `A ${round(r)},${round(r)} 0 0,1 ${round(r)},${round(top)} Z`;

  return { path, tabRight: tabRight(o.width, o.discCx, ring), scooped: true };
}

/** The deepest point of the bite, which is as far right as an icon may sit. */
function tabRight(width: number, discCx: number, ring: number): number {
  return Math.max(0, round(width - (discCx - ring)));
}

function capsule(width: number, top: number, bot: number, r: number): string {
  const right = Math.max(r, width - r);
  return (
    `M ${round(r)},${round(top)} ` +
    `L ${round(right)},${round(top)} ` +
    `A ${round(r)},${round(r)} 0 0,1 ${round(right)},${round(bot)} ` +
    `L ${round(r)},${round(bot)} ` +
    `A ${round(r)},${round(r)} 0 0,1 ${round(r)},${round(top)} Z`
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
