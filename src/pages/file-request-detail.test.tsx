import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const startArchiveDownload = vi.fn();
vi.mock('@/lib/archive-download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/archive-download')>();
  return { ...actual, startArchiveDownload: (...args: unknown[]) => startArchiveDownload(...args) };
});

const { default: FileRequestDetailPage } = await import('./file-request-detail');

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
  apiMock.mockReset();
  startArchiveDownload.mockReset();
});

beforeEach(() => { startArchiveDownload.mockResolvedValue({ parts: 1 }); });

const EXPIRES_AT = Math.floor(Date.now() / 1000) + 30 * 86_400;

const REQUEST = {
  id: 'fr_1', workspace_id: 'ws_1', folder_id: null, folder_name: null, token: 't', url: 'https://x/t',
  title: 'Invoices', message: null, is_revoked: 0, is_password_protected: 0, expires_at: EXPIRES_AT,
  allowed_extensions: null, max_file_size_bytes: null, max_files: null, upload_count: 1,
  created_at: 1_700_000_000, created_by_name: 'Ada',
};

const UPLOAD = {
  id: 'up_1', file_id: 'file_1', uploader_email: 'a@example.com', uploader_name: 'A',
  created_at: 1_700_000_000, file_name: 'invoice.pdf', size_bytes: 10, mime_type: 'application/pdf',
  extension: '.pdf', updated_at: 1_700_000_000, current_version: 1,
};

async function render() {
  apiMock.mockResolvedValue({ ok: true, request: REQUEST, uploads: [UPLOAD], recipients: [] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/file-requests/fr_1']}>
          <Routes><Route path="/file-requests/:id" element={<FileRequestDetailPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Fix round 1, IMPORTANT 4: this page still buffered the archive into a Blob
// and an object URL - the memory pin F4 removed from the files page - on the
// same endpoint.
describe('FileRequestDetailPage bulk download', () => {
  it('streams through startArchiveDownload rather than fetching a Blob', async () => {
    await render();
    expect(container!.textContent).toContain('invoice.pdf');

    const checkbox = container!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { checkbox.click(); });

    const downloadBtn = [...container!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Download');
    expect(downloadBtn, 'bulk Download button').toBeTruthy();
    await act(async () => { downloadBtn!.click(); });

    expect(startArchiveDownload).toHaveBeenCalledTimes(1);
    expect(startArchiveDownload.mock.calls[0][0]).toEqual({ fileIds: ['file_1'] });
  });

  // F6 (field report): a fixed 'en-US' ignored the viewer's own locale. Asserted
  // by watching the call rather than by reading the source, so it holds however
  // the date is produced and whatever locale this machine runs in.
  it('formats the expiry date in the viewer\'s locale', async () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString');
    await render();
    expect(spy).toHaveBeenCalled();
    for (const [locale] of spy.mock.calls) expect(locale).toBeUndefined();
    expect(container!.textContent).toContain(
      new Date(EXPIRES_AT * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    );
    spy.mockRestore();
  });
});
