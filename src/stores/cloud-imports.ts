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

  async refresh() {
    try {
      set({ jobs: await listJobs() });
    } catch {
      // Network hiccup: keep the last known list rather than blanking the UI.
    }
  },

  async start(args) {
    const { job_id } = await createImport(args);
    await get().refresh();
    void drive(job_id, get);
    return job_id;
  },

  async cancel(id) {
    await cancelJob(id);
    await get().refresh();
  },
}));

/**
 * A1 keeps the transfer client-driven, so this loop must run for the import to
 * advance. A2 moves the work to a Durable Object and this becomes a plain
 * status poll. Sequential by design: parallel calls would race on the same row.
 */
async function drive(jobId: string, get: () => CloudImportState): Promise<void> {
  for (;;) {
    let status: string;
    let retryAfter: number | undefined;

    try {
      ({ status, retry_after_seconds: retryAfter } = await processJob(jobId));
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
    if (retryAfter) await sleep(retryAfter);
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
