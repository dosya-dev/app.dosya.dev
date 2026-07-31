import { create } from 'zustand';
import { ApiError } from '@/api/client';
import {
  type CloudJob, cancelJob, createImport, listJobs, processJob, type SelectionEntry,
} from '@/api/cloud-import';

export const ACTIVE_CLOUD_STATUSES = new Set(['discovering', 'running']);

/** Percent complete, or null when the total is not yet meaningful. */
export function jobProgress(
  job: Pick<CloudJob, 'status' | 'total_bytes' | 'completed_bytes'>,
): number | null {
  if (job.status === 'discovering') return null;
  if (!job.total_bytes) return null;
  return Math.min(100, Math.floor((job.completed_bytes / job.total_bytes) * 100));
}

interface CloudImportState {
  jobs: CloudJob[];
  /**
   * job ids with an in-flight drive() loop. Lives in store state (not a
   * module-level variable) so it resets per-store-instance the same way
   * `jobs` does - a module-level Set would leak between tests that reuse the
   * same imported module (see cloud-imports.test.ts's own beforeEach reset).
   */
  driving: Set<string>;
  refresh: () => Promise<void>;
  start: (args: {
    accountId: string;
    workspaceId: string;
    destFolderId: string | null;
    selection: SelectionEntry[];
  }) => Promise<string>;
  cancel: (id: string) => Promise<void>;
}

export const useCloudImports = create<CloudImportState>((set, get) => ({
  jobs: [],
  driving: new Set(),

  async refresh() {
    try {
      const jobs = await listJobs();
      set({ jobs });
      // IMPORTANT 3 (2026-07-30 review): drive() previously only ever
      // started from start(), so a page reload left an already-`running`/
      // `discovering` job's card rendering a live-looking bar that never
      // advanced - the job was never wrong on the server, nothing was ever
      // driving it client-side again. Every refresh() (mount, poll, after
      // cancel) now resumes driving any active job it learns about;
      // ensureDriving's guard makes this a no-op for a job that already has
      // a loop running, so this is safe to call unconditionally here.
      for (const job of jobs) {
        if (ACTIVE_CLOUD_STATUSES.has(job.status)) ensureDriving(job.id, get, set);
      }
    } catch {
      // Network hiccup: keep the last known list rather than blanking the UI.
    }
  },

  async start(args) {
    const { job_id } = await createImport(args);
    await get().refresh();
    // Belt-and-suspenders: refresh() above already starts driving this job
    // if it came back in the active list, but that read is a separate round
    // trip that could in principle miss it (a stale read, a 5xx swallowed by
    // refresh()'s own catch). ensureDriving's guard makes this a no-op in
    // the ordinary case where refresh() already covered it.
    ensureDriving(job_id, get, set);
    return job_id;
  },

  async cancel(id) {
    await cancelJob(id);
    await get().refresh();
  },
}));

type GetState = () => CloudImportState;
type SetState = (partial: (state: CloudImportState) => Partial<CloudImportState>) => void;

/** Starts drive(jobId) unless a loop for it is already running. */
function ensureDriving(jobId: string, get: GetState, set: SetState): void {
  if (get().driving.has(jobId)) return;
  set((s) => ({ driving: new Set(s.driving).add(jobId) }));
  void drive(jobId, get).finally(() => {
    set((s) => {
      if (!s.driving.has(jobId)) return {};
      const next = new Set(s.driving);
      next.delete(jobId);
      return { driving: next };
    });
  });
}

/**
 * A1 keeps the transfer client-driven, so this loop must run for the import to
 * advance. A2 moves the work to a Durable Object and this becomes a plain
 * status poll. Sequential by design: parallel calls would race on the same row.
 */
async function drive(jobId: string, get: () => CloudImportState): Promise<void> {
  for (;;) {
    let status: string;

    try {
      ({ status } = await processJob(jobId));
    } catch (err) {
      // CRITICAL: the process route answers provider throttling with a real
      // HTTP 429, which api() surfaces as a thrown ApiError. Treating every
      // thrown error as fatal would abandon the job the first time Google
      // rate-limits a bulk import - the loop would stop and the import would
      // sit half-finished with no error shown. So a 429 is a WAIT, not a stop.
      const wait = retryAfterFromError(err);
      if (wait === null) {
        await get().refresh();
        return;
      }
      await get().refresh();
      await sleep(wait);
      continue;
    }

    await get().refresh();
    if (!ACTIVE_CLOUD_STATUSES.has(status)) return;
    // Deliberately unpaced: every successful processJob call already performs
    // bounded real work server-side (one transfer chunk, or one bounded
    // discovery slice - see LIST_CALLS_PER_SLICE in process.ts), so an
    // artificial client-side delay here would only slow the import down for
    // no benefit. Provider throttling is already handled by the 429 path
    // above; no 200 response from this route carries a pacing hint to honor.
  }
}

const sleep = (seconds: number) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** Seconds to wait if this error is a 429, else null when it is genuinely fatal. */
export function retryAfterFromError(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null;
  try {
    const body = JSON.parse(err.body) as { retryAfterSeconds?: number };
    return typeof body.retryAfterSeconds === 'number' && body.retryAfterSeconds > 0
      ? body.retryAfterSeconds
      : 30;
  } catch {
    return 30;
  }
}
