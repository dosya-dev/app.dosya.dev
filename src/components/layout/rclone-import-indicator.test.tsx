import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { RcloneJob } from '@/api/rclone-import';

const listJobsMock = vi.fn();
vi.mock('@/api/rclone-import', async (orig) => ({
  ...(await orig<typeof import('@/api/rclone-import')>()),
  listJobs: (...a: unknown[]) => listJobsMock(...a),
  cancelJob: vi.fn(),
}));
vi.mock('@/stores/workspace', () => ({ useWorkspace: (sel: (s: { activeId: string }) => unknown) => sel({ activeId: 'ws_1' }) }));

const { RcloneImportIndicator } = await import('./rclone-import-indicator');
const { useRcloneImports } = await import('@/stores/rclone-imports');
const { TooltipProvider } = await import('@/components/ui/tooltip');
const { rememberActiveJobs } = await import('@/lib/job-activity');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

function job(over: Partial<RcloneJob> = {}): RcloneJob {
  return {
    id: 'rcj_1', workspace_id: 'ws_1', kind: 'import', backend: 'sftp', label: 'SFTP', source_path: '/data', source_host: 'files.example.com',
    dest_folder_id: null, status: 'running', cancel_requested: 0, bytes_total: 0, bytes_done: 0,
    files_total: 0, files_done: 0, files_failed: 0, error_code: null, error_message: null, created_at: 0, finished_at: null,
    ...over,
  };
}

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TooltipProvider, null, createElement(RcloneImportIndicator)));
    await flush();
  });
  return container;
}

beforeEach(() => {
  localStorage.clear();
  listJobsMock.mockReset();
  listJobsMock.mockResolvedValue([]);
  useRcloneImports.setState({ workspaceId: null, jobs: null });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
});

describe('RcloneImportIndicator', () => {
  it('renders nothing when idle, and does not list jobs when none was running last time', async () => {
    const c = await render();
    expect(c.querySelector('[data-testid="rclone-import-ring"]')).toBeNull();
    expect(listJobsMock).not.toHaveBeenCalled();
  });

  it('lists jobs on mount when this browser last saw an import running', async () => {
    rememberActiveJobs('rclone', true);
    listJobsMock.mockResolvedValue([job()]);
    const c = await render();
    expect(listJobsMock).toHaveBeenCalledWith('ws_1');
    expect(c.querySelector('[data-testid="rclone-import-ring"]')).not.toBeNull();
  });

  it('spins while the source is uncounted and fills the ring once bytes are known', async () => {
    const c = await render();
    await act(async () => { useRcloneImports.setState({ workspaceId: 'ws_1', jobs: [job()] }); await flush(); });
    expect(c.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
    await act(async () => { useRcloneImports.setState({ jobs: [job({ bytes_total: 200, bytes_done: 100 })] }); await flush(); });
    expect(c.querySelector('svg')?.getAttribute('class')).toContain('-rotate-90');
  });

  it('ignores probes and finished imports', async () => {
    const c = await render();
    await act(async () => {
      useRcloneImports.setState({ workspaceId: 'ws_1', jobs: [job({ kind: 'probe' }), job({ id: 'd', status: 'complete' })] });
      await flush();
    });
    expect(c.querySelector('[data-testid="rclone-import-ring"]')).toBeNull();
  });
});
