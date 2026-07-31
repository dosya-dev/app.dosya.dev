import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// FileDetailPanel's version/share-link effects call api() on mount. Real
// network I/O has no place in a unit test and would make this test flaky in
// CI - stub only `api`, keep ApiError/apiErrorMessage/API_BASE real since
// the component imports them directly too.
const apiMock = vi.fn().mockRejectedValue(new Error('network disabled in test'));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { FileDetailPanel } = await import('./file-detail-panel');

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
  apiMock.mockClear();
});

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

// FileItem, as declared locally in file-detail-panel.tsx (not exported).
interface TestFile {
  id: string; name: string; size_bytes: number; mime_type: string; extension: string;
  region: string; created_at: number; updated_at: number; current_version: number;
  lock_mode: string; is_hidden: number; uploaded_by: string; uploader_name: string;
  share_count: number; comment_count: number; is_synced: number;
  import_source?: string; import_account_email?: string;
}

function testFile(over: Partial<TestFile> = {}): TestFile {
  return {
    id: 'f1',
    // .zip matches none of isImage/isVideo/isText/isAudio/.pdf, so
    // FilePreview renders the plain icon fallback with no fetch() of its own.
    name: 'Backup.zip',
    size_bytes: 1024,
    mime_type: 'application/zip',
    extension: 'zip',
    region: 'us',
    created_at: 0,
    updated_at: 0,
    current_version: 1,
    lock_mode: 'none',
    is_hidden: 0,
    uploaded_by: 'u1',
    uploader_name: 'Alice',
    share_count: 0,
    comment_count: 0,
    is_synced: 0,
    ...over,
  };
}

const noop = () => {};

async function renderPanel(file: TestFile) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(FileDetailPanel, {
      file, onClose: noop, onDownload: noop, onCopy: noop, onDelete: noop,
      onShare: noop, onView: noop, onRefresh: noop,
    }));
    await flush();
  });
}

/** Finds a Properties row's value by its label, independent of styling. */
function propRowValue(label: string): string | undefined {
  const labelSpan = [...document.querySelectorAll('span')]
    .find((s) => s.textContent?.trim() === label);
  return labelSpan?.nextElementSibling?.textContent?.trim();
}

describe('FileDetailPanel - Source row label lookup', () => {
  it('resolves the legacy google-drive import_source to "Google Drive"', async () => {
    await renderPanel(testFile({ import_source: 'google-drive' }));
    expect(propRowValue('Source')).toBe('Google Drive');
  });

  it('resolves a future provider (onedrive) import_source to "OneDrive"', async () => {
    await renderPanel(testFile({ import_source: 'onedrive' }));
    expect(propRowValue('Source')).toBe('OneDrive');
  });

  it('shows no Source row at all when the file was not cloud-imported', async () => {
    await renderPanel(testFile({ import_source: undefined }));
    expect(propRowValue('Source')).toBeUndefined();
  });
});
