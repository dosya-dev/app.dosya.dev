import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiErrorMessage } from '@/api/client';
import { browse, type CloudEntryDto, type SelectionEntry } from '@/api/cloud-import';
import { retryAfterFromError } from '@/stores/cloud-imports';

export function toggleSelection(
  current: SelectionEntry[],
  entry: SelectionEntry,
): SelectionEntry[] {
  const exists = current.some((e) => e.id === entry.id);
  return exists ? current.filter((e) => e.id !== entry.id) : [...current, entry];
}

/**
 * Converts a browse-result entry into the shape the import API expects.
 * Returns null for an entry the backend has already flagged `unsupported` -
 * those would fail server-side, so the picker must never let one into a
 * selection, even if a caller reaches this without going through the (also
 * disabled) checkbox.
 */
export function toSelectionEntry(entry: CloudEntryDto): SelectionEntry | null {
  if (entry.unsupported) return null;
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    size: entry.size,
    mimeType: entry.mimeType,
    exportMime: entry.exportAs?.mime ?? null,
  };
}

export interface Crumb { id: string; name: string }

/** True only for the specific 401 the backend uses to mean "reconnect this account". */
function isReconnectRequired(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 401) return false;
  try {
    const body = JSON.parse(err.body) as { code?: string };
    return body.code === 'RECONNECT_REQUIRED';
  } catch {
    return false;
  }
}

export function useCloudBrowser(accountId: string | null) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: '', name: 'Home' }]);
  const [entries, setEntries] = useState<CloudEntryDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectRequired, setReconnectRequired] = useState(false);
  // Seconds until the next automatic retry after a provider 429. Not a
  // reconnect case and not a fatal error - the dialog should keep whatever is
  // on screen and quietly retry, matching how the drive() polling loop in
  // stores/cloud-imports.ts already treats a 429 as a wait, not a stop.
  const [rateLimitedSeconds, setRateLimitedSeconds] = useState<number | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the current `load` so the 429 retry (scheduled via a plain
  // setTimeout, not React state) can call the latest version without
  // referencing `load` from inside its own definition.
  const loadRef = useRef<((append: boolean, pageCursor?: string) => Promise<void>) | null>(null);
  // Monotonic id for the in-flight browse() call. Rapid navigation (e.g. a
  // double-click into one folder followed immediately by a click into a
  // sibling) can have two browse() calls in flight at once; without this,
  // whichever resolves LAST wins even if it's the older, now-irrelevant one.
  // Each load() claims the next id and only commits its result (or clears
  // `loading`) if it is still the most recent call by the time it settles.
  const requestId = useRef(0);
  // Bumped by reset() to force a fresh load even when accountId/folderId
  // haven't actually changed (e.g. reopening the dialog already at Home) -
  // load()'s own useCallback deps wouldn't otherwise change identity, so the
  // mount/reload effect below needs a separate signal to refire.
  const [reloadNonce, setReloadNonce] = useState(0);

  const folderId = crumbs[crumbs.length - 1]!.id;

  const load = useCallback(async (append: boolean, pageCursor?: string) => {
    if (!accountId) return;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    const thisRequestId = ++requestId.current;
    const isCurrent = () => requestId.current === thisRequestId;
    setLoading(true);
    setError(null);
    setReconnectRequired(false);
    setRateLimitedSeconds(null);
    try {
      const page = await browse({ accountId, folderId, cursor: pageCursor });
      if (!isCurrent()) return; // superseded by a newer navigation/reset - discard
      setEntries((prev) => (append ? [...prev, ...page.entries] : page.entries));
      setCursor(page.cursor);
    } catch (err) {
      if (!isCurrent()) return; // stale error from a superseded request - discard
      if (isReconnectRequired(err)) {
        setReconnectRequired(true);
        setError(apiErrorMessage(err, 'This account needs to be reconnected.'));
        return;
      }
      const wait = retryAfterFromError(err);
      if (wait !== null) {
        setRateLimitedSeconds(wait);
        retryTimer.current = setTimeout(() => {
          void loadRef.current?.(append, pageCursor);
        }, wait * 1000);
        return;
      }
      setError(apiErrorMessage(err, 'Could not list that folder'));
    } finally {
      // Only the current request may clear the spinner - an older, already-
      // superseded request finishing late must not flip `loading` off while
      // the newer, still-in-flight request is the one the user is waiting on.
      if (isCurrent()) setLoading(false);
    }
  }, [accountId, folderId]);

  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => { void load(false); }, [load, reloadNonce]);

  // Cancel any pending 429 retry on unmount so it can't fire (and call
  // setState) after the dialog has gone away.
  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);

  // Stable (deps: []) so a caller can safely put it in an effect's dependency
  // array without that effect refiring on every render. Only ever touches
  // setState setters and refs, both of which have stable identity, so it
  // never needs accountId/folderId/load in its closure.
  const reset = useCallback(() => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    setCrumbs([{ id: '', name: 'Home' }]);
    setEntries([]);
    setCursor(null);
    setSelection([]);
    setError(null);
    setReconnectRequired(false);
    setRateLimitedSeconds(null);
    // Forces a fresh load even if accountId/folderId end up unchanged (e.g.
    // reopening while already at Home) - see reloadNonce's comment above.
    setReloadNonce((n) => n + 1);
  }, []);

  return {
    crumbs,
    entries,
    cursor,
    selection,
    loading,
    error,
    reconnectRequired,
    rateLimitedSeconds,
    enter: (entry: CloudEntryDto) => setCrumbs((c) => [...c, { id: entry.id, name: entry.name }]),
    goTo: (index: number) => setCrumbs((c) => c.slice(0, index + 1)),
    loadMore: () => { if (cursor) void load(true, cursor); },
    reload: () => void load(false),
    reset,
    toggle: (entry: CloudEntryDto) => {
      const sel = toSelectionEntry(entry);
      if (!sel) return;
      setSelection((s) => toggleSelection(s, sel));
    },
    clearSelection: () => setSelection([]),
  };
}
