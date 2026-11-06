import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTakeoutImport } from '@/stores/takeout-import';
import { useT } from '@/lib/i18n';

const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Progress ring on the Integrations sidebar item while a Google Takeout
 * import runs in this tab - the same ring the cloud and rclone importers
 * show. A paused import keeps its ring at the point it stopped, so the user
 * can see there is one to continue. Renders nothing otherwise.
 *
 * Reads the in-tab store only: a Takeout import lives in the tab that holds
 * the zips, so there is nothing to ask the server.
 */
export function TakeoutImportIndicator() {
  const t = useT();
  const phase = useTakeoutImport((s) => s.phase);
  const progress = useTakeoutImport((s) => s.progress);

  if ((phase !== 'running' && phase !== 'paused') || !progress || progress.total === 0) return null;

  const ratio = progress.totalBytes > 0 ? progress.doneBytes / progress.totalBytes : progress.done / progress.total;
  const pct = Math.min(100, Math.floor(ratio * 100));
  const vars = { n: progress.done, total: progress.total };

  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="flex items-center" aria-label={t('common.accessibility.cloudImportsInProgress')} data-testid="takeout-import-ring">
          <svg width="14" height="14" viewBox="0 0 14 14" className="-rotate-90">
            <circle cx="7" cy="7" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="2" />
            <circle
              cx="7"
              cy="7"
              r={RADIUS}
              fill="none"
              stroke={phase === 'paused' ? 'var(--muted-foreground)' : 'var(--primary)'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - pct / 100)}
              className="transition-[stroke-dashoffset] duration-500"
            />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="inline-end" className="p-2">
        <p className="mb-1 text-[11px] font-medium">Google Takeout - {pct}%</p>
        <p className="text-[11px] text-muted-foreground">
          {phase === 'paused' ? t('integrations-takeout.status.pausedNOfTotal', vars) : t('integrations-takeout.status.importingNOfTotal', vars)}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
