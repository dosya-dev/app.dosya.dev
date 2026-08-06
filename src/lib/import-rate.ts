import type { CloudJob } from '@/api/cloud-import';
import { useCloudImports } from '@/stores/cloud-imports';

/**
 * Transfer-rate tracking for cloud imports. The store polls jobs every 5s;
 * this module keeps a short window of (time, completed_bytes) samples per
 * RUNNING job and derives speed and ETA from the window. One module-level
 * subscriber samples for the whole app (query-client.ts's subscriber
 * pattern) no matter how many progress cards are mounted.
 */

export interface RateSample { t: number; bytes: number }

/** ~35s of history at the 5s poll cadence. */
const MAX_SAMPLES = 8;
/** A rate over a narrower window than this is noise, not signal. */
const MIN_WINDOW_MS = 3_000;
/** Below this the transfer reads as stalled - show no ETA. */
const MIN_RATE_BYTES_PER_SEC = 1;
/** Store updates closer together than this are the same poll's data. */
const DEDUPE_MS = 1_000;

const samplesByJob = new Map<string, RateSample[]>();

/**
 * Bytes/sec across the sample window. Null until two samples span at least
 * MIN_WINDOW_MS; 0 when the byte count did not grow (stall, or a
 * server-side counter reset) - callers must not turn 0 into an ETA.
 */
export function computeRate(samples: RateSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const spanMs = last.t - first.t;
  if (spanMs < MIN_WINDOW_MS) return null;
  const delta = last.bytes - first.bytes;
  if (delta <= 0) return 0;
  return delta / (spanMs / 1000);
}

/** Whole seconds remaining, or null when no honest estimate exists. */
export function etaSeconds(
  rate: number | null,
  totalBytes: number,
  completedBytes: number,
): number | null {
  if (rate === null || rate < MIN_RATE_BYTES_PER_SEC) return null;
  if (!totalBytes || completedBytes >= totalBytes) return null;
  return Math.ceil((totalBytes - completedBytes) / rate);
}

/** "45s" / "4m" / "1h" / "1h 20m" - always the "about" scale, never exact. */
export function humanDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Record one sample per running job, prune everything else. Exported (with
 * an injected clock) so the window semantics stay unit-testable; production
 * calls arrive via the store subscriber below.
 */
export function recordSamples(jobs: CloudJob[], now: number): void {
  const running = new Set<string>();
  for (const job of jobs) {
    if (job.status !== 'running') continue;
    running.add(job.id);
    const list = samplesByJob.get(job.id) ?? [];
    const last = list[list.length - 1];
    if (last && now - last.t < DEDUPE_MS) continue;
    list.push({ t: now, bytes: job.completed_bytes });
    if (list.length > MAX_SAMPLES) list.shift();
    samplesByJob.set(job.id, list);
  }
  // A job that finished, was cancelled, or vanished takes its window with
  // it - a later job re-using nothing keeps the map from growing.
  for (const id of [...samplesByJob.keys()]) {
    if (!running.has(id)) samplesByJob.delete(id);
  }
}

export function jobRate(job: CloudJob): { bytesPerSec: number | null; etaSeconds: number | null } {
  const rate = computeRate(samplesByJob.get(job.id) ?? []);
  return { bytesPerSec: rate, etaSeconds: etaSeconds(rate, job.total_bytes, job.completed_bytes) };
}

/** Test hook: each test starts with an empty window. */
export function resetImportRateSamples(): void {
  samplesByJob.clear();
}

useCloudImports.subscribe((state) => recordSamples(state.jobs, Date.now()));
