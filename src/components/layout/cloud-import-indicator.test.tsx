import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CloudJob } from '@/api/cloud-import';

// The store's refresh() calls listJobs; return an empty list so mounting the
// indicator settles on "idle" and each test then injects jobs via setState.
const listJobsMock = vi.fn();
vi.mock('@/api/cloud-import', () => ({
  listJobs: (...args: unknown[]) => listJobsMock(...args),
  createImport: vi.fn(),
  cancelJob: vi.fn(),
}));

const { CloudImportIndicator } = await import('./cloud-import-indicator');
const { useCloudImports } = await import('@/stores/cloud-imports');
const { TooltipProvider } = await import('@/components/ui/tooltip');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

function job(overrides: Partial<CloudJob>): CloudJob {
  return {
    id: 'cij_1',
    provider: 'onedrive',
    workspace_id: 'ws_1',
    status: 'running',
    total_files: 10,
    total_bytes: 0,
    total_folders: 0,
    completed_files: 0,
    completed_bytes: 0,
    failed_files: 0,
    skipped_files: 0,
    error_message: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TooltipProvider, null, createElement(CloudImportIndicator)));
    await flush();
  });
}

async function setJobs(jobs: CloudJob[]) {
  await act(async () => {
    useCloudImports.setState({ jobs });
    await flush();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listJobsMock.mockResolvedValue([]);
  useCloudImports.setState({ jobs: [] });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
    await flush();
  });
  container?.remove();
  root = null;
  container = null;
});

describe('CloudImportIndicator', () => {
  it('renders nothing while no import is active', async () => {
    await render();
    await setJobs([job({ status: 'complete' })]);

    expect(container!.querySelector('svg')).toBeNull();
  });

  it('shows a determinate ring with the aggregate byte percent for running jobs', async () => {
    await render();
    await setJobs([
      job({ id: 'a', total_bytes: 1000, completed_bytes: 250 }),
      job({ id: 'b', total_bytes: 1000, completed_bytes: 250 }),
    ]);

    const svg = container!.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('class')).toContain('-rotate-90');
    expect(container!.querySelector('[aria-label="Cloud imports in progress"]')).not.toBeNull();

    // 500 of 2000 bytes = 25%: the progress arc's dashoffset must be 75% of
    // the circumference (2 * PI * 5).
    const circles = svg.querySelectorAll('circle');
    const offset = parseFloat(circles[1].getAttribute('stroke-dashoffset')!);
    expect(offset).toBeCloseTo(2 * Math.PI * 5 * 0.75, 3);
  });

  it('shows the indeterminate spinner while discovery has not produced byte totals', async () => {
    await render();
    await setJobs([job({ status: 'discovering' })]);

    const svg = container!.querySelector('svg')!;
    expect(svg.getAttribute('class')).toContain('animate-spin');
  });
});
