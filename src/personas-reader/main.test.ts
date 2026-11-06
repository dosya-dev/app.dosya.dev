// The reader page the mobile app loads in a hidden WebView
// (apps/mobile/src/personas/device/ReaderHost.tsx): one photo in as base64,
// its faces (or why not) out, through window.ReactNativeWebView.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReaderUnsupportedError, type ReadFace } from '@dosya-dev/personas-engine';
import { ReaderUnavailableError } from '@/lib/personas-device/reader';
import { bootPersonasReader, createReaderPage, failureOf, readerApiBase, type PageReader } from './main';

const face = (score: number): ReadFace => ({
  box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
  sig: Float32Array.from({ length: 128 }, (_, i) => (i - 64) / 100 + score / 1000),
  score,
});

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

function setup(read: PageReader['read']) {
  const posted: unknown[] = [];
  const reader: PageReader = { read: vi.fn(read) };
  const page = createReaderPage({ reader, post: (m) => posted.push(JSON.parse(m)) });
  return { posted, reader, page };
}

describe('createReaderPage', () => {
  it('reads the photo it is sent and answers its faces with plain-number signatures', async () => {
    const f = face(0.9);
    const { posted, reader, page } = setup(async () => [f]);
    await page.handle(JSON.stringify({ id: 7, photoBase64: b64([0xff, 0xd8, 0xff, 0x00]) }));
    expect(Array.from((reader.read as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array)).toEqual([0xff, 0xd8, 0xff, 0x00]);
    expect(posted).toHaveLength(1);
    const out = posted[0] as { id: number; faces: { box: unknown; sig: number[]; score: number }[] };
    expect(out.id).toBe(7);
    expect(out.faces).toHaveLength(1);
    expect(out.faces[0].box).toEqual(f.box);
    expect(out.faces[0].score).toBeCloseTo(0.9);
    // A float32 survives JSON exactly: the phone rebuilds the same signature.
    expect(Float32Array.from(out.faces[0].sig)).toEqual(f.sig);
  });

  it('says why a photo could not be read: unsupported, failed or unavailable', async () => {
    const errors: unknown[] = [new ReaderUnsupportedError(), new Error('trap'), new ReaderUnavailableError('models missing')];
    const { posted, page } = setup(async () => {
      throw errors.shift();
    });
    for (const id of [1, 2, 3]) await page.handle(JSON.stringify({ id, photoBase64: b64([1]) }));
    expect(posted).toEqual([
      { id: 1, error: 'unsupported' },
      { id: 2, error: 'failed' },
      { id: 3, error: 'unavailable' },
    ]);
  });

  it('ignores anything that is not a read request, and a request it already answered', async () => {
    const { posted, reader, page } = setup(async () => []);
    for (const junk of [null, 5, 'not json', '{"id":"x","photoBase64":"AA=="}', '{"id":1}', '{"photoBase64":"AA=="}', '{"id":-1,"photoBase64":"AA=="}', { id: 1, photoBase64: 'AA==' }]) {
      await page.handle(junk);
    }
    expect(reader.read).not.toHaveBeenCalled();
    await page.handle(JSON.stringify({ id: 4, photoBase64: 'AA==' }));
    await page.handle(JSON.stringify({ id: 4, photoBase64: 'AA==' }));
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([{ id: 4, faces: [] }]);
  });

  it('a photo that is not base64 is unsupported', async () => {
    const { posted, reader, page } = setup(async () => []);
    await page.handle(JSON.stringify({ id: 9, photoBase64: '***' }));
    expect(reader.read).not.toHaveBeenCalled();
    expect(posted).toEqual([{ id: 9, error: 'unsupported' }]);
  });

  it('without a reader (no Worker or WebAssembly SIMD here) every read is unavailable, never the photo\'s fault', async () => {
    const posted: unknown[] = [];
    const page = createReaderPage({ reader: null, post: (m) => posted.push(JSON.parse(m)) });
    await page.handle(JSON.stringify({ id: 1, photoBase64: 'AA==' }));
    expect(posted).toEqual([{ id: 1, error: 'unavailable' }]);
  });

  it('failureOf maps the reader errors', () => {
    expect(failureOf(new ReaderUnsupportedError())).toBe('unsupported');
    expect(failureOf(new ReaderUnavailableError())).toBe('unavailable');
    expect(failureOf(new Error('x'))).toBe('failed');
    expect(failureOf('x')).toBe('failed');
  });
});

describe('bootPersonasReader', () => {
  afterEach(() => {
    delete (window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  });

  it('says in its ready line when this WebView cannot run the reader (no Worker or WebAssembly SIMD)', () => {
    const posted: string[] = [];
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage: (m: string) => posted.push(m) };
    const stop = bootPersonasReader({ reader: () => null });
    expect(posted.map((m) => JSON.parse(m))).toEqual([{ type: 'ready', supported: false }]);
    stop!();
  });

  it('refuses to read on any origin but the app\'s or localhost: ready says unsupported and every read is unavailable', async () => {
    const posted: string[] = [];
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage: (m: string) => posted.push(m) };
    const read = vi.fn(async () => [face(0.5)]);
    const stop = bootPersonasReader({ origin: 'https://staging.dosya.dev', reader: () => ({ read }) });
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: 1, photoBase64: 'AA==' }) }));
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted.map((m) => JSON.parse(m))).toEqual([{ type: 'ready', supported: false }, { id: 1, error: 'unavailable' }]);
    expect(read).not.toHaveBeenCalled();
    stop!();
  });

  it('readerApiBase: production API only for https://app.dosya.dev, same origin (or VITE_API_URL) on localhost, none elsewhere', () => {
    expect(readerApiBase('https://app.dosya.dev')).toBe('https://api.dosya.dev');
    expect(readerApiBase('https://app.dosya.dev', 'https://api.example.test')).toBe('https://api.example.test');
    expect(readerApiBase('http://localhost:5173')).toBe('');
    expect(readerApiBase('http://127.0.0.1:5173')).toBe('');
    expect(readerApiBase('http://localhost:5173', 'http://localhost:4321')).toBe('http://localhost:4321');
    for (const o of ['https://staging.dosya.dev', 'http://app.dosya.dev', 'https://app.dosya.dev.evil.test', 'https://evil.test', 'null', '']) {
      expect(readerApiBase(o), o).toBeNull();
      expect(readerApiBase(o, 'https://api.dosya.dev'), o).toBeNull();
    }
  });

  it('does nothing outside the app\'s WebView', () => {
    expect(bootPersonasReader({ reader: () => ({ read: async () => [] }) })).toBeNull();
  });

  it('says it is ready, then answers requests the app posts to the window or the document, each once', async () => {
    const posted: string[] = [];
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage: (m: string) => posted.push(m) };
    const read = vi.fn(async () => [face(0.5)]);
    const stop = bootPersonasReader({ reader: () => ({ read }) });
    expect(stop).not.toBeNull();
    expect(posted.map((m) => JSON.parse(m))).toEqual([{ type: 'ready', supported: true }]);

    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: 1, photoBase64: 'AA==' }) }));
    document.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: 1, photoBase64: 'AA==' }) }));
    document.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: 2, photoBase64: 'AA==' }) }));
    await vi.waitFor(() => expect(posted).toHaveLength(3));
    expect(read).toHaveBeenCalledTimes(2);
    expect(posted.slice(1).map((m) => JSON.parse(m).id)).toEqual([1, 2]);
    stop!();
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: 3, photoBase64: 'AA==' }) }));
    await new Promise((r) => setTimeout(r, 10));
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('the build', () => {
  const root = path.resolve(__dirname, '../..');

  it('has personas-reader.html as a second entry next to index.html', async () => {
    const { default: config } = await import('../../vite.config');
    const input = (config as { build?: { rollupOptions?: { input?: Record<string, string> } } }).build?.rollupOptions?.input ?? {};
    expect(Object.values(input).map((p) => path.relative(root, p)).sort()).toEqual(['index.html', 'personas-reader.html']);
  });

  it('the page loads this module, needs no cookies and names no third party', () => {
    const html = readFileSync(path.join(root, 'personas-reader.html'), 'utf8');
    expect(html).toContain('<script type="module" src="/src/personas-reader/main.ts"></script>');
    expect(html).toContain('noindex');
    expect(html).not.toMatch(/cloudflare/i);
  });
});
