import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Upload, ChevronDown } from 'lucide-react';
import { FilePreviewImage } from '@/components/file-preview-image';
import {
  greeting, todayStr, humanSize, humanSizeShort, timeAgo, shortDateTime,
  colorFor, extOf, avatarColor, initials,
  regionLabel, actionLabel, activityLink,
} from '@/lib/helpers';
import { parseUA } from '@/lib/ua';

interface DashboardActivity {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: number;
  user_id: string | null;
  user_name: string | null;
  user_avatar: string | null;
  // Forensic fields — nulled server-side (shapeActivityRow) for
  // non-privileged viewers looking at another member's row.
  source_ip?: string | null;
  user_agent?: string | null;
  outcome?: string | null;
  source?: string | null;
  resource_name?: string | null;
  meta?: ({ geo?: { country?: string | null; city?: string | null } | null } & Record<string, any>) | null;
}

interface DashboardData {
  user_name: string;
  workspace_name: string | null;
  stats: {
    total_files: number;
    files_this_week: number;
    shared_externally: number;
    total_bytes: number;
    storage_cap_bytes: number | null;
    plan: string;
  };
  storage_breakdown: { name: string; bytes: number; color: string }[];
  region_breakdown: { region: string; bytes: number; file_count: number; color: string }[];
  recent_files: { id: string; name: string; size_bytes: number; created_at: number }[];
  team_stats: { user_id: string; name: string; email: string; avatar_url: string | null; file_count: number; total_bytes: number }[];
  activity: DashboardActivity[];
}

const PLAN_LABELS: Record<string, string> = { free: 'Free', starter: 'Starter', plus: 'Plus', pro: 'Pro', business: 'Business' };
const MEMBER_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'];

