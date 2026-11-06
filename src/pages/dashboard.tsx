import { DATE_TIME_NUMERIC, formatDateWith, formatNumber } from '@/lib/format-locale';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE, apiErrorMessage } from '@/api/client';
import { dashboardQueryKey, dashboardQueryOptions, type DashboardActivity } from '@/lib/dashboard-query';
import { useWorkspace } from '@/stores/workspace';
import { usePermissions } from '@/hooks/use-permissions';
import { useOnboarding } from '@/stores/onboarding';
import { FirstRunHome } from '@/components/onboarding/first-run-home';
import { shouldShowFirstRun } from '@/components/onboarding/steps';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Upload, ChevronDown, AlertCircle, RefreshCw } from 'lucide-react';
import { FilePreviewImage } from '@/components/file-preview-image';
import { AiSearchCard } from '@/components/dashboard/ai-search-card';
import {
  greeting, todayStr, humanSize, humanSizeShort, timeAgo, shortDateTime,
  colorFor, extOf, avatarColor, initials,
  regionLabel, activityLink,
} from '@/lib/helpers';
import { activityPhrase, describeDevice } from '@/lib/activity-labels';
import { richText } from '@/lib/rich-text';
import { useT } from '@/lib/i18n';

// Plan names are server-side names and stay as they are in every language.
const PLAN_LABELS: Record<string, string> = { free: 'Free', starter: 'Starter', plus: 'Plus', pro: 'Pro', business: 'Business', tb4: '4 TB', tb6: '6 TB', tb8: '8 TB', tb10: '10 TB', tb20: '20 TB' };
const MEMBER_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'];

