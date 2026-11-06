import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// FileViewer loads the version list through api() on mount. Stub only `api`,
// keep API_BASE real - the raw-content fetch under test builds its URL off it.
const apiMock = vi.fn().mockRejectedValue(new Error('network disabled in test'));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

// Comments are fetched at viewer level; keep every case offline.
vi.mock('@/components/comments/api', () => ({
  listComments: vi.fn().mockResolvedValue([]), postComment: vi.fn(), deleteComment: vi.fn(),
  editComment: vi.fn(), searchMentionable: vi.fn().mockResolvedValue([]),
}));

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

vi.mock('@/lib/personas-device/engine-host', () => import('@/lib/personas-device/__fixtures__/fake-host'));
const { fakeHost } = await import('@/lib/personas-device/__fixtures__/fake-host');
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode(body).buffer });
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

// ── Text decoding + open-as-text flows ────────────────────────────

function txtFile() {
  return {
    id: 'f1', name: 'notes.txt', size_bytes: 512, mime_type: 'text/plain',
    extension: 'txt', region: 'weur', created_at: 1, updated_at: 1,
    current_version: 1, lock_mode: 'none', is_hidden: 0, uploaded_by: 'u1',
    uploader_name: 'User', share_count: 0, comment_count: 0, is_synced: 0,
  };
}

function binFile() {
  return { ...txtFile(), name: 'data.bin', mime_type: 'application/octet-stream', extension: 'bin' };
}

function bytesResponse(buf: ArrayBuffer) {
  return { ok: true, arrayBuffer: async () => buf };
}

/** UTF-16LE bytes with BOM, the encoding Windows Notepad's "Unicode" writes. */
function utf16leBytes(s: string): ArrayBuffer {
  const buf = new Uint8Array(2 + s.length * 2);
  buf[0] = 0xff; buf[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    buf[2 + i * 2] = c & 0xff;
    buf[3 + i * 2] = c >> 8;
  }
  return buf.buffer;
}

async function mountFile(file: ReturnType<typeof txtFile>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
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

function findButton(label: string) {
  return [...container!.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.includes(label)) ?? null;
}

describe('TextViewer decoding of the raw body', () => {
  it('renders a UTF-16LE (BOM) text file instead of calling it binary', async () => {
    // Padded over HIGHLIGHT_MAX so the highlighter (real shiki) never loads.
    const body = 'merhaba dünya\n' + 'x'.repeat(310_000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bytesResponse(utf16leBytes(body))));
    await mountFile(txtFile());
    expect(container!.textContent).toContain('merhaba dünya');
    expect(findButton('Open as text')).toBeFalsy();
  });
});

describe('TextViewer binary-content accept flow', () => {
  it('shows a warning card with an Open as text button instead of the content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      bytesResponse(new TextEncoder().encode('ab\0cd').buffer as ArrayBuffer)));
    await mountFile(txtFile());
    expect(container!.textContent).toContain("doesn't look like text");
    expect(findButton('Open as text'), 'expected an Open as text button on the warning card').toBeTruthy();
    expect(container!.textContent).not.toContain('abcd');
  });

  it('renders the content with NUL bytes stripped once the user accepts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      bytesResponse(new TextEncoder().encode('ab\0cd').buffer as ArrayBuffer)));
    await mountFile(txtFile());
    await click(findButton('Open as text'));
    expect(container!.textContent).toContain('abcd');
  });
});

