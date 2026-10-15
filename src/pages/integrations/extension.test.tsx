import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { EXTENSION_STORES, getStore } from '@/lib/browser-extension';

const { default: ExtensionSetup } = await import('./extension');

const UA = {
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
};

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

async function render(ua: string) {
  vi.stubGlobal('navigator', { ...navigator, userAgent: ua });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><ExtensionSetup /></MemoryRouter>);
  });
  return container!.textContent ?? '';
}

const hrefs = () => [...container!.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');

describe('ExtensionSetup', () => {
  it('offers the Chrome listing to Chrome, because it is live', async () => {
    const text = await render(UA.chrome);
    expect(text).toContain('Add it to Chrome');
    expect(hrefs()).toContain(getStore('chrome').listingUrl);
  });

  it('offers the Firefox listing to Firefox, because it is live', async () => {
    const text = await render(UA.firefox);
    expect(text).toContain('Add it to Firefox');
    expect(hrefs()).toContain(getStore('firefox').listingUrl);
  });

  it('offers the Edge listing to Edge, because it is live', async () => {
    const text = await render(UA.edge);
    expect(text).toContain('Add it to Edge');
    expect(hrefs()).toContain(getStore('edge').listingUrl);
  });

  it('offers the Safari listing enabled in the marketing catalog', async () => {
    const text = await render(UA.safari);
    expect(text).toContain('Add it to Safari');
    expect(hrefs()).toContain(getStore('safari').listingUrl);
  });

  /**
   * The rule the whole page is built around: a listing still in review
   * answers its own URL with a 404. A pending fixture keeps this safeguard
   * exercised after all actual stores become available.
   */
  it('never links a listing that is still in review', async () => {
    const safari = getStore('safari');
    const published = safari.published;
    safari.published = false;
    try {
      const text = await render(UA.safari);
      const links = hrefs();
      for (const store of EXTENSION_STORES.filter((s) => !s.published)) {
        expect(links, `${store.slug} linked while unpublished`).not.toContain(store.listingUrl);
      }
      // Still gives them a route that works.
      expect(links).toContain(getStore('chrome').listingUrl);
      expect(text).toContain('waiting on review');

    } finally {
      safari.published = published;
    }
  });

  it('names an unpublished browser rather than pretending it does not exist', async () => {
    const safari = getStore('safari');
    const published = safari.published;
    safari.published = false;
    try {
      const text = await render(UA.chrome);
      expect(text).toContain('Safari (in review)');
      expect(hrefs()).not.toContain(safari.listingUrl);
    } finally {
      safari.published = published;
    }
  });

  it('tells an Edge user it is Edge, not Chrome', async () => {
    const text = await render(UA.edge);
    expect(text).toContain('Add it to Edge');
    expect(text).not.toContain('Add it to Chrome');
  });

  it('describes what the extension actually captures', async () => {
    const text = await render(UA.chrome);
    expect(text).toContain('Save image');
    expect(text).toContain('Save selection as text');
    expect(text).toContain('Save visible screenshot');
  });

  it('opens every store link in a new tab without leaking the referrer', async () => {
    await render(UA.chrome);
    for (const a of container!.querySelectorAll('a[href^="http"]')) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noreferrer');
    }
  });
});
