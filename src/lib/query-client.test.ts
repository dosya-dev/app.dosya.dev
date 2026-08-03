import { describe, expect, test } from 'vitest';
import { queryClient, shouldRetryQuery } from './query-client';
import { ApiError } from '@/api/client';

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