describe('FileViewer unknown-type fallback', () => {
  it('offers Open as text on the unsupported-type card without fetching up front', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      bytesResponse(new TextEncoder().encode('plain payload').buffer as ArrayBuffer));
    vi.stubGlobal('fetch', fetchMock);
    await mountFile(binFile());
    expect(findButton('Open as text'), 'expected an Open as text button on the fallback card').toBeTruthy();
    expect(fetchMock.mock.calls.find(([u]) => String(u).includes('/raw'))).toBeUndefined();
  });

  it('loads and shows the file as text once the user accepts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      bytesResponse(new TextEncoder().encode('plain payload').buffer as ArrayBuffer));
    vi.stubGlobal('fetch', fetchMock);
    await mountFile(binFile());
    await click(findButton('Open as text'));
    expect(container!.textContent).toContain('plain payload');
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

  it('shows "In this photo" chips from this device\'s Personas, and nothing while Personas is off', async () => {
    fakeHost.reset();
    fakeHost.engine.faces.set('f1', [{ persona_id: 'p1', name: 'Emma', face_id: 'fa', box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]);
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    await mountViewer();
    const inspector = container!.querySelector('[data-testid="viewer-inspector"]')!;
    expect(inspector.textContent).toContain('In this photo');
    expect(inspector.querySelector('a[href="/personas/p1"]')!.textContent).toContain('Emma');
    expect(apiMock.mock.calls.filter(([p]) => /personas|\/people/.test(String(p)))).toEqual([]);
    act(() => root!.unmount());
    container!.remove();
    root = null;

    fakeHost.reset({ state: 'off' });
    fakeHost.engine.faces.set('f1', [{ persona_id: 'p1', name: 'Emma', face_id: 'fa', box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]);
    await mountViewer();
    expect(container!.querySelector('[data-testid="viewer-inspector"]')!.textContent).not.toContain('In this photo');
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

describe('FileViewer stage surface', () => {
  it('audio keeps the theme surface - its player is theme-token styled, not stage-dark', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    const file = { ...imageFile(), name: 'track.mp3', mime_type: 'audio/mpeg', extension: 'mp3' };
    await mountViewer({ file });
    const stage = container!.querySelector<HTMLElement>('[data-testid="viewer-stage"]');
    expect(stage, 'expected the stage element').toBeTruthy();
    expect(stage!.className).toContain('bg-background');
    expect(stage!.className).not.toContain('oklch(0.135');
  });

  it('images sit on the closed dark stage in every theme', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    await mountViewer();
    const stage = container!.querySelector<HTMLElement>('[data-testid="viewer-stage"]');
    expect(stage, 'expected the stage element').toBeTruthy();
    expect(stage!.className).toContain('oklch(0.135');
  });
});

describe('FileViewer edit entry points', () => {
  it('office files get a labeled Edit control in the header linking to the editor', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    const file = { ...imageFile(), name: 'report.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' };
    await mountViewer({ file });
    const edit = [...container!.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.trim() === 'Edit');
    expect(edit, 'expected a header Edit link for office files').toBeTruthy();
    expect(edit!.getAttribute('href')).toBe('/editor/f1');
  });

  it('images keep the Edit button that opens the media editor', async () => {
    apiMock.mockImplementation(() => Promise.resolve(versionRows()));
    await mountViewer();
    const edit = [...container!.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.trim() === 'Edit');
    expect(edit, 'expected the header Edit button for images').toBeTruthy();
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

describe('Comments tab', () => {
  it('initialTab comments selects the tab and the label shows the count', async () => {
    const { listComments } = await import('@/components/comments/api');
    (listComments as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'c1', file_id: 'f1', folder_id: null, workspace_id: 'w1', user_id: 'u1', parent_id: null, body: 'hi', is_edited: 0,
        created_at: 1, updated_at: 1, user_name: 'U', user_email: 'u@x', user_avatar: null, anchor_ms: null, anchor_page: null,
        anchor_version: null, mention_user_ids: null, mentions: [] },
    ]);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const file = txtFile();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer }));
    await act(async () => {
      root!.render(createElement(FileViewer, {
        file: file as never, files: [file] as never, workspaceId: 'w1',
        onClose: () => {}, onNavigate: () => {}, onRefresh: () => {}, initialTab: 'comments',
      }));
      await flush();
    });
    const sel = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(sel?.textContent).toContain('Comments');
    expect(sel?.textContent).toContain('1');
  });
});

describe('Comments tab layout and navigation', () => {
  it('renders the panel (not the empty versions message) when versions are empty', async () => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    const file = txtFile();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer }));
    await act(async () => {
      root!.render(createElement(FileViewer, {
        file: file as never, files: [file] as never, workspaceId: 'w1',
        onClose: () => {}, onNavigate: () => {}, onRefresh: () => {}, initialTab: 'comments',
      }));
      await flush();
    });
    const insp = container.querySelector('[data-testid="viewer-inspector"]')!;
    expect(insp.querySelector('textarea')).not.toBeNull();
    expect(insp.textContent).not.toContain('No version history');
    // The panel fills the body (flex column), it is not inside an overflow scroller.
    expect(insp.querySelector('.overflow-y-auto.px-4.py-4')).toBeNull();
  });

  it('navigating to another file drops the previous file comments and pending anchor', async () => {
    const { listComments } = await import('@/components/comments/api');
    (listComments as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => id === 'f1' ? [
      { id: 'c1', file_id: 'f1', folder_id: null, workspace_id: 'w1', user_id: 'u1', parent_id: null, body: 'only on A', is_edited: 0,
        created_at: 1, updated_at: 1, user_name: 'U', user_email: 'u@x', user_avatar: null, anchor_ms: null, anchor_page: null,
        anchor_version: null, mention_user_ids: null, mentions: [] }] : []);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer }));
    const a = txtFile(); const b = { ...txtFile(), id: 'f2', name: 'b.txt' };
    const render = (file: ReturnType<typeof txtFile>) => createElement(FileViewer, {
      file: file as never, files: [a, b] as never, workspaceId: 'w1', onClose: () => {}, onNavigate: () => {},
      onRefresh: () => {}, initialTab: 'comments', initialAnchor: { ms: 5000 }, initialCommentId: 'c1',
    });
    await act(async () => { root!.render(render(a)); await flush(); });
    expect(container.textContent).toContain('only on A');
    await act(async () => { root!.render(render(b)); await flush(); });
    expect(container.textContent).not.toContain('only on A');
    expect(container.querySelector('.ring-2')).toBeNull();
  });
});

