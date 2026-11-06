import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('FileDetailPanel - text preview fetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the session cookie (credentials: include) on the raw-content fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '<h1>hi</h1>' });
    vi.stubGlobal('fetch', fetchMock);

    await renderPanel(testFile({ name: 'page.html', mime_type: 'text/plain', extension: 'html' }));

    const rawCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/files/f1/raw'));
    expect(rawCall, 'expected a fetch of the /raw endpoint').toBeDefined();
    expect(rawCall![1]).toMatchObject({ credentials: 'include' });
  });
});

// The panel used to render Download, Share, Copy and Delete to every role and
// let the server answer with a 403. Each is now passed only when the role can
// perform it, and the panel hides the button when the callback is absent -
// the same contract the viewer overlay already has.
describe('FileDetailPanel - action buttons follow the callbacks', () => {
  const buttonLabels = () => [...document.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');

  async function renderWith(callbacks: Record<string, (() => void) | undefined>) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(FileDetailPanel, {
        file: testFile(), onClose: noop, onView: noop, onRefresh: noop, ...callbacks,
      }));
      await flush();
    });
  }

  it('hides Download, Share, Copy and Delete when their callbacks are absent', async () => {
    await renderWith({});
    const labels = buttonLabels();
    expect(labels).toContain('View file');
    expect(labels).not.toContain('Download');
    expect(labels).not.toContain('Share');
    expect(labels).not.toContain('Copy file');
    expect(labels).not.toContain('Delete file');
  });

  it('shows exactly the actions whose callbacks are present', async () => {
    await renderWith({ onDownload: noop, onDelete: noop });
    const labels = buttonLabels();
    expect(labels).toContain('Download');
    expect(labels).toContain('Delete file');
    expect(labels).not.toContain('Share');
    expect(labels).not.toContain('Copy file');
  });
});

// The panel's video preview is the shared dosya player in compact mode, not
// the browser's native <video controls>. jsdom has no media pipeline: the
// same stubs as file-viewer.test.tsx let Video.js mount.
describe('FileDetailPanel - video preview', () => {
  const mediaProps = ['play', 'pause', 'load', 'canPlayType'] as const;
  let saved: Partial<Record<(typeof mediaProps)[number], PropertyDescriptor | undefined>> = {};
  let hadMatchMedia = true;

  beforeEach(() => {
    saved = {};
    for (const k of mediaProps) saved[k] = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, k);
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, writable: true, value: vi.fn(() => Promise.resolve()) });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, writable: true, value: vi.fn() });
    Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, writable: true, value: vi.fn() });
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
  });
  afterEach(() => {
    for (const k of mediaProps) {
      const d = saved[k];
      if (d) Object.defineProperty(HTMLMediaElement.prototype, k, d);
      else delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>)[k];
    }
    if (!hadMatchMedia) delete (window as unknown as Record<string, unknown>).matchMedia;
  });

  const video = () => testFile({ name: 'clip.mp4', mime_type: 'video/mp4', extension: 'mp4' });

  it('renders the compact dosya player with metadata preload, not native controls', async () => {
    await renderPanel(video());
    const player = container!.querySelector('.dp.dp-compact');
    expect(player, 'expected the compact player').not.toBeNull();
    expect(container!.querySelector('video[controls]')).toBeNull();
    const v = player!.querySelector('video')!;
    expect(v.getAttribute('src')).toContain('/api/files/f1/raw');
    expect(v.getAttribute('preload')).toBe('metadata');
    expect(player!.querySelector('.dp-report-btn, .dp-keys-btn')).toBeNull();
  });

  it('leaves Space to the page while focus is outside the player', async () => {
    await renderPanel(video());
    const e = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('a playback failure swaps in the panel icon fallback', async () => {
    await renderPanel(video());
    await act(async () => { container!.querySelector('video')!.dispatchEvent(new Event('error')); await flush(); });
    expect(container!.querySelector('.dp')).toBeNull();
    expect(container!.querySelector('img[alt="MP4"]')).not.toBeNull();
  });
});
