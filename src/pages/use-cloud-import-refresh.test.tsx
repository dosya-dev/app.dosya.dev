import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CloudJob } from '@/api/cloud-import';
import { useCloudImports } from '@/stores/cloud-imports';
import { useCloudImportCompletionRefresh } from './use-cloud-import-refresh';

// Rendered with a minimal harness, following this repo's existing
// no-@testing-library pattern (see use-cloud-browser.test.ts /
// select-checkbox.test.tsx): a real React tree via react-dom/client + act(),
// no extra test-rendering library.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

async function renderHook(workspaceId: string, onComplete: () => void) {
  function Harness() {
    useCloudImportCompletionRefresh(workspaceId, onComplete);
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(Harness));
    await Promise.resolve();
  });
}

/** Mutates the store the same way the real app does (ImportProgressCard's
 * poll loop / the drive() loop calling refresh(), which does
 * `set({ jobs: await listJobs() })` - a fresh array each time). */
async function setJobs(jobs: CloudJob[]) {
  await act(async () => {
    useCloudImports.setState({ jobs });
    await Promise.resolve();
  });
}

describe('useCloudImportCompletionRefresh', () => {
  it('does not fire on mount, even if a job is already active', async () => {
    useCloudImports.setState({ jobs: [job({ status: 'running' })] });
    const onComplete = vi.fn();
    await renderHook('ws1', onComplete);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not fire on an ordinary progress tick while still running - the second half of the requirement', async () => {
    useCloudImports.setState({ jobs: [job({ status: 'running', completed_files: 0 })] });
    const onComplete = vi.fn();
    await renderHook('ws1', onComplete);

    await setJobs([job({ status: 'running', completed_files: 4 })]);
    expect(onComplete).not.toHaveBeenCalled();

    await setJobs([job({ status: 'running', completed_files: 9 })]);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('fires exactly once on the running -> complete transition, and not again on a repeat update', async () => {
    useCloudImports.setState({ jobs: [job({ status: 'running' })] });
    const onComplete = vi.fn();
    await renderHook('ws1', onComplete);

    await setJobs([job({ status: 'complete', completed_files: 10 })]);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // A later, unrelated store update (still terminal) must not re-fire -
    // the job already left "active" once and stays out.
    await setJobs([job({ status: 'complete', completed_files: 10 })]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('fires on discovering -> failed too, not only on a clean complete', async () => {
    useCloudImports.setState({ jobs: [job({ id: 'job2', status: 'discovering' })] });
    const onComplete = vi.fn();
    await renderHook('ws1', onComplete);

    await setJobs([job({ id: 'job2', status: 'failed' })]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a job completing in a different workspace', async () => {
    useCloudImports.setState({ jobs: [job({ workspace_id: 'ws2', status: 'running' })] });
    const onComplete = vi.fn();
    await renderHook('ws1', onComplete);

    await setJobs([job({ workspace_id: 'ws2', status: 'complete' })]);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('fires once even when multiple jobs in the workspace complete in the same update', async () => {
    useCloudImports.setState({
      jobs: [job({ id: 'job1', status: 'running' }), job({ id: 'job2', status: 'discovering' })],
    });
    const onComplete = vi.fn();
    await renderHook('ws1', onComplete);

    await setJobs([job({ id: 'job1', status: 'complete' }), job({ id: 'job2', status: 'failed' })]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
