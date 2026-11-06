import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUploads, uploadSummary } from '@/stores/uploads';
import { cancel, retry, resumeWithFile, retryAllFailed, canRetry } from '@/lib/upload-runner';
import type { UploadItem } from '@/lib/upload-types';
import { API_BASE } from '@/api/client';
import { ContextMenu } from '@/components/context-menu';
import { Progress } from '@/components/ui/progress';
import { humanSize } from '@/lib/helpers';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import type { T } from '@/i18n/translator';
import {
  ChevronUp, ChevronDown, X, RotateCw, Upload, Check, AlertCircle, Loader2,
  Download, FolderOpen, Trash2,
} from 'lucide-react';

export default function UploadDock() {
  const t = useT();
  const navigate = useNavigate();
  const items = useUploads((s) => s.items);
  const clearFinished = useUploads((s) => s.clearFinished);
  const removeItem = useUploads((s) => s.removeItem);
  const [expanded, setExpanded] = useState(true);
  const [ctx, setCtx] = useState<{ item: UploadItem; x: number; y: number } | null>(null);
  const resumeIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The dock slides UP into view, so it has to leave through the same edge.
  // React unmounting the moment the last item is cleared made that impossible,
  // so `mounted` outlives `items`: it is set on the first item and only cleared
  // once the exit animation has actually finished.
  const [mounted, setMounted] = useState(false);
  const lastItemsRef = useRef(items);

  useEffect(() => { if (items.length > 0) setMounted(true); }, [items.length]);

  const onPickResume = (id: string) => { resumeIdRef.current = id; fileInputRef.current?.click(); };
  const onResumeFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = resumeIdRef.current;
    e.target.value = '';
    resumeIdRef.current = null;
    if (!file || !id) return;
    const res = resumeWithFile(id, file);
    if (!res.ok) toast.error(t('common.error.couldNotResume'), res.error ?? t('common.error.fileMismatch'));
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
    // A separator is its OWN item (label '', separator: true) - never a flag on a
    // labeled item, which the ContextMenu would render as a divider instead of a button.
    const sep = { label: '', icon: null, separator: true, onClick: () => {} };
    if (item.status === 'complete') {
      return [
        { label: t('common.action.download'), icon: <Download className="size-3.5" />, onClick: () => { if (item.fileId) window.open(`${API_BASE}/api/files/${item.fileId}/download`, '_blank'); } },
        { label: t('common.action.openInFiles'), icon: <FolderOpen className="size-3.5" />, onClick: () => openInFiles(item) },
        sep,
        { label: t('common.action.removeFromList'), icon: <X className="size-3.5" />, onClick: () => removeItem(item.id) },
      ];
    }
    if (item.status === 'error') {
      return [
        { label: t('common.retry'), icon: <RotateCw className="size-3.5" />, onClick: () => retry(item.id) },
        sep,
        { label: t('common.remove'), icon: <Trash2 className="size-3.5" />, danger: true, onClick: () => removeItem(item.id) },
      ];
    }
    if (item.status === 'uploading' || item.status === 'queued') {
      return [{ label: t('common.action.cancelUpload'), icon: <X className="size-3.5" />, danger: true, onClick: () => cancel(item.id) }];
    }
    if (item.status === 'interrupted') {
      return [
        { label: t('common.action.resume'), icon: <RotateCw className="size-3.5" />, onClick: () => onPickResume(item.id) },
        sep,
        { label: t('common.remove'), icon: <Trash2 className="size-3.5" />, danger: true, onClick: () => removeItem(item.id) },
      ];
    }
    return [{ label: t('common.remove'), icon: <Trash2 className="size-3.5" />, danger: true, onClick: () => removeItem(item.id) }]; // canceled
  };

  const openCtx = (item: UploadItem, e: React.MouseEvent) => {
    e.preventDefault();
    setCtx({ item, x: e.clientX, y: e.clientY });
  };

  // Auto-hide, one animation late (hooks stay above this). While the dock is
  // leaving there are no items left to render, so the last frame's list is
  // held and shown for the length of the exit.
  const closing = items.length === 0;
  if (!closing) lastItemsRef.current = items;
  const shown = closing ? lastItemsRef.current : items;
  if (!mounted || shown.length === 0) return null;

  const summary = uploadSummary(shown);
  const clearable = shown.some((i) => i.status === 'complete' || i.status === 'error' || i.status === 'canceled');

  const attention = summary.failed + summary.interrupted;
  const headline = summary.anyActive
    ? t('common.label.uploadingSummarydoneSummarytotalSummaryoverallpct', { summaryDone: summary.done, summaryTotal: summary.total, summaryOverallPct: summary.overallPct })
    : attention > 0
      ? t('upload.heading.doneTotalUploadedAttentionNeedAttention', { done: summary.done, total: summary.total, attention })
      : summary.done === summary.total
        ? t('common.label.allSummarytotalUploaded', { summaryTotal: summary.total })
        : t('upload.heading.doneTotalUploaded', { done: summary.done, total: summary.total });

  return (
    <>
      <div
        data-closed={closing ? 'true' : undefined}
        onAnimationEnd={(e) => { if (e.target === e.currentTarget && closing) setMounted(false); }}
        className="fixed bottom-4 inset-e-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-card shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-2 motion-reduce:slide-in-from-bottom-0 motion-reduce:data-closed:slide-out-to-bottom-0"
      >
        <input ref={fileInputRef} type="file" hidden onChange={onResumeFile} />

        {/* Header (always visible): icon + summary + collapse/clear controls.
            Sibling buttons (no nested interactives) so each is keyboard-activatable. */}
        <div className="flex items-center gap-2.5 px-3.5 py-2.5">
          <button
            type="button"
            className="flex items-center gap-2.5 flex-1 min-w-0 text-start hover:opacity-80"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {summary.anyActive
              ? <Loader2 className="size-4 text-green-600 animate-spin shrink-0" />
              : <Upload className="size-4 text-muted-foreground shrink-0" />}
            <span className="text-xs font-semibold truncate">{headline}</span>
          </button>
          {/* One click for a batch with several failures; per-row Retry stays
              in the row and its context menu. */}
          {summary.failed > 0 && (
            <button
              type="button"
              className="text-[11px] font-medium text-foreground hover:underline shrink-0"
              onClick={() => retryAllFailed()}
            >
              {t('common.tooltip.retryAllFailed')}
            </button>
          )}
          {clearable && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => clearFinished()}
            >
              {t('common.action.clear')}
            </button>
          )}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t('common.action.collapseUploadList') : t('common.action.expandUploadList')}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
        </div>

        {/* Single combined progress bar across all active uploads - with the
            amount uploaded, amount left, and current combined speed. */}
        {summary.anyActive && (
          <div className="px-3.5 pb-2.5">
            <Progress
              value={summary.overallPct}
              className="**:data-[slot=progress-indicator]:bg-green-500 **:data-[slot=progress-indicator]:duration-300"
            />
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span className="truncate">
                {t('common.label.summaryactiveuploadedbytesOfSummaryactivetotalbytesFormattedvalueLeft', {
                  summaryActiveUploadedBytes: humanSize(summary.activeUploadedBytes),
                  summaryActiveTotalBytes: humanSize(summary.activeTotalBytes),
                  formattedValue: humanSize(Math.max(0, summary.activeTotalBytes - summary.activeUploadedBytes)),
                })}
              </span>
              {summary.activeSpeedBps > 0 && (
                <span className="shrink-0 tabular-nums">{t('common.label.bpsS', { bps: humanSize(summary.activeSpeedBps) })}</span>
              )}
            </div>
          </div>
        )}

        {/* Expanded: per-file list (right-click a row for actions) */}
        {expanded && (
          <div className="max-h-72 overflow-y-auto border-t">
            {shown.map((it) => (
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
    </>
  );
}

function DockRow({ item, onResume, onOpen, onContextMenu }: {
  item: UploadItem; onResume: () => void; onOpen: () => void; onContextMenu: (e: React.MouseEvent) => void;
}) {
  const t = useT();
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
            className="text-xs font-medium truncate max-w-full hover:underline text-start"
            title={t('common.action.openInFiles')}
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
                {t('common.label.itembytesuploadedItemfilesizeRemainingLeft', {
                  itemBytesUploaded: humanSize(item.bytesUploaded),
                  itemFileSize: humanSize(item.fileSize),
                  remaining: humanSize(remaining),
                })}
              </span>
              <span className="shrink-0 tabular-nums">
                {item.status === 'queued'
                  ? t('common.label.queued')
                  : item.speedBps && item.speedBps > 0
                    ? t('common.label.bpsS', { bps: humanSize(item.speedBps) })
                    : `${item.progress}%`}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{humanSize(item.fileSize)}</span>
            <span>·</span>
            <span>{statusLabel(item, t)}</span>
          </div>
        )}
      </div>
      <RowActions item={item} onResume={onResume} />
    </div>
  );
}

