import { useEffect, useState, type ChangeEvent } from 'react';
import { Home, FolderPlus, Loader2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/api/client';
import { toast } from '@/lib/toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderTree } from '@/components/folder-tree';
import { useLazyFolders, searchFolders, type SearchFolder } from '@/lib/folders';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

type Picked = { id: string; name: string; parent_id: string | null } | null;

/**
 * Shared folder picker dialog. Loads folders lazily (one level per expand) and
 * searches server-side, so it stays responsive in workspaces with tens of
 * thousands of folders. Owns an inline create-folder flow that targets the
 * currently-selected folder (or root).
 */
export function FolderPickerDialog({
  open, onClose, workspaceId, selectedId = null, selectedName = '',
  onSelect, title, confirmLabel, excludeId = null,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  selectedId?: string | null;
  selectedName?: string;
  onSelect: (id: string | null, name: string) => void;
  title?: string;
  confirmLabel?: string;
  excludeId?: string | null;
}) {
  const t = useT();
  const lazy = useLazyFolders(workspaceId, open);
  const [picked, setPicked] = useState<Picked>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchFolder[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPicked(selectedId ? { id: selectedId, name: selectedName, parent_id: null } : null);
      setSearch('');
      setResults([]);
      setCreating(false);
      setNewName('');
    }
  }, [open, selectedId, selectedName]);

  // Debounced server-side search.
  useEffect(() => {
    const q = search.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try { setResults(await searchFolders(workspaceId, q)); } catch { setResults([]); }
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, workspaceId]);

  const pickedName = picked ? (picked.name || t('common.label.folder')) : t('common.label.rootTopLevel');

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const parentId = picked?.id ?? null;
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; folder?: { id: string; name: string; parent_id: string | null } }>(
        '/api/folders',
        { method: 'POST', body: JSON.stringify({ workspace_id: workspaceId, parent_id: parentId, name }) },
      );
      if (res.ok && res.folder) {
        lazy.reload(parentId);                          // new child shows under its parent
        if (picked) {
          lazy.expand(picked.id);
          lazy.reload(picked.parent_id ?? null);        // refresh parent's has-children chevron
        }
        setPicked({ id: res.folder.id, name: res.folder.name, parent_id: parentId });
        setSearch('');
        setCreating(false);
        setNewName('');
        toast.success(t('common.feedback.folderCreated'), t('common.feedback.foldernameIsReadyToUse', { folderName: res.folder.name }));
      }
    } catch (err) {
      toast.error(t('common.error.folderCreationFailed'), apiErrorMessage(err, t('common.error.theFolderCouldNotBeCreated')));
    }
    setBusy(false);
  };

  const inSearchMode = search.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title ?? t('common.label.selectFolder')}</DialogTitle></DialogHeader>

        <Input
          placeholder={t('common.placeholder.searchFolders')}
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          className="h-8 text-xs"
        />

        <div className="max-h-64 overflow-y-auto border rounded-lg p-1">
          {inSearchMode ? (
            searching ? (
              <div className="flex items-center justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
            ) : results.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">{t('common.label.noFoldersMatchSearchtrim', { searchTrim: search.trim() })}</div>
            ) : (
              results.filter((f) => f.id !== excludeId).map((f) => (
                <button
                  key={f.id}
                  className={`w-full flex items-center gap-1.5 py-1.5 pe-3 ps-2 text-xs rounded-md hover:bg-muted/50 text-start ${picked?.id === f.id ? 'bg-primary/10' : ''}`}
                  onClick={() => setPicked({ id: f.id, name: f.name, parent_id: null })}
                >
                  <span className="flex-1 truncate">
                    {f.path && <span className="text-muted-foreground">{f.path} / </span>}
                    {f.name}
                  </span>
                </button>
              ))
            )
          ) : (
            <>
              <button
                className={`w-full flex items-center gap-1.5 py-1.5 px-2 text-xs rounded-md hover:bg-muted/50 text-start ${picked === null ? 'bg-primary/10' : ''}`}
                onClick={() => setPicked(null)}
              >
                <Home className="size-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1">{t('common.action.root')}</span>
              </button>
              <FolderTree
                childrenByParent={lazy.childrenByParent}
                expanded={lazy.expanded}
                loading={lazy.loading}
                rootKey={lazy.rootKey}
                selectedId={picked?.id ?? null}
                onSelect={(f) => setPicked({ id: f.id, name: f.name, parent_id: f.parent_id })}
                onToggle={lazy.toggle}
                excludeId={excludeId}
              />
            </>
          )}
        </div>

        {creating ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              {richText(t('common.label.newFolderInPickedname'), { pickedName: <span className="font-medium text-foreground">{pickedName}</span> })}
            </p>
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                placeholder={t('common.placeholder.folderName')}
                value={newName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                className="h-8 text-xs"
              />
              <Button size="sm" onClick={handleCreate} disabled={busy || !newName.trim()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : t('common.action.create')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setNewName(''); }}>{t('common.cancel')}</Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed text-xs font-medium hover:bg-muted/50 hover:border-solid transition-colors"
          >
            <FolderPlus className="size-3.5" />
            {t('common.action.newFolderPickedSelectTrueInPickednameOtherAtRoot', { picked: picked ? 'true' : 'false', pickedName })}
          </button>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => onSelect(picked?.id ?? null, pickedName)}>{confirmLabel ?? t('common.label.selectFolder')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
