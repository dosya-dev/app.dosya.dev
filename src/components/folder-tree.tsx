import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { folderIconSrc } from '@/lib/helpers';
import { buildTreeRows, filterFolders, folderPath, type PickerFolder } from '@/lib/folders';

/**
 * Presentational folder tree. Browse mode shows an indented, collapsible tree;
 * a non-empty `query` switches to flat, breadcrumb-prefixed search matches.
 * `excludeId` prunes a node and its subtree (so a folder can't target itself).
 */
export function FolderTree({ folders, selectedId, onSelect, excludeId = null, query = '' }: {
  folders: PickerFolder[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  excludeId?: string | null;
  query?: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rowCls = (id: string) =>
    `w-full flex items-center gap-1.5 py-1.5 pr-3 text-xs rounded-md hover:bg-muted/50 text-left ${selectedId === id ? 'bg-primary/10' : ''}`;

  // Search mode: flat matches with a breadcrumb prefix.
  const q = query.trim();
  if (q) {
    const matches = filterFolders(folders, q).filter((f) => f.id !== excludeId);
    if (matches.length === 0) {
      return <div className="px-2 py-3 text-center text-xs text-muted-foreground">No folders match "{q}"</div>;
    }
    return (
      <>
        {matches.map((f) => {
          const path = folderPath(folders, f.id);
          return (
            <button key={f.id} className={rowCls(f.id)} style={{ paddingLeft: 8 }} onClick={() => onSelect(f.id)}>
              <img src={folderIconSrc(f.file_count)} alt="" className="size-4 shrink-0" />
              <span className="flex-1 truncate">
                {path && <span className="text-muted-foreground">{path} / </span>}
                {f.name}
              </span>
            </button>
          );
        })}
      </>
    );
  }

  // Browse mode: indented, collapsible tree.
  const rows = buildTreeRows(folders, { excludeId, collapsed });
  return (
    <>
      {rows.map(({ folder, depth, hasChildren }) => (
        <button
          key={folder.id}
          className={rowCls(folder.id)}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => onSelect(folder.id)}
        >
          {hasChildren ? (
            <ChevronRight
              className={`size-3 text-muted-foreground shrink-0 transition-transform ${collapsed.has(folder.id) ? '' : 'rotate-90'}`}
              onClick={(e: ReactMouseEvent) => {
                e.stopPropagation();
                toggle(folder.id);
              }}
            />
          ) : (
            <span className="size-3 shrink-0" />
          )}
          <img src={folderIconSrc(folder.file_count)} alt="" className="size-4 shrink-0" />
          <span className="flex-1 truncate">{folder.name}</span>
        </button>
      ))}
    </>
  );
}
