import { describe, it, expect, vi } from 'vitest';
import { isChunkLoadError, recoverFromChunkError, CHUNK_RELOAD_MIN_INTERVAL_MS } from './chunk-reload';

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
