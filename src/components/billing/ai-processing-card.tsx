// Billing's account-wide "AI processing" card: the unit pool every owned
// workspace draws from (a family member's is the family payer's). The
// per-workspace breakdown lives on the workspace dashboard (/workspaces),
// which renders the same pool through AiPoolMeters.
//
// GET /api/me/ai-search. Hidden while loading, on failure, and when the plan
// has no AI search (`pool.limits` null).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchAccountAiSearch, type AccountAiPool, type AccountAiSearch } from '@/lib/ai-search';
import { formatDateWith, formatNumber } from '@/lib/format-locale';
import { useT } from '@/lib/i18n';

export function AiProcessingCard() {
  const t = useT();
  const [data, setData] = useState<AccountAiSearch | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAccountAiSearch()
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { /* optional card: stays hidden */ });
    return () => { cancelled = true; };
  }, []);

  if (!data?.pool.limits) return null;
  const { pool } = data;

  return (
    <Card className="gap-0 overflow-hidden p-5" data-testid="billing-ai-processing">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t('billing.heading.aiProcessing')}</h2>
        <FamilyPoolBadge pool={pool} />
      </div>
      <div className="mt-3 max-w-md">
        <AiPoolMeters pool={pool} />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        <Link to="/workspaces" className="underline-offset-2 hover:text-foreground hover:underline">{t('billing.action.perWorkspaceSeeTheWorkspaceDashboard')}</Link>
      </p>
    </Card>
  );
}

/** "Family pool" badge when the units shown are the family payer's. */
export function FamilyPoolBadge({ pool }: { pool: AccountAiPool }) {
  const t = useT();
  if (!pool.payer_is_family) return null;
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">{t('billing.label.familyPool')}</Badge>;
}

/** The account pool: the platform pause, backfill remaining, and this month used with the reset date. */
export function AiPoolMeters({ pool }: { pool: AccountAiPool }) {
  const t = useT();
  return (
    <div className="space-y-4">
      {pool.paused && (
        <p role="status" className="text-xs font-medium text-amber-600">{t('dashboard.status.pausedByDosya')}</p>
      )}
      <dl className="space-y-4">
        <Meter label={t('billing.label.backfillRemaining')} used={pool.backfill_units_remaining} max={pool.backfill_units_total} />
        {pool.month_units_total > 0 && (
          <div>
            <Meter label={t('billing.label.thisMonth')} used={pool.month_units_total - pool.month_units_remaining} max={pool.month_units_total} />
            {pool.month_reset_at && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('billing.label.resetsDate', { date: formatDateWith(pool.month_reset_at, { month: 'long', day: 'numeric', year: 'numeric' }, 'en-US') })}
              </p>
            )}
          </div>
        )}
      </dl>
    </div>
  );
}

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const t = useT();
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs font-medium">{label}</dt>
        <dd className="font-mono text-xs tabular-nums text-muted-foreground">{t('settings.label.countOfMax', { count: formatNumber(used), max: formatNumber(max) })}</dd>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(used, max)}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
