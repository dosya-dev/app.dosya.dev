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

export const CLOUD_IMPORT_POLL_MS = 5_000;
// Singleton interval, not store state - matches stores/remote-downloads.ts's
// timer exactly (same POLL_MS, same "only run while something is active"
// shape). Module-scoped rather than tied to any one component's mount
// lifecycle, because `jobs` is read by more than one component
// (ImportProgressCard, use-cloud-import-refresh's completion hook) and none
// of them should own starting/stopping a shared poll.
let pollTimer: ReturnType<typeof setInterval> | null = null;

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
  // driving the job to completion - refresh() must never kick off any
  // client-side WORK loop (the DO's single-threading only protects against
  // two DOs racing each other, not against a browser tab also poking the
  // same job). It still has to keep the UI current, though: now that the old
  // drive() loop is gone, refresh() is the only thing that ever calls
  // listJobs() again after the first one, so it owns a small
  // self-starting/self-stopping poll timer (see pollTimer above) that runs
  // only while at least one job is in an active status and clears itself
  // the moment none are - an idle page (or one whose only job just
  // finished) costs zero further requests.
  async refresh() {
    try {
      const jobs = await listJobs();
      set({ jobs });
      const hasActive = jobs.some((j) => ACTIVE_CLOUD_STATUSES.has(j.status));
      if (hasActive && !pollTimer) {
        pollTimer = setInterval(() => { void get().refresh(); }, CLOUD_IMPORT_POLL_MS);
      }
      if (!hasActive && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
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
