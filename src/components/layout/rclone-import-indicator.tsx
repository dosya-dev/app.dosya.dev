import { useEffect } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkspace } from '@/stores/workspace';
import { activeImports, importProgress, useRcloneImports } from '@/stores/rclone-imports';
import { hadActiveJobs } from '@/lib/job-activity';
import { useT } from '@/lib/i18n';

const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Progress ring on the Integrations sidebar item while a remote (rclone)
 * import is copying - the same ring the Google Drive / OneDrive / Dropbox
 * importer shows (cloud-import-indicator.tsx): determinate once rclone has
 * counted the source, a spinner before that. Renders nothing when idle.
 *
 * Lists jobs on mount only when the last refresh in this browser saw an
 * import running (lib/job-activity.ts); an import started from this client
 * seeds the store itself.
 */
export function RcloneImportIndicator() {
  const t = useT();
  const workspaceId = useWorkspace((s) => s.activeId);
  const jobs = useRcloneImports((s) => s.jobs);
  const storeWorkspace = useRcloneImports((s) => s.workspaceId);
  const refresh = useRcloneImports((s) => s.refresh);

  useEffect(() => {
    if (workspaceId && hadActiveJobs('rclone')) void refresh(workspaceId);
  }, [refresh, workspaceId]);

  if (!workspaceId || storeWorkspace !== workspaceId) return null;
  const active = activeImports(jobs ?? []);
  if (active.length === 0) return null;

  const sized = active.filter((j) => j.status === 'running' && j.bytes_total > 0);
  const totalBytes = sized.reduce((s, j) => s + j.bytes_total, 0);
  const doneBytes = sized.reduce((s, j) => s + j.bytes_done, 0);
  const pct = totalBytes > 0 ? Math.min(100, Math.floor((doneBytes / totalBytes) * 100)) : null;

  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="flex items-center" aria-label={t('common.accessibility.cloudImportsInProgress')} data-testid="rclone-import-ring">
          <svg width="14" height="14" viewBox="0 0 14 14" className={pct === null ? 'animate-spin' : '-rotate-90'}>
            <circle cx="7" cy="7" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="2" />
            <circle
              cx="7"
              cy="7"
              r={RADIUS}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={pct === null ? `${CIRCUMFERENCE * 0.25} ${CIRCUMFERENCE * 0.75}` : CIRCUMFERENCE}
              strokeDashoffset={pct === null ? 0 : CIRCUMFERENCE * (1 - pct / 100)}
              className="transition-[stroke-dashoffset] duration-500"
            />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="inline-end" className="p-2">
        <p className="mb-1 text-[11px] font-medium">
          {active.length === 1 ? t('common.label.1ImportInProgress') : t('common.label.activecountImportsInProgress', { activeCount: active.length })}
          {pct !== null ? ` - ${pct}%` : ''}
        </p>
        <div className="space-y-0.5">
          {active.slice(0, 4).map((job) => {
            const jobPct = importProgress(job);
            return (
              <div key={job.id} className="flex items-center justify-between gap-4 text-[11px]">
                <span className="max-w-52 truncate">
                  {job.label || job.backend}{job.source_path ? `: ${job.source_path}` : ''}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {jobPct !== null ? `${jobPct}%` : job.status === 'queued' ? t('profile.label.rcloneBadgeQueued') : '…'}
                </span>
              </div>
            );
          })}
          {active.length > 4 && (
            <p className="text-[11px] text-muted-foreground">{t('common.label.activelengthMore', { activeLength: active.length - 4 })}</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
