import { create } from 'zustand';
import { cancelJob, isActive, listJobs, type RcloneJob } from '@/api/rclone-import';
import { rememberActiveJobs } from '@/lib/job-activity';

export const RCLONE_IMPORT_POLL_MS = 4_000;

/** Import jobs (not probes) that are queued or copying. */
export function activeImports(jobs: RcloneJob[]): RcloneJob[] {
  return jobs.filter((j) => j.kind === 'import' && isActive(j));
}

/** Percent complete, or null until rclone has counted the source. */
export function importProgress(job: Pick<RcloneJob, 'status' | 'bytes_total' | 'bytes_done'>): number | null {
  if (job.status !== 'running' || job.bytes_total <= 0) return null;
  return Math.min(100, Math.floor((job.bytes_done / job.bytes_total) * 100));
}

// One timer for every subscriber (the page's job table and the sidebar ring),
// same shape as stores/cloud-imports.ts: it runs only while an import is
// active and clears itself the moment none is.
let pollTimer: ReturnType<typeof setInterval> | null = null;
let polledWorkspace: string | null = null;

interface RcloneImportState {
  /** The workspace the list belongs to; a switch empties it before the first refresh. */
  workspaceId: string | null;
  /** null until the first list for this workspace has answered. */
  jobs: RcloneJob[] | null;
  refresh: (workspaceId: string) => Promise<void>;
  /** A job this client just created: show it before the next poll confirms it. */
  seed: (job: RcloneJob) => void;
  cancel: (id: string) => Promise<void>;
}

export const useRcloneImports = create<RcloneImportState>((set, get) => ({
  workspaceId: null,
  jobs: null,

  async refresh(workspaceId) {
    if (get().workspaceId !== workspaceId) set({ workspaceId, jobs: null });
    try {
      const jobs = await listJobs(workspaceId);
      if (get().workspaceId !== workspaceId) return;
      set({ jobs });
      const active = activeImports(jobs).length > 0;
      // The sidebar ring only lists jobs on mount when this says yes - see lib/job-activity.ts.
      rememberActiveJobs('rclone', active);
      if (active && (!pollTimer || polledWorkspace !== workspaceId)) {
        if (pollTimer) clearInterval(pollTimer);
        polledWorkspace = workspaceId;
        pollTimer = setInterval(() => { void get().refresh(workspaceId); }, RCLONE_IMPORT_POLL_MS);
      }
      if (!active && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        polledWorkspace = null;
      }
    } catch {
      // Network hiccup: keep the last known list rather than blanking the UI.
      if (get().jobs === null) set({ jobs: [] });
    }
  },

  seed(job) {
    const { jobs, workspaceId } = get();
    set({ workspaceId: workspaceId ?? job.workspace_id, jobs: [job, ...(jobs ?? []).filter((j) => j.id !== job.id)] });
    if (job.kind === 'import' && isActive(job)) {
      rememberActiveJobs('rclone', true);
      void get().refresh(job.workspace_id);
    }
  },

  async cancel(id) {
    await cancelJob(id);
    const ws = get().workspaceId;
    if (ws) await get().refresh(ws);
  },
}));
