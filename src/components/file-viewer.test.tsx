import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// FileViewer loads the version list through api() on mount. Stub only `api`,
// keep API_BASE real - the raw-content fetch under test builds its URL off it.
const apiMock = vi.fn().mockRejectedValue(new Error('network disabled in test'));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { FileViewer } = await import('./file-viewer');

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
  vi.unstubAllGlobals();
});

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

// FileItem shape as consumed by FileViewer (declared in @/lib/file-types).
function htmlFile() {
  return {
    id: 'f1', name: 'page.html', size_bytes: 512, mime_type: 'text/plain',
    extension: 'html', region: 'weur', created_at: 1, updated_at: 1,
    current_version: 1, lock_mode: 'none', is_hidden: 0, uploaded_by: 'u1',
    uploader_name: 'User', share_count: 0, comment_count: 0, is_synced: 0,
  };
}

describe('TextViewer raw-content fetch', () => {
  it('sends the session cookie (credentials: include) so cross-origin preview works', async () => {
    // Over HIGHLIGHT_MAX so the highlighter (real shiki) never loads in the test.
    const body = 'a'.repeat(300 * 1024 + 10);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => body });
    vi.stubGlobal('fetch', fetchMock);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const file = htmlFile();
    await act(async () => {
      root!.render(createElement(FileViewer, {
        file: file as never,
        files: [file] as never,
        workspaceId: 'w1',
        onClose: () => {},
        onNavigate: () => {},
        onRefresh: () => {},
      }));
      await flush();
    });

    const rawCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/files/f1/raw'));
    expect(rawCall, 'expected a fetch of the /raw endpoint').toBeDefined();
    expect(rawCall![1]).toMatchObject({ credentials: 'include' });
  });
});