function RowActions({ item, onResume }: { item: UploadItem; onResume: () => void }) {
  const t = useT();
  if (item.status === 'uploading' || item.status === 'queued') {
    return (
      <button className="text-muted-foreground hover:text-destructive" title={t('common.cancel')} onClick={() => cancel(item.id)}>
        <X className="size-4" />
      </button>
    );
  }
  if (item.status === 'error') {
    // Same reasoning as the Uploads page: no bytes in this tab, no retry.
    const retryable = canRetry(item.id);
    return (
      <button
        className="text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
        title={retryable ? t('common.retry') : t('common.action.addTheFileAgainToUploadItThisTabNo')}
        disabled={!retryable}
        onClick={() => retry(item.id)}
      >
        <RotateCw className="size-4" />
      </button>
    );
  }
  if (item.status === 'interrupted') {
    return (
      <button className="text-[11px] font-medium text-green-600 hover:underline" title={t('common.action.reSelectTheFileToResume')} onClick={onResume}>
        {t('common.tooltip.resume')}
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

function statusLabel(item: UploadItem, t: T): string {
  switch (item.status) {
    case 'complete': return t('common.label.done');
    case 'error': return item.error ?? t('common.status.error');
    case 'interrupted': return t('common.label.interrupted');
    case 'canceled': return t('common.label.canceled');
    case 'uploading': return `${item.progress}%`;
    default: return t('common.label.queued');
  }
}
