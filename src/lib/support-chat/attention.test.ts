import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAttention, setAttention, setAttentionLabel } from './attention';

// jsdom has no canvas: stub just enough for the favicon path, and an Image that fails
// to load, so the plain-circle fallback is drawn.
const ctx2d = {
  drawImage: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
  fillStyle: '', strokeStyle: '', lineWidth: 0,
};
class FailingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) { setTimeout(() => this.onerror?.(), 0); }
}

const flush = () => new Promise((r) => setTimeout(r, 5));
const icons = () => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];

beforeEach(() => {
  document.head.innerHTML =
    '<title>x</title><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/svg+xml" href="/favicon.svg">' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">';
  document.title = 'Files · dosya.dev';
  ctx2d.drawImage.mockClear();
  ctx2d.arc.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,DOT');
  vi.stubGlobal('Image', FailingImage);
});
afterEach(() => {
  clearAttention();
  setAttentionLabel(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('tab attention', () => {
  it('prefixes the current title with the count and persona, and restores it on clear', () => {
    setAttention({ count: 2, personaName: 'Carl' });
    expect(document.title).toBe('(2) New message from Carl · Files · dosya.dev');
    clearAttention();
    expect(document.title).toBe('Files · dosya.dev');
  });

  it('falls back to dosya support without a persona', () => {
    setAttention({ count: 1, personaName: null });
    expect(document.title).toBe('(1) New message from dosya support · Files · dosya.dev');
  });

  it('is idempotent: repeated sets replace the prefix, never stack it; clear twice is harmless', () => {
    setAttention({ count: 1, personaName: 'Carl' });
    setAttention({ count: 3, personaName: 'Emma' });
    expect(document.title).toBe('(3) New message from Emma · Files · dosya.dev');
    clearAttention();
    clearAttention();
    expect(document.title).toBe('Files · dosya.dev');
  });

  it('clear without a set leaves the title alone', () => {
    document.title = 'Settings · dosya.dev';
    clearAttention();
    expect(document.title).toBe('Settings · dosya.dev');
  });

  it('wraps a title the page-title module sets while attention is on, and restores that newer title', async () => {
    setAttention({ count: 1, personaName: 'Carl' });
    document.title = 'Settings · dosya.dev'; // RouteTitle after navigation
    await flush(); // the title observer runs as a microtask
    expect(document.title).toBe('(1) New message from Carl · Settings · dosya.dev');
    setAttention({ count: 2, personaName: 'Carl' });
    expect(document.title).toBe('(2) New message from Carl · Settings · dosya.dev');
    clearAttention();
    expect(document.title).toBe('Settings · dosya.dev');
  });

  it('a persona name with a double space (read back collapsed) neither loops nor leaves the prefix behind', async () => {
    setAttention({ count: 1, personaName: 'Ana  Silva' });
    expect(document.title).toBe('(1) New message from Ana Silva · Files · dosya.dev');
    document.title = 'Settings · dosya.dev';
    await flush();
    expect(document.title).toBe('(1) New message from Ana Silva · Settings · dosya.dev');
    setAttention({ count: 2, personaName: 'Ana  Silva' });
    expect(document.title).toBe('(2) New message from Ana Silva · Settings · dosya.dev');
    clearAttention();
    expect(document.title).toBe('Settings · dosya.dev');
  });

  it('a persona name with leading and trailing newlines is handled the same way', async () => {
    setAttention({ count: 1, personaName: '\nCarl\n' });
    expect(document.title).toBe('(1) New message from Carl · Files · dosya.dev');
    document.title = 'Settings · dosya.dev';
    await flush();
    expect(document.title).toBe('(1) New message from Carl · Settings · dosya.dev');
    clearAttention();
    expect(document.title).toBe('Settings · dosya.dev');
  });

  it('the observer stops after a few rewrites when a title never reads back as written', async () => {
    const proto = Document.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'title')!;
    let writes = 0;
    // An unknown normalisation: every read differs from every write.
    Object.defineProperty(document, 'title', {
      configurable: true,
      get() { return `${desc.get!.call(document)}!`; },
      set(v: string) { writes++; desc.set!.call(document, v); },
    });
    try {
      setAttention({ count: 1, personaName: 'Carl' });
      desc.set!.call(document, 'Settings · dosya.dev');
      await flush();
      expect(writes).toBeLessThanOrEqual(7);
    } finally {
      clearAttention();
      delete (document as unknown as Record<string, unknown>).title;
    }
  });

  it('uses a translated label when one is installed', () => {
    setAttentionLabel((count, name) => `(${count}) Neue Nachricht von ${name}`);
    setAttention({ count: 1, personaName: 'Carl' });
    expect(document.title).toBe('(1) Neue Nachricht von Carl · Files · dosya.dev');
  });

  it('swaps every icon link to a dotted PNG (circle fallback when the svg will not load) and restores them', async () => {
    setAttention({ count: 1, personaName: 'Carl' });
    await flush();
    expect(icons().map((l) => l.getAttribute('href'))).toEqual(['data:image/png;base64,DOT', 'data:image/png;base64,DOT']);
    expect(ctx2d.arc).toHaveBeenCalled();
    expect(ctx2d.drawImage).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')!.getAttribute('href')).toBe('/apple-touch-icon.png');
    clearAttention();
    expect(icons().map((l) => l.getAttribute('href'))).toEqual(['/favicon.ico', '/favicon.svg']);
    expect(icons()[1].getAttribute('type')).toBe('image/svg+xml');
  });

  it('a clear before the favicon finishes drawing leaves the original icons', async () => {
    setAttention({ count: 1, personaName: 'Carl' });
    clearAttention();
    await flush();
    expect(icons().map((l) => l.getAttribute('href'))).toEqual(['/favicon.ico', '/favicon.svg']);
  });

  it('still sets the title when canvas is unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    setAttention({ count: 1, personaName: 'Carl' });
    await flush();
    expect(document.title).toBe('(1) New message from Carl · Files · dosya.dev');
    expect(icons()[1].getAttribute('href')).toBe('/favicon.svg');
  });
});