// ── Video (Video.js player) ───────────────────────────────────────

/**
 * jsdom has no media pipeline. Same stubs as audio-player.test.tsx, plus
 * canPlayType so Video.js believes the Html5 tech can play the source.
 */
const mediaProps = ['play', 'pause', 'load', 'canPlayType'] as const;
let savedMedia: Partial<Record<(typeof mediaProps)[number], PropertyDescriptor | undefined>> = {};
let loadSpy: ReturnType<typeof vi.fn>;
let hadMatchMedia = true;

function stubMedia() {
  savedMedia = {};
  for (const k of mediaProps) savedMedia[k] = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, k);
  loadSpy = vi.fn();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, writable: true, value: vi.fn(() => Promise.resolve()) });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, writable: true, value: vi.fn() });
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, writable: true, value: loadSpy });
  Object.defineProperty(HTMLMediaElement.prototype, 'canPlayType', { configurable: true, writable: true, value: () => 'maybe' });
  hadMatchMedia = typeof window.matchMedia === 'function';
  if (!hadMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true, writable: true,
      value: (query: string) => ({
        matches: false, media: query, onchange: null, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
      }),
    });
  }
}

function restoreMedia() {
  for (const k of mediaProps) {
    const d = savedMedia[k];
    if (d) Object.defineProperty(HTMLMediaElement.prototype, k, d);
    else delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>)[k];
  }
  if (!hadMatchMedia) delete (window as unknown as Record<string, unknown>).matchMedia;
}

function videoFile(overrides: Record<string, unknown> = {}) {
  return { ...htmlFile(), name: 'clip.mp4', mime_type: 'video/mp4', extension: 'mp4', ...overrides };
}

function commentAt(ms: number, body: string) {
  return { id: 'c1', file_id: 'f1', folder_id: null, workspace_id: 'w1', user_id: 'u1', parent_id: null, body, is_edited: 0,
    created_at: 1, updated_at: 1, user_name: 'U', user_email: 'u@x', user_avatar: null, anchor_ms: ms, anchor_page: null,
    anchor_version: 1, mention_user_ids: null, mentions: [] };
}

async function mountVideoViewer(file: ReturnType<typeof videoFile>) {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  const el = () => createElement(FileViewer, {
    file: file as never, files: [file] as never, workspaceId: 'w1',
    onClose: () => {}, onNavigate: () => {}, onRefresh: () => {},
  });
  await act(async () => { root!.render(el()); await flush(); });
  return { rerender: async () => { await act(async () => { root!.render(el()); await flush(); }); } };
}

/** Give the <video> a duration and fire loadedmetadata, as a real decode would. */
async function loadMetadata(video: HTMLVideoElement, seconds = 100) {
  Object.defineProperty(video, 'duration', { configurable: true, value: seconds });
  await act(async () => { video.dispatchEvent(new Event('loadedmetadata')); await flush(); });
}

