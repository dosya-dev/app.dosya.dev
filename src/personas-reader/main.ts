// The face reader page for the mobile app (personas-reader.html, a second
// Vite entry). React Native's Hermes cannot run WebAssembly, so the phone
// loads this page in a hidden, zero-size WebView
// (apps/mobile/src/personas/device/ReaderHost.tsx) and hands it one photo at
// a time. The page reads with the web app's own reader worker
// (lib/personas-device/reader.ts, reader.worker.ts, read-core.ts): the wasm
// and both models come from GET /api/personas/models/<name> and are checked
// against their pinned SHA-256 before use. No cookie or session is needed:
// the models route is public.
//
// Protocol, as JSON strings over window.ReactNativeWebView.postMessage and
// the WebView's message event:
//   page -> app  {type:'ready', supported}            once, when it listens;
//                                                     supported false: this WebView
//                                                     has no Worker or wasm SIMD
//   app -> page  {id, photoBase64}                    one photo
//   page -> app  {id, faces:[{box, sig:number[], score}]}
//             or {id, error:'unsupported'|'failed'|'unavailable'}
// `unavailable` means the reader itself could not load (download, SHA-256,
// no Worker or WebAssembly SIMD here): never the photo's fault.
//
// Faces only ever go back to the app that sent the photo; nothing is logged
// or sent anywhere else.
//
// The page reads only where the app loads it from: https://app.dosya.dev
// (production API) or a localhost origin (development). Served from any
// other origin it says it cannot read and answers every request
// `unavailable`, so a stray copy never fetches models from production.
import { ReaderUnsupportedError, type ReadFace } from '@dosya-dev/personas-engine';
import { createWebReader, readerSupported, ReaderUnavailableError } from '@/lib/personas-device/reader';

export type ReadFailure = 'unsupported' | 'failed' | 'unavailable';

export interface PageReader {
  read(photo: Uint8Array): Promise<ReadFace[]>;
}

export function failureOf(e: unknown): ReadFailure {
  if (e instanceof ReaderUnsupportedError) return 'unsupported';
  if (e instanceof ReaderUnavailableError) return 'unavailable';
  return 'failed';
}

/** How many answered ids are remembered, so a request delivered twice is read once. */
const SEEN_MAX = 256;

function decodeBase64(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function parseRequest(data: unknown): { id: number; photoBase64: string } | null {
  if (typeof data !== 'string') return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  const m = msg as { id?: unknown; photoBase64?: unknown } | null;
  if (!m || typeof m !== 'object' || typeof m.id !== 'number' || !Number.isSafeInteger(m.id) || m.id < 0) return null;
  if (typeof m.photoBase64 !== 'string') return null;
  return { id: m.id, photoBase64: m.photoBase64 };
}

/**
 * The page's message handling, free of the window so tests drive it. `reader`
 * null: this WebView cannot run the reader, and every read is unavailable.
 */
export function createReaderPage(opts: { reader: PageReader | null; post: (msg: string) => void }) {
  const seen = new Set<number>();
  const answer = (o: unknown) => opts.post(JSON.stringify(o));

  return {
    async handle(data: unknown): Promise<void> {
      const req = parseRequest(data);
      if (!req || seen.has(req.id)) return;
      seen.add(req.id);
      if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value as number);
      const { id } = req;
      if (!opts.reader) return answer({ id, error: 'unavailable' });
      const photo = decodeBase64(req.photoBase64);
      if (!photo) return answer({ id, error: 'unsupported' });
      try {
        const faces = await opts.reader.read(photo);
        answer({ id, faces: faces.map((f) => ({ box: f.box, sig: Array.from(f.sig), score: f.score })) });
      } catch (e) {
        answer({ id, error: failureOf(e) });
      }
    },
  };
}

type NativeBridge = { postMessage(msg: string): void };

const APP_ORIGIN = 'https://app.dosya.dev';
const PRODUCTION_API = 'https://api.dosya.dev';

/**
 * The API origin for a page served from `origin`: production for the app's
 * own origin, the same origin on localhost (the Vite proxy), VITE_API_URL
 * overriding either; null for every other origin, where the page does not read.
 */
export function readerApiBase(origin: string, envUrl?: string): string | null {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return null;
  }
  if (origin === APP_ORIGIN) return envUrl || PRODUCTION_API;
  if (host === 'localhost' || host === '127.0.0.1') return envUrl || '';
  return null;
}

function defaultReader(base: string): PageReader | null {
  return readerSupported() ? createWebReader(`${base}/api/personas/models`) : null;
}

/**
 * Start the page inside the app's WebView: listen for requests on the window
 * and the document (react-native-webview delivers postMessage to one or the
 * other by platform), then say ready. Returns the stop function, or null
 * outside the app's WebView, where the page does nothing.
 */
export function bootPersonasReader(opts: { reader?: () => PageReader | null; origin?: string } = {}): (() => void) | null {
  const bridge = (window as { ReactNativeWebView?: NativeBridge }).ReactNativeWebView;
  if (!bridge || typeof bridge.postMessage !== 'function') return null;
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const base = readerApiBase(opts.origin ?? window.location.origin, env?.VITE_API_URL);
  // Not the app's origin: no reader, so every read is unavailable.
  const reader = base === null ? null : opts.reader ? opts.reader() : defaultReader(base);
  const page = createReaderPage({ reader, post: (m) => bridge.postMessage(m) });
  const onMessage = (ev: Event) => void page.handle((ev as MessageEvent).data);
  window.addEventListener('message', onMessage);
  document.addEventListener('message', onMessage);
  bridge.postMessage(JSON.stringify({ type: 'ready', supported: reader !== null }));
  return () => {
    window.removeEventListener('message', onMessage);
    document.removeEventListener('message', onMessage);
  };
}

if (typeof window !== 'undefined' && !import.meta.env?.VITEST) bootPersonasReader();
