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

// The PDF branch must NOT pull real pdf.js into this test - the stub records
// the props the branch hands over.
vi.mock('@/components/pdf-viewer/pdf-viewer', () => {
  const PdfViewer = (props: {
    fileName: string;
    rawUrl: string;
    downloadUrl: string;
    toolbarSlots?: { left: HTMLElement | null; center: HTMLElement | null };
  }) =>
    createElement('div', {
      'data-testid': 'pdf-viewer-stub',
      'data-file-name': props.fileName,
      'data-raw': props.rawUrl,
      'data-download': props.downloadUrl,
      'data-has-slots': props.toolbarSlots && props.toolbarSlots.left && props.toolbarSlots.center ? 'yes' : 'no',
    });
  return { PdfViewer, default: PdfViewer };
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

/**
 * The audio player keeps a live <audio> element and runs a tag read and a
 * waveform decode keyed on its source URL. rawUrl() stamps Date.now() on every
 * call and is invoked during render, so an unrelated re-render used to hand
 * the player a brand new URL - restarting playback and re-downloading the file
 * every time. The text editor already had a stable URL for exactly this
 * reason; audio needs the same one.
 */
describe('FileViewer audio source stability', () => {
  function audioFile() {
    return {
      id: 'f1', name: 'track.mp3', size_bytes: 512, mime_type: 'audio/mpeg',
      extension: 'mp3', region: 'weur', created_at: 1, updated_at: 1,
      current_version: 1, lock_mode: 'none', is_hidden: 0, uploaded_by: 'u1',
      uploader_name: 'User', share_count: 0, comment_count: 0, is_synced: 0,
    };
  }

  it('keeps the same <audio> src across re-renders', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const file = audioFile();

    const render = async () => {
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
    };

    await render();
    const first = container.querySelector('audio')?.getAttribute('src');
    expect(first, 'expected the audio player to render an <audio> element').toBeTruthy();

    // Re-render the same file, as any unrelated state change in the viewer does.
    await render();
    const second = container.querySelector('audio')?.getAttribute('src');

    expect(second).toBe(first);
  });

  it('does not cache-bust the audio source with a wall-clock value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const file = audioFile();

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

    const src = container.querySelector('audio')?.getAttribute('src') ?? '';
    const t = new URL(src, 'https://example.test').searchParams.get('_t');
    // A deterministic token derived from the version is fine; a timestamp is not.
    if (t !== null) expect(Number(t)).toBeLessThan(1_000_000_000_000);
  });
});

describe('FileViewer - PDF branch', () => {
  function pdfFile() {
    return {
      id: 'pdf1', name: 'İnceleme.pdf', size_bytes: 4096, mime_type: 'application/pdf',
      extension: 'pdf', region: 'weur', created_at: 1, updated_at: 1,
      current_version: 1, lock_mode: 'none', is_hidden: 0, uploaded_by: 'u1',
      uploader_name: 'User', share_count: 0, comment_count: 0, is_synced: 0,
    };
  }

  async function mountPdf() {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const file = pdfFile();
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
  }

  it('renders the custom PdfViewer instead of a browser iframe', async () => {
    await mountPdf();
    expect(container!.querySelector('[data-testid="pdf-viewer-stub"]')).toBeTruthy();
    expect(container!.querySelector('iframe')).toBeFalsy();
  });

  it('hands the file name, stable raw URL, and download URL to the PdfViewer', async () => {
    await mountPdf();
    const stub = container!.querySelector<HTMLElement>('[data-testid="pdf-viewer-stub"]')!;
    expect(stub.dataset.fileName).toBe('İnceleme.pdf');
    expect(stub.dataset.raw).toContain('/api/files/pdf1/raw');
    // The stable URL, not the Date.now()-stamped one - pdf.js refetches when
    // its source URL changes, so a per-render URL would re-download the file.
    const t = new URL(stub.dataset.raw!, 'https://example.test').searchParams.get('_t');
    if (t !== null) expect(Number(t)).toBeLessThan(1_000_000_000_000);
    expect(stub.dataset.download).toContain('/api/files/pdf1/download');
  });

  it('gives the PDF viewer the full-bleed content area, not the padded centered one', async () => {
    await mountPdf();
    const wrapper = container!.querySelector<HTMLElement>('[data-testid="pdf-viewer-stub"]')!.parentElement!;
    expect(wrapper.className).toContain('overflow-hidden');
    expect(wrapper.className).not.toContain('p-6');
  });

  it('mounts header toolbar slots and hands them to the PdfViewer, sidebar slot before the title', async () => {
    await mountPdf();
    const left = container!.querySelector<HTMLElement>('[data-pdf-slot="left"]');
    const center = container!.querySelector<HTMLElement>('[data-pdf-slot="center"]');
    expect(left).toBeTruthy();
    expect(center).toBeTruthy();
    const title = [...container!.querySelectorAll('span')].find((s) => s.textContent === 'İnceleme.pdf');
    expect(title).toBeTruthy();
    // The sidebar slot must precede the title in the header's reading order.
    expect(left!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container!.querySelector<HTMLElement>('[data-testid="pdf-viewer-stub"]')!.dataset.hasSlots).toBe('yes');
  });

  it('mounts no PDF toolbar slots for non-PDF files', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const file = { ...pdfFile(), name: 'track.mp3', mime_type: 'audio/mpeg', extension: 'mp3' };
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
    expect(container.querySelector('[data-pdf-slot]')).toBeFalsy();
  });
});
