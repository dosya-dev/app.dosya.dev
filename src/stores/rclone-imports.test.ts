import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RcloneJob } from '@/api/rclone-import';

const listJobsMock = vi.fn();
const cancelJobMock = vi.fn();
vi.mock('@/api/rclone-import', async (orig) => ({
  ...(await orig<typeof import('@/api/rclone-import')>()),
  listJobs: (...a: unknown[]) => listJobsMock(...a),
  cancelJob: (...a: unknown[]) => cancelJobMock(...a),
}));

const { useRcloneImports, activeImports, importProgress, RCLONE_IMPORT_POLL_MS } = await import('./rclone-imports');
const { hadActiveJobs } = await import('@/lib/job-activity');

function job(over: Partial<RcloneJob> = {}): RcloneJob {
  return {
    id: 'rcj_1', workspace_id: 'ws_1', kind: 'import', backend: 'sftp', label: 'SFTP', source_path: '/data', source_host: 'files.example.com',
    dest_folder_id: null, status: 'running', cancel_requested: 0, bytes_total: 1000, bytes_done: 250,
    files_total: 4, files_done: 1, files_failed: 0, error_code: null, error_message: null, created_at: 0, finished_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useRcloneImports.setState({ workspaceId: null, jobs: null });
  listJobsMock.mockReset();
  cancelJobMock.mockReset();
});
afterEach(async () => {
  // Drain the poll so one test's timer never leaks into the next.
  listJobsMock.mockResolvedValue([]);
  const ws = useRcloneImports.getState().workspaceId;
  if (ws) await useRcloneImports.getState().refresh(ws);
  vi.useRealTimers();
});

describe('helpers', () => {
  it('activeImports keeps queued and running imports, never probes', () => {
    const jobs = [job(), job({ id: 'q', status: 'queued' }), job({ id: 'p', kind: 'probe' }), job({ id: 'd', status: 'complete' })];
    expect(activeImports(jobs).map((j) => j.id)).toEqual(['rcj_1', 'q']);
  });
  it('importProgress is null until rclone has counted the source', () => {
    expect(importProgress(job())).toBe(25);
    expect(importProgress(job({ bytes_total: 0 }))).toBeNull();
    expect(importProgress(job({ status: 'queued' }))).toBeNull();
  });
});

describe('refresh', () => {
  it('lists the workspace, remembers activity, and polls only while an import runs', async () => {
    listJobsMock.mockResolvedValue([job()]);
    await useRcloneImports.getState().refresh('ws_1');
    expect(listJobsMock).toHaveBeenCalledWith('ws_1');
    expect(useRcloneImports.getState().jobs).toHaveLength(1);
    expect(hadActiveJobs('rclone')).toBe(true);

    listJobsMock.mockResolvedValue([job({ status: 'complete' })]);
    await vi.advanceTimersByTimeAsync(RCLONE_IMPORT_POLL_MS + 10);
    expect(listJobsMock).toHaveBeenCalledTimes(2);
    expect(hadActiveJobs('rclone')).toBe(false);

    await vi.advanceTimersByTimeAsync(RCLONE_IMPORT_POLL_MS * 3);
    expect(listJobsMock).toHaveBeenCalledTimes(2);
  });

  it('a workspace switch empties the list until the new answer arrives', async () => {
    listJobsMock.mockResolvedValue([job()]);
    await useRcloneImports.getState().refresh('ws_1');
    let resolve!: (v: RcloneJob[]) => void;
    listJobsMock.mockReturnValue(new Promise<RcloneJob[]>((r) => { resolve = r; }));
    const p = useRcloneImports.getState().refresh('ws_2');
    expect(useRcloneImports.getState()).toMatchObject({ workspaceId: 'ws_2', jobs: null });
    resolve([]);
    await p;
    expect(useRcloneImports.getState().jobs).toEqual([]);
  });

  it('a failed list keeps the last known jobs', async () => {
    listJobsMock.mockResolvedValue([job()]);
    await useRcloneImports.getState().refresh('ws_1');
    listJobsMock.mockRejectedValue(new Error('offline'));
    await useRcloneImports.getState().refresh('ws_1');
    expect(useRcloneImports.getState().jobs).toHaveLength(1);
  });
});

describe('seed and cancel', () => {
  it('seed shows a just-started import at once and marks activity', async () => {
    listJobsMock.mockResolvedValue([job({ status: 'queued' })]);
    useRcloneImports.getState().seed(job({ status: 'queued' }));
    expect(useRcloneImports.getState().jobs?.[0].id).toBe('rcj_1');
    expect(hadActiveJobs('rclone')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(listJobsMock).toHaveBeenCalledWith('ws_1');
  });

  it('cancel calls the API then refreshes', async () => {
    listJobsMock.mockResolvedValue([job()]);
    await useRcloneImports.getState().refresh('ws_1');
    cancelJobMock.mockResolvedValue({ status: 'cancelled' });
    listJobsMock.mockResolvedValue([job({ status: 'cancelled' })]);
    await useRcloneImports.getState().cancel('rcj_1');
    expect(cancelJobMock).toHaveBeenCalledWith('rcj_1');
    expect(useRcloneImports.getState().jobs?.[0].status).toBe('cancelled');
  });
});
