import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const startArchiveDownload = vi.fn();
const toasts: { kind: string; title: string; body?: string }[] = [];
vi.mock('@/lib/toast', () => ({
  toast: {
    info: (title: string, body?: string) => toasts.push({ kind: 'info', title, body }),
    error: (title: string, body?: string) => toasts.push({ kind: 'error', title, body }),
    success: (title: string, body?: string) => toasts.push({ kind: 'success', title, body }),
  },
}));
vi.mock('@/lib/archive-download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/archive-download')>();
  return { ...actual, startArchiveDownload: (...args: unknown[]) => startArchiveDownload(...args) };
});

const { default: FilesPage } = await import('./files');
const { useWorkspace } = await import('@/stores/workspace');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
  startArchiveDownload.mockReset();
  toasts.length = 0;
  localStorage.clear();
});

const FOLDER = {
  id: 'fld_1', name: 'Photos', created_at: 1_700_000_000, updated_at: 1_700_000_000,
  file_count: 2, lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', is_synced: 0,
  total_size_bytes: 10, content_updated_at: 1_700_000_000, region: null,
  uploader_name: null, share_count: 0, comment_count: 0, origin: null,
};

async function selectFolderAndDownload() {
  const row = [...container!.querySelectorAll('div')]
    .find((d) => d.className.includes('cursor-pointer') && d.textContent?.includes('Photos'))!;
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
  const zipBtn = [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes('Download ZIP'));
  expect(zipBtn, 'Download ZIP button').toBeTruthy();
  await act(async () => { zipBtn!.click(); });
}

async function render() {
  const listing = {
    ok: true, folders: [FOLDER], files: [], breadcrumbs: [],
    pagination: { page: 1, per_page: 100, total_files: 0, total_pages: 1 },
  };
  apiMock.mockImplementation((path: unknown) =>
    Promise.resolve(typeof path === 'string' && path.startsWith('/api/cloud/imports')
      ? { ok: true, jobs: [] }
      : listing));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><FilesPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

// F4 (field report): the page must hand the selection to the shared archive
// helper - which streams rather than buffering - not build its own fetch.
describe('FilesPage bulk ZIP download', () => {
  it('sends the selection to startArchiveDownload', async () => {
    localStorage.setItem('dosya_files_view', 'list');
    startArchiveDownload.mockResolvedValue({ parts: 1 });
    await render();
    await selectFolderAndDownload();

    expect(startArchiveDownload).toHaveBeenCalledTimes(1);
    expect(startArchiveDownload.mock.calls[0][0]).toEqual({ fileIds: [], folderIds: ['fld_1'] });
    expect(toasts.at(-1)?.kind).toBe('success');
  });

  // Fix round 2, MINOR 1: a selection too long for one URL arrives as several
  // ZIPs. Saying "your ZIP" while three downloads land reads as a bug.
  it('says how many downloads a split selection produced', async () => {
    localStorage.setItem('dosya_files_view', 'list');
    startArchiveDownload.mockResolvedValue({ parts: 3 });
    await render();
    await selectFolderAndDownload();

    const last = toasts.at(-1)!;
    expect(last.kind).toBe('success');
    expect(`${last.title} ${last.body ?? ''}`).toContain('3');
  });

  it('says nothing cheerful when the selection was refused', async () => {
    localStorage.setItem('dosya_files_view', 'list');
    startArchiveDownload.mockResolvedValue({ parts: 0 });
    await render();
    await selectFolderAndDownload();

    expect(toasts.some((t) => t.kind === 'success')).toBe(false);
  });
});
