import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUploads, uploadSummary } from '@/stores/uploads';
import { cancel, retry, retryInRegion, resumeWithFile } from '@/lib/upload-runner';
import type { UploadItem } from '@/lib/upload-types';
import { api, API_BASE } from '@/api/client';
import { ContextMenu } from '@/components/context-menu';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { humanSize } from '@/lib/helpers';
import { toast } from '@/lib/toast';
import {
  ChevronUp, ChevronDown, X, RotateCw, Upload, Check, AlertCircle, Loader2,
  Download, FolderOpen, Globe, Trash2,
} from 'lucide-react';

interface RegionInfo { code: string; city: string; country: string }

export default function UploadDock() {
  const navigate = useNavigate();
  const items = useUploads((s) => s.items);
  const clearFinished = useUploads((s) => s.clearFinished);
  const removeItem = useUploads((s) => s.removeItem);
  const [expanded, setExpanded] = useState(true);
  const [ctx, setCtx] = useState<{ item: UploadItem; x: number; y: number } | null>(null);
  const [regionTarget, setRegionTarget] = useState<UploadItem | null>(null);
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const resumeIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedRegionsWsRef = useRef<string | null>(null);

  // When the "retry in another region" dialog opens, load only the regions
  // ALLOWED for that upload's workspace (same filter the Uploads page uses).
  // Refetched only when the target's workspace differs from the last load.
  useEffect(() => {
    if (!regionTarget) return;
    const ws = regionTarget.workspace_id;
    if (loadedRegionsWsRef.current === ws) return;
    Promise.all([
      api<{ ok: boolean; regions: RegionInfo[] }>('/api/regions'),
      api<{ ok: boolean; settings?: { available_regions: string | null } | null }>(`/api/workspaces/${ws}`),
    ])
      .then(([regRes, wsRes]) => {
        if (!regRes.ok) return;
        let available: string[] = [];
        if (wsRes.ok && wsRes.settings?.available_regions) {
          try { available = JSON.parse(wsRes.settings.available_regions); } catch { /* all */ }
        }
        setRegions(available.length > 0 ? regRes.regions.filter((r) => available.includes(r.code)) : regRes.regions);
        loadedRegionsWsRef.current = ws;
      })
      .catch(() => { /* leave empty → dialog shows a loading note */ });
  }, [regionTarget]);

  const onPickResume = (id: string) => { resumeIdRef.current = id; fileInputRef.current?.click(); };
  const onResumeFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = resumeIdRef.current;
    e.target.value = '';
    resumeIdRef.current = null;
    if (!file || !id) return;
    const res = resumeWithFile(id, file);
    if (!res.ok) toast.error('Could not resume', res.error ?? 'File mismatch');
  };

  // Open a completed upload on the Files page, deep-linked by file id (+ folder)
  // so that page can scroll to and highlight it.
  const openInFiles = (item: UploadItem) => {
    if (item.fileId) {
      navigate(`/files?file=${item.fileId}${item.folder_id ? `&folder=${item.folder_id}` : ''}`);
    } else {
      navigate('/files');
    }
  };

  // Right-click actions per row. A completed file gets quick actions (full file
  // management still lives on the Files page); a failed one gets retry options.
  const menuItems = (item: UploadItem) => {
    if (item.status === 'complete') {
      return [
        { label: 'Download', icon: <Download className="size-3.5" />, onClick: () => { if (item.fileId) window.open(`${API_BASE}/api/files/${item.fileId}/download`, '_blank'); } },
        { label: 'Open in Files', icon: <FolderOpen className="size-3.5" />, onClick: () => openInFiles(item) },
        { label: 'Remove from list', icon: <X className="size-3.5" />, separator: true, onClick: () => removeItem(item.id) },
      ];
    }
    if (item.status === 'error') {
      return [
        { label: 'Retry', icon: <RotateCw className="size-3.5" />, onClick: () => retry(item.id) },
        { label: 'Retry in another region…', icon: <Globe className="size-3.5" />, onClick: () => setRegionTarget(item) },
        { label: 'Remove', icon: <Trash2 className="size-3.5" />, separator: true, danger: true, onClick: () => removeItem(item.id) },
      ];
    }
    if (item.status === 'uploading' || item.status === 'queued') {
      return [{ label: 'Cancel upload', icon: <X className="size-3.5" />, danger: true, onClick: () => cancel(item.id) }];
    }
    if (item.status === 'interrupted') {
      return [
        { label: 'Resume…', icon: <RotateCw className="size-3.5" />, onClick: () => onPickResume(item.id) },
        { label: 'Remove', icon: <Trash2 className="size-3.5" />, separator: true, danger: true, onClick: () => removeItem(item.id) },
      ];
    }
    return [{ label: 'Remove', icon: <Trash2 className="size-3.5" />, danger: true, onClick: () => removeItem(item.id) }]; // canceled
  };

  const openCtx = (item: UploadItem, e: React.MouseEvent) => {
    e.preventDefault();
    setCtx({ item, x: e.clientX, y: e.clientY });
  };

  // Auto-hide: nothing to show at all → render nothing (hooks stay above this).
  if (items.length === 0) return null;

  const summary = uploadSummary(items);
  const clearable = items.some((i) => i.status === 'complete' || i.status === 'error' || i.status === 'canceled');

  const attention = summary.failed + summary.interrupted;
  const headline = summary.anyActive
    ? `Uploading ${summary.done}/${summary.total} · ${summary.overallPct}%`
    : attention > 0
      ? `${summary.done}/${summary.total} uploaded · ${attention} need attention`
      : summary.done === summary.total
        ? `All ${summary.total} uploaded`
        : `${summary.done}/${summary.total} uploaded`;

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-card shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
        <input ref={fileInputRef} type="file" hidden onChange={onResumeFile} />

        {/* Header (always visible): icon + summary + collapse/clear controls.
            Sibling buttons (no nested interactives) so each is keyboard-activatable. */}
        <div className="flex items-center gap-2.5 px-3.5 py-2.5">
          <button
            type="button"
            className="flex items-center gap-2.5 flex-1 min-w-0 text-left hover:opacity-80"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {summary.anyActive
              ? <Loader2 className="size-4 text-green-600 animate-spin shrink-0" />
              : <Upload className="size-4 text-muted-foreground shrink-0" />}
            <span className="text-xs font-semibold truncate">{headline}</span>
          </button>
          {clearable && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => clearFinished()}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse upload list' : 'Expand upload list'}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
        </div>

        {/* Single combined progress bar across all active uploads — with the
            amount uploaded, amount left, and current combined speed. */}
        {summary.anyActive && (
          <div className="px-3.5 pb-2.5">
            <Progress
              value={summary.overallPct}
              className="**:data-[slot=progress-indicator]:bg-green-500 **:data-[slot=progress-indicator]:duration-300"
            />
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span className="truncate">
                {humanSize(summary.activeUploadedBytes)} of {humanSize(summary.activeTotalBytes)}
                {' · '}{humanSize(Math.max(0, summary.activeTotalBytes - summary.activeUploadedBytes))} left
              </span>
              {summary.activeSpeedBps > 0 && (
                <span className="shrink-0 tabular-nums">{humanSize(summary.activeSpeedBps)}/s</span>
              )}
            </div>
          </div>
        )}

        {/* Expanded: per-file list (right-click a row for actions) */}
        {expanded && (
          <div className="max-h-72 overflow-y-auto border-t">
            {items.map((it) => (
              <DockRow
                key={it.id}
                item={it}
                onResume={() => onPickResume(it.id)}
                onOpen={() => openInFiles(it)}
                onContextMenu={(e) => openCtx(it, e)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right-click menu (reuses the same component as the Files page) */}
      <ContextMenu
        position={ctx ? { x: ctx.x, y: ctx.y } : null}
        onClose={() => setCtx(null)}
        items={ctx ? menuItems(ctx.item) : []}
      />

      {/* "Retry in another region" picker for failed uploads */}
      <Dialog open={!!regionTarget} onOpenChange={(v) => { if (!v) setRegionTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Upload in another region</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground break-all">
            Re-upload <span className="font-medium text-foreground">{regionTarget?.fileName}</span> to a different region.
          </p>
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {regions.map((r) => (
              <button
                key={r.code}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${r.code === regionTarget?.region ? 'border-green-500 bg-green-50 dark:bg-green-950/30' : 'hover:bg-muted/50'}`}
                onClick={() => { if (regionTarget) retryInRegion(regionTarget.id, r.code); setRegionTarget(null); }}
              >
                <span className="text-xs font-medium truncate">{r.city}, {r.country}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{r.code}</span>
              </button>
            ))}
            {regions.length === 0 && (
              <p className="py-4 text-xs text-muted-foreground">Loading regions…</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegionTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DockRow({ item, onResume, onOpen, onContextMenu }: {
  item: UploadItem; onResume: () => void; onOpen: () => void; onContextMenu: (e: React.MouseEvent) => void;
}) {
  const active = item.status === 'uploading' || item.status === 'queued';
  const remaining = Math.max(0, item.fileSize - item.bytesUploaded);
  const openable = item.status === 'complete' && !!item.fileId;
  return (
    <div
      className="flex items-center gap-3 px-3.5 py-2 border-b last:border-b-0 hover:bg-muted/40"
      onContextMenu={onContextMenu}
    >
      <StatusIcon status={item.status} />
      <div className="flex-1 min-w-0">
        {openable ? (
          <button
            type="button"
            className="text-xs font-medium truncate max-w-full hover:underline text-left"
            title="Open in Files"
            onClick={onOpen}
          >
            {item.fileName}
          </button>
        ) : (
          <p className="text-xs font-medium truncate">{item.fileName}</p>
        )}
        {active ? (
          <>
            <Progress
              value={item.progress}
              className="my-1 **:data-[slot=progress-indicator]:bg-green-500"
            />
            <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span className="truncate">
                {humanSize(item.bytesUploaded)} / {humanSize(item.fileSize)} · {humanSize(remaining)} left
              </span>
              <span className="shrink-0 tabular-nums">
                {item.status === 'queued'
                  ? 'Queued'
                  : item.speedBps && item.speedBps > 0
                    ? `${humanSize(item.speedBps)}/s`
                    : `${item.progress}%`}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{humanSize(item.fileSize)}</span>
            <span>·</span>
            <span>{statusLabel(item)}</span>
          </div>
        )}
      </div>
      <RowActions item={item} onResume={onResume} />
    </div>
  );
}

function RowActions({ item, onResume }: { item: UploadItem; onResume: () => void }) {
  if (item.status === 'uploading' || item.status === 'queued') {
    return (
      <button className="text-muted-foreground hover:text-destructive" title="Cancel" onClick={() => cancel(item.id)}>
        <X className="size-4" />
      </button>
    );
  }
  if (item.status === 'error') {
    return (
      <button className="text-muted-foreground hover:text-foreground" title="Retry" onClick={() => retry(item.id)}>
        <RotateCw className="size-4" />
      </button>
    );
  }
  if (item.status === 'interrupted') {
    return (
      <button className="text-[11px] font-medium text-green-600 hover:underline" title="Re-select the file to resume" onClick={onResume}>
        Resume
      </button>
    );
  }
  return null;
}

function StatusIcon({ status }: { status: UploadItem['status'] }) {
  if (status === 'complete') return <Check className="size-4 text-green-600 shrink-0" />;
  if (status === 'error') return <AlertCircle className="size-4 text-destructive shrink-0" />;
  if (status === 'uploading') return <Loader2 className="size-4 text-green-600 animate-spin shrink-0" />;
  if (status === 'interrupted') return <AlertCircle className="size-4 text-amber-500 shrink-0" />;
  return <Upload className="size-4 text-muted-foreground shrink-0" />; // queued / canceled
}

function statusLabel(item: UploadItem): string {
  switch (item.status) {
    case 'complete': return 'Done';
    case 'error': return item.error ?? 'Error';
    case 'interrupted': return 'Interrupted';
    case 'canceled': return 'Canceled';
    case 'uploading': return `${item.progress}%`;
    default: return 'Queued';
  }
}
