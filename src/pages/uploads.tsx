import { useState, useEffect, useRef, memo, type DragEvent, type ChangeEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { useUploads } from '@/stores/uploads';
import { useShallow } from 'zustand/react/shallow';
import type { UploadItem } from '@/lib/upload-types';
import { setWorkspaceCap, retry, retryAllFailed, canRetry } from '@/lib/upload-runner';
import { uploadFromDrop, uploadFromPicker } from '@/lib/upload-drop';
import {
  getUserConcurrency, setUserConcurrency, MAX_USER_CONCURRENCY,
} from '@/lib/upload-concurrency';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Upload, Info, Check, AlertCircle, Loader2, Home, FolderOpen, Layers, RotateCw } from 'lucide-react';
import { humanSize, folderIconSrc } from '@/lib/helpers';
import { toast } from '@/lib/toast';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';

export default function UploadsPage() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [searchParams] = useSearchParams();
  const [folderId, setFolderId] = useState<string | null>(searchParams.get('folder'));
  const [folderName, setFolderName] = useState(searchParams.get('folder_name') || 'Root (top level)');
  // Set when the Files page sent us here from a group view. Groups are flat
  // collections rather than folders, so the file still lands in a folder; the
  // upload runner enrols it into the group once it completes.
  const groupId = searchParams.get('group');
  const [groupName, setGroupName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [selectFolderOpen, setSelectFolderOpen] = useState(false);
  const [concurrency, setConcurrency] = useState(getUserConcurrency());
  const [wsMaxUploads, setWsMaxUploads] = useState<number>(0); // 0 = unlimited
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // This workspace's queue, from the global store. useShallow keeps the
  // filtered array reference stable across renders (zustand v5 has no built-in
  // selector memoization, so returning a fresh array here would loop forever).
  const queue = useUploads(useShallow((s) => s.items.filter((i) => i.workspace_id === wsId)));

  // Turns the second hidden input into a folder picker. Set as an attribute
  // because React's input types have no webkitdirectory prop.
  useEffect(() => {
    const el = folderInputRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, []);

  // Load the workspace's concurrency cap. Nothing here asks about locations any
  // more: every file in a workspace lives in the workspace's own location.
  useEffect(() => {
    if (!wsId) return;
    (async () => {
      try {
        const wsRes = await api<{ ok: boolean; settings?: { max_concurrent_uploads: number } | null }>(`/api/workspaces/${wsId}`);
        const cap = wsRes.ok ? (wsRes.settings?.max_concurrent_uploads ?? 0) : 0;
        setWsMaxUploads(cap);
        setWorkspaceCap(cap);
        if (cap > 0 && getUserConcurrency() > cap) { setUserConcurrency(cap); setConcurrency(cap); }
      } catch { /* */ }
    })();
  }, [wsId]);

  // Resolve the group's display name so the header can say where files are going.
  useEffect(() => {
    if (!wsId || !groupId) { setGroupName(''); return; }
    (async () => {
      try {
        const data = await api<{ ok: boolean; groups?: { id: string; name: string }[] }>(`/api/groups?workspace_id=${wsId}`);
        if (data.ok) setGroupName(data.groups?.find((g) => g.id === groupId)?.name ?? '');
      } catch { /* header just falls back to "this group" */ }
    })();
  }, [wsId, groupId]);

  const uploadInput = () => ({
    workspace_id: wsId, folder_id: folderId, group_id: groupId,
  });

  const onConcurrencyChange = (n: number) => { setConcurrency(n); setUserConcurrency(n); };
  // Synchronous by necessity: uploadFromDrop reads dataTransfer.items - the only
  // way to see inside a dropped folder - and that list dies with this handler.
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (!wsId || !e.dataTransfer) return;
    void uploadFromDrop(e.dataTransfer, uploadInput());
  };
  // Files from the folder picker carry webkitRelativePath, so the same tree is
  // rebuilt server-side as for a drop.
  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (wsId && e.target.files?.length) void uploadFromPicker(e.target.files, uploadInput());
    e.target.value = '';
  };

  const totalBytes = queue.reduce((s, e) => s + e.fileSize, 0);
  const doneCount = queue.filter((e) => e.status === 'complete').length;
  const failedCount = queue.filter((e) => e.status === 'error').length;

  return (
    <div className="p-6 overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">Upload files</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {folderId
            ? <>Uploading to <span className="font-semibold text-foreground">{folderName}</span> · encrypted in transit</>
            : groupId
              ? <>Uploading to <span className="font-semibold text-foreground">{groupName || 'this group'}</span> · files land at the top level and are added to the group</>
              : "Files are end-to-end encrypted in transit and stored in this workspace's location."}
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
            {/* webkitdirectory is set on the element rather than written as a JSX
                prop: React types do not carry it, and setAttribute works the same
                in every engine that supports folder picking. */}
            <input ref={folderInputRef} type="file" multiple hidden onChange={onFileChange} />
            <Upload className="size-10 text-muted-foreground mx-auto mb-4" />
            <p className="font-semibold text-sm mb-1">Drop files or folders here to upload</p>
            <p className="text-xs text-muted-foreground mb-4">
              Drag and drop anything - folders keep their structure. Or{' '}
              <button className="font-semibold text-foreground underline" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>browse for files</button>
              {' '}or{' '}
              <button className="font-semibold text-foreground underline" onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}>pick a folder</button>. No file size limit on Pro.
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
                <div className="flex items-center gap-1.5">
                  {failedCount > 0 && (
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => retryAllFailed()}>
                      <RotateCw className="size-3" /> Retry all failed
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => useUploads.getState().clearFinished()}>Clear done</Button>
                </div>
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

