import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Mutable fixture the pdfjs mock closes over - tests tweak it per case.
const H = vi.hoisted(() => ({
  numPages: 5,
  // One entry per page; words become text items, so "hello beta" is two items.
  pageText: ['alpha one', 'hello beta', 'gamma', 'hello delta hello', 'omega'],
  destroy: vi.fn(),
  failWith: null as Error | null,
}));

vi.mock('pdfjs-dist', () => {
  const makePage = (n: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale, scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    getTextContent: async () => ({
      items: (H.pageText[n - 1] ?? '').split(' ').filter(Boolean).map((str) => ({ str })),
    }),
  });
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: vi.fn(() => {
      if (H.failWith) return { promise: Promise.reject(H.failWith), destroy: H.destroy };
      const doc = {
        numPages: H.numPages,
        getPage: async (n: number) => makePage(n),
        destroy: H.destroy,
      };
      return { promise: Promise.resolve(doc), destroy: H.destroy };
    }),
  };
});

// The worker file itself must never execute in tests - only its URL is used.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/fake-worker.mjs' }));

const { PdfViewer } = await import('./pdf-viewer');
const { getDocument } = await import('pdfjs-dist');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  H.numPages = 5;
  H.failWith = null;
  H.destroy.mockClear();
  vi.mocked(getDocument).mockClear();
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

async function mount(over: Partial<{ fileName: string; rawUrl: string; downloadUrl: string }> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(PdfViewer, {
      fileName: over.fileName ?? 'İnceleme.pdf',
      rawUrl: over.rawUrl ?? 'https://api.test/api/files/f1/raw?_t=1',
      downloadUrl: over.downloadUrl ?? 'https://api.test/api/files/f1/download',
    }));
    await flush();
  });
}

function pageInput(): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>('input[aria-label="Page number"]');
  expect(el).toBeTruthy();
  return el!;
}

function zoomLabel(): string {
  return container!.querySelector('[aria-label="Zoom level"]')!.textContent ?? '';
}

async function setPage(value: string) {
  const input = pageInput();
  await act(async () => {
    const proto = Object.getPrototypeOf(input) as { value?: unknown };
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
  });
}

describe('PdfViewer - document load', () => {
  it('shows the decoded file name and the page count once the document loads', async () => {
    await mount();
    expect(container!.textContent).toContain('İnceleme.pdf');
    expect(container!.textContent).toContain('/ 5');
    expect(pageInput().value).toBe('1');
  });

  it('passes the raw URL and withCredentials to pdf.js', async () => {
    await mount();
    expect(vi.mocked(getDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.test/api/files/f1/raw?_t=1', withCredentials: true }),
    );
  });

  it('renders an error card with a download link when the document fails to load', async () => {
    H.failWith = new Error('bad pdf');
    await mount();
    expect(container!.textContent).toContain('Could not display this PDF');
    const link = container!.querySelector<HTMLAnchorElement>('a[download]');
    expect(link?.getAttribute('href')).toBe('https://api.test/api/files/f1/download');
  });

  it('destroys the pdf.js loading task on unmount', async () => {
    await mount();
    act(() => { root!.unmount(); });
    root = null;
    expect(H.destroy).toHaveBeenCalled();
  });
});

describe('PdfViewer - page virtualization', () => {
  it('mounts canvases only near the current page, placeholders elsewhere', async () => {
    H.numPages = 9;
    await mount();
    expect(container!.querySelector('[data-page="1"] canvas')).toBeTruthy();
    expect(container!.querySelector('[data-page="3"] canvas')).toBeTruthy();
    expect(container!.querySelector('[data-page="9"]')).toBeTruthy();
    expect(container!.querySelector('[data-page="9"] canvas')).toBeFalsy();
  });

  it('moves the canvas window when jumping to a page via the page input', async () => {
    H.numPages = 9;
    await mount();
    await setPage('9');
    expect(pageInput().value).toBe('9');
    expect(container!.querySelector('[data-page="9"] canvas')).toBeTruthy();
    expect(container!.querySelector('[data-page="1"] canvas')).toBeFalsy();
  });

  it('clamps an out-of-range page number to the last page', async () => {
    await mount();
    await setPage('99');
    expect(pageInput().value).toBe('5');
  });
});

describe('PdfViewer - zoom', () => {
  it('starts at fit width and shows a numeric percentage', async () => {
    await mount();
    expect(zoomLabel()).toMatch(/^\d+%$/);
  });

  it('zoom in raises the percentage, zoom out lowers it back', async () => {
    await mount();
    const before = parseInt(zoomLabel(), 10);
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[title="Zoom in"]')!.click();
      await flush();
    });
    const raised = parseInt(zoomLabel(), 10);
    expect(raised).toBeGreaterThan(before);
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[title="Zoom out"]')!.click();
      await flush();
    });
    expect(parseInt(zoomLabel(), 10)).toBeLessThan(raised);
  });

  it('offers zoom presets and applies a fixed percentage', async () => {
    await mount();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[aria-label="Zoom options"]')!.click();
      await flush();
    });
    const preset = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === '150%');
    expect(preset).toBeTruthy();
    await act(async () => { preset!.click(); await flush(); });
    expect(zoomLabel()).toBe('150%');
  });
});

