import { type MouseEvent as ReactMouseEvent } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { folderIconSrc } from '@/lib/helpers';
import { type PickerFolder } from '@/lib/folders';

/**
 * Presentational lazy folder tree. Renders whatever levels have been loaded into
 * `childrenByParent`; expanding a folder is the caller's job (onToggle), which
 * fetches that folder's children on demand. `excludeId` prunes a node + subtree.
 */
export function FolderTree({
  childrenByParent, expanded, loading, rootKey,
  selectedId, onSelect, onToggle, excludeId = null,
}: {
  childrenByParent: Map<string | null, PickerFolder[]>;
  expanded: Set<string>;
  loading: Set<string>;
  rootKey: string;
  selectedId: string | null;
  onSelect: (folder: PickerFolder) => void;
  onToggle: (id: string) => void;
  excludeId?: string | null;
}) {
  const rowCls = (id: string) =>
    `w-full flex items-center gap-1.5 py-1.5 pr-3 text-xs rounded-md hover:bg-muted/50 text-left ${selectedId === id ? 'bg-primary/10' : ''}`;

  const renderLevel = (parentId: string | null, depth: number): React.ReactNode => {
    const kids = (childrenByParent.get(parentId) ?? []).filter((f) => f.id !== excludeId);
    return kids.map((f) => (
      <div key={f.id}>
        <button className={rowCls(f.id)} style={{ paddingLeft: 8 + depth * 16 }} onClick={() => onSelect(f)}>
          {f.has_children ? (
            <ChevronRight
              className={`size-3 text-muted-foreground shrink-0 transition-transform ${expanded.has(f.id) ? 'rotate-90' : ''}`}
              onClick={(e: ReactMouseEvent) => { e.stopPropagation(); onToggle(f.id); }}
            />
          ) : (
            <span className="size-3 shrink-0" />
          )}
          <img src={folderIconSrc(f.file_count)} alt="" className="size-4 shrink-0" />
          <span className="flex-1 truncate">{f.name}</span>
          {loading.has(f.id) && <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />}
        </button>
        {expanded.has(f.id) && renderLevel(f.id, depth + 1)}
      </div>
    ));
  };

  const rootsLoading = loading.has(rootKey);
  const roots = childrenByParent.get(null) ?? [];
  if (rootsLoading && roots.length === 0) {
    return <div className="flex items-center justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  }
  if (roots.length === 0) {
    return <div className="px-2 py-3 text-center text-xs text-muted-foreground">No folders yet</div>;
  }
  return <>{renderLevel(null, 0)}</>;
}
