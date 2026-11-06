import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FileItem } from '@/lib/file-types';

// The decoder is the heavy part and only loads after Open. Mock it so the test
// can also prove it is NOT loaded before the click.
const renderPreview = vi.fn();
vi.mock('@/lib/client-decode.generated', () => ({ renderPreview: (...args: unknown[]) => renderPreview(...args) }));

const { DecodedPreview } = await import('./decoded-preview');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  renderPreview.mockReset();
  vi.unstubAllGlobals();
});

function file(over: Partial<FileItem> = {}): FileItem {
  return { id: 'f1', name: 'scan.tiff', size_bytes: 4096, mime_type: 'image/tiff', ...over } as FileItem;
}

function mount(f: FileItem) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(DecodedPreview, { file: f, rawUrl: '/raw/f1', downloadUrl: '/dl/f1' })));
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

describe('DecodedPreview', () => {
  it('shows a card with Open and Download, and fetches nothing until Open', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mount(file());
    const buttons = [...container!.querySelectorAll('button, a')].map((b) => b.textContent?.trim());
    expect(buttons).toHaveLength(2);
    expect(container!.querySelector('a[download]')?.getAttribute('href')).toBe('/dl/f1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(renderPreview).not.toHaveBeenCalled();
  });

  it('downloads with progress, decodes, and shows the image', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-length': '4' } })));
    renderPreview.mockResolvedValue({ blob: new Blob(['x'], { type: 'image/webp' }), page: 0, pageCount: 1 });
    mount(file());
    act(() => container!.querySelector('button')!.click());
    await flush();
    expect(renderPreview).toHaveBeenCalledWith('scan.tiff', new Uint8Array([1, 2, 3, 4]), { page: 0 });
    expect(container!.querySelector('[data-testid="decoded-preview-pager"]')).toBeNull();
    const img = container!.querySelector('[data-testid="decoded-preview-image"]');
    expect(img?.getAttribute('src')).toBe('blob:preview');
  });

  it('says it could not preview, and offers to try again, when decoding fails', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))));
    renderPreview.mockRejectedValue(new Error('damaged'));
    mount(file());
    act(() => container!.querySelector('button')!.click());
    await flush();
    expect(container!.querySelector('[data-testid="decoded-preview-image"]')).toBeNull();
    expect(container!.querySelector('.text-destructive')).not.toBeNull();
    expect(container!.querySelector('button')).not.toBeNull();
  });

  it('turns the pages of a multi-page scan without downloading it again', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([9])));
    vi.stubGlobal('fetch', fetchSpy);
    renderPreview.mockImplementation(async (_n: string, _b: Uint8Array, opts: { page: number }) => ({
      blob: new Blob([String(opts.page)]),
      page: opts.page,
      pageCount: 3,
    }));
    mount(file());
    act(() => container!.querySelector('button')!.click());
    await flush();
    const pager = () => container!.querySelector('[data-testid="decoded-preview-pager"]')!;
    const [prev, next] = [...pager().querySelectorAll('button')];
    expect(prev!.disabled).toBe(true);
    act(() => next!.click());
    await flush();
    expect(renderPreview).toHaveBeenLastCalledWith('scan.tiff', new Uint8Array([9]), { page: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(pager().querySelectorAll('button')[0]!.disabled).toBe(false);
  });

  it('offers only the download for a file over the size cap', () => {
    mount(file({ size_bytes: 300 * 1024 * 1024 }));
    expect(container!.querySelector('button')).toBeNull();
    expect(container!.querySelector('a[download]')).not.toBeNull();
  });
});
