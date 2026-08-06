import { useEffect } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkspace } from '@/stores/workspace';
import { ACTIVE_CLOUD_STATUSES, jobProgress, useCloudImports } from '@/stores/cloud-imports';
import { describeJob } from '@/components/cloud-import/import-progress-card';

const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Small circular progress ring shown on the Integrations sidebar item while
 * cloud imports are running - the from-any-page counterpart of the
 * files-page ImportProgressCard (which keeps Cancel and problem details).
 * Renders nothing when idle. Same visual rules as
 * remote-download-indicator.tsx: determinate ring once byte totals exist,
 * indeterminate spinner while discovery is still counting.
 */
export function CloudImportIndicator() {
  const activeId = useWorkspace((s) => s.activeId);
  const jobs = useCloudImports((s) => s.jobs);
  const refresh = useCloudImports((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh, activeId]);

  const active = jobs.filter((j) => ACTIVE_CLOUD_STATUSES.has(j.status));
  if (active.length === 0) return null;

  const sized = active.filter((j) => j.status === 'running' && j.total_bytes > 0);
  const totalBytes = sized.reduce((s, j) => s + j.total_bytes, 0);
  const doneBytes = sized.reduce((s, j) => s + j.completed_bytes, 0);
  const pct = totalBytes > 0 ? Math.min(100, Math.floor((doneBytes / totalBytes) * 100)) : null;

  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="flex items-center" aria-label="Cloud imports in progress">
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
          {active.length === 1 ? '1 import in progress' : `${active.length} imports in progress`}
          {pct !== null ? ` - ${pct}%` : ''}
        </p>
        <div className="space-y-0.5">
          {active.slice(0, 4).map((job) => {
            const jobPct = jobProgress(job);
            return (
              <div key={job.id} className="flex items-center justify-between gap-4 text-[11px]">
                <span className="max-w-[13rem] truncate">{describeJob(job)}</span>
                <span className="tabular-nums text-muted-foreground">
                  {jobPct !== null ? `${jobPct}%` : '…'}
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
