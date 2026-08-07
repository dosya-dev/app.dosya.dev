import { describe, expect, test } from 'vitest';
import { ApiError, apiErrorCode, apiErrorMessage } from './client';
import { API_ERROR_COPY, humanizeApiError } from './error-copy';

const locked = () =>
  new ApiError(403, JSON.stringify({ ok: false, error: 'folder_locked', folder_id: 'f1', lock_mode: 'full_lock' }));

describe('humanizeApiError', () => {
  test('folder_locked reads as a sentence, not a code', () => {
    const copy = humanizeApiError('folder_locked');
    expect(copy).toBe(API_ERROR_COPY.folder_locked);
    expect(copy).not.toBe('folder_locked');
    expect(copy).toMatch(/locked/i);
  });

  test('an unmapped code falls back to itself rather than to a blank or a lie', () => {
    expect(humanizeApiError('some_future_code')).toBe('some_future_code');
  });
});

describe('apiErrorMessage', () => {
  test('a folder_locked body no longer surfaces the raw code', () => {
    // The regression: this rendered the literal string "folder_locked" under
    // "Could not load this folder" on the files page.
    const msg = apiErrorMessage(locked());
    expect(msg).not.toBe('folder_locked');
    expect(msg).toBe(API_ERROR_COPY.folder_locked);
  });

  test('sentences the API already wrote pass through untouched', () => {
    const err = new ApiError(400, JSON.stringify({ error: 'Full lock requires a password' }));
    expect(apiErrorMessage(err)).toBe('Full lock requires a password');
  });

  test('a non-ApiError falls back', () => {
    expect(apiErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });
});

describe('apiErrorCode', () => {
  test('returns the machine code so callers can branch on it', () => {
    expect(apiErrorCode(locked())).toBe('folder_locked');
  });

  test('is not confused by the humanized message', () => {
    // apiErrorMessage rewrites; apiErrorCode must not - branching on prose
    // would break the moment the copy is reworded.
    expect(apiErrorCode(locked())).not.toBe(apiErrorMessage(locked()));
  });

  test('null for a non-JSON body (gateway/HTML error page)', () => {
    expect(apiErrorCode(new ApiError(502, '<html>Bad Gateway</html>'))).toBeNull();
  });

  test('null for an empty error field and for non-ApiError failures', () => {
    expect(apiErrorCode(new ApiError(400, JSON.stringify({ error: '   ' })))).toBeNull();
    expect(apiErrorCode(new TypeError('network'))).toBeNull();
  });
});
