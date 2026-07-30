import { useEffect } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkspace } from '@/stores/workspace';
import { ACTIVE_REMOTE_STATUSES, useRemoteDownloads } from '@/stores/remote-downloads';

const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Small circular progress ring shown on the Integrations sidebar item while
 * remote downloads are running. Renders nothing when idle.
 */
export function RemoteDownloadIndicator() {
  const activeId = useWorkspace((s) => s.activeId);
  const jobs = useRemoteDownloads((s) => s.jobs);
  const refresh = useRemoteDownloads((s) => s.refresh);

  useEffect(() => {
    refresh();
  }, [refresh, activeId]);

  const active = jobs.filter((j) => ACTIVE_REMOTE_STATUSES.has(j.status));
  if (active.length === 0) return null;

  const sized = active.filter((j) => j.bytes_total);
  const totalBytes = sized.reduce((s, j) => s + (j.bytes_total ?? 0), 0);
  const doneBytes = sized.reduce((s, j) => s + j.bytes_done, 0);
  const pct = totalBytes > 0 ? Math.min(100, Math.floor((doneBytes / totalBytes) * 100)) : null;

  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="ml-auto flex items-center" aria-label="Remote downloads in progress">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            className={pct === null ? 'animate-spin' : '-rotate-90'}
          >
            <circle cx="7" cy="7" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="2" />
            <circle
              cx="7"
              cy="7"
              r={RADIUS}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={
                pct === null
                  ? `${CIRCUMFERENCE * 0.25} ${CIRCUMFERENCE * 0.75}`
                  : CIRCUMFERENCE
              }
              strokeDashoffset={pct === null ? 0 : CIRCUMFERENCE * (1 - pct / 100)}
              className="transition-[stroke-dashoffset] duration-500"
            />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="p-2">
        <p className="mb-1 text-[11px] font-medium">
          {active.length === 1 ? 'Downloading 1 file' : `Downloading ${active.length} files`}
          {pct !== null ? ` - ${pct}%` : ''}
        </p>
        <div className="space-y-0.5">
          {active.slice(0, 4).map((job) => {
            const jobPct = job.bytes_total
              ? Math.min(100, Math.floor((job.bytes_done / job.bytes_total) * 100))
              : null;
            return (
              <div key={job.id} className="flex items-center justify-between gap-4 text-[11px]">
                <span className="max-w-[11rem] truncate">{job.filename}</span>
                <span className="tabular-nums text-muted-foreground">
                  {job.status === 'queued' ? 'queued' : jobPct !== null ? `${jobPct}%` : '…'}
                </span>
              </div>
            );
          })}
          {active.length > 4 && (
            <p className="text-[11px] text-muted-foreground">+{active.length - 4} more</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
