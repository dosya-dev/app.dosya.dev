/**
 * Upload speed and time left for a Takeout import, from how many bytes had
 * finished at each progress update.
 *
 * Measured over the last minute so one large video finishing does not swing
 * the number, and only from this session's samples, so files a previous
 * session already uploaded never count as speed.
 */
import { formatNumberWith } from '@/lib/format-locale';

/** Samples older than this fall out of the speed. */
export const WINDOW_MS = 60_000;
/** No speed until the samples span at least this long. */
export const MIN_SPAN_MS = 5_000;

export class RateMeter {
  private samples: { t: number; bytes: number }[] = [];

  add(t: number, bytes: number) {
    this.samples.push({ t, bytes });
    // Keep one sample older than the window as the baseline for its start.
    while (this.samples.length > 2 && this.samples[1].t <= t - WINDOW_MS) this.samples.shift();
  }

  /** Bytes per second, or null until there is enough to say. */
  bps(): number | null {
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const span = last.t - first.t;
    if (span < MIN_SPAN_MS || last.bytes <= first.bytes) return null;
    return ((last.bytes - first.bytes) * 1000) / span;
  }
}

/** Seconds left at the given speed, or null when there is no speed yet. */
export function secondsLeft(remainingBytes: number, bps: number | null): number | null {
  if (!bps || bps <= 0) return null;
  return Math.max(0, remainingBytes / bps);
}

const unit = (n: number, u: 'second' | 'minute' | 'hour') =>
  formatNumberWith(n, { style: 'unit', unit: u, unitDisplay: 'short', maximumFractionDigits: 0 });

/** "40 sec", "25 min", "2 hr 15 min", in the app's language. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return unit(Math.max(1, Math.round(seconds / 10) * 10), 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return unit(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? unit(hours, 'hour') : `${unit(hours, 'hour')} ${unit(rest, 'minute')}`;
}
