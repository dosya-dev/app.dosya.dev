import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '@/api/client';
import type { CloudJob } from '@/api/cloud-import';

const listJobsMock = vi.fn();
const processJobMock = vi.fn();
const createImportMock = vi.fn();
const cancelJobMock = vi.fn();

vi.mock('@/api/cloud-import', () => ({
  listJobs: (...args: unknown[]) => listJobsMock(...args),
  processJob: (...args: unknown[]) => processJobMock(...args),
  createImport: (...args: unknown[]) => createImportMock(...args),
  cancelJob: (...args: unknown[]) => cancelJobMock(...args),
}));

const { useCloudImports, ACTIVE_CLOUD_STATUSES, jobProgress, retryAfterFromError } =
  await import('./cloud-imports');

function job(over: Partial<CloudJob> = {}): CloudJob {
  return {
    id: 'job1',
    provider: 'google_drive',
    workspace_id: 'ws1',
    status: 'running',
    total_files: 10,
    total_bytes: 1000,
    total_folders: 0,
    completed_files: 0,
    completed_bytes: 0,
    failed_files: 0,
    skipped_files: 0,
    error_message: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

/** Drains the microtask queue without relying on real or fake timers. */
async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

beforeEach(() => {
  listJobsMock.mockReset();
  processJobMock.mockReset();
  createImportMock.mockReset();
  cancelJobMock.mockReset();
  useCloudImports.setState({ jobs: [] });
});

describe('ACTIVE_CLOUD_STATUSES', () => {
  it('treats discovering and running as active', () => {
    expect(ACTIVE_CLOUD_STATUSES.has('discovering')).toBe(true);
    expect(ACTIVE_CLOUD_STATUSES.has('running')).toBe(true);
  });

  it('treats terminal statuses as inactive', () => {
    for (const status of ['complete', 'failed', 'cancelled']) {
      expect(ACTIVE_CLOUD_STATUSES.has(status)).toBe(false);
    }
  });
});

describe('jobProgress', () => {
  it('returns null while discovering, since the total is not known yet', () => {
    expect(jobProgress({ status: 'discovering', total_bytes: 0, completed_bytes: 0 })).toBeNull();
  });

  it('returns a percentage once running', () => {
    expect(jobProgress({ status: 'running', total_bytes: 200, completed_bytes: 50 })).toBe(25);
  });

  it('never exceeds 100', () => {
    expect(jobProgress({ status: 'running', total_bytes: 100, completed_bytes: 500 })).toBe(100);
  });

  it('returns null for a zero-byte total rather than dividing by zero', () => {
    expect(jobProgress({ status: 'running', total_bytes: 0, completed_bytes: 0 })).toBeNull();
  });
});

describe('retryAfterFromError', () => {
  it('returns the retryAfterSeconds carried by a 429 body', () => {
    const err = new ApiError(429, JSON.stringify({ code: 'RATE_LIMITED', retryAfterSeconds: 12 }));
    expect(retryAfterFromError(err)).toBe(12);
  });

  it('falls back to a sensible default for a 429 with a malformed (non-JSON) body', () => {
    const err = new ApiError(429, 'not json at all');
    expect(retryAfterFromError(err)).toBe(30);
  });

  it('falls back to a sensible default for a 429 with a missing retryAfterSeconds field', () => {
    const err = new ApiError(429, JSON.stringify({ code: 'RATE_LIMITED' }));
    expect(retryAfterFromError(err)).toBe(30);
  });

  it('falls back to a sensible default for a 429 with a non-positive retryAfterSeconds', () => {
    const err = new ApiError(429, JSON.stringify({ retryAfterSeconds: 0 }));
    expect(retryAfterFromError(err)).toBe(30);
  });

  it('returns null (fatal) for a non-429 ApiError', () => {
    const err = new ApiError(500, JSON.stringify({ error: 'boom' }));
    expect(retryAfterFromError(err)).toBeNull();
  });

  it('returns null (fatal) for a non-ApiError throw', () => {
    expect(retryAfterFromError(new Error('network down'))).toBeNull();
    expect(retryAfterFromError('a raw string throw')).toBeNull();
    expect(retryAfterFromError(undefined)).toBeNull();
  });
});

describe('the drive loop (via useCloudImports.start)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('THE 429 PATH: continues polling after a 429 (waits, then retries) instead of abandoning the job', async () => {
    createImportMock.mockResolvedValue({ job_id: 'job1', status: 'discovering' });
    listJobsMock.mockResolvedValue([job({ status: 'running' })]);
    const rateLimited = new ApiError(
      429,
      JSON.stringify({ code: 'RATE_LIMITED', retryAfterSeconds: 5 }),
    );
    processJobMock
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce({ status: 'complete' });

    await useCloudImports.getState().start({
      accountId: 'a1', workspaceId: 'ws1', destFolderId: null, selection: [],
    });
    await vi.advanceTimersByTimeAsync(0);

    // First attempt fires and hits the 429.
    expect(processJobMock).toHaveBeenCalledTimes(1);

    // If the bug regressed (catch collapsed into a bare `return`), the loop would have
    // already stopped here and no amount of waiting would produce a second call.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(processJobMock).toHaveBeenCalledTimes(1); // not yet - still waiting out the 429

    await vi.advanceTimersByTimeAsync(1);
    expect(processJobMock).toHaveBeenCalledTimes(2); // the wait elapsed: the loop retried

    // The retry succeeded and the job is terminal, so the loop should now be done.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(processJobMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling on a non-429 error, without retrying', async () => {
    createImportMock.mockResolvedValue({ job_id: 'job1', status: 'discovering' });
    listJobsMock.mockResolvedValue([job({ status: 'running' })]);
    const serverError = new ApiError(500, JSON.stringify({ error: 'boom' }));
    processJobMock.mockRejectedValue(serverError);

    await useCloudImports.getState().start({
      accountId: 'a1', workspaceId: 'ws1', destFolderId: null, selection: [],
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(processJobMock).toHaveBeenCalledTimes(1);

    // Plenty of time passes; a genuinely fatal error must never be retried.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(processJobMock).toHaveBeenCalledTimes(1);
  });

  it('terminates on each terminal status and does not spin forever', async () => {
    for (const status of ['complete', 'failed', 'cancelled'] as const) {
      processJobMock.mockReset();
      listJobsMock.mockReset();
      createImportMock.mockReset();
      createImportMock.mockResolvedValue({ job_id: 'job1', status: 'discovering' });
      listJobsMock.mockResolvedValue([job({ status })]);
      processJobMock.mockResolvedValue({ status });

      await useCloudImports.getState().start({
        accountId: 'a1', workspaceId: 'ws1', destFolderId: null, selection: [],
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(processJobMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(120_000);
      expect(processJobMock).toHaveBeenCalledTimes(1); // loop exited - no further polling
    }
  });

  it('keeps polling while the job stays active across several process calls', async () => {
    createImportMock.mockResolvedValue({ job_id: 'job1', status: 'discovering' });
    listJobsMock.mockResolvedValue([job({ status: 'running' })]);
    processJobMock
      .mockResolvedValueOnce({ status: 'discovering' })
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'complete' });

    await useCloudImports.getState().start({
      accountId: 'a1', workspaceId: 'ws1', destFolderId: null, selection: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(processJobMock).toHaveBeenCalledTimes(3);
  });
});

describe('useCloudImports.refresh / cancel', () => {
  it('refresh populates jobs from listJobs', async () => {
    listJobsMock.mockResolvedValue([job({ id: 'j1' }), job({ id: 'j2' })]);
    await useCloudImports.getState().refresh();
    expect(useCloudImports.getState().jobs.map((j) => j.id)).toEqual(['j1', 'j2']);
  });

  it('refresh keeps the last known jobs on a network failure rather than blanking the UI', async () => {
    listJobsMock.mockResolvedValueOnce([job({ id: 'j1' })]);
    await useCloudImports.getState().refresh();
    listJobsMock.mockRejectedValueOnce(new Error('offline'));
    await useCloudImports.getState().refresh();
    expect(useCloudImports.getState().jobs.map((j) => j.id)).toEqual(['j1']);
  });

  it('cancel calls cancelJob then refreshes', async () => {
    cancelJobMock.mockResolvedValue({ ok: true });
    listJobsMock.mockResolvedValue([job({ id: 'j1', status: 'cancelled' })]);
    await useCloudImports.getState().cancel('j1');
    expect(cancelJobMock).toHaveBeenCalledWith('j1');
    expect(useCloudImports.getState().jobs.map((j) => j.id)).toEqual(['j1']);
  });
});