describe('PdfViewer - toolbar actions', () => {
  it('links the download button to the download URL', async () => {
    await mount();
    const link = container!.querySelector<HTMLAnchorElement>('a[title="Download"]');
    expect(link?.getAttribute('href')).toBe('https://api.test/api/files/f1/download');
  });

  it('print button invokes window.print', async () => {
    await mount();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[title="Print"]')!.click();
      await flush(40);
    });
    expect(print).toHaveBeenCalled();
  });
});

describe('PdfViewer - thumbnail sidebar', () => {
  it('is closed by default and opens with one thumbnail per page', async () => {
    await mount();
    expect(container!.querySelector('[data-testid="pdf-thumbs"]')).toBeFalsy();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[title="Toggle sidebar"]')!.click();
      await flush();
    });
    const rail = container!.querySelector('[data-testid="pdf-thumbs"]');
    expect(rail).toBeTruthy();
    expect(rail!.querySelectorAll('[data-thumb]').length).toBe(5);
  });

  it('clicking a thumbnail jumps to that page', async () => {
    await mount();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[title="Toggle sidebar"]')!.click();
      await flush();
    });
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-thumb="3"]')!.click();
      await flush();
    });
    expect(pageInput().value).toBe('3');
  });

  it('remembers the open state in localStorage', async () => {
    await mount();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[title="Toggle sidebar"]')!.click();
      await flush();
    });
    expect(localStorage.getItem('dosya:pdf-sidebar')).toBe('1');
    act(() => { root!.unmount(); });
    root = null;
    container!.remove();
    await mount();
    expect(container!.querySelector('[data-testid="pdf-thumbs"]')).toBeTruthy();
  });
});

describe('PdfViewer - search', () => {
  async function openFind(query: string) {
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[title="Search"]')!.click();
      await flush();
    });
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="Find in document"]')!;
    expect(input).toBeTruthy();
    await act(async () => {
      const proto = Object.getPrototypeOf(input) as { value?: unknown };
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, query);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flush(60);
    });
    return input;
  }

  it('counts matches across all pages', async () => {
    await mount();
    await openFind('hello');
    expect(container!.textContent).toContain('1/3');
  });

  it('jumps to the first matching page and cycles with Enter', async () => {
    await mount();
    await openFind('hello');
    expect(pageInput().value).toBe('2');
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="Find in document"]')!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });
    expect(container!.textContent).toContain('2/3');
    expect(pageInput().value).toBe('4');
  });

  it('shows no-results feedback for a query with no matches', async () => {
    await mount();
    await openFind('zzz-not-here');
    expect(container!.textContent).toContain('No results');
  });
});