export const QueueRow = memo(function QueueRow({ item }: { item: UploadItem }) {
  const ext = item.fileName.includes('.') ? item.fileName.split('.').pop()!.toUpperCase() : 'FILE';
  const navigate = useNavigate();

  // A finished upload used to say "Done" and stop there - the file was in the
  // workspace but there was no way to get to it from here. Deep-link to it on
  // the Files page (which scrolls to and highlights `?file=`), and offer the
  // containing folder separately for "where did that land?".
  const openFile = () => {
    if (!item.fileId) { navigate('/files'); return; }
    navigate(`/files?file=${item.fileId}${item.folder_id ? `&folder=${item.folder_id}` : ''}`);
  };
  const openFolder = () => navigate(item.folder_id ? `/files?folder=${item.folder_id}` : '/files');

  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-b-0">
      <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-[9px] font-bold tracking-wider text-muted-foreground bg-muted">
        {ext}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-xs font-medium truncate">{item.fileName}</p>
          {item.status === 'error' && (() => {
            // The bytes live in memory only, so a row that outlived a reload
            // has nothing to send. Saying so beats a button that does nothing.
            const retryable = canRetry(item.id);
            return (
              <button
                type="button"
                onClick={() => retry(item.id)}
                disabled={!retryable}
                title={retryable ? 'Try this upload again' : 'Add the file again to upload it - this tab no longer has its contents.'}
                className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-foreground hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
              >
                <RotateCw className="size-3" /> Retry
              </button>
            );
          })()}
          {item.status === 'complete' && (
            <span className="flex items-center gap-2 shrink-0">
              <button onClick={openFile} className="text-[11px] font-medium text-green-600 hover:text-green-700 hover:underline">
                View file
              </button>
              <span className="text-[11px] text-muted-foreground/40">·</span>
              <button onClick={openFolder} className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline">
                Go to location
              </button>
            </span>
          )}
        </div>
        {/* A failed row names its reason: "Error" alone left the user guessing
            whether to retry, rename, or give up. */}
        {item.status === 'error' && item.error && (
          <p className="text-[11px] text-destructive truncate mb-1" title={item.error}>{item.error}</p>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{humanSize(item.fileSize)}</span>
          <Progress
            value={item.status === 'error' ? 0 : item.progress}
            className="flex-1 **:data-[slot=progress-indicator]:bg-(--bar-color) **:data-[slot=progress-indicator]:duration-300"
            style={{ '--bar-color': item.status === 'error' ? '#ef4444' : '#22c55e' } as React.CSSProperties}
          />
          <span className={`text-[11px] font-medium min-w-7 text-right ${item.status === 'error' ? 'text-destructive' : item.status === 'complete' ? 'text-green-600' : 'text-muted-foreground'}`}>
            {item.status === 'complete' ? 'Done' : item.status === 'error' ? 'Error' : item.status === 'uploading' ? `${item.progress}%` : '-'}
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