export default function DashboardPage() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!wsId) return;
    try {
      const d = await api<{ ok: boolean } & DashboardData>(`/api/dashboard?workspace_id=${wsId}`);
      if (d.ok) setData(d);
    } catch { /* ignore */ }
    setLoading(false);
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <DashboardSkeleton />;
  if (!data) return <div className="p-6 text-center text-muted-foreground">Failed to load dashboard</div>;

  const s = data.stats;
  const pct = s.storage_cap_bytes ? Math.min(100, Math.round((s.total_bytes / s.storage_cap_bytes) * 100)) : 0;

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
            Upload files
          </Button>
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total files" value={s.total_files.toLocaleString()} sub={<><span className="text-green-600 font-semibold">+{s.files_this_week}</span> this week</>} />
        <StatCard label="Shared externally" value={s.shared_externally.toLocaleString()} sub="Active share links" />
        <StatCard label="File requests" value="—" sub="Active requests" />
        <StatCard label="Storage used" value={humanSizeShort(s.total_bytes)} sub={s.storage_cap_bytes ? `of ${humanSizeShort(s.storage_cap_bytes)}` : 'unlimited plan'} />
        <StatCard label="Current plan" value={PLAN_LABELS[s.plan] ?? s.plan}>
          {s.plan === 'free' ? (
            <Link to="/#pricing"><Button size="sm" className="mt-2 h-6 text-[11px]">Upgrade now</Button></Link>
          ) : (
            <Link to="/billing" className="text-[11px] text-muted-foreground hover:text-foreground">Manage billing</Link>
          )}
        </StatCard>
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        {/* Left column */}
        <div className="space-y-4">
          {/* Storage breakdown */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold">Storage breakdown</CardTitle>
              <Link to="/files" className="text-xs text-muted-foreground hover:text-foreground">Manage</Link>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-5 mb-4">
                <StorageRing pct={pct} />
                <div>
                  <p className="text-2xl font-semibold tracking-tight">{humanSizeShort(s.total_bytes)} <span className="text-sm font-normal text-muted-foreground">used</span></p>
                  <p className="text-xs text-muted-foreground mt-1">{s.storage_cap_bytes ? `of ${humanSizeShort(s.storage_cap_bytes)} total` : 'unlimited storage'}</p>
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
                      <span className="text-[11px] text-muted-foreground min-w-[36px] text-right">{humanSizeShort(b.bytes)}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Recent files */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold">Recent files</CardTitle>
              <Link to="/files" className="text-xs text-muted-foreground hover:text-foreground">View all</Link>
            </CardHeader>
            <CardContent>
              {data.recent_files.length === 0 ? (
                <p className="py-5 text-center text-xs text-muted-foreground">No files yet</p>
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
                        <p className="font-mono text-xs font-semibold text-white truncate drop-shadow">{f.name}</p>
                        <p className="font-mono text-[10px] text-white/70 truncate drop-shadow">{humanSize(f.size_bytes)} · {timeAgo(f.created_at)}</p>
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
              <CardTitle className="text-sm font-semibold">Team usage</CardTitle>
              <Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">Manage</Link>
            </CardHeader>
            <CardContent>
              {data.team_stats.length === 0 ? (
                <p className="py-5 text-center text-xs text-muted-foreground">No team members yet</p>
              ) : (
                <>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">{humanSizeShort(s.total_bytes)}</span> of {s.storage_cap_bytes ? humanSizeShort(s.storage_cap_bytes) : 'Unlimited'} used</span>
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
                            <p className="text-[13px] font-medium truncate">{m.name || m.email}</p>
                            <p className="text-[11px] text-muted-foreground">{m.file_count} file{m.file_count !== 1 ? 's' : ''} · {humanSizeShort(m.total_bytes)}</p>
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
              <CardTitle className="text-sm font-semibold">Activity</CardTitle>
              <Link to="/activity" className="text-xs text-muted-foreground hover:text-foreground">All</Link>
            </CardHeader>
            <CardContent className="max-h-[360px] overflow-y-auto">
              {data.activity.length === 0 ? (
                <p className="py-5 text-center text-xs text-muted-foreground">No activity yet</p>
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
              <CardTitle className="text-sm font-semibold">Storage by region</CardTitle>
            </CardHeader>
            <CardContent>
              {data.region_breakdown.length === 0 ? (
                <p className="py-5 text-center text-xs text-muted-foreground">No files uploaded yet</p>
              ) : (
                <div className="space-y-2">
                  {data.region_breakdown.map((r) => {
                    const total = data.region_breakdown.reduce((s, x) => s + x.bytes, 0);
                    const rPct = total > 0 ? Math.round((r.bytes / total) * 100) : 0;
                    return (
                      <div key={r.region} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
                        <span className="text-xs flex-1">{regionLabel(r.region)}</span>
                        <span className="text-[11px] text-muted-foreground">{r.file_count} file{r.file_count !== 1 ? 's' : ''}</span>
                        <span className="text-[11px] font-medium min-w-[40px] text-right">{rPct}%</span>
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
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const failed = a.outcome === 'failure' || a.outcome === 'denied';
  const device = parseUA(a.user_agent);
  const geo = a.meta?.geo;
  const resourceName = a.resource_name ?? a.meta?.name;
  const link = activityLink(a.entity_type, a.entity_id, a.action);

  return (
    <div className="border-b last:border-b-0">
      {/* div, not button: the resource name inside is a Link and interactive
          elements can't nest. Clicking the row toggles the detail. */}
      <div role="button" tabIndex={0} onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }} className="w-full text-left flex items-start gap-2.5 py-2.5 cursor-pointer">
        <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold text-white mt-0.5" style={{ background: avatarColor(a.user_id ?? '') }}>
          {/* avatar_url is an R2 object key, not a URL — treat it as a "has photo"
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
            initials(a.user_name ?? 'Unknown')
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">{a.user_name ?? 'Unknown'}</span>{' '}
            {actionLabel(a.action)}{' '}
            {resourceName && (
              link ? (
                <Link to={link} onClick={(e) => e.stopPropagation()} className="font-semibold text-foreground hover:underline">{resourceName}</Link>
              ) : (
                <span className="font-semibold text-foreground">{resourceName}</span>
              )
            )}
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
        <dl className="pl-9.5 pb-2.5 grid grid-cols-[72px_1fr] gap-x-2.5 gap-y-1 text-[11px]">
          {workspaceName && (
            <>
              <dt className="text-muted-foreground">Workspace</dt>
              <dd className="truncate">{workspaceName}</dd>
            </>
          )}
          <dt className="text-muted-foreground">When</dt>
          <dd>{new Date(a.created_at * 1000).toLocaleString()} · {timeAgo(a.created_at)}</dd>

          {(resourceName || a.entity_type) && (
            <>
              <dt className="text-muted-foreground">{a.entity_type === 'file' ? 'File' : 'Resource'}</dt>
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
              <dt className="text-muted-foreground">Where</dt>
              <dd>{a.source_ip}{geo?.country ? ` · ${geo.city ? `${geo.city}, ` : ''}${geo.country}` : ''}</dd>
            </>
          )}
          {a.user_agent && (
            <>
              <dt className="text-muted-foreground">Device</dt>
              <dd title={a.user_agent}>{device.browser}{device.os ? ` · ${device.os}` : ''}</dd>
            </>
          )}
          {a.source && (
            <>
              <dt className="text-muted-foreground">Source</dt>
              <dd>{a.source}</dd>
            </>
          )}
          {a.outcome && (
            <>
              <dt className="text-muted-foreground">Outcome</dt>
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
  const circumference = 188.5;
  const offset = circumference - (circumference * pct / 100);
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className="shrink-0">
      <circle cx="40" cy="40" r="30" fill="none" className="stroke-border" strokeWidth="8" />
      <circle cx="40" cy="40" r="30" fill="none" stroke="#22c55e" strokeWidth="8" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 40 40)" className="transition-all duration-700" />
      <text x="40" y="37" textAnchor="middle" fontSize="13" fontWeight="600" className="fill-foreground">{pct}%</text>
      <text x="40" y="50" textAnchor="middle" fontSize="8.5" className="fill-muted-foreground">used</text>
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
