import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FileItem } from '@/lib/file-types';

const { OfficePreview } = await import('./office-preview');

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

// Microtask-only flush - safe under both real and fake timers (never touches
// setTimeout, unlike the setTimeout(0) flush used by the other component
// tests, which would hang forever once fake timers are active).
async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

function officeFile(over: Partial<FileItem> = {}): FileItem {
  return {
    id: 'f1',
    name: 'report.docx',
    size_bytes: 2048,
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
    region: 'weur',
    created_at: 1,
    updated_at: 1,
    current_version: 1,
    lock_mode: 'none',
    is_hidden: 0,
    uploaded_by: 'u1',
    uploader_name: 'User',
    share_count: 0,
    comment_count: 0,
    is_synced: 0,
    ...over,
  };
}

function stubBlobUrl() {
  const createObjectURL = vi.fn(() => 'blob:test');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  return { createObjectURL, revokeObjectURL };
}

async function mount(props: { file?: FileItem; version?: number; fallback?: unknown; compact?: boolean }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(OfficePreview, {
      file: props.file ?? officeFile(),
      version: props.version,
      fallback: props.fallback ?? createElement('div', { 'data-testid': 'fallback' }, 'Fallback card'),
      compact: props.compact,
    } as never));
    await flush();
  });
}

describe('OfficePreview - success path', () => {
  it('renders an iframe whose src starts with blob: once the PDF fetch resolves', async () => {
    stubBlobUrl();
    const pdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => pdfBlob });
    vi.stubGlobal('fetch', fetchMock);

    await mount({});

    const iframe = container!.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe!.getAttribute('src')).toMatch(/^blob:/);
    expect(container!.querySelector('[data-testid="fallback"]')).toBeFalsy();

    const [reqUrl, reqInit] = fetchMock.mock.calls[0];
    expect(String(reqUrl)).toContain('/api/files/f1/preview-pdf');
    expect(reqInit).toMatchObject({ credentials: 'include' });
  });

  it('appends ?version=N when a version prop is given', async () => {
    stubBlobUrl();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['x']) });
    vi.stubGlobal('fetch', fetchMock);

    await mount({ version: 3 });

    const [reqUrl] = fetchMock.mock.calls[0];
    expect(String(reqUrl)).toContain('/api/files/f1/preview-pdf?version=3');
  });
});

describe('OfficePreview - 503 conversion-in-flight retry', () => {
  it('shows "Preparing preview" then swaps in the iframe once the retry succeeds', async () => {
    vi.useFakeTimers();
    try {
      stubBlobUrl();
      const pdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: false, status: 503,
          headers: { get: (h: string) => (h === 'Retry-After' ? '3' : null) },
        })
        .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => pdfBlob });
      vi.stubGlobal('fetch', fetchMock);

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(createElement(OfficePreview, {
          file: officeFile(),
          fallback: createElement('div', { 'data-testid': 'fallback' }, 'Fallback card'),
        } as never));
        await flush();
      });

      expect(container.textContent).toContain('Preparing preview');
      expect(container.querySelector('iframe')).toBeFalsy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      const iframe = container.querySelector('iframe');
      expect(iframe).toBeTruthy();
      expect(iframe!.getAttribute('src')).toMatch(/^blob:/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the pending retry timer on unmount, leaving no dangling handle', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false, status: 503,
        headers: { get: (h: string) => (h === 'Retry-After' ? '3' : null) },
      });
      vi.stubGlobal('fetch', fetchMock);

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(createElement(OfficePreview, {
          file: officeFile(),
          fallback: createElement('div', null, 'Fallback card'),
        } as never));
        await flush();
      });

      expect(container.textContent).toContain('Preparing preview');
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      act(() => { root!.unmount(); });
      root = null;

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up and renders the fallback after exhausting all retries on repeated 503s', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false, status: 503,
        headers: { get: (h: string) => (h === 'Retry-After' ? '3' : null) },
      });
      vi.stubGlobal('fetch', fetchMock);

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(createElement(OfficePreview, {
          file: officeFile(),
          fallback: createElement('div', { 'data-testid': 'fallback' }, 'Fallback card'),
        } as never));
        await flush();
      });

      expect(container.textContent).toContain('Preparing preview');

      // MAX_RETRIES is 2, so the initial attempt plus two retries (each after
      // the 3s Retry-After delay) is enough time to exhaust every attempt.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });

      expect(container.querySelector('[data-testid="fallback"]')).toBeTruthy();
      expect(container.querySelector('iframe')).toBeFalsy();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OfficePreview - error paths', () => {
  it('renders the fallback node on a 502 conversion_failed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 502,
      json: async () => ({ ok: false, code: 'conversion_failed' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await mount({});

    expect(container!.querySelector('[data-testid="fallback"]')).toBeTruthy();
    expect(container!.querySelector('iframe')).toBeFalsy();
  });

  it('renders the fallback node on a 422 too_large response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 422,
      json: async () => ({ ok: false, code: 'too_large' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await mount({});

    expect(container!.querySelector('[data-testid="fallback"]')).toBeTruthy();
  });

  it('renders the fallback node on a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network disabled in test'));
    vi.stubGlobal('fetch', fetchMock);

    await mount({});

    expect(container!.querySelector('[data-testid="fallback"]')).toBeTruthy();
  });

  it('falls back when the decoded PDF blob exceeds the 20MB display cap', async () => {
    stubBlobUrl();
    // A real 21MB Blob works fine in jsdom, but constructing one from a
    // string literal here would bloat the test - a same-shaped stand-in
    // (only `.size` is read before the cap check) is cheaper and just as real.
    const oversizedBlob = { size: 21 * 1024 * 1024 } as Blob;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => oversizedBlob });
    vi.stubGlobal('fetch', fetchMock);

    await mount({});

    expect(container!.querySelector('[data-testid="fallback"]')).toBeTruthy();
    expect(container!.querySelector('iframe')).toBeFalsy();
  });
});

