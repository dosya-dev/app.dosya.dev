import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { UploadItem } from '@/lib/upload-types';

const retry = vi.fn();
let retryable = true;
vi.mock('@/lib/upload-runner', () => ({
  retry: (...a: unknown[]) => retry(...a),
  retryAllFailed: () => {},
  setWorkspaceCap: () => {},
  canRetry: () => retryable,
}));
vi.mock('@/api/client', async (importOriginal) => ({
  // shouldRetryQuery does `error instanceof ApiError` on every retry, and a retry
  // can outlive the test that started it - a mock without it throws and fails the run.
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  api: async () => ({ ok: true }),
  API_BASE: '',
}));

const uploadFromPicker = vi.fn();
vi.mock('@/lib/upload-drop', () => ({
  uploadFromDrop: () => {},
  uploadFromPicker: (...a: unknown[]) => uploadFromPicker(...a),
}));

const { default: UploadsPage, QueueRow } = await import('./uploads');
const { useWorkspace } = await import('@/stores/workspace');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  retry.mockReset();
  uploadFromPicker.mockReset();
  retryable = true;
});

function item(over: Partial<UploadItem>): UploadItem {
  return {
    id: 'u1', session_id: null, fileName: 'report.pdf', fileSize: 100, mimeType: 'application/pdf',
    workspace_id: 'ws', folder_id: null, status: 'queued', progress: 0, bytesUploaded: 0,
    part_size: null, total_parts: null, uploaded_parts: [], ...over,
  };
}

function render(it: UploadItem) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<MemoryRouter><QueueRow item={it} /></MemoryRouter>); });
}

// F3 (field report): a failed row on the Uploads page used to show only a red
// "Error" with nowhere to go. It now names the reason and offers Retry.
describe('Uploads page QueueRow', () => {
  it('renders the reason and a Retry button for an error row, which retries that upload', () => {
    render(item({ status: 'error', error: 'File type .exe is not allowed in this workspace' }));
    expect(container!.textContent).toContain('File type .exe is not allowed in this workspace');
    const btn = [...container!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Retry');
    expect(btn).toBeTruthy();
    act(() => { btn!.click(); });
    expect(retry).toHaveBeenCalledWith('u1');
  });

  // Fix round 1, MINOR (a): after a reload the bytes are gone, so Retry can
  // only ever no-op. It says so rather than pretending.
  it('disables Retry for an error row whose file this tab no longer holds', () => {
    retryable = false;
    render(item({ status: 'error', error: 'Upload failed' }));
    const btn = [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes('Retry')) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Add the file again');
    act(() => { btn.click(); });
    expect(retry).not.toHaveBeenCalled();
    // The reason survives so the row still explains itself.
    expect(container!.textContent).toContain('Upload failed');
  });

  it('shows no Retry button for a completed row', () => {
    render(item({ status: 'complete', progress: 100 }));
    expect([...container!.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Retry')).toBe(false);
  });
});

// A workspace's files all live in its one location, chosen at creation. The
// Uploads page used to offer a per-upload region picker; there is nothing left
// for it to choose, and nothing for it to send.
describe('Uploads page - no per-upload location choice', () => {
  async function renderPage() {
    useWorkspace.setState({ activeId: 'ws' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<MemoryRouter><UploadsPage /></MemoryRouter>);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  it('offers no region picker', async () => {
    await renderPage();
    expect(container!.textContent).not.toContain('Select region');
    expect(container!.textContent).not.toContain('Search city, country or code');
    expect(container!.textContent).not.toContain('You pick the region');
  });

  it('hands the runner an upload input with no region key', async () => {
    await renderPage();
    const input = container!.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'a.txt');
    const files = { 0: file, length: 1, item: () => file } as unknown as FileList;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(uploadFromPicker).toHaveBeenCalledTimes(1);
    expect(uploadFromPicker.mock.calls[0][1]).not.toHaveProperty('region');
  });
});
