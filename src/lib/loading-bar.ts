import { useEffect, useSyncExternalStore } from 'react';

/**
 * The one signal behind the hairline at the top of the content area.
 *
 * Anything that makes the app wait registers here: a page chunk downloading
 * (lazyChunk does it for every route), a page's main fetch (useLoadingBar),
 * anything else that wants the line. It is a counter, not a flag, because
 * waits overlap - a chunk can still be downloading when its page starts its
 * first request - and the line must stay up until the LAST one ends, not the
 * first. Nothing here knows about React except the two hooks at the bottom,
 * so lazyChunk can call it from module scope.
 */

let count = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/**
 * Register a wait. Returns the matching end; calling it twice is a no-op, so
 * a caller that ends in both `.then` and `.finally` cannot drive the counter
 * negative and strand the line.
 */
export function beginLoading(): () => void {
  count += 1;
  notify();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    count -= 1;
    notify();
  };
}

export function isLoadingPending(): boolean {
  return count > 0;
}

export function subscribeLoading(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test seam only: the counter is module state and survives between tests. */
export function resetLoadingForTests() {
  count = 0;
  listeners.clear();
}

/** Whether anything is waiting right now; re-renders on every change. */
export function useLoadingPending(): boolean {
  return useSyncExternalStore(subscribeLoading, isLoadingPending, isLoadingPending);
}

/**
 * Hold the line up while `active` is true. For pages whose first paint is
 * followed by a fetch the user is waiting on - the file listing, a dashboard
 * - so the line covers the data as well as the code. Ends on unmount, so a
 * navigation away mid-fetch never leaves the line stuck.
 */
export function useLoadingBar(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return beginLoading();
  }, [active]);
}
