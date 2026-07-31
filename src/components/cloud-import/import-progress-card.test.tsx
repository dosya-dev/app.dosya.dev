import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CloudJob } from '@/api/cloud-import';
import {
  IMPORT_SOURCE_LABELS,
  ImportProgressCard,
  PROVIDER_LABELS,
  describeJob,
} from './import-progress-card';
import { useCloudImports } from '@/stores/cloud-imports';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('IMPORT_SOURCE_LABELS', () => {
  it('labels the legacy google-drive value', () => {
    expect(IMPORT_SOURCE_LABELS['google-drive']).toBe('Google Drive');
  });

  it('has labels ready for the A2 and A3 providers', () => {
    expect(IMPORT_SOURCE_LABELS.onedrive).toBe('OneDrive');
    expect(IMPORT_SOURCE_LABELS.dropbox).toBe('Dropbox');
  });
});

describe('PROVIDER_LABELS', () => {
  it('is keyed by provider id, not by import_source value', () => {
    // The two maps differ only for google, which is exactly the trap: the
    // list route's job.provider is 'google', but files.import_source (and
    // therefore IMPORT_SOURCE_LABELS) uses the historical 'google-drive'.
    expect(PROVIDER_LABELS.google).toBe('Google Drive');
    expect(PROVIDER_LABELS['google-drive']).toBeUndefined();
  });

  it('has labels ready for the A2 and A3 providers', () => {
    expect(PROVIDER_LABELS.onedrive).toBe('OneDrive');
    expect(PROVIDER_LABELS.dropbox).toBe('Dropbox');
  });
});

describe('describeJob', () => {
  it('reports scanning while discovering, with no fake total', () => {
    expect(describeJob({
      status: 'discovering', total_files: 12, completed_files: 0,
      failed_files: 0, skipped_files: 0,
    })).toBe('Scanning - 12 files found so far');
  });

  it('reports progress while running', () => {
    expect(describeJob({
      status: 'running', total_files: 10, completed_files: 3,
      failed_files: 0, skipped_files: 0,
    })).toBe('Importing 3 of 10 files');
  });

  it('reports a clean completion without a failure clause', () => {
    expect(describeJob({
      status: 'complete', total_files: 4, completed_files: 4,
      failed_files: 0, skipped_files: 0,
    })).toBe('Imported 4 files');
  });

  it('surfaces failures and skips in the completion summary', () => {
    expect(describeJob({
      status: 'complete', total_files: 10, completed_files: 7,
      failed_files: 2, skipped_files: 1,
    })).toBe('Imported 7 of 10 files - 2 failed, 1 skipped');
  });

  it('reports a plain failed message regardless of partial counts', () => {
    expect(describeJob({
      status: 'failed', total_files: 5, completed_files: 2,
      failed_files: 1, skipped_files: 0,
    })).toBe('Import failed');
  });

  it('reports a plain cancelled message regardless of partial counts', () => {
    expect(describeJob({
      status: 'cancelled', total_files: 5, completed_files: 2,
      failed_files: 0, skipped_files: 0,
    })).toBe('Import cancelled');
  });
});

describe('ImportProgressCard', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let originalState: ReturnType<typeof useCloudImports.getState>;

  beforeEach(() => {
    originalState = useCloudImports.getState();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    useCloudImports.setState(originalState, true);
  });

  function job(over: Partial<CloudJob> = {}): CloudJob {
    return {
      id: 'job1',
      provider: 'google',
      workspace_id: 'ws1',
      status: 'running',
      total_files: 10,
      total_bytes: 1000,
      total_folders: 2,
      completed_files: 3,
      completed_bytes: 300,
      failed_files: 0,
      skipped_files: 0,
      error_message: null,
      created_at: 0,
      updated_at: 0,
      ...over,
    };
  }

  async function render(jobs: CloudJob[], cancel = vi.fn().mockResolvedValue(undefined)) {
    useCloudImports.setState({ jobs, refresh: vi.fn().mockResolvedValue(undefined), cancel });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<ImportProgressCard />);
      await Promise.resolve();
    });
    return { cancel };
  }

  it('renders nothing when there are no active jobs', async () => {
    await render([job({ status: 'complete' })]);
    expect(container!.innerHTML).toBe('');
  });

  it('renders nothing when there are no jobs at all', async () => {
    await render([]);
    expect(container!.innerHTML).toBe('');
  });

  it('renders indeterminate progress (not 0 percent) while a job is discovering', async () => {
    await render([job({ status: 'discovering', total_files: 12, completed_files: 0 })]);

    expect(document.body.textContent).toContain('Scanning - 12 files found so far');
    const progressRoot = container!.querySelector('[data-slot="progress"]');
    expect(progressRoot).not.toBeNull();
    // Indeterminate is signalled by Base UI's data-indeterminate attribute,
    // which only appears when value is null - never for value=0, which would
    // instead render data-progressing and falsely imply "no progress".
    expect(progressRoot!.hasAttribute('data-indeterminate')).toBe(true);
    expect(progressRoot!.hasAttribute('data-progressing')).toBe(false);
  });

  it('renders a determinate progress bar once running with a known total', async () => {
    await render([job({ status: 'running', total_bytes: 1000, completed_bytes: 300 })]);
    const progressRoot = container!.querySelector('[data-slot="progress"]');
    expect(progressRoot).not.toBeNull();
    expect(progressRoot!.hasAttribute('data-progressing')).toBe(true);
    expect(progressRoot!.hasAttribute('data-indeterminate')).toBe(false);
  });

  it('wires Cancel to the store cancel() with the job id', async () => {
    const { cancel } = await render([job({ id: 'job42', status: 'running' })]);

    const button = [...container!.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Cancel');
    expect(button).toBeTruthy();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('job42');
  });
});
