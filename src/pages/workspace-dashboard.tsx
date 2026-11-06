import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getWorkspaceDashboard } from '@/api/workspace-dashboard';
import {
  storageColor, stackedSegments, roleLabel, WS_SEGMENT_COLORS,
  type WorkspaceDashboardData,
} from '@/lib/workspace-dashboard';
import { useWorkspace } from '@/stores/workspace';
import { formatBytes } from '@/lib/billing/cart-math';
import { API_BASE } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import { licenseProviderLabel, licenseTimeline } from '@/lib/license-timeline';
import { useT } from '@/lib/i18n';
import { fetchAccountAiSearch, type AccountAiSearch, type AccountAiWorkspace } from '@/lib/ai-search';
import { AiPoolMeters, FamilyPoolBadge } from '@/components/billing/ai-processing-card';
import { AiIndexDonut } from '@/components/workspaces/ai-index-donut';
import type { MessageKey } from '@/i18n/keys';

type AiRowState = 'indexing' | 'limit' | 'platform';

const AI_STATE_KEY: Record<AiRowState, MessageKey> = {
  indexing: 'billing.status.indexing',
  limit: 'settings.status.pausedLimitReached',
  platform: 'dashboard.status.pausedByDosya',
};

function aiRowState(ws: AccountAiWorkspace, poolPaused: boolean): AiRowState {
  if (poolPaused || ws.paused_reason === 'platform') return 'platform';
  return ws.paused_reason === 'limit' ? 'limit' : 'indexing';
}

const SOURCE_DOT: Record<string, string> = {
  plan: '#3b82f6', package: '#8b5cf6', custom: '#f59e0b', license: '#ec4899', referral: '#22c55e',
};

