import { create } from 'zustand';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';

export interface RemoteDownloadJob {
  id: string;
  url: string;
  filename: string;
  status: 'queued' | 'downloading' | 'finalizing' | 'done' | 'error' | 'cancelled';
  bytes_total: number | null;
  bytes_done: number;
  error_code: string | null;
  file_id: string | null;
  created_at: number;
}

export const ACTIVE_REMOTE_STATUSES = new Set(['queued', 'downloading', 'finalizing']);

const POLL_MS = 5_000;
// Singleton interval: runs only while at least one job is active, so pages
// that never touch remote downloads cost zero requests.
let timer: ReturnType<typeof setInterval> | null = null;

interface RemoteDownloadsState {
  jobs: RemoteDownloadJob[];
  refresh: () => Promise<void>;
}

export const useRemoteDownloads = create<RemoteDownloadsState>((set, get) => ({
  jobs: [],
  refresh: async () => {
    const workspaceId = useWorkspace.getState().activeId;
    if (!workspaceId) return;
    try {
      const data = await api<{ ok: boolean; jobs: RemoteDownloadJob[] }>(
        `/api/remote-downloads?workspace_id=${workspaceId}`,
      );
      set({ jobs: data.jobs });
      const hasActive = data.jobs.some((j) => ACTIVE_REMOTE_STATUSES.has(j.status));
      if (hasActive && !timer) timer = setInterval(() => get().refresh(), POLL_MS);
      if (!hasActive && timer) {
        clearInterval(timer);
        timer = null;
      }
    } catch {
      // Transient failure: keep prior state; an active timer retries on its own.
    }
  },
}));
