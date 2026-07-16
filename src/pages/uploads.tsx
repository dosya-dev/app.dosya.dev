import { useState, useEffect, useRef, memo, type DragEvent, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { useUploads } from '@/stores/uploads';
import { useShallow } from 'zustand/react/shallow';
import type { UploadItem } from '@/lib/upload-types';
import { enqueue, setWorkspaceCap } from '@/lib/upload-runner';
import {
  getUserConcurrency, setUserConcurrency, MAX_USER_CONCURRENCY,
} from '@/lib/upload-concurrency';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Upload, Globe, Info, Check, AlertCircle, Loader2, Home, FolderOpen, Layers } from 'lucide-react';
import { humanSize, folderIconSrc } from '@/lib/helpers';
import { toast } from '@/lib/toast';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';

interface RegionInfo { code: string; city: string; country: string }


export default function UploadsPage() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [searchParams] = useSearchParams();
  const [folderId, setFolderId] = useState<string | null>(searchParams.get('folder'));
  const [folderName, setFolderName] = useState(searchParams.get('folder_name') || 'Root (top level)');
  const [selectedRegion, setSelectedRegion] = useState('ap-southeast-2');
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selectFolderOpen, setSelectFolderOpen] = useState(false);
  const [concurrency, setConcurrency] = useState(getUserConcurrency());
  const [wsMaxUploads, setWsMaxUploads] = useState<number>(0); // 0 = unlimited
  const fileInputRef = useRef<HTMLInputElement>(null);

  // This workspace's queue, from the global store. useShallow keeps the
  // filtered array reference stable across renders (zustand v5 has no built-in
  // selector memoization, so returning a fresh array here would loop forever).
  const queue = useUploads(useShallow((s) => s.items.filter((i) => i.workspace_id === wsId)));

  // Load regions + folders + workspace concurrency cap
  useEffect(() => {
    if (!wsId) return;
    (async () => {
      try {
        const [regRes, wsRes] = await Promise.all([
          api<{ ok: boolean; regions: RegionInfo[] }>('/api/regions'),
          api<{ ok: boolean; workspace?: { default_region: string }; settings?: { available_regions: string | null; max_concurrent_uploads: number } | null }>(`/api/workspaces/${wsId}`),
        ]);
        if (regRes.ok) {
          let available: string[] = [];
          if (wsRes.ok && wsRes.settings?.available_regions) {
            try { available = JSON.parse(wsRes.settings.available_regions); } catch { /* */ }
          }
          setRegions(available.length > 0 ? regRes.regions.filter((r) => available.includes(r.code)) : regRes.regions);
          if (wsRes.ok && wsRes.workspace?.default_region) setSelectedRegion(wsRes.workspace.default_region);
        }
        const cap = wsRes.ok ? (wsRes.settings?.max_concurrent_uploads ?? 0) : 0;
        setWsMaxUploads(cap);
        setWorkspaceCap(cap);
        if (cap > 0 && getUserConcurrency() > cap) { setUserConcurrency(cap); setConcurrency(cap); }
      } catch { /* */ }
    })();
  }, [wsId]);

  function addFiles(files: FileList | File[]) {
    if (!wsId) return;
    enqueue(files, { workspace_id: wsId, folder_id: folderId, region: selectedRegion });
  }

  const onConcurrencyChange = (n: number) => { setConcurrency(n); setUserConcurrency(n); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files); };
  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ''; } };

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
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => useUploads.getState().clearFinished()}>Clear done</Button>
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
                  ? <img src={folderIconSrc(0)} alt="" className="size-3.5 shrink-0" />
                  : <Home className="size-3.5 text-muted-foreground shrink-0" />}
                <span className="flex-1 truncate">{folderName}</span>
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
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><Layers className="size-3" /> Simultaneous uploads</p>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: MAX_USER_CONCURRENCY }, (_, i) => i + 1)
                  .filter((n) => wsMaxUploads <= 0 || n <= wsMaxUploads)
                  .map((n) => (
                    <button
                      key={n}
                      className={`w-8 h-8 rounded-lg border text-xs font-medium transition-colors ${concurrency === n ? 'border-green-500 bg-green-50 dark:bg-green-950/30' : 'hover:bg-muted/50'}`}
                      onClick={() => onConcurrencyChange(n)}
                    >{n}</button>
                  ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                {wsMaxUploads > 0
                  ? `Your workspace allows up to ${wsMaxUploads} at a time.`
                  : `Upload up to ${concurrency} file${concurrency === 1 ? '' : 's'} at once.`}
              </p>
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
        <FolderPickerDialog
          open
          onClose={() => setSelectFolderOpen(false)}
          workspaceId={wsId}
          selectedId={folderId}
          selectedName={folderName}
          onSelect={(id, name) => { setFolderId(id); setFolderName(name); setSelectFolderOpen(false); toast.success('Uploading here', `New files will go to "${name}".`); }}
        />
      )}
    </div>
  );
}

const QueueRow = memo(function QueueRow({ item }: { item: UploadItem }) {
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
          <Progress
            value={item.status === 'error' ? 0 : item.progress}
            className="flex-1 **:data-[slot=progress-indicator]:bg-(--bar-color) **:data-[slot=progress-indicator]:duration-300"
            style={{ '--bar-color': item.status === 'error' ? '#ef4444' : '#22c55e' } as React.CSSProperties}
          />
          <span className={`text-[11px] font-medium min-w-7 text-right ${item.status === 'error' ? 'text-destructive' : item.status === 'complete' ? 'text-green-600' : 'text-muted-foreground'}`}>
            {item.status === 'complete' ? 'Done' : item.status === 'error' ? 'Error' : item.status === 'uploading' ? `${item.progress}%` : '—'}
          </span>
        </div>
      </div>
      <div className="shrink-0">
        {item.status === 'complete' && <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center"><Check className="size-3 text-green-600" /></div>}
        {item.status === 'error' && <div className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center"><AlertCircle className="size-3 text-red-500" /></div>}
        {item.status === 'uploading' && <Loader2 className="size-5 text-green-600 animate-spin" />}
        {(item.status === 'queued' || item.status === 'interrupted' || item.status === 'canceled') && <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-muted-foreground/30" /></div>}
      </div>
    </div>
  );
});