export default function DashboardPage() {
  const t = useT();
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  // Without `view_activity` the server narrows this panel to the member's own
  // rows, so the card says so and drops the "All" link - which leads to
  // /activity, the one door that still answers 403 for the want of it. Same
  // contract as everywhere else: this hides a door known to be locked, it
  // does not decide what is allowed (see use-permissions.ts).
  const { can } = usePermissions();
  const canViewActivity = can('view_activity');
  const onbDismissed = useOnboarding((s) => s.dismissed);
  const refreshOnboarding = useOnboarding((s) => s.refresh);
  const queryClient = useQueryClient();
  // The layout may already have this in flight from boot (prefetchDashboard):
  // mounting here joins that request rather than starting another, and a
  // revisit inside staleTime paints from cache with no request at all.
  const { data, isPending, error, refetch } = useQuery({
    ...dashboardQueryOptions(wsId),
    enabled: !!wsId,
  });

  useEffect(() => { void refreshOnboarding(wsId); }, [refreshOnboarding, wsId]);

  // Uploads finishing elsewhere change the numbers on this page. The first
  // upload is also what flips this page from first-run to dashboard, so both
  // fetches have to refresh on it.
  useEffect(() => {
    const onUploaded = () => {
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKey(wsId) });
      void refreshOnboarding(wsId);
    };
    window.addEventListener('dosya:upload-complete', onUploaded);
    return () => window.removeEventListener('dosya:upload-complete', onUploaded);
  }, [queryClient, refreshOnboarding, wsId]);

  if (isPending) return <DashboardSkeleton />;
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <AlertCircle className="size-10 text-destructive/40 mb-3" />
        <p className="text-sm font-medium text-foreground mb-1">{t('dashboard.error.couldNotLoadYourDashboard')}</p>
        <p className="text-xs text-muted-foreground max-w-80 mb-4">
          {/* The old dead-end read "Failed to load dashboard" with no reason
              and no way forward but a manual reload. */}
          {apiErrorMessage(error, t('dashboard.error.theDashboardCouldNotBeLoaded'))}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void refetch()}>
            <RefreshCw className="size-3 me-1" /> {t('common.action.tryAgain')}
          </Button>
          <Link to="/support">
            <Button variant="ghost" size="sm" className="h-8 text-xs">{t('common.action.contactSupport')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // An empty workspace gets the first-run screen instead of a dashboard full
  // of zeroes. Keyed on the workspace being empty rather than the account
  // being new, so accounts that never uploaded get it too. Also requires an
  // empty trash: total_files alone would show "put your first file in" to an
  // established account that selected all and deleted, while its storage and
  // plan cards vanish underneath it.
  if (shouldShowFirstRun(data.stats, onbDismissed)) {
    return <FirstRunHome userName={data.user_name} />;
  }

  const s = data.stats;
  const pct = s.storage_cap_bytes ? Math.min(100, Math.round((s.total_bytes / s.storage_cap_bytes) * 100)) : 0;
  const teamUsageText = t('dashboard.description.stotalBytesOfHascapUsed', {
    sTotal_bytes: '{sTotal_bytes}',
    hasCap: s.storage_cap_bytes ? 'true' : 'other',
    sStorage_cap_bytes: s.storage_cap_bytes ? humanSizeShort(s.storage_cap_bytes) : '',
  });
  const teamUsageLine = richText(
    teamUsageText,
    { sTotal_bytes: <span className="font-semibold text-foreground">{humanSizeShort(s.total_bytes)}</span> },
  );

  return (
    <div className="p-6 space-y-5 overflow-y-auto animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{greeting()}, {data.user_name.split(' ')[0]}</h1>
          <p className="text-sm text-muted-foreground mt-1">{todayStr()}</p>
        </div>
        <Link to="/uploads">
          <Button className="gap-2">
            <Upload className="size-4" />
            {t('common.action.uploadFiles')}
          </Button>
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label={t('common.label.totalFiles')} value={formatNumber(s.total_files)} sub={richText(t('dashboard.label.sfilesThisWeekThisWeek'), { count: <span className="text-green-600 font-semibold">{s.files_this_week}</span> })} />
        <StatCard label={t('common.label.sharedExternally')} value={formatNumber(s.shared_externally)} sub={t('common.label.activeShareLinks')} />
        <StatCard label={t('common.label.fileRequests')} value="-" sub={t('common.label.activeRequests')} />
        <StatCard label={t('common.label.storageUsed')} value={humanSizeShort(s.total_bytes)} sub={s.storage_cap_bytes ? t('dashboard.label.ofSstorageCapBytes', { storageCapBytes: humanSizeShort(s.storage_cap_bytes) }) : t('dashboard.label.unlimitedPlan')} />
        <StatCard label={t('common.label.currentPlan')} value={PLAN_LABELS[s.plan] ?? s.plan}>
          {/* This used to point at /#pricing, a marketing-site anchor. Inside the
              app the router resolved it to the dashboard itself, so the button
              appeared to do nothing. /billing?upgrade=1 opens the plan chooser. */}
          {s.plan === 'free' ? (
            <Link to="/billing?upgrade=1"><Button size="sm" className="mt-2 h-6 text-[11px]">{t('dashboard.action.upgradeNow')}</Button></Link>
          ) : (
            <Link to="/billing" className="text-[11px] text-muted-foreground hover:text-foreground">{t('dashboard.action.manageBilling')}</Link>
          )}
        </StatCard>
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        {/* Left column */}
        <div className="space-y-4">
          {/* Storage breakdown, with the AI search card beside it. The card
              renders nothing when the owner's plan has no AI search; the
              breakdown then takes the whole row (only-child). */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
            <Card className="md:only:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-semibold">{t('dashboard.heading.storageBreakdown')}</CardTitle>
                <Link to="/files" className="text-xs text-muted-foreground hover:text-foreground">{t('common.action.manage')}</Link>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-5 mb-4">
                  <StorageRing pct={pct} />
                  <div>
                    <p className="text-2xl font-semibold tracking-tight">{humanSizeShort(s.total_bytes)} <span className="text-sm font-normal text-muted-foreground">{t('common.label.used')}</span></p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {s.storage_cap_bytes ? t('dashboard.label.ofSstorageCapBytesTotal', { storageCapBytes: humanSizeShort(s.storage_cap_bytes) }) : t('dashboard.label.unlimitedStorage')}
                      {s.trash_bytes > 0 ? t('dashboard.label.strashBytesInTrash', { sTrash_bytes: humanSizeShort(s.trash_bytes) }) : ''}
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  {data.storage_breakdown.map((b) => {
                    const max = Math.max(...data.storage_breakdown.map((x) => x.bytes), 1);
                    return (
                      <div key={b.name} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color }} />
                        <span className="text-xs text-muted-foreground flex-1">{b.name}</span>
                        <Progress
                          value={Math.round((b.bytes / max) * 100)}
                          className="flex-[2] **:data-[slot=progress-track]:bg-border **:data-[slot=progress-indicator]:bg-(--bar-color)"
                          style={{ '--bar-color': b.color } as React.CSSProperties}
                        />
                        <span className="text-[11px] text-muted-foreground min-w-[36px] text-end">{humanSizeShort(b.bytes)}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
            <AiSearchCard wsId={wsId} />
          </div>

          {/* Recent files */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold">{t('dashboard.heading.recentFiles')}</CardTitle>
              <Link to="/files" className="text-xs text-muted-foreground hover:text-foreground">{t('common.action.viewAll')}</Link>
            </CardHeader>
            <CardContent>
              {data.recent_files.length === 0 ? (
                <p className="py-5 text-center text-xs text-muted-foreground">{t('dashboard.empty.noFilesYet')}</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                  {data.recent_files.map((f) => (
                    <Link key={f.id} to={`/files?view=${f.id}`} className="group relative aspect-3/2 overflow-hidden rounded-xl border hover:shadow-lg hover:-translate-y-px transition-all no-underline">

                      {/* Full-bleed cover image (matches the files-page card) */}
                      <div className="absolute inset-0 bg-neutral-900">
                        <FilePreviewImage
                          fileId={f.id}
                          fileName={f.name}
                          size={512}
                          className="w-full h-full object-cover"
                          fallback={
                            <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${colorFor(f.name)}22, #0a0a0a)` }}>
                              <span className="font-mono text-lg font-bold tracking-widest uppercase" style={{ color: colorFor(f.name) }}>{extOf(f.name).toUpperCase() || 'FILE'}</span>
                            </div>
                          }
                        />
                      </div>
                      {/* Name + size·date overlaid on a bottom scrim */}
                      <div className="absolute inset-x-0 bottom-0 z-10 bg-linear-to-t from-black/85 via-black/40 to-transparent p-2.5 pt-6">
                        <p className="font-mono text-xs font-semibold text-white truncate drop-shadow" dir="auto">{f.name}</p>
                        <p className="font-mono text-[10px] text-white/70 truncate drop-shadow"><bdi>{humanSize(f.size_bytes)}</bdi> · <bdi>{timeAgo(f.created_at)}</bdi></p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Team usage */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold">{t('dashboard.heading.teamUsage')}</CardTitle>
              <Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">{t('common.action.manage')}</Link>
            </CardHeader>
            <CardContent>
              {data.team_stats.length === 0 ? (
                <p className="py-5 text-center text-xs text-muted-foreground">{t('dashboard.label.noTeamMembersYet')}</p>
              ) : (
                <>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">{teamUsageLine}</span>
                    <span className="text-xs font-semibold">{pct}%</span>
                  </div>
                  {/* Stacked bar */}
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden mb-4">
                    <div className="h-full flex rounded-full overflow-hidden" style={{ width: `${Math.max(pct, 1)}%` }}>
                      {data.team_stats.filter((m) => m.total_bytes > 0).map((m, i) => (
                        <div key={m.user_id} className="h-full" style={{ width: `${Math.max((m.total_bytes / s.total_bytes) * 100, 1)}%`, background: MEMBER_COLORS[i % MEMBER_COLORS.length] }} title={`${m.name || m.email}: ${humanSizeShort(m.total_bytes)}`} />
                      ))}
                    </div>
                  </div>
                  {/* Member list */}
                  <div className="space-y-0">
                    {data.team_stats.map((m, i) => {
                      const memberPct = s.storage_cap_bytes ? ((m.total_bytes / s.storage_cap_bytes) * 100) : 0;
                      return (
                        <div key={m.user_id} className="flex items-center gap-2.5 py-2.5 border-b last:border-b-0">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: MEMBER_COLORS[i % MEMBER_COLORS.length] }} />
                          {m.avatar_url ? (
                            <img src={`${API_BASE}/api/users/${m.user_id}/avatar`} crossOrigin="use-credentials" className="w-7 h-7 rounded-full shrink-0 object-cover" alt="" />
                          ) : (
                            <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold text-white" style={{ background: avatarColor(m.user_id) }}>{initials(m.name || m.email)}</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium truncate" dir="auto">{m.name || m.email}</p>
                            <p className="text-[11px] text-muted-foreground">{t('dashboard.description.mfileCountPluralMtotalBytes', { mFile_count: m.file_count, mTotal_bytes: humanSizeShort(m.total_bytes) })}</p>
                          </div>
                          <span className="text-xs font-semibold shrink-0">{m.total_bytes > 0 ? (memberPct < 0.1 ? '<0.1%' : memberPct.toFixed(1) + '%') : '0%'}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Activity feed */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold">{canViewActivity ? t('common.heading.activity') : t('dashboard.heading.yourActivity')}</CardTitle>
              {canViewActivity && (
                <Link to="/activity" className="text-xs text-muted-foreground hover:text-foreground">{t('common.label.all.all')}</Link>
              )}
            </CardHeader>
            <CardContent className="max-h-[360px] overflow-y-auto">
              {data.activity.length === 0 ? (
                <p className="py-5 text-center text-xs text-muted-foreground">{t('common.empty.noActivityYet')}</p>
              ) : (
                <div className="space-y-0">
                  {data.activity.map((a) => (
                    <ActivityItem key={a.id} a={a} workspaceName={data.workspace_name} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Storage by region */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t('dashboard.heading.storageByRegion')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.region_breakdown.length === 0 ? (
                <p className="py-5 text-center text-xs text-muted-foreground">{t('common.label.noFilesUploadedYet')}</p>
              ) : (
                <div className="space-y-2">
                  {data.region_breakdown.map((r) => {
                    const total = data.region_breakdown.reduce((s, x) => s + x.bytes, 0);
                    const rPct = total > 0 ? Math.round((r.bytes / total) * 100) : 0;
                    return (
                      <div key={r.region} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
                        <span className="text-xs flex-1">{regionLabel(r.region)}</span>
                        <span className="text-[11px] text-muted-foreground">{t('file-requests.status.ruploadCountPluralOneFileOtherFiles', { rUpload_count: r.file_count })}</span>
                        <span className="text-[11px] font-medium min-w-[40px] text-end">{rPct}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ActivityItem({ a, workspaceName }: { a: DashboardActivity; workspaceName: string | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const failed = a.outcome === 'failure' || a.outcome === 'denied';
  const device = describeDevice(a.user_agent);
  const geo = a.meta?.geo;
  const resourceName = a.resource_name ?? a.meta?.name;
  const link = activityLink(a.entity_type, a.entity_id, a.action);

  return (
    <div className="border-b last:border-b-0">
      {/* div, not button: the resource name inside is a Link and interactive
          elements can't nest. Clicking the row toggles the detail. */}
      <div role="button" tabIndex={0} onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }} className="w-full text-start flex items-start gap-2.5 py-2.5 cursor-pointer">
        <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold text-white mt-0.5" style={{ background: avatarColor(a.user_id ?? '') }}>
          {/* avatar_url is an R2 object key, not a URL - treat it as a "has photo"
              flag and load the image through the API (cookie-authenticated),
              falling back to initials if it's missing or fails to load. */}
          {a.user_avatar && a.user_id && !avatarFailed ? (
            <img
              src={`${API_BASE}/api/users/${a.user_id}/avatar`}
              alt=""
              crossOrigin="use-credentials"
              className="w-full h-full rounded-full object-cover"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            initials(a.user_name ?? t('common.label.unknown'))
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {richText(t('dashboard.label.auserNameunknownAactionResourcenamelinklink'), {
              aUser_nameUnknown: <span className="font-semibold text-foreground">{a.user_name ?? t('common.label.unknown')}</span>,
              aAction: activityPhrase(a.action),
              resourceNameLinkLink: resourceName && (
                link ? (
                  <Link to={link} onClick={(e) => e.stopPropagation()} className="font-semibold text-foreground hover:underline">{resourceName}</Link>
                ) : (
                  <span className="font-semibold text-foreground">{resourceName}</span>
                )
              ),
            })}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {timeAgo(a.created_at)} · {shortDateTime(a.created_at)}
            {geo?.country ? ` · ${geo.city ? `${geo.city}, ` : ''}${geo.country}` : ''}
            {failed ? ` · ${a.outcome}` : ''}
          </p>
        </div>
        <ChevronDown className={`size-3 shrink-0 mt-1.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && (
        <dl className="ps-9.5 pb-2.5 grid grid-cols-[72px_1fr] gap-x-2.5 gap-y-1 text-[11px]">
          {workspaceName && (
            <>
              <dt className="text-muted-foreground">{t('common.label.workspace')}</dt>
              <dd className="truncate">{workspaceName}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{t('common.label.when')}</dt>
          <dd>{formatDateWith(a.created_at, DATE_TIME_NUMERIC)} · {timeAgo(a.created_at)}</dd>

          {(resourceName || a.entity_type) && (
            <>
              <dt className="text-muted-foreground">{a.entity_type === 'file' ? t('common.label.fileTitleCase') : t('common.label.resource')}</dt>
              <dd className="truncate">
                {link ? (
                  <Link to={link} className="hover:underline">{resourceName ?? `${a.entity_type} ${a.entity_id ?? ''}`}</Link>
                ) : (
                  resourceName ?? `${a.entity_type} ${a.entity_id ?? ''}`
                )}
              </dd>
            </>
          )}
          {a.source_ip && (
            <>
              <dt className="text-muted-foreground">{t('common.label.where')}</dt>
              <dd>{a.source_ip}{geo?.country ? ` · ${geo.city ? `${geo.city}, ` : ''}${geo.country}` : ''}</dd>
            </>
          )}
          {a.user_agent && (
            <>
              <dt className="text-muted-foreground">{t('common.label.device')}</dt>
              <dd title={a.user_agent}>{device.browser}{device.os ? ` · ${device.os}` : ''}</dd>
            </>
          )}
          {a.source && (
            <>
              <dt className="text-muted-foreground">{t('common.label.source')}</dt>
              <dd>{a.source}</dd>
            </>
          )}
          {a.outcome && (
            <>
              <dt className="text-muted-foreground">{t('common.label.outcome')}</dt>
              <dd>{a.outcome}{a.meta?.reason ? ` (${a.meta.reason})` : ''}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, children }: { label: string; value: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-4 pb-4">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-1.5">{label}</p>
        <p className="text-2xl font-semibold tracking-tight leading-none">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-1.5">{sub}</p>}
        {children}
      </CardContent>
    </Card>
  );
}

function StorageRing({ pct }: { pct: number }) {
  const t = useT();
  const circumference = 188.5;
  const offset = circumference - (circumference * pct / 100);
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className="shrink-0">
      <circle cx="40" cy="40" r="30" fill="none" className="stroke-border" strokeWidth="8" />
      <circle cx="40" cy="40" r="30" fill="none" stroke="#22c55e" strokeWidth="8" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 40 40)" className="transition-all duration-700" />
      <text x="40" y="37" textAnchor="middle" fontSize="13" fontWeight="600" className="fill-foreground">{pct}%</text>
      <text x="40" y="50" textAnchor="middle" fontSize="8.5" className="fill-muted-foreground">{t('common.label.used')}</text>
    </svg>
  );
}

function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-5">
      <div className="flex justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i}><CardContent className="pt-4 pb-4 space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-16" /><Skeleton className="h-3 w-24" /></CardContent></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        <div className="space-y-4">
          <Card><CardContent className="pt-6 space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></CardContent></Card>
          <Card><CardContent className="pt-6 space-y-3"><Skeleton className="h-24 w-full" /></CardContent></Card>
        </div>
        <div className="space-y-4">
          <Card><CardContent className="pt-6 space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></CardContent></Card>
        </div>
      </div>
    </div>
  );
}
