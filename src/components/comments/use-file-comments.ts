import { useCallback, useEffect, useRef, useState } from 'react';
import { listComments } from './api';
import type { Comment } from './types';
import type { AnchorMarker } from './anchor-context';
import { isOlderVersion } from './format';

/**
 * The last thread seen per file, for this tab's lifetime. Reopening a file
 * shows it at once while the fresh list loads behind it, instead of an empty
 * panel for the length of a round trip. Bounded so a long session browsing
 * many files does not grow it without end.
 */
const threadCache = new Map<string, Comment[]>();
const THREAD_CACHE_MAX = 50;

function remember(key: string, comments: Comment[]): void {
  threadCache.delete(key);
  threadCache.set(key, comments);
  if (threadCache.size > THREAD_CACHE_MAX) threadCache.delete(threadCache.keys().next().value!);
}

/** Tests only: forget every cached thread. */
export function clearThreadCache(): void {
  threadCache.clear();
}

export function useFileComments(fileId: string, workspaceId: string) {
  // Data is stored with the file it belongs to: on the first render after a
  // file change the old file's comments are simply not returned, and a slow
  // response for a previous file is ignored.
  const [state, setState] = useState<{ key: string; comments: Comment[]; error: boolean; loaded: boolean }>(
    { key: '', comments: [], error: false, loaded: false },
  );
  const key = `${workspaceId}:${fileId}`;
  const latest = useRef(key);
  latest.current = key;

  const reload = useCallback(async () => {
    const forKey = `${workspaceId}:${fileId}`;
    try {
      const list = await listComments(fileId, workspaceId);
      remember(forKey, list);
      if (latest.current === forKey) setState({ key: forKey, comments: list, error: false, loaded: true });
    } catch {
      if (latest.current === forKey) setState((s) => ({ key: forKey, comments: s.key === forKey ? s.comments : (threadCache.get(forKey) ?? []), error: true, loaded: true }));
    }
  }, [fileId, workspaceId]);

  useEffect(() => { void reload(); }, [reload]);

  const setComments = useCallback((c: Comment[]) => {
    remember(latest.current, c);
    setState({ key: latest.current, comments: c, error: false, loaded: true });
  }, []);

  const current = state.key === key;
  // Until this file's own response arrives, the cached copy stands in for it
  // (shown, not loading); a file never seen still shows the loading state.
  const cached = current ? undefined : threadCache.get(key);
  return {
    comments: current ? state.comments : (cached ?? []),
    loading: current ? !state.loaded : cached === undefined,
    error: current ? state.error : false,
    reload,
    setComments,
  };
}

/** Top-level anchored comments as markers. Older-version comments are dimmed. */
export function markersFrom(comments: Comment[], currentVersion: number | null): AnchorMarker[] {
  return comments
    .filter((c) => !c.parent_id && (c.anchor_ms != null || c.anchor_page != null))
    .map((c) => ({
      id: c.id,
      ms: c.anchor_ms,
      page: c.anchor_page,
      dim: isOlderVersion(c, currentVersion),
      initial: (c.user_name || '?').trim().charAt(0).toUpperCase(),
      excerpt: c.body.length > 80 ? `${c.body.slice(0, 79)}…` : c.body,
    }));
}
