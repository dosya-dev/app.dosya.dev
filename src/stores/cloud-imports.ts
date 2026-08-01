import { create } from 'zustand';
import { ApiError } from '@/api/client';
import {
  type CloudJob, cancelJob, createImport, listJobs, type SelectionEntry,
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

  // A2 moves job execution into a server-side Durable Object, which owns
  // driving the job to completion. This is now a plain status read - it must
  // never kick off any client-side work loop. The DO's single-threading only
  // protects against two DOs racing each other, not against a browser tab
  // also poking the same job, so resuming a drive loop here (as a pre-A2
  // version of this store did) would race the DO on the same items.
  async refresh() {
    try {
      const jobs = await listJobs();
      set({ jobs });
    } catch {
      // Network hiccup: keep the last known list rather than blanking the UI.
    }
  },

  async start(args) {
    const { job_id } = await createImport(args);
    await get().refresh();
    return job_id;
  },

  async cancel(id) {
    await cancelJob(id);
    await get().refresh();
  },
}));

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
