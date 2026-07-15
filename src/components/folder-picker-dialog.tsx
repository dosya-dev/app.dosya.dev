import { useEffect, useState, type ChangeEvent } from 'react';
import { Home, FolderPlus, Loader2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/api/client';
import { toast } from '@/lib/toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderTree } from '@/components/folder-tree';
import { type PickerFolder } from '@/lib/folders';

/**
 * Shared folder picker dialog. Wraps FolderTree with search, a Root row, an inline
 * create-folder flow (owns the POST), and a confirm footer. Consumers own the folder
 * list (via useFolderTree) so their triggers stay in sync through onFoldersChange.
 */
export function FolderPickerDialog({
  open, onClose, workspaceId, folders, onFoldersChange,
  selectedId, onSelect, title = 'Select folder', confirmLabel = 'Select folder', excludeId = null,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  folders: PickerFolder[];
  onFoldersChange: (next: PickerFolder[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null, name: string) => void;
  title?: string;
  confirmLabel?: string;
  excludeId?: string | null;
}) {
  const [picked, setPicked] = useState<string | null>(selectedId);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPicked(selectedId);
      setSearch('');
      setCreating(false);
      setNewName('');
    }
  }, [open, selectedId]);

  const nameOf = (id: string | null) =>
    id === null ? 'Root (top level)' : folders.find((f) => f.id === id)?.name ?? 'Folder';

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; folder?: { id: string; name: string; parent_id: string | null } }>(
        '/api/folders',
        { method: 'POST', body: JSON.stringify({ workspace_id: workspaceId, parent_id: picked, name }) },
      );
      if (res.ok && res.folder) {
        const created: PickerFolder = {
          id: res.folder.id,
          name: res.folder.name,
          parent_id: res.folder.parent_id ?? picked,
          file_count: 0,
        };
        onFoldersChange([...folders, created]);
        setPicked(created.id);
        setCreating(false);
        setNewName('');
        toast.success('Folder created', `"${created.name}" is ready to use.`);
      }
    } catch (err) {
      toast.error('Folder creation failed', apiErrorMessage(err, 'The folder could not be created.'));
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>

        <Input
          placeholder="Search folders..."
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          className="h-8 text-xs"
        />

        <div className="max-h-64 overflow-y-auto border rounded-lg p-1">
          {!search.trim() && (
            <button
              className={`w-full flex items-center gap-1.5 py-1.5 px-2 text-xs rounded-md hover:bg-muted/50 text-left ${picked === null ? 'bg-primary/10' : ''}`}
              onClick={() => setPicked(null)}
            >
              <Home className="size-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1">Root</span>
            </button>
          )}
          <FolderTree
            folders={folders}
            selectedId={picked}
            onSelect={setPicked}
            excludeId={excludeId}
            query={search}
          />
        </div>

        {creating ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              New folder in <span className="font-medium text-foreground">{nameOf(picked)}</span>
            </p>
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                placeholder="Folder name"
                value={newName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                className="h-8 text-xs"
              />
              <Button size="sm" onClick={handleCreate} disabled={busy || !newName.trim()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'Create'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setNewName(''); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed text-xs font-medium hover:bg-muted/50 hover:border-solid transition-colors"
          >
            <FolderPlus className="size-3.5" />
            New folder {picked !== null ? `in "${nameOf(picked)}"` : 'at root'}
          </button>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSelect(picked, nameOf(picked))}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
