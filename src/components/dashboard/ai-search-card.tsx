// The workspace dashboard's AI search card: this workspace's indexing status.
// Settings -> AI search holds only the controls; the account-wide unit pool
// is on Billing.
//
// GET /api/workspaces/:id/ai-search (any member). Hidden while loading, on
// failure, and when the owner's plan has no AI search (`status.limits` null).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchWorkspaceAiSearch, pauseReason, type AiSearchSettingsResponse } from '@/lib/ai-search';
import { formatNumber } from '@/lib/format-locale';
import { useT } from '@/lib/i18n';

const SETTINGS_LINK = '/settings#section-ai';

export function AiSearchCard({ wsId }: { wsId: string }) {
  const t = useT();
  // Keyed by workspace, so a switch never shows the previous workspace's numbers.
  const [loaded, setLoaded] = useState<{ wsId: string; res: AiSearchSettingsResponse | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWorkspaceAiSearch(wsId)
      .then((res) => { if (!cancelled) setLoaded({ wsId, res }); })
      .catch(() => { /* optional card: stays hidden */ });
    return () => { cancelled = true; };
  }, [wsId]);

  const data = loaded?.wsId === wsId ? loaded.res : null;
  if (!data || !data.status.limits) return null;
  const { settings, status, can_edit: canEdit } = data;
  const limits = status.limits!;
  const reason = settings.enabled ? pauseReason(status) : null;

  return (
    <Card data-testid="dashboard-ai-search">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-semibold">{t('settings.label.aiSearch')}</CardTitle>
        {settings.enabled && (
          <Link to={SETTINGS_LINK} className="text-xs text-muted-foreground hover:text-foreground">{t('common.action.manage')}</Link>
        )}
      </CardHeader>
      <CardContent>
        {!settings.enabled ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('dashboard.description.searchInsideDocumentsAndPhotosNotJustFileNames')}</p>
            {canEdit && (
              <Link
                to={SETTINGS_LINK}
                className="inline-flex h-7 items-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted"
              >{t('dashboard.action.turnOn')}</Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {reason && (
              <p role="status" className="rounded-lg border border-orange-300/60 bg-orange-50 px-3 py-2 text-xs dark:bg-orange-950/20">
                {reason === 'maintenance' ? t('dashboard.status.pausedByDosya') : t('settings.status.pausedLimitReached')}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-[11px] text-muted-foreground">{t('settings.label.indexed')}</dt>
                <dd className="text-lg font-semibold tracking-tight tabular-nums">{formatNumber(status.indexed)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">{t('settings.label.waiting')}</dt>
                <dd className="text-lg font-semibold tracking-tight tabular-nums">{formatNumber(status.pending)}</dd>
              </div>
            </dl>
            <div className="space-y-3">
              <Budget label={t('common.label.images')} used={status.images} max={limits.imagesMax} />
              <Budget label={t('common.label.documents')} used={status.documents} max={limits.documentsMax} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Budget({ label, used, max }: { label: string; used: number; max: number }) {
  const t = useT();
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{t('settings.label.countOfMax', { count: formatNumber(used), max: formatNumber(max) })}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(used, max)}>
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-orange-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
