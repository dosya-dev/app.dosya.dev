import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/client';

export interface PickerFolder {
  id: string;
  name: string;
  parent_id: string | null;
  file_count: number;
}

export interface TreeRow {
  folder: PickerFolder;
  depth: number;
  hasChildren: boolean;
}

/** Breadcrumb of ancestor names, e.g. "Alpha / Beta". "" for a root or unknown folder. */
export function folderPath(folders: PickerFolder[], id: string): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  let pid = byId.get(id)?.parent_id ?? null;
  while (pid) {
    const p = byId.get(pid);
    if (!p) break;
    parts.unshift(p.name);
    pid = p.parent_id;
  }
  return parts.join(' / ');
}

/** Depth-first flatten of the folder forest, siblings sorted by name. */
export function buildTreeRows(
  folders: PickerFolder[],
  opts: { excludeId?: string | null; collapsed?: Set<string> } = {},
): TreeRow[] {
  const { excludeId = null, collapsed } = opts;
  const childrenOf = new Map<string | null, PickerFolder[]>();
  for (const f of folders) {
    if (f.id === excludeId) continue; // pruning here drops the whole subtree
    const key = f.parent_id ?? null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(f);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const rows: TreeRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childrenOf.get(parentId) ?? []) {
      const hasChildren = (childrenOf.get(f.id) ?? []).length > 0;
      rows.push({ folder: f, depth, hasChildren });
      if (hasChildren && !collapsed?.has(f.id)) walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Flat, case-insensitive name-substring matches. [] for a blank query. */
export function filterFolders(folders: PickerFolder[], query: string): PickerFolder[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return folders.filter((f) => f.name.toLowerCase().includes(q));
}

/** Centralizes the GET /api/folders/tree fetch shared by every folder picker. */
export function useFolderTree(workspaceId: string | null) {
  const [folders, setFolders] = useState<PickerFolder[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!workspaceId) {
      setFolders([]);
      return;
    }
    setLoading(true);
    api<{ ok: boolean; folders?: PickerFolder[] }>(`/api/folders/tree?workspace_id=${workspaceId}`)
      .then((d) => {
        if (d.ok && d.folders) setFolders(d.folders);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { folders, setFolders, loading, reload };
}