describe('OfficePreview - unmount cleanup', () => {
  it('revokes the blob object URL on unmount', async () => {
    const { revokeObjectURL } = stubBlobUrl();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['x']) });
    vi.stubGlobal('fetch', fetchMock);

    await mount({});
    expect(container!.querySelector('iframe')).toBeTruthy();

    act(() => { root!.unmount(); });
    root = null;

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});

describe('OfficePreview - stale-load replacement', () => {
  it('swaps to the new file\'s preview and revokes the stale object URL when the file changes on the same root', async () => {
    const objectUrls = ['blob:file-a', 'blob:file-b'];
    let urlIndex = 0;
    const createObjectURL = vi.fn(() => objectUrls[urlIndex++]);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const blobA = new Blob(['A']);
    const blobB = new Blob(['B']);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => blobA })
      .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => blobB });
    vi.stubGlobal('fetch', fetchMock);

    const fileA = officeFile({ id: 'file-a' });
    const fileB = officeFile({ id: 'file-b' });

    await mount({ file: fileA });

    let iframe = container!.querySelector('iframe');
    expect(iframe!.getAttribute('src')).toBe('blob:file-a#toolbar=1');

    // Rerender the SAME root with a different file - this is the
    // stale-load-replacement path: the effect's cleanup (keyed on
    // [file.id, version]) tears down file A's in-flight request before
    // file B's effect runs.
    await act(async () => {
      root!.render(createElement(OfficePreview, {
        file: fileB,
        fallback: createElement('div', { 'data-testid': 'fallback' }, 'Fallback card'),
      } as never));
      await flush();
    });

    iframe = container!.querySelector('iframe');
    expect(iframe!.getAttribute('src')).toBe('blob:file-b#toolbar=1');
    // File A's blob URL is revoked as part of the effect-cleanup-on-
    // dependency-change path, not just on final unmount.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:file-a');

    // File A's own AbortController is aborted at replacement time too, so a
    // late-arriving response for the stale request can't do anything.
    const [, fileARequestInit] = fetchMock.mock.calls[0];
    expect((fileARequestInit as { signal: AbortSignal }).signal.aborted).toBe(true);
  });
});

describe('OfficePreview - compact variant', () => {
  it('uses a chromeless #toolbar=0&navpanes=0 hash for the compact iframe', async () => {
    stubBlobUrl();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['x']) });
    vi.stubGlobal('fetch', fetchMock);

    await mount({ compact: true });

    const iframe = container!.querySelector('iframe');
    expect(iframe!.getAttribute('src')).toBe('blob:test#toolbar=0&navpanes=0');
    // The floating "Open in editor" action row is lightbox-only chrome - the
    // compact panel card already has its own always-visible editor button.
    expect(container!.textContent).not.toContain('Open in editor');
  });

  it('uses the full #toolbar=1 hash and shows the editor action row when not compact', async () => {
    stubBlobUrl();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['x']) });
    vi.stubGlobal('fetch', fetchMock);

    await mount({});

    const iframe = container!.querySelector('iframe');
    expect(iframe!.getAttribute('src')).toBe('blob:test#toolbar=1');
    expect(container!.textContent).toContain('Open in editor');
  });
});
