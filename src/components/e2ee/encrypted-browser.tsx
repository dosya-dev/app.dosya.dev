import { useEffect, useRef, useState } from 'react';
import { useE2ee, type EncryptedEntry } from '@/stores/e2ee';
import { MembersPanel } from '@/components/e2ee/members-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  ShieldCheck, LogOut, Plus, Folder, File, Upload, Download, Info, ChevronRight, Users,
} from 'lucide-react';

/**
 * The unlocked encrypted-workspace surface: pick/create a workspace, browse
 * its (client-decrypted) contents, upload/download. Visually echoes the
 * Files page's card/grid language (see src/pages/files.tsx) without
 * importing its internals — these cards are deliberately lighter (no
 * thumbnails/share/comments, since encrypted entries carry no such metadata
 * yet).
 */
export function EncryptedBrowser() {
  const workspaces = useE2ee((s) => s.workspaces);
  const activeWorkspaceId = useE2ee((s) => s.activeWorkspaceId);
  const entries = useE2ee((s) => s.entries);
  const busy = useE2ee((s) => s.busy);
  const error = useE2ee((s) => s.error);
  const lock = useE2ee((s) => s.lock);
  const createWorkspace = useE2ee((s) => s.createWorkspace);
  const openWorkspace = useE2ee((s) => s.openWorkspace);
  const refreshMyWorkspaces = useE2ee((s) => s.refreshMyWorkspaces);
  const refreshFolder = useE2ee((s) => s.refreshFolder);
  const refreshMembers = useE2ee((s) => s.refreshMembers);
  const uploadFiles = useE2ee((s) => s.uploadFiles);
  const downloadEntry = useE2ee((s) => s.downloadEntry);

  const [newWsOpen, setNewWsOpen] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [membersOpen, setMembersOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Subfolder navigation: the store's refreshFolder/uploadFiles/downloadEntry
  // all accept an optional folderId, and listFolder can return kind:'folder'
  // entries, so a flat root-only view would leave any nested folder
  // permanently unreachable. This local breadcrumb stack drives that folderId
  // — no store changes needed, it's just component-local UI state.
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const currentFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : '';

  // On mount (i.e. right after unlock — this component only renders once
  // status === 'unlocked') pull in any workspaces shared with this account,
  // so an invitee sees them in the bar below without a manual refresh.
  useEffect(() => {
    refreshMyWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectWorkspace = async (id: string) => {
    setFolderPath([]);
    await openWorkspace(id);
    // Only follow up with a listing if the open actually succeeded — the
    // engine rejects unknown/un-openable workspaces, and firing
    // refreshFolder anyway would overwrite that error with a generic
    // "Could not load folder." message.
    if (useE2ee.getState().activeWorkspaceId === id) {
      await refreshFolder('');
      await refreshMembers();
    }
  };

  const handleCreateWorkspace = async () => {
    const name = newWsName.trim();
    if (!name) return;
    await createWorkspace(name);
    const state = useE2ee.getState();
    if (!state.error && state.activeWorkspaceId) {
      setNewWsOpen(false);
      setNewWsName('');
      setFolderPath([]);
      await refreshFolder('');
    }
  };

  const handleOpenFolder = async (entry: EncryptedEntry) => {
    setFolderPath((prev) => [...prev, { id: entry.id, name: entry.name }]);
    await refreshFolder(entry.id);
  };

  const handleBreadcrumb = async (index: number) => {
    if (index < 0) {
      setFolderPath([]);
      await refreshFolder('');
      return;
    }
    const next = folderPath.slice(0, index + 1);
    setFolderPath(next);
    await refreshFolder(next[next.length - 1].id);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files, currentFolderId);
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (activeWorkspaceId) setDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.currentTarget === e.target) setDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    if (!activeWorkspaceId) return;
    const dropped = e.dataTransfer.files;
    if (dropped.length > 0) uploadFiles(dropped, currentFolderId);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <ShieldCheck className="size-3 text-green-600" /> End-to-end encrypted
          </Badge>
          <h1 className="text-lg font-semibold">Vault</h1>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => lock()}>
          <LogOut className="size-3.5" /> Lock
        </Button>
      </div>

      {/* Disclosure banner — the accurate R2-on-dev limitation */}
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Files here are end-to-end encrypted in your browser. Chunk upload/download requires the
          production storage backend — on local dev the file list works, but chunk transfer may fail
          against the dev R2 stub.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Workspace bar */}
      <div className="flex flex-wrap items-center gap-2">
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            onClick={() => handleSelectWorkspace(ws.id)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              ws.id === activeWorkspaceId
                ? 'border-primary bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted/60'
            }`}
          >
            {ws.name}
            {!ws.selfFounded && (
              <Badge variant="secondary" className="text-[9px]">Shared</Badge>
            )}
          </button>
        ))}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setNewWsOpen(true)}>
          <Plus className="size-3.5" /> New Space
        </Button>
      </div>

      {/* Folder view */}
      {activeWorkspace ? (
        <div
          className="relative min-h-64 rounded-xl border border-dashed p-4"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5">
              <div className="flex flex-col items-center gap-2 text-primary">
                <Upload className="size-10" />
                <p className="text-sm font-semibold">Drop files to encrypt &amp; upload</p>
              </div>
            </div>
          )}

          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1 text-xs">
              <button onClick={() => handleBreadcrumb(-1)} className="font-medium hover:text-foreground text-muted-foreground truncate">
                {activeWorkspace.name}
              </button>
              {folderPath.map((f, i) => (
                <span key={f.id} className="flex items-center gap-1 shrink-0">
                  <ChevronRight className="size-3 text-muted-foreground" />
                  <button onClick={() => handleBreadcrumb(i)} className="text-muted-foreground hover:text-foreground truncate max-w-32">
                    {f.name}
                  </button>
                </span>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setMembersOpen(true)}>
                <Users className="size-3.5" /> Members
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                <Upload className="size-3.5" /> Upload
              </Button>
            </div>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInput} />
          </div>

          {busy ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-3/2 w-full rounded-xl" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Folder className="mb-3 size-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No files yet — upload to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {entries.map((entry) =>
                entry.kind === 'folder' ? (
                  <EncryptedFolderCard key={entry.id} name={entry.name} onClick={() => handleOpenFolder(entry)} />
                ) : (
                  <EncryptedFileCard
                    key={entry.id}
                    name={entry.name}
                    onDownload={() => downloadEntry(entry.id, entry.name, currentFolderId)}
                  />
                ),
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <ShieldCheck className="mb-3 size-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Select or create a Space to get started.</p>
        </div>
      )}

      {/* New workspace dialog */}
      <Dialog open={newWsOpen} onOpenChange={setNewWsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Space</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="e2ee-ws-name">Name</Label>
            <Input
              id="e2ee-ws-name"
              autoFocus
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateWorkspace(); }}
              placeholder="e.g. Personal documents"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewWsOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateWorkspace} disabled={!newWsName.trim() || busy}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members panel — invite/revoke + the §11/§8 disclosures */}
      {activeWorkspace && (
        <MembersPanel
          open={membersOpen}
          onOpenChange={setMembersOpen}
          workspaceName={activeWorkspace.name}
        />
      )}
    </div>
  );
}

// ── Lightweight cards mirroring files.tsx's FolderCard/FileCard look ───────

function EncryptedFolderCard({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Card
      className="gap-0 cursor-pointer py-0 p-3 transition-all hover:-translate-y-px hover:shadow-md"
      onClick={onClick}
    >
      <div className="mb-2 flex items-center gap-2">
        <Folder className="size-6 text-muted-foreground" />
      </div>
      <p className="truncate text-xs font-medium">{name}</p>
      <p className="text-[10px] text-muted-foreground">Encrypted folder</p>
    </Card>
  );
}

function EncryptedFileCard({ name, onDownload }: { name: string; onDownload: () => void }) {
  const ext = (name.split('.').pop() || 'FILE').toUpperCase();
  return (
    <Card className="group relative aspect-3/2 gap-0 overflow-hidden rounded-xl p-0 py-0 ring-1 ring-black/5 transition-all hover:-translate-y-px hover:shadow-lg dark:ring-white/10">
      <div className="absolute inset-0 flex items-center justify-center bg-linear-to-br from-muted to-background">
        <File className="size-8 text-muted-foreground/50" />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-black/80 via-black/40 to-transparent" />
      <span className="absolute top-2 right-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
        {ext}
      </span>
      <button
        className="absolute bottom-2 right-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/35 opacity-0 backdrop-blur-sm transition-colors hover:bg-black/55 group-hover:opacity-100"
        title="Download"
        onClick={(e) => { e.stopPropagation(); onDownload(); }}
      >
        <Download className="size-4 text-white" />
      </button>
      <p className="absolute inset-x-0 bottom-0 z-0 truncate p-2.5 pr-12 font-mono text-sm font-semibold text-white drop-shadow">
        {name}
      </p>
    </Card>
  );
}