export default function WorkspaceDashboardPage() {
  const t = useT();
  const navigate = useNavigate();
  const activeId = useWorkspace((s) => s.activeId);
  const setActiveId = useWorkspace((s) => s.setActiveId);
  const [data, setData] = useState<WorkspaceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  // AI search pool + per-workspace index counts (GET /api/me/ai-search). Optional:
  // a failure or a plan without AI search (limits null) hides every AI line.
  const [ai, setAi] = useState<AccountAiSearch | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAccountAiSearch()
      .then((res) => { if (!cancelled) setAi(res); })
      .catch(() => { /* optional: AI lines stay hidden */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    getWorkspaceDashboard()
      .then((d) => setData(d))
      .catch((err) => { console.error('Failed to load workspace dashboard', err); })
      .finally(() => setLoading(false));
  }, []);

  const openWorkspace = (id: string) => {
    if (id !== activeId) setActiveId(id);
    navigate('/');
  };

  if (loading) return <WorkspaceDashboardSkeleton />;
  if (!data) return <div className="p-6 text-center text-muted-foreground">{t('workspaces.error.failedToLoadWorkspaceDashboard')}</div>;

  const { total, sources, owned, shared } = data;
  const pct = total.limit_bytes > 0 ? Math.min(100, Math.round((total.used_bytes / total.limit_bytes) * 100)) : 0;
  const segments = stackedSegments(owned, total.used_bytes);
  const aiPool = ai?.pool.limits ? ai.pool : null;
  const aiById = new Map((aiPool ? ai!.workspaces : []).map((w) => [w.id, w]));

  return (
    <div className="p-6 space-y-5 overflow-y-auto animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t('common.heading.workspaceDashboard')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('workspaces.description.yourStorageAcrossEveryWorkspaceYouOwn')}</p>
        </div>
        <Link to="/billing">
          <Button className="gap-2"><Plus className="size-4" /> {t('workspaces.action.getMoreStorage')}</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Left column: total + owned workspaces */}
        <div className="space-y-4">
          {/* Your storage */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t('workspaces.heading.yourStorage')}</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-end justify-between mb-3">
                <p className="text-2xl font-semibold tracking-tight">
                  {formatBytes(total.used_bytes)} <span className="text-sm font-normal text-muted-foreground">{t('common.label.used')}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('navigation.label.freeFreeOfTotal', { free: formatBytes(total.free_bytes), total: formatBytes(total.limit_bytes) })}
                </p>
              </div>
              {/* Stacked-by-workspace usage bar */}
              <div className="h-2.5 bg-border rounded-full overflow-hidden">
                <div className="h-full flex overflow-hidden" style={{ width: `${pct}%` }}>
                  {segments.length === 0 ? (
                    <div className="h-full w-full" style={{ background: storageColor(pct) }} />
                  ) : segments.map((seg) => {
                    const ownedIdx = owned.findIndex((w) => w.id === seg.id);
                    const color = WS_SEGMENT_COLORS[ownedIdx % WS_SEGMENT_COLORS.length];
                    return (
                      <div key={seg.id} className="h-full" style={{ width: `${seg.widthPct}%`, background: color }} title={`${seg.name}: ${formatBytes(owned.find((w) => w.id === seg.id)?.used_bytes ?? 0)}`} />
                    );
                  })}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">{t('workspaces.description.pctOfYourTotalSpaceUsed', { pct })}</p>
            </CardContent>
          </Card>

          {/* Workspaces you own */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t('workspaces.heading.workspacesYouOwn')}</CardTitle></CardHeader>
            <CardContent>
              {owned.length === 0 ? (
                <p className="py-5 text-center text-xs text-muted-foreground">{t('workspaces.label.youDonTOwnAnyWorkspacesYet')}</p>
              ) : (
                <div className="space-y-0">
                  {owned.map((ws, i) => (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => openWorkspace(ws.id)}
                      className="w-full flex items-center gap-3 py-2.5 border-b last:border-b-0 text-start hover:bg-muted/40 rounded-md px-1 transition-colors"
                    >
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: WS_SEGMENT_COLORS[i % WS_SEGMENT_COLORS.length] }} />
                      <div className="w-8 h-8 rounded-md flex items-center justify-center text-[11px] font-bold text-white shrink-0 overflow-hidden bg-muted" style={ws.icon_image_url ? undefined : { background: ws.icon_color }}>
                        {ws.icon_image_url
                          ? <img src={`${API_BASE}/api/workspaces/${ws.id}/icon`} alt="" className="w-full h-full object-cover" />
                          : ws.icon_initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate">{ws.name}</p>
                        <p className="text-[11px] text-muted-foreground">{t('workspaces.action.wsusedBytesUsed', { bytes: formatBytes(ws.used_bytes) })}</p>
                        {aiPool && <AiIndexLine ws={aiById.get(ws.id)} poolPaused={aiPool.paused} />}
                      </div>
                      <div className="w-28 shrink-0">
                        <Progress
                          value={Math.min(ws.share_pct, 100)}
                          className="**:data-[slot=progress-track]:bg-border **:data-[slot=progress-indicator]:bg-(--bar-color)"
                          style={{ '--bar-color': WS_SEGMENT_COLORS[i % WS_SEGMENT_COLORS.length] } as React.CSSProperties}
                        />
                      </div>
                      <span className="text-xs font-semibold w-10 text-end shrink-0">{ws.share_pct}%</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: sources + shared */}
        <div className="space-y-4">
          {/* Where your space comes from */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t('workspaces.heading.whereYourSpaceComesFrom')}</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {sources.map((src, i) => {
                  const provider = typeof src.meta.provider === 'string' ? src.meta.provider : null;
                  const timeline = src.kind === 'license'
                    ? licenseTimeline({
                      ends_at: typeof src.meta.ends_at === 'number' ? src.meta.ends_at : null,
                      renews_at: typeof src.meta.renews_at === 'number' ? src.meta.renews_at : null,
                      provider,
                    })
                    : null;
                  return (
                    <div key={`${src.kind}-${i}`} className="flex items-start gap-2">
                      <div className="mt-[5px] w-2 h-2 rounded-full shrink-0" style={{ background: SOURCE_DOT[src.kind] ?? '#6b7280' }} />
                      <div className="min-w-0 flex-1">
                        <span className="block text-xs truncate">{src.label}</span>
                        {timeline ? (
                          <span className={timeline.tone === 'ending' ? 'block text-[11px] font-medium text-amber-600' : 'block text-[11px] text-muted-foreground'}>
                            {licenseProviderLabel(provider)} · {timeline.text}
                          </span>
                        ) : null}
                      </div>
                      <span className="text-[11px] font-medium text-muted-foreground">{formatBytes(src.bytes)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between border-t mt-3 pt-2 text-xs font-semibold">
                <span>{t('common.label.total')}</span><span>{formatBytes(total.limit_bytes)}</span>
              </div>
            </CardContent>
          </Card>

          {/* AI search: the account's processing pool */}
          {aiPool && (
            <Card data-testid="workspaces-ai-search">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-semibold">{t('settings.label.aiSearch')}</CardTitle>
                <FamilyPoolBadge pool={aiPool} />
              </CardHeader>
              <CardContent className="space-y-5">
                <AiIndexDonut workspaces={ai!.workspaces} />
                <AiPoolMeters pool={aiPool} />
              </CardContent>
            </Card>
          )}

          {/* Shared with you */}
          {shared.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t('workspaces.heading.sharedWithYou')}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-[11px] text-muted-foreground mb-2">{t('workspaces.description.theseUseTheOwnerSStorageNotYours')}</p>
                <div className="space-y-0">
                  {shared.map((ws) => (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => openWorkspace(ws.id)}
                      className="w-full flex items-center gap-2.5 py-2 text-start hover:bg-muted/40 rounded-md px-1 transition-colors"
                    >
                      <div className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0 overflow-hidden bg-muted" style={ws.icon_image_url ? undefined : { background: ws.icon_color }}>
                        {ws.icon_image_url
                          ? <img src={`${API_BASE}/api/workspaces/${ws.id}/icon`} alt="" className="w-full h-full object-cover" />
                          : ws.icon_initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate">{ws.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{ws.owner_name}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{roleLabel(ws.role_id)}</Badge>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** One owned workspace's AI index line under its storage line; nothing when the response does not list it. */
function AiIndexLine({ ws, poolPaused }: { ws: AccountAiWorkspace | undefined; poolPaused: boolean }) {
  const t = useT();
  if (!ws) return null;
  if (!ws.enabled) {
    return <p className="text-[11px] text-muted-foreground" data-testid="ws-ai-line">{t('workspaces.status.aiSearchOff')}</p>;
  }
  const state = aiRowState(ws, poolPaused);
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground" data-testid="ws-ai-line">
      <span>{t('workspaces.label.aiIndexImagesDocuments', { images: ws.images, documents: ws.documents })}</span>
      <span
        data-testid="ws-ai-state"
        className={state === 'indexing'
          ? 'rounded-full border px-1.5 text-[10px] leading-4'
          : 'rounded-full border border-amber-300/70 bg-amber-50 px-1.5 text-[10px] leading-4 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'}
      >{t(AI_STATE_KEY[state])}</span>
    </p>
  );
}

function WorkspaceDashboardSkeleton() {
  return (
    <div className="p-6 space-y-5">
      <div className="flex justify-between">
        <div className="space-y-2"><Skeleton className="h-6 w-56" /><Skeleton className="h-4 w-72" /></div>
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <Card><CardContent className="pt-6 space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-3 w-full" /></CardContent></Card>
          <Card><CardContent className="pt-6 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></CardContent></Card>
        </div>
        <div className="space-y-4">
          <Card><CardContent className="pt-6 space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></CardContent></Card>
        </div>
      </div>
    </div>
  );
}
