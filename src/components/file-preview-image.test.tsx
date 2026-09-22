import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/api/client', async (importOriginal) => ({
  // shouldRetryQuery does `error instanceof ApiError` on every retry, and a retry
  // can outlive the test that started it - a mock without it throws and fails the run.
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  API_BASE: 'https://api.example.com',
}));
// The browser-side WASM decode is only reachable through the HEIC branch and
// spawns workers; this suite is about which URL the <img> points at.
vi.mock('@/lib/heic', () => ({ getHeicPreviewUrl: vi.fn(() => new Promise(() => {})) }));

const { FilePreviewImage } = await import('./file-preview-image');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom ships no IntersectionObserver; the HEIC placeholder mounts one to
  // decide when to decode. Never firing is the state under test here (the
  // placeholder), so a no-op is the right stub.
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});

describe('FilePreviewImage', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null; container = null;
  });

  function render(node: React.ReactElement) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root!.render(node); });
    return container;
  }

  const img = (c: HTMLElement) => c.querySelector('img') as HTMLImageElement | null;

  it('asks for a thumbnail at the requested size, not the full original', () => {
    // Regression: this used to point straight at /raw and ignore `size`, so a
    // 28px table row and a photo-grid tile both downloaded the whole original.
    const c = render(<FilePreviewImage fileId="f1" fileName="beach.jpg" size={128} fallback={<span>icon</span>} />);
    const src = img(c)!.src;
    expect(src).toContain('https://api.example.com/api/files/f1/thumb');
    expect(src).toContain('w=128');
    expect(src).not.toContain('/raw');
  });

  it('carries version and extra query params through to /thumb', () => {
    const c = render(
      <FilePreviewImage fileId="f1" fileName="beach.jpg" version={3} query="ut=tok123" size={512} fallback={<span>icon</span>} />,
    );
    const src = img(c)!.src;
    expect(src).toContain('version=3');
    expect(src).toContain('ut=tok123');
    expect(src).toContain('w=512');
  });

  it('falls back to the raw original when the thumbnail fails to load', () => {
    const c = render(<FilePreviewImage fileId="f1" fileName="beach.jpg" size={256} fallback={<span>icon</span>} />);
    expect(img(c)!.src).toContain('/thumb');
    act(() => { img(c)!.dispatchEvent(new Event('error')); });
    expect(img(c)!.src).toBe('https://api.example.com/api/files/f1/raw');
  });

  it('shows the fallback only after the raw original fails too', () => {
    const c = render(<FilePreviewImage fileId="f1" fileName="beach.jpg" size={256} fallback={<span>icon</span>} />);
    act(() => { img(c)!.dispatchEvent(new Event('error')); });
    expect(c.textContent).not.toContain('icon');
    act(() => { img(c)!.dispatchEvent(new Event('error')); });
    expect(img(c)).toBeNull();
    expect(c.textContent).toContain('icon');
  });

  it('leaves the HEIC path on /thumb, then hands off to the browser decoder', () => {
    const c = render(<FilePreviewImage fileId="f2" fileName="IMG_0001.heic" size={256} fallback={<span>icon</span>} />);
    expect(img(c)!.src).toContain('/api/files/f2/thumb');
    // A failed HEIC thumbnail means "the Worker could not decode it", so it
    // must NOT degrade to /raw (browsers cannot render HEIC) - it goes to the
    // WASM decoder, which renders a placeholder while it works.
    act(() => { img(c)!.dispatchEvent(new Event('error')); });
    expect(img(c)).toBeNull();
    expect(c.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders the fallback for a non-image', () => {
    const c = render(<FilePreviewImage fileId="f3" fileName="notes.txt" fallback={<span>icon</span>} />);
    expect(img(c)).toBeNull();
    expect(c.textContent).toContain('icon');
  });
});
