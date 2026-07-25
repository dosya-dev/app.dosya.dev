import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getWorkspaceDashboard } from '@/api/workspace-dashboard';
import {
  storageColor, stackedSegments, roleLabel, WS_SEGMENT_COLORS,
  type WorkspaceDashboardData,
} from '@/lib/workspace-dashboard';
import { useWorkspace } from '@/stores/workspace';
import { formatBytes } from '@/lib/billing/cart-math';
import { api, API_BASE } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';

const SOURCE_DOT: Record<string, string> = {
  plan: '#3b82f6', package: '#8b5cf6', custom: '#f59e0b', referral: '#22c55e',
};

export default function WorkspaceDashboardPage() {
  const navigate = useNavigate();
  const activeId = useWorkspace((s) => s.activeId);
  const setActiveId = useWorkspace((s) => s.setActiveId);
  const [data, setData] = useState<WorkspaceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWorkspaceDashboard()
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openWorkspace = (id: string) => {
    if (id !== activeId) setActiveId(id);
    navigate('/');
  };

  if (loading) return <WorkspaceDashboardSkeleton />;
  if (!data) return <div className="p-6 text-center text-muted-foreground">Failed to load workspace dashboard</div>;

  const { total, sources, owned, shared } = data;
  const pct = total.limit_bytes > 0 ? Math.min(100, Math.round((total.used_bytes / total.limit_bytes) * 100)) : 0;
  const segments = stackedSegments(owned, total.used_bytes);

  return (
    <div className="p-6 space-y-5 overflow-y-auto animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Workspace dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Your storage across every workspace you own</p>
        </div>
        <Link to="/billing">
          <Button className="gap-2"><Plus className="size-4" /> Get more storage</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Left column: total + owned workspaces */}
        <div className="space-y-4">
          {/* Your storage */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Your storage</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-end justify-between mb-3">
                <p className="text-2xl font-semibold tracking-tight">
                  {formatBytes(total.used_bytes)} <span className="text-sm font-normal text-muted-foreground">used</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatBytes(total.free_bytes)} free of {formatBytes(total.limit_bytes)}
                </p>
              </div>
              {/* Stacked-by-workspace usage bar */}
              <div className="h-2.5 bg-border rounded-full overflow-hidden">
                <div className="h-full flex rounded-full overflow-hidden" style={{ width: `${pct}%` }}>
                  {segments.length === 0 ? (
                    <div className="h-full w-full" style={{ background: storageColor(pct) }} />
                  ) : segments.map((seg) => (
                    <div key={seg.id} className="h-full" style={{ width: `${seg.widthPct}%`, background: seg.color }} title={`${seg.name}: ${formatBytes(owned.find((w) => w.id === seg.id)?.used_bytes ?? 0)}`} />
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">{pct}% of your total space used</p>
            </CardContent>
          </Card>

          {/* Workspaces you own */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Workspaces you own</CardTitle></CardHeader>
            <CardContent>
              {owned.length === 0 ? (
                <p className="py-5 text-center text-xs text-muted-foreground">You don't own any workspaces yet.</p>
              ) : (
                <div className="space-y-0">
                  {owned.map((ws, i) => (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => openWorkspace(ws.id)}
                      className="w-full flex items-center gap-3 py-2.5 border-b last:border-b-0 text-left hover:bg-muted/40 rounded-md px-1 transition-colors"
                    >
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: WS_SEGMENT_COLORS[i % WS_SEGMENT_COLORS.length] }} />
                      <div className="w-8 h-8 rounded-md flex items-center justify-center text-[11px] font-bold text-white shrink-0 overflow-hidden bg-muted" style={ws.icon_image_url ? undefined : { background: ws.icon_color }}>
                        {ws.icon_image_url
                          ? <img src={`${API_BASE}/api/workspaces/${ws.id}/icon`} alt="" className="w-full h-full object-cover" />
                          : ws.icon_initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate">{ws.name}</p>
                        <p className="text-[11px] text-muted-foreground">{formatBytes(ws.used_bytes)} used</p>
                      </div>
                      <div className="w-28 shrink-0">
                        <Progress
                          value={Math.min(ws.share_pct, 100)}
                          className="**:data-[slot=progress-track]:bg-border **:data-[slot=progress-indicator]:bg-(--bar-color)"
                          style={{ '--bar-color': WS_SEGMENT_COLORS[i % WS_SEGMENT_COLORS.length] } as React.CSSProperties}
                        />
                      </div>
                      <span className="text-xs font-semibold w-10 text-right shrink-0">{ws.share_pct}%</span>
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
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Where your space comes from</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {sources.map((src, i) => (
                  <div key={`${src.kind}-${i}`} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: SOURCE_DOT[src.kind] ?? '#6b7280' }} />
                    <span className="text-xs flex-1 truncate">{src.label}</span>
                    <span className="text-[11px] font-medium text-muted-foreground">{formatBytes(src.bytes)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between border-t mt-3 pt-2 text-xs font-semibold">
                <span>Total</span><span>{formatBytes(total.limit_bytes)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Shared with you */}
          {shared.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Shared with you</CardTitle></CardHeader>
              <CardContent>
                <p className="text-[11px] text-muted-foreground mb-2">These use the owner's storage, not yours.</p>
                <div className="space-y-0">
                  {shared.map((ws) => (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => openWorkspace(ws.id)}
                      className="w-full flex items-center gap-2.5 py-2 text-left hover:bg-muted/40 rounded-md px-1 transition-colors"
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
