import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Recovery for the stale-chunk failure that follows every deploy.
 *
 * Every page in this app is a lazy chunk with a content-hashed filename (see
 * router.tsx). A tab opened before a deploy holds an entry bundle that names
 * the OLD chunk files; once the deploy lands those names are gone, and
 * Cloudflare Pages answers the request with the SPA's index.html fallback.
 * The browser refuses to execute HTML as a module script, the router's error
 * boundary catches it, and the user gets a "Something went wrong" 500 page.
 * So a routine deploy looks like a server outage to anyone holding a tab open,
 * which is exactly how this was first reported.
 *
 * Reloading fetches the current index and therefore the current chunk names,
 * which is the entire fix. The guard below is what makes it safe: if a chunk
 * is genuinely missing rather than merely stale, the reload fails the same way
 * and the tab would reload forever.
 *
 * The guard is a TIMESTAMP rather than a one-shot flag on purpose. A one-shot
 * flag would have to be cleared on a successful load to let the NEXT deploy
 * recover - but the entry bundle runs and would clear it before the lazy chunk
 * ever fails, re-arming the loop it was supposed to prevent. A timestamp needs
 * no clearing: a repeat failure seconds later is a real breakage and is
 * refused, while the same failure weeks later is a new deploy and recovers.
 */

const RELOAD_KEY = 'dosya_chunk_reload_at';

/** How long after a recovery reload we refuse to reload again. */
export const CHUNK_RELOAD_MIN_INTERVAL_MS = 10_000;

/**
 * Substrings of the messages browsers actually emit for this failure. Matched
 * case-insensitively because the wording differs per engine, and the MIME
 * variant is included because that is what surfaces when Pages serves
 * index.html for a chunk path that no longer exists.
 */
const CHUNK_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'expected a javascript-or-wasm module script',
  'importing a module script failed',
  'failed to load module script',
];

export function isChunkLoadError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!message) return false;
  const lower = message.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

export interface ChunkReloadDeps {
  reload: () => void;
  now: () => number;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
}

/**
 * Reload the tab if `err` is a stale-chunk failure and we have not already
 * tried very recently. Returns whether a reload was triggered.
 */
export function recoverFromChunkError(err: unknown, deps: ChunkReloadDeps): boolean {
  if (!isChunkLoadError(err)) return false;

  const now = deps.now();
  try {
    const raw = deps.storage.getItem(RELOAD_KEY);
    const last = raw === null ? NaN : Number(raw);
    // A corrupt value is treated as "no recent attempt" rather than as a
    // reason to give up - the guard exists to stop loops, not to be strict.
    if (Number.isFinite(last) && now - last < CHUNK_RELOAD_MIN_INTERVAL_MS) return false;
    deps.storage.setItem(RELOAD_KEY, String(now));
  } catch {
    // sessionStorage throws in some privacy modes. Without a working guard a
    // reload could loop, so decline rather than risk it.
    return false;
  }

  deps.reload();
  return true;
}

/** Browser-wired convenience wrapper. */
export function recoverFromChunkErrorInBrowser(err: unknown): boolean {
  return recoverFromChunkError(err, {
    reload: () => window.location.reload(),
    now: () => Date.now(),
    storage: window.sessionStorage,
  });
}

/**
 * Bridge over the gap between committing a reload and the reload landing.
 *
 * `window.location.reload()` is queued, not immediate, so React gets at least
 * one more render after the handler above decides to recover. That render used
 * to crash: Vite's preload helper rethrows a failed dynamic import only while
 * the `vite:preloadError` event is un-prevented, and our handler prevents it
 * once a reload is committed. The helper's `.catch()` then RESOLVES the import
 * with `undefined`, React.lazy reads `.default` off that, and the router's
 * error boundary paints "Something went wrong" for the few ms before the tab
 * reloads - the exact symptom this module exists to prevent, arriving through
 * the recovery path itself. It also reported a TypeError to Sentry on every
 * successful recovery, so each deploy paged us for a bug that had healed.
 *
 * Never settling is the fix: React keeps the Suspense fallback on screen until
 * the reload replaces the document. The promise is collected with the page.
 */
export function resolveLazyModule<T>(mod: T | undefined): Promise<T> {
  if (mod === undefined) return new Promise<never>(() => {});
  return Promise.resolve(mod);
}

/**
 * `React.lazy` for a default-exported chunk, with the recovery bridge applied.
 * Use this instead of `lazy` directly so a post-deploy reload never surfaces as
 * a render crash. Chunks behind a named export need the same `resolveLazyModule`
 * step before their picker runs, since the picker would otherwise be the thing
 * that reads a property off undefined.
 */
export function lazyChunk<P>(
  factory: () => Promise<{ default: ComponentType<P> }>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => factory().then(resolveLazyModule));
}

/**
 * The same bridge for a chunk whose component is a NAMED export.
 *
 * The picker has to live here rather than next to the `import()` call. Vite's
 * build transform absorbs a `.then()` written alongside `import()` into the
 * preload helper's own callback, which would run the picker BEFORE the helper
 * swallows a stale-chunk error - so the picker, not React, becomes the thing
 * that reads a property off undefined. Passing the factory in from another
 * module keeps the chain outside the helper, where it belongs.
 */
export function lazyChunkNamed<M, P>(
  factory: () => Promise<M>,
  pick: (mod: M) => ComponentType<P>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => factory().then(resolveLazyModule).then((mod) => ({ default: pick(mod) })));
}
