import { useCallback, useEffect, useState } from 'react';
import { Lock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getBackends, isActive, type RcloneBackendsResponse } from '@/api/rclone-import';
import { useRcloneImports } from '@/stores/rclone-imports';
import { useWorkspace } from '@/stores/workspace';
import { formatBytes } from '@/lib/format-locale';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { RemoteImportWizard } from './remote-import-wizard';
import { ImportJobsTable } from './import-jobs-table';
import { ServiceMark } from './service-mark';
import { meterTone } from './form-model';

const METER = { ok: 'bg-[#22c55e]', warn: 'bg-[#d97706]', full: 'bg-[#ef4444]' } as const;

type Entitlement = NonNullable<RcloneBackendsResponse['entitlement']>;

/** One line: what this period allows and how much of it is used. */
function UsageStrip({ ent }: { ent: Entitlement }) {
  const t = useT();
  const pct = ent.bytes_limit > 0 ? Math.min(100, (ent.bytes_used / ent.bytes_limit) * 100) : 100;
  const tone = meterTone(ent.bytes_used, ent.bytes_limit);
  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card px-5 py-3.5 sm:flex-row sm:items-center sm:gap-5">
      <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
        {ent.trial ? t('profile.label.rcloneTrialAllowance') : t('profile.label.rcloneThisMonth')}
      </span>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted sm:flex-1"
        role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
        aria-label={ent.trial ? t('profile.label.rcloneTrialAllowance') : t('profile.label.rcloneThisMonth')}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-500', METER[tone])} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
        <span className="font-mono tabular-nums text-foreground">{formatBytes(ent.bytes_used)} / {formatBytes(ent.bytes_limit)}</span>
        <span aria-hidden>·</span>
        <span>{t('profile.label.rcloneConcurrent', { count: ent.concurrent })}</span>
      </span>
    </div>
  );
}

/** Free (or lapsed) workspace: what they would get, and the way to get it. */
function UpgradePanel({ meta, grace }: { meta: RcloneBackendsResponse; grace: boolean }) {
  const t = useT();
  const preview = meta.backends.slice(0, 12);
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-md">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Lock aria-hidden className="size-4 text-muted-foreground" /> {t('profile.label.rcloneServicesCount', { count: meta.backends.length })}
          </h2>
          <p className={cn('mt-1.5 text-[13px]', grace ? 'text-destructive' : 'text-muted-foreground')}>
            {grace ? t('profile.description.rcloneGracePeriod') : t('profile.description.rclonePaidOnly')}
          </p>
        </div>
        <a href="/billing" className="shrink-0">
          <Button className="gap-1.5"><Sparkles className="size-3.5" /> {grace ? t('profile.action.rcloneFixPayment') : t('profile.action.rcloneUpgrade')}</Button>
        </a>
      </div>
      <ul aria-hidden className="grid grid-cols-2 gap-2 border-t bg-muted/30 p-4 opacity-70 sm:grid-cols-3 lg:grid-cols-4">
        {preview.map((b) => (
          <li key={b.name} className="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2.5 py-2">
            <ServiceMark backend={b} size="sm" />
            <span className="truncate text-[12px] font-medium">{b.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <Skeleton className="h-12 rounded-2xl" />
      <Skeleton className="h-80 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />
    </div>
  );
}

/**
 * The body of /integrations/remote-rclone: 40+ services through rclone on our
 * server. Paid plans only - free users see what they would unlock, because the
 * list itself is the reason to upgrade.
 */
export function RemoteImportPanel() {
  const t = useT();
  const workspaceId = useWorkspace((s) => s.activeId);
  // undefined = loading, null = the request failed.
  const [meta, setMeta] = useState<RcloneBackendsResponse | null | undefined>(undefined);
  // Jobs live in a shared store so the sidebar ring (layout/rclone-import-
  // indicator.tsx) sees an import the moment it starts here, and the store
  // owns the one poll timer for both.
  const storeJobs = useRcloneImports((s) => s.jobs);
  const storeWorkspace = useRcloneImports((s) => s.workspaceId);
  const jobs = storeWorkspace === workspaceId ? storeJobs : null;
  const refreshJobs = useRcloneImports((s) => s.refresh);
  const seedJob = useRcloneImports((s) => s.seed);
  const cancelStoreJob = useRcloneImports((s) => s.cancel);

  const loadJobs = useCallback(() => {
    if (!workspaceId) return;
    void refreshJobs(workspaceId);
  }, [workspaceId, refreshJobs]);

  const loadMeta = useCallback(() => {
    if (!workspaceId) return;
    getBackends(workspaceId).then(setMeta).catch(() => setMeta(null));
  }, [workspaceId]);

  useEffect(() => { loadMeta(); loadJobs(); }, [loadMeta, loadJobs]);

  // The store polls while an import is active; the allowance moves when one
  // ends, so refresh the meter then.
  const anyActive = (jobs ?? []).some(isActive);
  useEffect(() => {
    if (!anyActive) return;
    return () => { loadMeta(); };
  }, [anyActive, loadMeta]);

  const cancel = async (id: string) => {
    try { await cancelStoreJob(id); } catch { toast.error(t('profile.error.rcloneCouldNotCancel')); }
  };

  if (meta === undefined) return <PanelSkeleton />;
  if (!meta?.enabled || !workspaceId) {
    return <p className="rounded-2xl border bg-card p-5 text-[13px] text-muted-foreground">{t('profile.description.rcloneNotAvailable')}</p>;
  }
  const ent = meta.entitlement;
  const paid = ent !== null && ent.reason !== 'free_plan' && ent.reason !== 'grace_period';
  const blockedNote = paid && ent && !ent.allowed
    ? ent.reason === 'allowance_used' ? t('profile.description.rcloneAllowanceUsed')
      : ent.reason === 'concurrency' ? t('profile.description.rcloneConcurrencyFull') : null
    : null;

  return (
    <div className="space-y-5">
      {paid && ent && <UsageStrip ent={ent} />}
      {blockedNote && <p className="rounded-xl bg-muted px-4 py-2.5 text-[12px] text-muted-foreground">{blockedNote}</p>}

      {paid ? (
        <RemoteImportWizard
          backends={meta.backends}
          workspaceId={workspaceId}
          canStart={Boolean(ent?.allowed)}
          onStarted={(job) => { seedJob(job); loadMeta(); }}
        />
      ) : (
        <UpgradePanel meta={meta} grace={ent?.reason === 'grace_period'} />
      )}

      {(paid || (jobs?.length ?? 0) > 0) && (
        <section aria-labelledby="rclone-imports" className="space-y-3 pt-3">
          <h2 id="rclone-imports" className="text-[15px] font-semibold tracking-tight">{t('profile.heading.rcloneImports')}</h2>
          {jobs === null ? <Skeleton className="h-32 rounded-2xl" /> : <ImportJobsTable jobs={jobs} backends={meta.backends} onCancel={cancel} />}
        </section>
      )}
    </div>
  );
}
