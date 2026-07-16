import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';

export interface PickerFolder {
  id: string;
  name: string;
  parent_id: string | null;
  file_count: number;
  has_children: boolean;
}

export interface SearchFolder {
  id: string;
  name: string;
  file_count: number;
  path: string; // breadcrumb of ancestor names ("" for a root-level folder)
}

const ROOT_KEY = '__root__';
const keyOf = (parentId: string | null) => parentId ?? ROOT_KEY;

/** Direct children of a folder (or roots when parentId is null). */
export async function fetchChildren(workspaceId: string, parentId: string | null): Promise<PickerFolder[]> {
  const qs = new URLSearchParams({ workspace_id: workspaceId });
  if (parentId) qs.set('parent_id', parentId);
  const d = await api<{ ok: boolean; folders?: Array<Omit<PickerFolder, 'has_children'> & { has_children: number | boolean }> }>(
    `/api/folders/children?${qs.toString()}`,
  );
  if (!d.ok || !d.folders) return [];
  return d.folders.map((f) => ({ ...f, has_children: !!f.has_children }));
}

/** Up to 50 name matches, each with a server-computed breadcrumb path. */
export async function searchFolders(workspaceId: string, q: string): Promise<SearchFolder[]> {
  const qs = new URLSearchParams({ workspace_id: workspaceId, q });
  const d = await api<{ ok: boolean; folders?: SearchFolder[] }>(`/api/folders/search?${qs.toString()}`);
  return d.ok && d.folders ? d.folders : [];
}

/**
 * Lazily loads a folder tree one level at a time and caches children by parent id.
 * Keeps the picker fast even in workspaces with tens of thousands of folders.
 */
export function useLazyFolders(workspaceId: string | null, open: boolean) {
  const [childrenByParent, setChildrenByParent] = useState<Map<string | null, PickerFolder[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const loadedRef = useRef<Set<string | null>>(new Set());

  const load = useCallback(async (parentId: string | null) => {
    if (!workspaceId) return;
    loadedRef.current.add(parentId);
    const k = keyOf(parentId);
    setLoading((prev) => new Set(prev).add(k));
    let kids: PickerFolder[] = [];
    try { kids = await fetchChildren(workspaceId, parentId); } catch { /* leave empty */ }
    setChildrenByParent((prev) => new Map(prev).set(parentId, kids));
    setLoading((prev) => { const next = new Set(prev); next.delete(k); return next; });
  }, [workspaceId]);

  // (Re)load roots whenever the picker opens or the workspace changes.
  useEffect(() => {
    if (open && workspaceId) {
      loadedRef.current = new Set();
      setChildrenByParent(new Map());
      setExpanded(new Set());
      load(null);
    }
  }, [open, workspaceId, load]);

  const toggle = useCallback((id: string) => {
    const willExpand = !expanded.has(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    if (willExpand && !loadedRef.current.has(id)) load(id);
  }, [expanded, load]);

  const expand = useCallback((id: string) => setExpanded((prev) => new Set(prev).add(id)), []);

  /** Force a refetch of one level (used after creating a folder). */
  const reload = useCallback((parentId: string | null) => {
    loadedRef.current.delete(parentId);
    load(parentId);
  }, [load]);

  return { childrenByParent, expanded, loading, toggle, expand, reload, rootKey: ROOT_KEY };
}
