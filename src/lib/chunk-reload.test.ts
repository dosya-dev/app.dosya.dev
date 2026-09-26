import { describe, it, expect, vi } from 'vitest';
import { isChunkLoadError, recoverFromChunkError, resolveLazyModule, CHUNK_RELOAD_MIN_INTERVAL_MS } from './chunk-reload';

/** The messages browsers actually produce for this failure, verbatim from a real incident. */
const CHROME_DYNAMIC_IMPORT =
  'Failed to fetch dynamically imported module: https://app.dosya.dev/assets/login-CAXu7qeb.js';
const CHROME_MIME =
  'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec.';
const FIREFOX = 'error loading dynamically imported module';

function deps(overrides: Partial<{ now: number; last: string | null; throws: boolean }> = {}) {
  const store = new Map<string, string>();
  if (overrides.last != null) store.set('dosya_chunk_reload_at', overrides.last);
  const reload = vi.fn();
  return {
    reload,
    now: () => overrides.now ?? 1_000_000,
    storage: {
      getItem: (k: string) => {
        if (overrides.throws) throw new Error('storage disabled');
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (overrides.throws) throw new Error('storage disabled');
        store.set(k, v);
      },
    },
    store,
  };
}

describe('isChunkLoadError', () => {
  it('recognises the dynamic-import failure', () => {
    expect(isChunkLoadError(new Error(CHROME_DYNAMIC_IMPORT))).toBe(true);
  });

  // The MIME variant is what actually surfaces when Pages serves index.html
  // for a chunk path that no longer exists, so it must be recognised too.
  it('recognises the HTML-served-as-module failure', () => {
    expect(isChunkLoadError(new Error(CHROME_MIME))).toBe(true);
  });

  it('recognises the Firefox wording', () => {
    expect(isChunkLoadError(new Error(FIREFOX))).toBe(true);
  });

  it('accepts a bare string as well as an Error', () => {
    expect(isChunkLoadError(CHROME_DYNAMIC_IMPORT)).toBe(true);
  });

  it('does not claim ordinary errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError({ status: 500 })).toBe(false);
  });
});

describe('recoverFromChunkError', () => {
  it('reloads once for a chunk error and records when', () => {
    const d = deps();
    expect(recoverFromChunkError(new Error(CHROME_DYNAMIC_IMPORT), d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.store.get('dosya_chunk_reload_at')).toBe('1000000');
  });

  it('never reloads for an unrelated error', () => {
    const d = deps();
    expect(recoverFromChunkError(new Error('boom'), d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });

  // The loop guard. If the chunk is genuinely gone rather than merely stale,
  // reloading fails identically - without this the tab reloads forever.
  it('refuses a second reload inside the guard window', () => {
    const d = deps({ now: 1_000_000, last: String(1_000_000 - (CHUNK_RELOAD_MIN_INTERVAL_MS - 1)) });
    expect(recoverFromChunkError(new Error(CHROME_DYNAMIC_IMPORT), d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });

  // But a LATER deploy must still recover, so the guard has to expire.
  it('allows another reload once the guard window has passed', () => {
    const d = deps({ now: 1_000_000, last: String(1_000_000 - (CHUNK_RELOAD_MIN_INTERVAL_MS + 1)) });
    expect(recoverFromChunkError(new Error(CHROME_DYNAMIC_IMPORT), d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it('declines rather than looping when storage is unavailable', () => {
    const d = deps({ throws: true });
    expect(recoverFromChunkError(new Error(CHROME_DYNAMIC_IMPORT), d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it('ignores a corrupt stored timestamp instead of throwing', () => {
    const d = deps({ last: 'not-a-number' });
    expect(recoverFromChunkError(new Error(CHROME_DYNAMIC_IMPORT), d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });
});

/**
 * Faithful model of Vite's build-time preload helper (the deployed copy is in
 * assets/preload-helper-*.js). The detail that matters: when a listener calls
 * preventDefault, `handlePreloadError` stops rethrowing and returns undefined,
 * so `.catch(handlePreloadError)` RESOLVES the import with undefined.
 */
function vitePreload<T>(load: () => Promise<T>): Promise<T | undefined> {
  const handlePreloadError = (err: unknown) => {
    const event = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown };
    event.payload = err;
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw err;
    return undefined;
  };
  return load().catch(handlePreloadError);
}

/** React's lazy initializer, which is where the production TypeError was thrown. */
function reactLazyInitializer<T>(moduleObject: { default: T } | undefined): T {
  return (moduleObject as { default: T }).default;
}

async function settlesWithin<T>(promise: Promise<T>, ms = 20): Promise<{ settled: boolean }> {
  const marker = Symbol('pending');
  const race = await Promise.race([
    promise.then(() => 'settled' as const, () => 'settled' as const),
    new Promise<typeof marker>((resolve) => setTimeout(() => resolve(marker), ms)),
  ]);
  return { settled: race !== marker };
}

describe('resolveLazyModule', () => {
  it('passes a real module through untouched', async () => {
    const mod = { default: () => null };
    await expect(resolveLazyModule(mod)).resolves.toBe(mod);
  });

  // Regression: a swallowed stale-chunk error resolved the import with
  // undefined, React read `.default` off it, and the router boundary painted
  // "Something went wrong" in the few ms before location.reload() landed.
  it('never settles when the preload helper swallowed a stale-chunk error', async () => {
    const { settled } = await settlesWithin(resolveLazyModule(undefined));
    expect(settled).toBe(false);
  });

  it('keeps React.lazy from reading .default off undefined after a recovery', async () => {
    const listener = (event: Event) => {
      const err = (event as Event & { payload?: unknown }).payload ?? event;
      // Stand in for recoverFromChunkErrorInBrowser returning true: a reload is
      // now committed, so the handler suppresses the error.
      if (isChunkLoadError(err)) event.preventDefault();
    };
    window.addEventListener('vite:preloadError', listener);
    try {
      const staleChunk = () => Promise.reject(new Error(CHROME_DYNAMIC_IMPORT));
      const factory = () => vitePreload(staleChunk).then(resolveLazyModule).then(reactLazyInitializer);
      const { settled } = await settlesWithin(factory());
      expect(settled).toBe(false);
    } finally {
      window.removeEventListener('vite:preloadError', listener);
    }
  });
  
  // The named-export case has an extra trap: the picker reads a property off
  // the module, so if it runs on a swallowed (undefined) module it throws the
  // same TypeError the bridge exists to prevent. It must never run.
  it('never runs a named-export picker on a swallowed stale-chunk module', async () => {
    const pick = vi.fn((m: { PdfViewer: unknown }) => m.PdfViewer);
    const listener = (event: Event) => {
      const err = (event as Event & { payload?: unknown }).payload ?? event;
      if (isChunkLoadError(err)) event.preventDefault();
    };
    window.addEventListener('vite:preloadError', listener);
    try {
      const staleChunk = () => Promise.reject(new Error(CHROME_DYNAMIC_IMPORT));
      const { settled } = await settlesWithin(
        vitePreload(staleChunk)
          .then(resolveLazyModule)
          .then((m) => ({ default: pick(m as unknown as { PdfViewer: unknown }) })),
      );
      expect(settled).toBe(false);
      expect(pick).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('vite:preloadError', listener);
    }
  });
});
