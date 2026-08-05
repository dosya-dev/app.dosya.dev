import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Keep the editor's failure path quiet: toast renders into the real DOM and
// api() would hit the network. Neither belongs in this unit test.
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const apiMock = vi.fn().mockRejectedValue(new Error('network disabled in test'));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { TextEditorOverlay } = await import('./text-editor');

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
  vi.unstubAllGlobals();
});

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('TextEditorOverlay initial content fetch', () => {
  it('sends the session cookie (credentials: include) so cross-origin editing works', async () => {
    // ok:false makes the load reject before the CodeMirror dynamic imports run;
    // the request options are all this test is about.
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(TextEditorOverlay, {
        file: { id: 'f1', name: 'page.html', mime_type: 'text/plain' },
        rawUrl: 'https://api.example.test/api/files/f1/raw?_t=1',
        workspaceId: 'w1',
        onClose: () => {},
        onSaved: () => {},
      }));
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/files/f1/raw?_t=1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
