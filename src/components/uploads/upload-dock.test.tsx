import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { UploadItem } from '@/lib/upload-types';

const retryAllFailed = vi.fn();
const retry = vi.fn();
let retryable = true;
vi.mock('@/lib/upload-runner', () => ({
  cancel: () => {},
  retry: (...a: unknown[]) => retry(...a),
  resumeWithFile: () => ({ ok: true }),
  retryAllFailed: () => retryAllFailed(),
  canRetry: () => retryable,
}));
vi.mock('@/api/client', async (importOriginal) => ({
  // shouldRetryQuery does `error instanceof ApiError` on every retry, and a retry
  // can outlive the test that started it - a mock without it throws and fails the run.
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  api: async () => ({ ok: true }),
  API_BASE: '',
}));

const { default: UploadDock } = await import('./upload-dock');
const { useUploads } = await import('@/stores/uploads');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  localStorage.clear();
  useUploads.setState({ items: [] });
  retryAllFailed.mockReset();
  retry.mockReset();
  retryable = true;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function item(over: Partial<UploadItem>): UploadItem {
  return {
    id: 'u1', session_id: null, fileName: 'a.txt', fileSize: 100, mimeType: 't',
    workspace_id: 'ws', folder_id: null, status: 'queued', progress: 0, bytesUploaded: 0,
    part_size: null, total_parts: null, uploaded_parts: [], ...over,
  };
}

function render(items: UploadItem[]) {
  useUploads.setState({ items });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<MemoryRouter><UploadDock /></MemoryRouter>); });
}

const retryAllButton = () =>
  [...container!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Retry all failed');

// F3 (field report): several failures in one batch are retried with one click.
describe('UploadDock - Retry all failed', () => {
  it('shows the control when any row has failed and it calls the runner', () => {
    render([item({ id: 'e1', status: 'error', error: 'x' }), item({ id: 'c1', status: 'complete' })]);
    const btn = retryAllButton();
    expect(btn).toBeTruthy();
    act(() => { btn!.click(); });
    expect(retryAllFailed).toHaveBeenCalledTimes(1);
  });

  // Fix round 1, MINOR (a): the dock's own per-row Retry had the same silent
  // no-op as the Uploads page once this tab no longer held the bytes.
  it('disables the row Retry when the file is no longer in this tab', () => {
    retryable = false;
    render([item({ id: 'e1', status: 'error', error: 'Upload failed' })]);
    const rowRetry = [...container!.querySelectorAll('button')].find((b) => b.title?.startsWith('Add the file again')) as HTMLButtonElement;
    expect(rowRetry).toBeTruthy();
    expect(rowRetry.disabled).toBe(true);
    act(() => { rowRetry.click(); });
    expect(retry).not.toHaveBeenCalled();
  });

  it('is absent when nothing has failed', () => {
    render([item({ id: 'c1', status: 'complete' }), item({ id: 'q1', status: 'queued' })]);
    expect(retryAllButton()).toBeUndefined();
  });
});

// The location belongs to the workspace, not to an upload, so a failed upload
// has only one place it can go - retrying somewhere else is not an option any
// more, and the door that offered it is gone.
describe('UploadDock - failed-row menu', () => {
  it('offers Retry and Remove, and no region choice', () => {
    render([item({ id: 'e1', status: 'error', error: 'Upload failed' })]);
    const row = container!.querySelector('[class*="max-h-72"] > div') as HTMLElement;
    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); });
    const menu = document.body.querySelector('[class*="z-[9000]"]') as HTMLElement;
    expect(menu).toBeTruthy();
    const labels = [...menu.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toContain('Retry');
    expect(labels).toContain('Remove');
    expect(labels.some((l) => l?.includes('another region'))).toBe(false);
    expect(document.body.textContent).not.toContain('Upload in another region');
  });
});
