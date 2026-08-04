import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { queryClient, shouldRetryQuery } from './query-client';
import { ApiError } from '@/api/client';
import { FILES_QUERY_ROOT } from '@/lib/files-request';
import { useCloudImports } from '@/stores/cloud-imports';
import type { CloudJob } from '@/api/cloud-import';

describe('shouldRetryQuery', () => {
  test('never retries 401 - the session is gone, retrying cannot fix it', () => {
    expect(shouldRetryQuery(0, new ApiError(401, 'Not authenticated'))).toBe(false);
  });

  test('never retries 403 - a permission denial is not transient', () => {
    expect(shouldRetryQuery(0, new ApiError(403, 'Forbidden'))).toBe(false);
  });

  test('retries a 500 twice, then gives up', () => {
    const err = new ApiError(500, 'boom');
    expect(shouldRetryQuery(0, err)).toBe(true);
    expect(shouldRetryQuery(1, err)).toBe(true);
    expect(shouldRetryQuery(2, err)).toBe(false);
  });

  test('retries a non-ApiError network failure', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
  });
});

describe('queryClient defaults', () => {
  test('serves cached data for 30s before revalidating', () => {
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(30_000);
  });

  test('keeps evicted-from-view data for 10min so revisits paint instantly', () => {
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(600_000);
  });

  test('revalidates on window focus', () => {
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
  });

  test('does not retry mutations - they are not idempotent', () => {
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });
});

function job(over: Partial<CloudJob> = {}): CloudJob {
  return {
    id: 'job1',
    provider: 'google',
    workspace_id: 'ws1',
    status: 'running',
    total_files: 10,
    total_bytes: 1000,
    total_folders: 1,
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

describe('module-scope cloud-import completion listener', () => {
  // Mirrors the dosya:upload-complete describe below in spirit: this
  // subscriber is wired once at module load (see query-client.ts), so it has
  // to work with nothing mounted, which is exactly what these tests exercise
  // by never rendering anything - only poking the store directly, the same
  // way ImportProgressCard's poll loop does via refresh().
  let originalState: ReturnType<typeof useCloudImports.getState>;
  let invalidateSpy: MockInstance<typeof queryClient.invalidateQueries>;

  beforeEach(() => {
    originalState = useCloudImports.getState();
    // Also flushes the subscriber's internal prevActiveIds bookkeeping to
    // empty (the subscriber fires on every store update, including this
    // one), so each test starts from a clean edge-detection baseline.
    useCloudImports.setState({ jobs: [] });
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    invalidateSpy.mockRestore();
    useCloudImports.setState(originalState, true);
  });

  test('a job going active -> complete invalidates the files cache', () => {
    useCloudImports.setState({ jobs: [job({ status: 'running' })] });
    expect(invalidateSpy).not.toHaveBeenCalled();

    useCloudImports.setState({ jobs: [job({ status: 'complete' })] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [FILES_QUERY_ROOT] });
  });

  test('does not fire again on a later update where the job stays terminal', () => {
    // The non-obvious bookkeeping this pins: after the first active ->
    // terminal edge, the job's id drops out of the subscriber's
    // prevActiveCloudImportIds, so a further update where it is still
    // 'complete' (unchanged) must not read as a fresh edge and re-invalidate.
    useCloudImports.setState({ jobs: [job({ status: 'running' })] });
    useCloudImports.setState({ jobs: [job({ status: 'complete' })] });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    useCloudImports.setState({ jobs: [job({ status: 'complete' })] });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  test('a job going active -> failed invalidates the files cache', () => {
    useCloudImports.setState({ jobs: [job({ status: 'discovering' })] });
    useCloudImports.setState({ jobs: [job({ status: 'failed' })] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [FILES_QUERY_ROOT] });
  });

  test('a job going active -> cancelled invalidates the files cache', () => {
    useCloudImports.setState({ jobs: [job({ status: 'running' })] });
    useCloudImports.setState({ jobs: [job({ status: 'cancelled' })] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [FILES_QUERY_ROOT] });
  });

  test('an ordinary progress tick does not invalidate anything', () => {
    useCloudImports.setState({ jobs: [job({ status: 'running', completed_files: 0 })] });
    useCloudImports.setState({ jobs: [job({ status: 'running', completed_files: 4 })] });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test('a job that was never seen as active does not invalidate anything', () => {
    useCloudImports.setState({ jobs: [job({ status: 'complete' })] });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test('two jobs completing in the same update still invalidates (not double-registered per job)', () => {
    useCloudImports.setState({
      jobs: [job({ id: 'job1', status: 'running' }), job({ id: 'job2', status: 'discovering' })],
    });
    useCloudImports.setState({
      jobs: [job({ id: 'job1', status: 'complete' }), job({ id: 'job2', status: 'failed' })],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [FILES_QUERY_ROOT] });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  test('invalidates regardless of workspace - there is no page mounted to scope it to', () => {
    useCloudImports.setState({ jobs: [job({ workspace_id: 'some-other-workspace', status: 'running' })] });
    useCloudImports.setState({ jobs: [job({ workspace_id: 'some-other-workspace', status: 'complete' })] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [FILES_QUERY_ROOT] });
  });
});
