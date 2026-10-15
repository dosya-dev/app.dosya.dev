import { useCallback, useEffect, useRef, useState } from 'react';
import { listComments } from './api';
import type { Comment } from './types';
import type { AnchorMarker } from './anchor-context';
import { isOlderVersion } from './format';

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
      if (latest.current === forKey) setState({ key: forKey, comments: list, error: false, loaded: true });
    } catch {
      if (latest.current === forKey) setState((s) => ({ key: forKey, comments: s.key === forKey ? s.comments : [], error: true, loaded: true }));
    }
  }, [fileId, workspaceId]);

  useEffect(() => { void reload(); }, [reload]);

  const setComments = useCallback((c: Comment[]) => {
    setState({ key: latest.current, comments: c, error: false, loaded: true });
  }, []);

  const current = state.key === key;
  return {
    comments: current ? state.comments : [],
    loading: !current || !state.loaded,
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
