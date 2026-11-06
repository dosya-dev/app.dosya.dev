import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudDownload, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { isActive, type RcloneBackend, type RcloneJob } from '@/api/rclone-import';
import { formatBytes } from '@/lib/format-locale';
import { timeAgo } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';
import { cn } from '@/lib/utils';
import { ServiceMark } from './service-mark';
import { errorKind, jobTone, type ErrorKind, type JobTone } from './form-model';

const TONE: Record<JobTone, { key: MessageKey; dot: string; text: string }> = {
  waiting: { key: 'profile.label.rcloneBadgeQueued', dot: 'bg-muted-foreground/60', text: 'text-muted-foreground' },
  running: { key: 'profile.label.rcloneBadgeRunning', dot: 'bg-[#3b82f6] animate-pulse', text: 'text-foreground' },
  done: { key: 'profile.label.rcloneBadgeDone', dot: 'bg-[#22c55e]', text: 'text-foreground' },
  partial: { key: 'profile.label.rcloneBadgePartial', dot: 'bg-[#d97706]', text: 'text-foreground' },
  failed: { key: 'profile.label.rcloneStatusFailed', dot: 'bg-destructive', text: 'text-destructive' },
  cancelled: { key: 'profile.label.rcloneStatusCancelled', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
};

const ERROR_TEXT: Record<ErrorKind, MessageKey> = {
  not_found: 'profile.error.rcloneErrNotFound',
  allowance: 'profile.error.rcloneErrAllowance',
  stopped: 'profile.error.rcloneErrStopped',
  not_started: 'profile.error.rcloneErrNotStarted',
  unsafe: 'profile.error.rcloneErrUnsafe',
  plan: 'profile.error.rcloneErrPlan',
  connect: 'profile.error.rcloneErrConnect',
};

function Status({ job }: { job: RcloneJob }) {
  const t = useT();
  const tone = jobTone(job);
  const cancelling = isActive(job) && job.cancel_requested;
  const s = TONE[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium', s.text)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', s.dot)} />
      {cancelling ? t('profile.label.rcloneStatusCancelling') : t(s.key)}
    </span>
  );
}

function ProgressCell({ job, t }: { job: RcloneJob; t: ReturnType<typeof useT> }) {
  const tone = jobTone(job);
  if (tone === 'running') {
    const pct = job.bytes_total > 0 ? Math.min(100, (job.bytes_done / job.bytes_total) * 100) : null;
    return (
      <div className="min-w-[150px] space-y-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === null ? undefined : Math.round(pct)}>
          <div className={cn('h-full rounded-full bg-primary transition-[width] duration-500', pct === null && 'w-1/3 animate-pulse')} style={pct === null ? undefined : { width: `${pct}%` }} />
        </div>
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatBytes(job.bytes_done)}{job.bytes_total > 0 && ` / ${formatBytes(job.bytes_total)}`} · {t('profile.label.rcloneFilesCount', { files: job.files_done })}
        </p>
      </div>
    );
  }
  if (tone === 'waiting') return <span className="text-[12px] text-muted-foreground">{t('profile.label.rcloneStatusQueued')}</span>;
  if (tone === 'failed') return <span className="text-[12px] text-destructive">{t(ERROR_TEXT[errorKind(job.error_code)])}</span>;
  return (
    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
      {t('profile.label.rcloneFilesCount', { files: job.files_done })} · {formatBytes(job.bytes_done)}
      {tone === 'partial' && <span className="ms-1 text-[#b45309] dark:text-[#f59e0b]">· {t('profile.label.rcloneFailedCount', { failed: job.files_failed })}</span>}
    </span>
  );
}

/** The workspace's imports: one row each, with the raw rclone error behind "Details". */
export function ImportJobsTable({ jobs, backends, onCancel }: {
  jobs: RcloneJob[];
  backends: RcloneBackend[];
  onCancel: (id: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const byName = new Map(backends.map((b) => [b.name, b]));

  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
          <CloudDownload aria-hidden className="size-5 text-muted-foreground" />
        </div>
        <p className="mt-3 text-[14px] font-medium">{t('profile.label.rcloneEmptyTitle')}</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">{t('profile.description.rcloneEmptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <Table>
        <TableHeader className="bg-muted/60">
          <TableRow className="hover:bg-transparent">
            <TableHead className="ps-5 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{t('profile.label.rcloneColSource')}</TableHead>
            <TableHead className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{t('common.column.status')}</TableHead>
            <TableHead className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{t('profile.label.rcloneColProgress')}</TableHead>
            <TableHead className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{t('profile.label.rcloneColStarted')}</TableHead>
            <TableHead className="pe-5"><span className="sr-only">{t('profile.label.rcloneColActions')}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => {
            const b = byName.get(job.backend);
            const tone = jobTone(job);
            const hasDetails = Boolean(job.error_message) && (tone === 'failed' || tone === 'partial');
            const expanded = open === job.id;
            return (
              <Fragment key={job.id}>
                <TableRow data-testid="rclone-job" className={cn(expanded && 'border-b-0')}>
                  <TableCell className="ps-5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {b ? <ServiceMark backend={b} size="sm" /> : <span className="size-7 shrink-0 rounded-lg bg-muted" />}
                      <div className="min-w-0">
                        <p className="max-w-[220px] truncate text-[13px] font-medium">{job.label}</p>
                        <p dir="ltr" className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
                          {job.source_host ? `${job.source_host}${job.source_path ? `/${job.source_path.replace(/^\/+/, '')}` : ''}` : job.source_path || '/'}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Status job={job} /></TableCell>
                  <TableCell><ProgressCell job={job} t={t} /></TableCell>
                  <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground">{timeAgo(job.created_at)}</TableCell>
                  <TableCell className="pe-5 text-end">
                    <div className="flex items-center justify-end gap-1.5">
                      {hasDetails && (
                        <Button variant="ghost" size="sm" className="text-[12px]" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : job.id)}>
                          {expanded ? t('profile.action.rcloneHideDetails') : t('profile.action.rcloneDetails')}
                        </Button>
                      )}
                      {isActive(job) && !job.cancel_requested && (
                        <Button variant="outline" size="sm" className="text-[12px]" onClick={() => onCancel(job.id)}>{t('common.action.cancel')}</Button>
                      )}
                      {(tone === 'done' || tone === 'partial') && job.files_done > 0 && (
                        <Link
                          to={job.dest_folder_id ? `/files?folder=${encodeURIComponent(job.dest_folder_id)}` : '/files'}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium hover:bg-muted"
                        >
                          <FolderOpen aria-hidden className="size-3.5" /> {t('profile.action.rcloneOpenFolder')}
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="px-5 pb-4 pt-0">
                      <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">{job.error_message}</pre>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
