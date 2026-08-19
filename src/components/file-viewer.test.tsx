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

// ── Stage + inspector redesign ────────────────────────────────────

function imageFile() {
  return {
    id: 'f1', name: 'photo.jpg', size_bytes: 2048, mime_type: 'image/jpeg',
    extension: 'jpg', region: 'ap-southeast-2', created_at: 1700000000, updated_at: 1700000100,
    current_version: 2, lock_mode: 'none', is_hidden: 0, uploaded_by: 'u1',
    uploader_name: 'Deniz Aksoy', share_count: 2, comment_count: 3, is_synced: 1,
    origin: 'web',
  };
}

type MountOpts = {
  file?: ReturnType<typeof imageFile>;
  files?: ReturnType<typeof imageFile>[];
  actions?: Record<string, unknown>;
  onNavigate?: (f: unknown) => void;
};

async function mountViewer(opts: MountOpts = {}) {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const file = opts.file ?? imageFile();
  await act(async () => {
    root!.render(createElement(FileViewer, {
      file: file as never,
      files: (opts.files ?? [file]) as never,
      workspaceId: 'w1',
      onClose: () => {},
      onNavigate: opts.onNavigate ?? (() => {}),
      onRefresh: () => {},
      actions: opts.actions as never,
    }));
    await flush();
  });
  return file;
}

function byLabel(label: string) {
  return container!.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

async function click(el: HTMLElement | null) {
  expect(el, 'expected element to click').toBeTruthy();
  await act(async () => { el!.click(); await flush(); });
}

function versionRows() {
  return {
    ok: true,
    current_version: 2,
    versions: [
      { version_number: 2, size_bytes: 2048, created_at: 1700000100, uploader_name: 'Deniz Aksoy' },
      { version_number: 1, size_bytes: 4096, created_at: 1700000000, uploader_name: 'Firat Kaya' },
    ],
  };
}

describe('FileViewer inspector', () => {
  it('shows the file details (size, region, uploader, origin) in the Details tab', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    await mountViewer();
    const inspector = container!.querySelector('[data-testid="viewer-inspector"]');
    expect(inspector, 'expected the inspector rail').toBeTruthy();
    const text = inspector!.textContent!;
    expect(text).toContain('2 KB');
    expect(text).toContain('Sydney');
    expect(text).toContain('Deniz Aksoy');
    expect(text).toContain('Web');
    expect(text).toContain('Share links');
  });

  it('switches to the Versions tab and lists versions with a Latest badge', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    await mountViewer();
    const tab = [...container!.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.includes('Versions'));
    await click(tab ?? null);
    const panel = container!.querySelector('[data-testid="viewer-inspector"]')!;
    expect(panel.textContent).toContain('v2');
    expect(panel.textContent).toContain('v1');
    expect(panel.textContent).toContain('Latest');
  });

  it('restores an older version through the restore endpoint', async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(String(path).endsWith('/versions') ? versionRows() : { ok: true }));
    await mountViewer();
    const tab = [...container!.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.includes('Versions'));
    await click(tab ?? null);
    const restore = [...container!.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Restore');
    await click(restore ?? null);
    const call = apiMock.mock.calls.find(([p]) => String(p).includes('/versions/restore'));
    expect(call, 'expected a POST to the restore endpoint').toBeDefined();
    expect(call![1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ version_number: 1 });
  });

  it('shows an empty state when the file has no version history', async () => {
    apiMock.mockImplementation(() => Promise.resolve({ ok: true, current_version: 1, versions: [] }));
    await mountViewer();
    const tab = [...container!.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.includes('Versions'));
    await click(tab ?? null);
    expect(container!.querySelector('[data-testid="viewer-inspector"]')!.textContent).toContain('No version history');
  });

  it('hides and shows the inspector with the i key', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    await mountViewer();
    expect(container!.querySelector('[data-testid="viewer-inspector"]')).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
      await flush();
    });
    expect(container!.querySelector('[data-testid="viewer-inspector"]')).toBeFalsy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
      await flush();
    });
    expect(container!.querySelector('[data-testid="viewer-inspector"]')).toBeTruthy();
  });
});

describe('FileViewer actions', () => {
  it('favourite star reflects state and calls onToggleFavourite with the file', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    const onToggleFavourite = vi.fn();
    const file = await mountViewer({ actions: { isFavourite: true, onToggleFavourite } });
    const star = byLabel('Remove from favourites');
    await click(star);
    expect(onToggleFavourite).toHaveBeenCalledWith(expect.objectContaining({ id: file.id }));
  });

  it('offers Rename and Delete in the more menu, wired to the callbacks', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const file = await mountViewer({ actions: { onRename, onDelete } });
    await click(byLabel('More actions'));
    const rename = [...container!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.includes('Rename'));
    await click(rename ?? null);
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: file.id }));
    await click(byLabel('More actions'));
    const del = [...container!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.includes('trash'));
    await click(del ?? null);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: file.id }));
  });

  it('renders no action controls when no actions prop is passed', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    await mountViewer();
    expect(byLabel('Add to favourites')).toBeFalsy();
    expect(byLabel('Remove from favourites')).toBeFalsy();
    expect(byLabel('More actions')).toBeFalsy();
  });
});

describe('FileViewer stage navigation', () => {
  it('floating next arrow navigates to the next file and prev is disabled on the first', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    const onNavigate = vi.fn();
    const a = imageFile();
    const b = { ...imageFile(), id: 'f2', name: 'second.jpg' };
    await mountViewer({ file: a, files: [a, b], onNavigate });
    const prev = byLabel('Previous file');
    const next = byLabel('Next file');
    expect(prev, 'expected a floating previous arrow').toBeTruthy();
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    await click(next);
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 'f2' }));
  });

  it('zoom controls appear for images and step the zoom level', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    await mountViewer();
    const zoomIn = byLabel('Zoom in');
    expect(zoomIn, 'expected image zoom controls').toBeTruthy();
    await click(zoomIn);
    expect(container!.textContent).toContain('125%');
  });
});
