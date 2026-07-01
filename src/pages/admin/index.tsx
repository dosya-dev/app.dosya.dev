import { useState, useEffect, useCallback } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  LayoutDashboard, Users, Files, Share2, Shield, Activity,
  CreditCard, Mail, MessageSquare, Bell, HardDrive, Link2,
  Search, ChevronLeft, ChevronRight, Loader2, Trash2, Ban,
  Eye, X, Check, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { humanSize, timeAgo, avatarColor, initials } from '@/lib/helpers';
import { toast } from '@/lib/toast';

// ── Types ─────────────────────────────────────────────────

interface AdminStats {
  total_users: number; paid_users: number; free_users: number;
  total_storage_bytes: number; total_files: number; total_workspaces: number;
}

interface AdminOverview {
  stats: AdminStats;
  users_by_plan: { plan: string; count: number }[];
  users: { id: string; name: string; email: string; plan: string; created_at: number }[];
  workspaces: { id: string; name: string; owner_name: string; storage_used_bytes: number; created_at: number }[];
}

// ── Admin Layout ──────────────────────────────────────────

const NAV = [
  { path: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { path: '/admin/users', label: 'Users', icon: Users },
  { path: '/admin/files', label: 'Files', icon: Files },
  { path: '/admin/shares', label: 'Shares', icon: Share2 },
  { path: '/admin/sessions', label: 'Sessions', icon: Shield },
  { path: '/admin/activity', label: 'Activity', icon: Activity },
  { path: '/admin/payments', label: 'Payments', icon: CreditCard },
  { path: '/admin/invites', label: 'Invites', icon: Link2 },
  { path: '/admin/emails', label: 'Emails', icon: Mail },
  { path: '/admin/announcements', label: 'Announcements', icon: Bell },
  { path: '/admin/health', label: 'Health', icon: HardDrive },
  { path: '/admin/growth', label: 'Growth', icon: Activity },
  { path: '/admin/security', label: 'Security', icon: Shield },
  { path: '/admin/contact', label: 'Contact', icon: MessageSquare },
  { path: '/admin/plans', label: 'Plans', icon: CreditCard },
];

export function AdminLayout() {
  const location = useLocation();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ ok: boolean }>('/api/admin')
      .then(() => setAuthorized(true))
      .catch((e: any) => { setAuthorized(e.status === 403 ? false : true); });
  }, []);

  if (authorized === null) return <div className="flex items-center justify-center h-full"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (authorized === false) return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <AlertTriangle className="size-10 text-destructive" />
      <p className="text-lg font-semibold">Access Denied</p>
      <p className="text-sm text-muted-foreground">You don't have admin access.</p>
      <Link to="/"><Button variant="outline">Go to Dashboard</Button></Link>
    </div>
  );

  return (
    <div className="flex h-full overflow-hidden">
      <nav className="w-48 shrink-0 border-r p-3 overflow-y-auto hidden md:block">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">Admin Panel</p>
        {NAV.map((n) => {
          const active = n.exact ? location.pathname === n.path : location.pathname.startsWith(n.path);
          return (
            <Link key={n.path} to={n.path}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium mb-0.5 transition-colors ${active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}>
              <n.icon className="size-3.5" /> {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
}

// ── Overview Page ─────────────────────────────────────────

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ ok: boolean } & AdminOverview>('/api/admin')
      .then((d) => { if (d.ok) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="space-y-4"><Skeleton className="h-6 w-40" /><div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div></div>;
  if (!data) return <p className="text-sm text-muted-foreground">Failed to load admin data.</p>;

  const s = data.stats;
  const stats = [
    { label: 'Total Users', value: s.total_users },
    { label: 'Paid Users', value: s.paid_users },
    { label: 'Total Storage', value: humanSize(s.total_storage_bytes) },
    { label: 'Total Files', value: s.total_files.toLocaleString() },
    { label: 'Workspaces', value: s.total_workspaces },
    { label: 'Free Users', value: s.free_users },
  ];

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-5">Admin Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold mt-1">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Users</CardTitle></CardHeader>
          <CardContent>
            {data.users.slice(0, 8).map((u) => (
              <div key={u.id} className="flex items-center gap-2.5 py-2 border-b last:border-b-0 text-xs">
                <div className="size-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ background: avatarColor(u.id) }}>{initials(u.name)}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{u.name}</p>
                  <p className="text-muted-foreground truncate">{u.email}</p>
                </div>
                <Badge variant="secondary" className="text-[9px]">{u.plan}</Badge>
                <span className="text-muted-foreground">{timeAgo(u.created_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Workspaces</CardTitle></CardHeader>
          <CardContent>
            {data.workspaces.slice(0, 8).map((w) => (
              <div key={w.id} className="flex items-center gap-2.5 py-2 border-b last:border-b-0 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{w.name}</p>
                  <p className="text-muted-foreground truncate">{w.owner_name}</p>
                </div>
                <span className="text-muted-foreground">{humanSize(w.storage_used_bytes)}</span>
                <span className="text-muted-foreground">{timeAgo(w.created_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {data.users_by_plan.length > 0 && (
        <Card className="mt-5">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Users by Plan</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-4">
              {data.users_by_plan.map((p) => (
                <div key={p.plan} className="text-center">
                  <p className="text-xl font-bold">{p.count}</p>
                  <p className="text-xs text-muted-foreground capitalize">{p.plan}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
