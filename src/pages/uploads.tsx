import { useState, useEffect, useRef, memo, type DragEvent, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Upload, FolderPlus, Globe, Info, Check, AlertCircle, Loader2, Home, FolderOpen } from 'lucide-react';
import { humanSize, folderIconSrc } from '@/lib/helpers';
import { toast } from '@/lib/toast';

interface RegionInfo { code: string; city: string; country: string }
interface PickerFolder { id: string; name: string; parent_id: string | null; file_count: number }
interface QueueItem {
  id: string;
  fileName: string;
  fileSize: number;
  status: 'pending' | 'uploading' | 'complete' | 'error';
  progress: number;
  error?: string;
}


export default function UploadsPage() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [searchParams] = useSearchParams();
  const [folderId, setFolderId] = useState<string | null>(searchParams.get('folder'));
  const [folderName, setFolderName] = useState(searchParams.get('folder_name') || 'Root (top level)');
  const [selectedRegion, setSelectedRegion] = useState('ap-southeast-2');
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [folders, setFolders] = useState<PickerFolder[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selectFolderOpen, setSelectFolderOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload state kept outside React to avoid re-render loops
  const fileMap = useRef(new Map<string, File>());
  const pending = useRef<string[]>([]);
  const busy = useRef(false);
  const setQueueRef = useRef(setQueue);
  const wsIdRef = useRef(wsId);
  const folderIdRef = useRef(folderId);
  const regionRef = useRef(selectedRegion);

  setQueueRef.current = setQueue;
  wsIdRef.current = wsId;
  folderIdRef.current = folderId;
  regionRef.current = selectedRegion;

  // Load regions + folders
  useEffect(() => {
    if (!wsId) return;
    (async () => {
      try {
        const [regRes, wsRes, folderRes] = await Promise.all([
          api<{ ok: boolean; regions: RegionInfo[] }>('/api/regions'),
          api<{ ok: boolean; workspace?: { default_region: string }; settings?: { available_regions: string | null } | null }>(`/api/workspaces/${wsId}`),
          api<{ ok: boolean; folders?: PickerFolder[] }>(`/api/folders/tree?workspace_id=${wsId}`),
        ]);
        if (regRes.ok) {
          let available: string[] = [];
          if (wsRes.ok && wsRes.settings?.available_regions) {
            try { available = JSON.parse(wsRes.settings.available_regions); } catch { /* */ }
          }
          setRegions(available.length > 0 ? regRes.regions.filter((r) => available.includes(r.code)) : regRes.regions);
          if (wsRes.ok && wsRes.workspace?.default_region) setSelectedRegion(wsRes.workspace.default_region);
        }
        if (folderRes.ok && folderRes.folders) setFolders(folderRes.folders);
      } catch { /* */ }
    })();
  }, [wsId]);

  // The upload runner — never recurses, uses async/await only
  async function runUploadQueue() {
    if (busy.current) return;
    busy.current = true;

    while (pending.current.length > 0) {
      const id = pending.current.shift()!;
      const file = fileMap.current.get(id);
      if (!file) continue;

      // Mark uploading
      setQueueRef.current((prev) => prev.map((q) => q.id === id ? { ...q, status: 'uploading' as const, progress: 0 } : q));

      try {
        // 1. Init
        const initRes = await fetch(`${API_BASE}/api/upload/init`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: wsIdRef.current,
            folder_id: folderIdRef.current,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type || 'application/octet-stream',
            region: regionRef.current,
          }),
        });
        const initData = await initRes.json();
        if (!initRes.ok || !initData.ok || !initData.upload_url) {
          throw new Error(initData.error ?? 'Init failed');
        }

        // 2. Upload via XHR (for progress)
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', `${API_BASE}${initData.upload_url}`);
          xhr.withCredentials = true;
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

          let lastTick = 0;
          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            const now = Date.now();
            if (now - lastTick < 300) return;
            lastTick = now;
            const pct = Math.round((e.loaded / e.total) * 100);
            setQueueRef.current((prev) => prev.map((q) => q.id === id ? { ...q, progress: pct } : q));
          };

          xhr.onload = () => {
            try {
              const d = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300 && d.ok) {
                setQueueRef.current((prev) => prev.map((q) => q.id === id ? { ...q, status: 'complete' as const, progress: 100 } : q));
                toast.success('Upload complete', `"${file.name}" was uploaded successfully.`);
                resolve();
              } else {
                reject(new Error(d.error ?? `HTTP ${xhr.status}`));
              }
            } catch { reject(new Error(`HTTP ${xhr.status}`)); }
          };
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send(file);
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setQueueRef.current((prev) => prev.map((q) => q.id === id ? { ...q, status: 'error' as const, error: msg } : q));
        toast.error('Upload failed', `"${file.name}": ${msg}`);
      }

      fileMap.current.delete(id);
    }

    busy.current = false;
  }

  function addFiles(files: FileList | File[]) {
    const items: QueueItem[] = [];
    Array.from(files).forEach((file, i) => {
      const id = `up_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
      fileMap.current.set(id, file);
      pending.current.push(id);
      items.push({ id, fileName: file.name, fileSize: file.size, status: 'pending', progress: 0 });
    });
    setQueue((prev) => [...prev, ...items]);
    // Start processing after React flushes the state update
    setTimeout(runUploadQueue, 10);
  }

  const clearDone = () => setQueue((prev) => prev.filter((e) => e.status !== 'complete' && e.status !== 'error'));
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files); };
  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ''; } };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const data = await api<{ ok: boolean; folder?: { id: string; name: string }; error?: string }>('/api/folders', {
        method: 'POST', body: JSON.stringify({ workspace_id: wsId, parent_id: folderId, name: newFolderName.trim() }),
      });
      if (data.ok && data.folder) {
        setFolders((prev) => [...prev, { id: data.folder!.id, name: data.folder!.name, parent_id: folderId, file_count: 0 }]);
        setFolderId(data.folder.id); setFolderName(data.folder.name);
        toast.success('Folder created', `"${data.folder.name}" is ready to use.`);
        setCreateFolderOpen(false); setNewFolderName('');
      } else toast.error('Folder creation failed', data.error ?? 'Could not create folder');
    } catch { toast.error('Folder creation failed', 'The folder could not be created.'); }
    setCreatingFolder(false);
  };

  const totalBytes = queue.reduce((s, e) => s + e.fileSize, 0);
  const doneCount = queue.filter((e) => e.status === 'complete').length;

  return (
    <div className="p-6 overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">Upload files</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {folderId ? <>Uploading to <span className="font-semibold text-foreground">{folderName}</span> · encrypted in transit</> : 'Files are end-to-end encrypted in transit. You pick the region.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="space-y-4">
          <div
            className={`border-2 border-dashed rounded-xl bg-card p-12 text-center cursor-pointer transition-colors ${dragging ? 'border-green-500 bg-green-50/50 dark:bg-green-950/20' : 'border-border hover:border-muted-foreground/30'}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input ref={fileInputRef} type="file" multiple hidden onChange={onFileChange} />
            <Upload className="size-10 text-muted-foreground mx-auto mb-4" />
            <p className="font-semibold text-sm mb-1">Drop files here to upload</p>
            <p className="text-xs text-muted-foreground mb-4">
              Drag and drop anything, or{' '}
              <button className="font-semibold text-foreground underline" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>browse your computer</button>. No file size limit on Pro.
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              {['Video', 'Images', 'Documents', 'Archives', 'Any format'].map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
            </div>
          </div>

          {queue.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-sm font-semibold">Upload queue</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">{queue.length} file{queue.length !== 1 ? 's' : ''} · {humanSize(totalBytes)} total · {doneCount} complete</p>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={clearDone}>Clear done</Button>
              </CardHeader>
              <CardContent className="space-y-0">
                {queue.map((item) => <QueueRow key={item.id} item={item} />)}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Upload options</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><FolderOpen className="size-3" /> Folder</p>
              <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted/50 text-xs hover:bg-muted transition-colors text-left" onClick={() => setSelectFolderOpen(true)}>
                {folderId
                  ? <img src={folderIconSrc(folders.find((f) => f.id === folderId)?.file_count ?? 0)} alt="" className="size-3.5 shrink-0" />
                  : <Home className="size-3.5 text-muted-foreground shrink-0" />}
                <span className="flex-1 truncate">{folderName}</span>
              </button>
              <button className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setCreateFolderOpen(true)}>
                <FolderPlus className="size-3" /> Create new folder
              </button>
            </div>
            <div className="border-t" />
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><Globe className="size-3" /> Select region</p>
              <div className="grid grid-cols-2 gap-1.5 max-h-50 overflow-y-auto">
                {[...regions].sort((a, b) => (a.code === selectedRegion ? -1 : b.code === selectedRegion ? 1 : 0)).map((r) => (
                  <button key={r.code} className={`flex flex-col px-2.5 py-2 rounded-lg border text-left transition-colors ${r.code === selectedRegion ? 'border-green-500 bg-green-50 dark:bg-green-950/30' : 'hover:bg-muted/50'}`} onClick={() => setSelectedRegion(r.code)}>
                    <span className="text-[11px] font-medium">{r.city}, {r.country}</span>
                    <span className="text-[10px] text-muted-foreground">{r.code}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t" />
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Info className="size-3" /> No egress fees · ever</p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Info className="size-3" /> Encrypted in transit with <span className="font-semibold">TLS 1.3</span></p>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectFolderOpen && (
        <FolderPickerDialog open onClose={() => setSelectFolderOpen(false)} folders={folders} selectedId={folderId}
          onSelect={(id, name) => { setFolderId(id); setFolderName(name); setSelectFolderOpen(false); toast.success('Uploading here', `New files will go to "${name}".`); }} />
      )}

      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create new folder</DialogTitle></DialogHeader>
          <Input placeholder="e.g. Project Assets" value={newFolderName} onChange={(e: ChangeEvent<HTMLInputElement>) => setNewFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()} maxLength={100} />
          <p className="text-xs text-muted-foreground">{folderId ? `Will be created inside "${folderName}"` : 'Will be created at root level'}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateFolder} disabled={creatingFolder}>{creatingFolder ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null} Create folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const QueueRow = memo(function QueueRow({ item }: { item: QueueItem }) {
  const ext = item.fileName.includes('.') ? item.fileName.split('.').pop()!.toUpperCase() : 'FILE';
  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-b-0">
      <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-[9px] font-bold tracking-wider text-muted-foreground bg-muted">
        {ext}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate mb-1">{item.fileName}</p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{humanSize(item.fileSize)}</span>
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${item.status === 'error' ? 0 : item.progress}%`, background: item.status === 'error' ? '#ef4444' : '#22c55e' }} />
          </div>
          <span className={`text-[11px] font-medium min-w-7 text-right ${item.status === 'error' ? 'text-destructive' : item.status === 'complete' ? 'text-green-600' : 'text-muted-foreground'}`}>
            {item.status === 'complete' ? 'Done' : item.status === 'error' ? 'Error' : item.status === 'uploading' ? `${item.progress}%` : '—'}
          </span>
        </div>
      </div>
      <div className="shrink-0">
        {item.status === 'complete' && <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center"><Check className="size-3 text-green-600" /></div>}
        {item.status === 'error' && <div className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center"><AlertCircle className="size-3 text-red-500" /></div>}
        {item.status === 'uploading' && <Loader2 className="size-5 text-green-600 animate-spin" />}
        {item.status === 'pending' && <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-muted-foreground/30" /></div>}
      </div>
    </div>
  );
});

function FolderPickerDialog({ open, onClose, folders, selectedId, onSelect }: {
  open: boolean; onClose: () => void; folders: PickerFolder[]; selectedId: string | null;
  onSelect: (id: string | null, name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(selectedId);

  useEffect(() => { if (open) { setPicked(selectedId); setSearch(''); } }, [open, selectedId]);

  const q = search.trim().toLowerCase();

  // No search → hierarchical tree (depth-indented). Search → flat matches with breadcrumb path.
  const treeRows: { folder: PickerFolder; depth: number }[] = [];
  if (!q) {
    const pushChildren = (parentId: string | null, depth: number) => {
      folders
        .filter((f) => f.parent_id === parentId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((f) => { treeRows.push({ folder: f, depth }); pushChildren(f.id, depth + 1); });
    };
    pushChildren(null, 0);
  }
  const matches = q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : [];

  const pathOf = (f: PickerFolder): string => {
    const parts: string[] = [];
    let pid = f.parent_id;
    while (pid) { const p = folders.find((x) => x.id === pid); if (!p) break; parts.unshift(p.name); pid = p.parent_id; }
    return parts.length ? parts.join(' / ') + ' / ' : '';
  };

  const rowCls = (id: string | null) =>
    `w-full flex items-center gap-2 pr-2.5 py-2 text-xs border-b last:border-b-0 hover:bg-muted/50 text-left ${picked === id ? 'bg-green-50 dark:bg-green-950/30' : ''}`;
  const selectedBadge = <Badge className="text-[9px] bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400">selected</Badge>;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Select folder</DialogTitle></DialogHeader>
        <Input placeholder="Search folders..." value={search} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="h-8 text-xs" />
        <div className="max-h-70 overflow-y-auto border rounded-lg">
          <button className={rowCls(null)} style={{ paddingLeft: 10 }} onClick={() => setPicked(null)}>
            <Home className="size-3.5 text-muted-foreground shrink-0" /><span className="flex-1 truncate">Root (top level)</span>
            {picked === null && selectedBadge}
          </button>

          {q ? (
            matches.length === 0 ? (
              <div className="px-2.5 py-3 text-center text-xs text-muted-foreground">No folders match "{search}"</div>
            ) : matches.map((f) => (
              <button key={f.id} className={rowCls(f.id)} style={{ paddingLeft: 10 }} onClick={() => setPicked(f.id)}>
                <img src={folderIconSrc(f.file_count)} alt="" className="size-3.5 shrink-0" />
                <span className="flex-1 truncate"><span className="text-muted-foreground">{pathOf(f)}</span>{f.name}</span>
                {picked === f.id && selectedBadge}
              </button>
            ))
          ) : (
            treeRows.map(({ folder, depth }) => (
              <button key={folder.id} className={rowCls(folder.id)} style={{ paddingLeft: 10 + depth * 18 }} onClick={() => setPicked(folder.id)}>
                <img src={folderIconSrc(folder.file_count)} alt="" className="size-3.5 shrink-0" />
                <span className="flex-1 truncate">{folder.name}</span>
                {picked === folder.id && selectedBadge}
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSelect(picked, picked === null ? 'Root (top level)' : folders.find((f) => f.id === picked)?.name ?? 'Folder')}>Select folder</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
