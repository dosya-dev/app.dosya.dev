import { useEffect } from 'react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ACTIVE_CLOUD_STATUSES, jobProgress, useCloudImports } from '@/stores/cloud-imports';
import { PROVIDER_LABELS } from '@/lib/cloud-providers';
import { humanDuration, jobRate } from '@/lib/import-rate';
import { humanSize } from '@/lib/helpers';
import type { CloudJob } from '@/api/cloud-import';

type JobCounts = Pick<
  CloudJob, 'status' | 'total_files' | 'completed_files' | 'failed_files' | 'skipped_files'
>;

export function describeJob(job: JobCounts): string {
  if (job.status === 'discovering') {
    return `Scanning - ${job.total_files} files found so far`;
  }
  if (job.status === 'running') {
    return `Importing ${job.completed_files} of ${job.total_files} files`;
  }
  if (job.status === 'cancelled') return 'Import cancelled';
  if (job.status === 'failed') return 'Import failed';

  const problems: string[] = [];
  if (job.failed_files > 0) problems.push(`${job.failed_files} failed`);
  if (job.skipped_files > 0) problems.push(`${job.skipped_files} skipped`);

  if (problems.length === 0) return `Imported ${job.completed_files} files`;
  return `Imported ${job.completed_files} of ${job.total_files} files - ${problems.join(', ')}`;
}

/** Renders nothing when no cloud import is active. */
/**
 * Size / speed / ETA line for one job. Running jobs show
 * "45 MB of 1.2 GB - 3.4 MB/s - about 4m left", with the speed and ETA
 * slots blank until the rate window has two honest samples (and no ETA on a
 * stall - see lib/import-rate.ts). Discovery shows only the bytes counted
 * so far: the total is still growing, so a percent or ETA would be fiction.
 */
function JobStats({ job }: { job: CloudJob }) {
  if (job.status === 'discovering') {
    if (job.total_bytes <= 0) return null;
    return (
      <p className="text-xs text-muted-foreground" data-testid="job-stats">
        {humanSize(job.total_bytes)} found so far
      </p>
    );
  }
  if (job.status !== 'running' || job.total_bytes <= 0) return null;

  const rate = jobRate(job);
  return (
    <p className="text-xs text-muted-foreground tabular-nums" data-testid="job-stats">
      {humanSize(job.completed_bytes)} of {humanSize(job.total_bytes)}
      {rate.bytesPerSec != null && rate.bytesPerSec > 0 ? ` - ${humanSize(rate.bytesPerSec)}/s` : ''}
      {rate.etaSeconds !== null ? ` - about ${humanDuration(rate.etaSeconds)} left` : ''}
    </p>
  );
}

export function ImportProgressCard({ provider }: { provider?: string } = {}) {
  const jobs = useCloudImports((s) => s.jobs);
  const refresh = useCloudImports((s) => s.refresh);
  const cancel = useCloudImports((s) => s.cancel);

  useEffect(() => { void refresh(); }, [refresh]);

  // Optional provider filter: the /integrations setup pages show only their
  // own provider's jobs; the files page passes nothing and shows them all.
  const active = jobs.filter(
    (j) => ACTIVE_CLOUD_STATUSES.has(j.status) && (!provider || j.provider === provider),
  );
  if (active.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      {active.map((job) => {
        const pct = jobProgress(job);
        return (
          <div key={job.id} className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>{describeJob(job)}</span>
              <Button variant="ghost" size="sm" onClick={() => void cancel(job.id)}>
                Cancel
              </Button>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="job-source">
              {PROVIDER_LABELS[job.provider] ?? job.provider}
              {job.account_email ? ` - from ${job.account_email}` : ''}
            </p>
            <JobStats job={job} />
            {/*
              jobProgress() already returns exactly what Progress's `value`
              prop wants: number | null, with null meaning indeterminate.
              During discovery the total genuinely isn't known yet, so this
              must stay null (indeterminate) rather than coerce to 0 - 0%
              would falsely read as "no progress" while files are actively
              being discovered.
            */}
            <Progress value={pct} />
          </div>
        );
      })}
    </div>
  );
}
