const KEY = 'upload_concurrency';
export const DEFAULT_CONCURRENCY = 3;
export const MAX_USER_CONCURRENCY = 5;

export function getUserConcurrency(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw ? parseInt(raw, 10) : DEFAULT_CONCURRENCY;
    if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
    return Math.min(n, MAX_USER_CONCURRENCY);
  } catch {
    return DEFAULT_CONCURRENCY;
  }
}

export function setUserConcurrency(n: number): void {
  const clamped = Math.max(1, Math.min(Math.floor(n), MAX_USER_CONCURRENCY));
  try {
    localStorage.setItem(KEY, String(clamped));
  } catch {
    // non-fatal
  }
}

/** wsCap = workspace max_concurrent_uploads; 0/null/undefined means unlimited. */
export function effectiveConcurrency(userCap: number, wsCap: number | null | undefined): number {
  const u = Math.max(1, userCap);
  if (!wsCap || wsCap <= 0) return u;
  return Math.max(1, Math.min(u, wsCap));
}
