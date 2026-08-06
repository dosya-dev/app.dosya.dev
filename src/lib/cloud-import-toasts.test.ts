import { describe, expect, it } from 'vitest';
import type { CloudJob } from '@/api/cloud-import';
import { completionToast } from './cloud-import-toasts';

function job(overrides: Partial<CloudJob>): CloudJob {
  return {
    id: 'cij_1',
    provider: 'onedrive',
    account_email: 'o@example.com',
    workspace_id: 'ws_1',
    status: 'complete',
    total_files: 10,
    total_bytes: 1000,
    total_folders: 0,
    completed_files: 10,
    completed_bytes: 1000,
    failed_files: 0,
    skipped_files: 0,
    error_message: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

describe('completionToast', () => {
  it('maps a clean completion to a success toast naming the account', () => {
    expect(completionToast(job({}))).toEqual({
      kind: 'success',
      title: 'Import complete',
      description: '10 files from o@example.com',
    });
  });

  it('appends skipped and failed counts when non-zero', () => {
    const t = completionToast(job({ completed_files: 7, skipped_files: 2, failed_files: 1 }));
    expect(t?.description).toBe('7 files from o@example.com - 2 skipped - 1 failed');
  });

  it('uses the singular form for one file', () => {
    expect(completionToast(job({ completed_files: 1 }))?.description).toBe('1 file from o@example.com');
  });

  it('maps failed to an error toast carrying the job error message', () => {
    const t = completionToast(job({ status: 'failed', error_message: 'Provider unavailable' }));
    expect(t).toEqual({ kind: 'error', title: 'Import failed', description: 'Provider unavailable' });
  });

  it('falls back to a generic failure line naming the source when error_message is null', () => {
    const t = completionToast(job({ status: 'failed', error_message: null }));
    expect(t?.description).toBe('The import from o@example.com could not be completed.');
  });

  it('maps cancelled to an info toast', () => {
    expect(completionToast(job({ status: 'cancelled' }))).toEqual({
      kind: 'info',
      title: 'Import cancelled',
      description: 'From o@example.com',
    });
  });

  it('falls back to the provider label when the account email is gone', () => {
    const t = completionToast(job({ account_email: null }));
    expect(t?.description).toBe('10 files from OneDrive');
  });

  it('returns null for a non-terminal status rather than inventing a toast', () => {
    expect(completionToast(job({ status: 'running' }))).toBeNull();
  });
});
