import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '@/api/client';
import type { CloudJob } from '@/api/cloud-import';

const listJobsMock = vi.fn();
const createImportMock = vi.fn();
const cancelJobMock = vi.fn();

vi.mock('@/api/cloud-import', () => ({
  listJobs: (...args: unknown[]) => listJobsMock(...args),
  createImport: (...args: unknown[]) => createImportMock(...args),
  cancelJob: (...args: unknown[]) => cancelJobMock(...args),
}));

const { useCloudImports, ACTIVE_CLOUD_STATUSES, CLOUD_IMPORT_POLL_MS, jobProgress, retryAfterFromError } =
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

beforeEach(() => {
  listJobsMock.mockReset();
  createImportMock.mockReset();
  cancelJobMock.mockReset();
  useCloudImports.setState({ jobs: [] });
});

afterEach(async () => {
  // refresh()'s poll timer is a module-level singleton (CLOUD_IMPORT_POLL_MS
  // in cloud-imports.ts), not store state, so it does NOT reset with the
  // useCloudImports.setState() above. job()'s default status is 'running'
  // (active), so most tests in this file that call refresh() or start()
  // leave an armed timer behind unless something later feeds it an inactive
  // list - left alone, that would fire a real 5-second setInterval calling
  // listJobsMock again well after this test's own assertions have already
  // run, and would starve every later test of ever arming a *new* timer
  // (the `!pollTimer` guard would see the stale one and never replace it).
  // Force it clear the same way the app does when an import finishes: feed
  // refresh() an empty list. Runs after the poll-timer describe block's own
  // afterEach below (Vitest runs nested afterEach hooks before file-level
  // ones), so by the time this fires any fake-timer switch has already
  // happened and this is a harmless no-op there - it is the real fix for
  // every other test in this file.
  listJobsMock.mockResolvedValue([]);
  await useCloudImports.getState().refresh();
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

describe('useCloudImports.start', () => {
  it('start() creates the job and refreshes', async () => {
    createImportMock.mockResolvedValue({ job_id: 'job1', status: 'discovering' });
    listJobsMock.mockResolvedValue([job({ status: 'discovering' })]);

    await useCloudImports.getState().start({
      accountId: 'a1', workspaceId: 'ws1', destFolderId: null, selection: [],
    });

    expect(createImportMock).toHaveBeenCalledOnce();
    expect(listJobsMock).toHaveBeenCalled();
  });

  it('refresh() never calls a process endpoint', async () => {
    // processJob no longer exists; this pins that it stays gone. Deliberately
    // vi.importActual, not a plain dynamic import() - the vi.mock() factory
    // at the top of this file intercepts import('@/api/cloud-import')
    // wherever it appears, dynamic or static, so a plain import() here would
    // only ever inspect the mock factory's own shape (which we wrote by
    // hand, minus processJob, so it would trivially "pass" even if the real
    // module still exported processJob). vi.importActual bypasses vi.mock
    // and loads the real, unmocked module, so this actually pins the
    // shipped API surface.
    listJobsMock.mockResolvedValue([job({ status: 'running' })]);
    await useCloudImports.getState().refresh();
    const actual = await vi.importActual<typeof import('@/api/cloud-import')>('@/api/cloud-import');
    expect(Object.keys(actual)).not.toContain('processJob');
  });
});

describe('the poll timer (via refresh())', () => {
  // The old drive() loop was the only repeating caller of refresh() - delete
  // it without replacing that, and a job's card renders one snapshot and
  // never moves again until the page reloads. refresh() now owns a small
  // self-starting/self-stopping poll timer instead (CLOUD_IMPORT_POLL_MS),
  // same shape as stores/remote-downloads.ts's timer. These two tests would
  // both fail against the pre-poller version of refresh() - the first
  // because a second listJobs() call never happens on its own, the second
  // because a "stops polling" claim is meaningless when nothing ever started.

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    // Clear any interval this test armed using the SAME (still-fake) timer
    // implementation that created it, before switching back to real timers
    // below - clearInterval on a fake-timer id after vi.useRealTimers() has
    // already run is not something to rely on. See the file-level afterEach
    // above for why this matters to every other test in this file too.
    listJobsMock.mockResolvedValue([]);
    await useCloudImports.getState().refresh();
    vi.useRealTimers();
  });

  it('advances the job without a remount while it stays active', async () => {
    listJobsMock
      .mockResolvedValueOnce([job({ status: 'running', completed_bytes: 100 })])
      .mockResolvedValueOnce([job({ status: 'running', completed_bytes: 500 })]);

    await useCloudImports.getState().refresh();
    expect(listJobsMock).toHaveBeenCalledTimes(1);
    expect(useCloudImports.getState().jobs[0].completed_bytes).toBe(100);

    // No manual refresh() call here - only the poll timer itself should
    // produce the second listJobs() call.
    await vi.advanceTimersByTimeAsync(CLOUD_IMPORT_POLL_MS);
    expect(listJobsMock).toHaveBeenCalledTimes(2);
    expect(useCloudImports.getState().jobs[0].completed_bytes).toBe(500);
  });

  it('stops polling once the job reaches a terminal status', async () => {
    listJobsMock
      .mockResolvedValueOnce([job({ status: 'running' })])
      .mockResolvedValueOnce([job({ status: 'complete' })]);

    await useCloudImports.getState().refresh();
    expect(listJobsMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CLOUD_IMPORT_POLL_MS);
    expect(listJobsMock).toHaveBeenCalledTimes(2); // the poll that discovers completion

    // Plenty more time passes; a terminal status must not keep polling.
    await vi.advanceTimersByTimeAsync(CLOUD_IMPORT_POLL_MS * 10);
    expect(listJobsMock).toHaveBeenCalledTimes(2);
  });
});

describe('useCloudImports.refresh / cancel', () => {
  it('refresh populates jobs from listJobs', async () => {
    listJobsMock.mockResolvedValue([job({ id: 'j1' }), job({ id: 'j2' })]);
    await useCloudImports.getState().refresh();
    expect(useCloudImports.getState().jobs.map((j) => j.id)).toEqual(['j1', 'j2']);
  });

  it('refresh keeps the last known jobs on a network failure rather than blanking the UI', async () => {
    listJobsMock.mockResolvedValueOnce([job({ id: 'j1', status: 'complete' })]);
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
