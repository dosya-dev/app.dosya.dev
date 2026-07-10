import { useRef, useState } from 'react';
import { useUploads, uploadSummary } from '@/stores/uploads';
import { cancel, retry, resumeWithFile } from '@/lib/upload-runner';
import type { UploadItem } from '@/lib/upload-types';
import { Progress } from '@/components/ui/progress';
import { humanSize } from '@/lib/helpers';
import { toast } from '@/lib/toast';
import { ChevronUp, ChevronDown, X, RotateCw, Upload, Check, AlertCircle, Loader2 } from 'lucide-react';

export default function UploadDock() {
  const items = useUploads((s) => s.items);
  const clearFinished = useUploads((s) => s.clearFinished);
  const [expanded, setExpanded] = useState(true);
  const resumeIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-hide: nothing to show at all → render nothing.
  if (items.length === 0) return null;

  const summary = uploadSummary(items);
  // Anything clearFinished() would remove (complete / error / canceled).
  const clearable = items.some(
    (i) => i.status === 'complete' || i.status === 'error' || i.status === 'canceled',
  );

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

  const attention = summary.failed + summary.interrupted;
  const headline = summary.anyActive
    ? `Uploading ${summary.done}/${summary.total} · ${summary.overallPct}%`
    : attention > 0
      ? `${summary.done}/${summary.total} uploaded · ${attention} need attention`
      : summary.done === summary.total
        ? `All ${summary.total} uploaded`
        : `${summary.done}/${summary.total} uploaded`;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t bg-card shadow-lg">
      <input ref={fileInputRef} type="file" hidden onChange={onResumeFile} />

      {/* Summary bar — a real toggle button plus sibling controls (no nested
          interactive elements, so every control is keyboard-activatable). */}
      <div className="w-full flex items-center gap-3 px-4 py-2">
        <button
          type="button"
          className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {summary.anyActive
            ? <Loader2 className="size-4 text-green-600 animate-spin shrink-0" />
            : <Upload className="size-4 text-muted-foreground shrink-0" />}
          <span className="text-xs font-medium truncate">{headline}</span>
          {summary.anyActive && (
            <Progress
              value={summary.overallPct}
              className="flex-1 max-w-60 **:data-[slot=progress-indicator]:bg-green-500"
            />
          )}
        </button>
        {clearable && (
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground underline shrink-0"
            onClick={() => clearFinished()}
          >
            Clear finished
          </button>
        )}
        <button
          type="button"
          className="shrink-0"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse upload list' : 'Expand upload list'}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
      </div>

      {/* Expanded per-file list */}
      {expanded && (
        <div className="max-h-64 overflow-y-auto border-t">
          {items.map((it) => (
            <DockRow key={it.id} item={it} onResume={() => onPickResume(it.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DockRow({ item, onResume }: { item: UploadItem; onResume: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b last:border-b-0">
      <StatusIcon status={item.status} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{item.fileName}</p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{humanSize(item.fileSize)}</span>
          {(item.status === 'uploading' || item.status === 'queued') && (
            <Progress
              value={item.progress}
              className="flex-1 max-w-40 **:data-[slot=progress-indicator]:bg-green-500"
            />
          )}
          <span className="text-[11px] text-muted-foreground">{statusLabel(item)}</span>
        </div>
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
