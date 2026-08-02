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