describe('Video player in the file viewer', () => {
  beforeEach(stubMedia);
  afterEach(restoreMedia);

  it('keeps the same video element across re-renders and after versions arrive', async () => {
    // Versions land a tick after mount, which changes stableRawUrl's cache
    // token. The old player was keyed on the url and remounted right there.
    apiMock.mockImplementation((path: string) => new Promise((resolve) => {
      setTimeout(() => resolve(String(path).endsWith('/versions') ? versionRows() : { ok: true }), 5);
    }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
    const srcSets: string[] = [];
    const realSetAttribute = Element.prototype.setAttribute;
    const setAttr = vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (this: Element, name: string, value: string) {
      if (this instanceof HTMLMediaElement && name === 'src') srcSets.push(value);
      return realSetAttribute.call(this, name, value);
    });
    try {
      const { rerender } = await mountVideoViewer(videoFile({ current_version: 2 }));
      const video = container!.querySelector('video');
      expect(video, 'expected the player to render a <video>').not.toBeNull();
      const src = video!.getAttribute('src');
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); await flush(); });
      expect(apiMock.mock.calls.some(([p]) => String(p).endsWith('/versions'))).toBe(true);
      await rerender();
      expect(container!.querySelector('video')).toBe(video);
      expect(video!.isConnected).toBe(true);
      expect(video!.getAttribute('src')).toBe(src);
      expect(srcSets).toHaveLength(1);
      expect(loadSpy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      setAttr.mockRestore();
    }
  });

  it('decode failure shows download and unregisters the anchor target', async () => {
    const { VideoPlayer } = await import('./video/video-player');
    const { AnchorProvider, useAnchorTarget } = await import('@/components/comments/anchor-context');
    function Probe() {
      const t = useAnchorTarget();
      return createElement('span', { 'data-testid': 'probe', 'data-target': t ? t.kind : 'none' });
    }
    const file = videoFile();
    const downloadUrl = 'https://api.example.test/api/files/f1/download';
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => {
      root!.render(createElement(AnchorProvider, {
        markers: [], pending: null, onPendingApplied: () => {}, onSelectComment: () => {},
        children: [
          createElement(VideoPlayer, { key: 'v', file: file as never, stableRawUrl: 'https://api.example.test/api/files/f1/raw?_t=1', downloadUrl }),
          createElement(Probe, { key: 'p' }),
        ],
      }));
      await flush();
    });
    const probe = () => container!.querySelector('[data-testid="probe"]')!.getAttribute('data-target');
    const video = container.querySelector('video')!;
    expect(probe()).toBe('none');
    await loadMetadata(video);
    expect(probe()).toBe('time');
    expect(container.querySelector('.dp-download')).toBeNull();
    await act(async () => { video.dispatchEvent(new Event('error')); await flush(); });
    expect(container.querySelector(`.dp-download[href="${downloadUrl}"]`)).not.toBeNull();
    expect(container.textContent).toContain("This browser can't decode this video. Download it and open it in a player like VLC, which decodes everything.");
    expect(probe()).toBe('none');
  });

  it('a version switch drops the anchor target until the new player reports a duration', async () => {
    const { VideoPlayer } = await import('./video/video-player');
    const { AnchorProvider, useAnchorTarget } = await import('@/components/comments/anchor-context');
    function Probe() {
      const t = useAnchorTarget();
      return createElement('span', { 'data-testid': 'probe', 'data-target': t ? t.kind : 'none' });
    }
    const file = videoFile({ current_version: 2 });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    const render = (version: number) => act(async () => {
      root!.render(createElement(AnchorProvider, {
        markers: [], pending: null, onPendingApplied: () => {}, onSelectComment: () => {},
        children: [
          createElement(VideoPlayer, { key: 'v', file: file as never, version, stableRawUrl: `https://api.example.test/api/files/f1/raw?v=${version}`, downloadUrl: 'https://api.example.test/dl' }),
          createElement(Probe, { key: 'p' }),
        ],
      }));
      await flush();
    });
    const probe = () => container!.querySelector('[data-testid="probe"]')!.getAttribute('data-target');
    await render(2);
    const first = container.querySelector('video')!;
    await loadMetadata(first);
    expect(probe()).toBe('time');
    await render(1);
    const second = container.querySelector('video')!;
    expect(second).not.toBe(first);
    expect(probe()).toBe('none');
    await loadMetadata(second);
    expect(probe()).toBe('time');
  });

  it('sends a playback report to the signed-in route and shows the API error when it fails', async () => {
    const { VideoPlayer } = await import('./video/video-player');
    const { ApiError } = await import('@/api/client');
    apiMock.mockImplementation(() => Promise.resolve({ ok: true, reference: 'R-1' }));
    const file = videoFile();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => {
      root!.render(createElement(VideoPlayer, { file: file as never, stableRawUrl: 'https://api.example.test/raw', downloadUrl: 'https://api.example.test/dl' }));
      await flush();
    });
    const q = <T extends HTMLElement = HTMLElement>(s: string) => container!.querySelector<T>(s);
    const send = async (details: string) => {
      await click(q('.dp-report-btn'));
      await click(q('button.dp-opt[data-reason="playback"]'));
      const box = q<HTMLTextAreaElement>('[data-step="playback"] textarea[name="details"]')!;
      box.value = details; box.dispatchEvent(new Event('input', { bubbles: true }));
      await click(q('[data-step="playback"] .dp-send'));
    };
    expect(container.querySelectorAll('button.dp-opt').length).toBe(1);
    await send('stutters');
    const call = apiMock.mock.calls.find(([p]) => String(p) === '/api/files/f1/report');
    expect(call, 'expected a POST to the report route').toBeDefined();
    expect(call![1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({ reason: 'playback', details: 'stutters' });
    expect(q('[data-step="done"]')!.hidden).toBe(false);

    apiMock.mockImplementation(() => Promise.reject(new ApiError(429, JSON.stringify({ ok: false, error: 'Too many reports' }))));
    // The done step closes the popover; the next press reopens it on a clean pick.
    if (!q('.dp-report-anchor.dp-open')) await click(q('.dp-report-btn'));
    await click(q('button.dp-opt[data-reason="playback"]'));
    await click(q('[data-step="playback"] .dp-send'));
    expect(q('.dp-error')?.textContent).toContain('Too many reports');
  });
});

describe('Video comment markers', () => {
  beforeEach(stubMedia);
  afterEach(restoreMedia);

  it('draws a .dp-marker per timestamped comment, positioned from anchor_ms / duration, and a click seeks and selects', async () => {
    const { listComments } = await import('@/components/comments/api');
    (listComments as ReturnType<typeof vi.fn>).mockImplementation(async () => [commentAt(25_000, 'at twenty five')]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
    await mountVideoViewer(videoFile());
    const video = container!.querySelector('video')!;
    expect(video).not.toBeNull();
    expect(container!.querySelector('.dp-marker')).toBeNull();
    await loadMetadata(video);
    const dot = container!.querySelector<HTMLButtonElement>('.dp-marker[data-id="c1"]');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute('aria-label')).toBe('Comment: at twenty five');
    expect(dot!.style.left).toBe('25%');
    expect(container!.querySelector('[data-testid="viewer-inspector"]')?.textContent ?? '').not.toContain('at twenty five');
    await click(dot);
    expect(video.currentTime).toBe(25);
    // selectComment opened the comments panel on that comment.
    expect(container!.querySelector('[data-testid="viewer-inspector"]')?.textContent).toContain('at twenty five');
  });

  it('clicking a marker left on an older version says so, once, like the panel chip', async () => {
    const { toast } = await import('@/lib/toast');
    const info = vi.spyOn(toast, 'info').mockImplementation(() => {});
    const { listComments } = await import('@/components/comments/api');
    (listComments as ReturnType<typeof vi.fn>).mockImplementation(async () => [commentAt(25_000, 'old take')]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
    await mountVideoViewer(videoFile({ current_version: 2 }));
    const video = container!.querySelector('video')!;
    await loadMetadata(video);
    await click(container!.querySelector<HTMLButtonElement>('.dp-marker[data-id="c1"]'));
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('Comment was left on v1');
    // The panel opened on the comment; its chip seeks through the anchor
    // target and goes through the same note.
    info.mockClear();
    const video2 = container!.querySelector('video')!;
    if (video2 !== video) await loadMetadata(video2);
    const chip = [...container!.querySelectorAll<HTMLButtonElement>('[data-testid="viewer-inspector"] button')]
      .find((b) => b.textContent?.includes('0:25'))!;
    await click(chip);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('Comment was left on v1');
    expect(video2.currentTime).toBe(25);
    info.mockRestore();
  });
});
