import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Search, ChevronLeft, ChevronRight, Loader2, Trash2, X, Check, RefreshCw } from 'lucide-react';
import { humanSize, timeAgo } from '@/lib/helpers';
import { toast } from '@/lib/toast';

// ── Generic paginated admin page ──────────────────────────

function usePaginated<T>(endpoint: string, key: string) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set('q', search);
      const data = await api<any>(`${endpoint}?${params}`);
      if (data.ok) {
        setItems(data[key] ?? []);
        setTotalPages(data.pagination?.total_pages ?? 1);
      }
    } catch {}
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  return { items, page, setPage, totalPages, loading, search, setSearch, reload: load };
}

function Pagination({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="size-4" /></Button>
      <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="size-4" /></Button>
    </div>
  );
}

function AdminHeader({ title, count, search, setSearch }: { title: string; count?: number; search: string; setSearch: (s: string) => void }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h1 className="text-xl font-bold">{title}{count != null ? ` (${count})` : ''}</h1>
      <div className="relative w-56">
        <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} placeholder="Search..." className="h-8 text-xs pl-8" />
      </div>
    </div>
  );
}

function LoadingSkeleton() { return <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>; }

// ── Files ─────────────────────────────────────────────────

export function AdminFilesPage() {
  const { items: files, page, setPage, totalPages, loading, search, setSearch, reload } = usePaginated<any>('/api/admin/files', 'files');

  const deleteFile = async (fileId: string) => {
    try { await api('/api/admin/files', { method: 'POST', body: JSON.stringify({ action: 'delete', file_id: fileId }) }); toast.success('File deleted', 'The file has been removed.'); reload(); } catch { toast.error('Delete failed', 'The file could not be deleted.'); }
  };

  return (
    <div className="max-w-4xl">
      <AdminHeader title="Files" search={search} setSearch={setSearch} />
      {loading ? <LoadingSkeleton /> : (
        <div className="rounded-xl border bg-card overflow-hidden">
          {files.map((f: any) => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 hover:bg-muted/50 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{f.name}</p>
                <p className="text-muted-foreground">{f.uploader_name} · {f.workspace_name}</p>
              </div>
              <span className="text-muted-foreground">{humanSize(f.size_bytes)}</span>
              <span className="text-muted-foreground">{timeAgo(f.created_at)}</span>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] text-destructive" onClick={() => deleteFile(f.id)}><Trash2 className="size-3" /></Button>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} setPage={setPage} />
    </div>
  );
}

// ── Shares ────────────────────────────────────────────────

export function AdminSharesPage() {
  const { items: shares, page, setPage, totalPages, loading, search, setSearch, reload } = usePaginated<any>('/api/admin/shares', 'shares');

  const revoke = async (shareId: string) => {
    try { await api('/api/admin/shares', { method: 'POST', body: JSON.stringify({ action: 'revoke', share_id: shareId }) }); toast.success('Share revoked', 'The share link no longer works.'); reload(); } catch { toast.error('Revoke failed', 'The share could not be revoked.'); }
  };

  return (
    <div className="max-w-4xl">
      <AdminHeader title="Shares" search={search} setSearch={setSearch} />
      {loading ? <LoadingSkeleton /> : (
        <div className="rounded-xl border bg-card overflow-hidden">
          {shares.map((s: any) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 hover:bg-muted/50 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{s.file_name || s.folder_name || 'Unknown'}</p>
                <p className="text-muted-foreground">{s.creator_name} · {s.view_count} views</p>
              </div>
              <Badge variant={s.is_revoked ? 'secondary' : 'outline'} className="text-[9px]">{s.is_revoked ? 'Revoked' : 'Active'}</Badge>
              <span className="text-muted-foreground">{timeAgo(s.created_at)}</span>
              {!s.is_revoked && <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] text-destructive" onClick={() => revoke(s.id)}>Revoke</Button>}
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} setPage={setPage} />
    </div>
  );
}

// ── Sessions ──────────────────────────────────────────────

export function AdminSessionsPage() {
  const { items: sessions, page, setPage, totalPages, loading, search, setSearch, reload } = usePaginated<any>('/api/admin/sessions', 'sessions');

  const revoke = async (sessionId: string) => {
    try { await api('/api/admin/sessions', { method: 'POST', body: JSON.stringify({ action: 'revoke', session_id: sessionId }) }); toast.success('Session revoked', 'The session has been signed out.'); reload(); } catch { toast.error('Revoke failed', 'The session could not be revoked.'); }
  };

  return (
    <div className="max-w-4xl">
      <AdminHeader title="Sessions" search={search} setSearch={setSearch} />
      {loading ? <LoadingSkeleton /> : (
        <div className="rounded-xl border bg-card overflow-hidden">
          {sessions.map((s: any) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 hover:bg-muted/50 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{s.user_name} ({s.user_email})</p>
                <p className="text-muted-foreground">{s.device_name || 'Unknown device'} · {s.ip_address}</p>
              </div>
              <Badge variant={s.is_active ? 'secondary' : 'outline'} className="text-[9px]">{s.is_active ? 'Active' : 'Expired'}</Badge>
              <span className="text-muted-foreground">{timeAgo(s.created_at)}</span>
              {s.is_active && <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] text-destructive" onClick={() => revoke(s.id)}>Revoke</Button>}
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} setPage={setPage} />
    </div>
  );
}

// ── Activity ──────────────────────────────────────────────

export function AdminActivityPage() {
  const { items: activity, page, setPage, totalPages, loading, search, setSearch } = usePaginated<any>('/api/admin/activity', 'activity');

  return (
    <div className="max-w-4xl">
      <AdminHeader title="Activity" search={search} setSearch={setSearch} />
      {loading ? <LoadingSkeleton /> : (
        <div className="rounded-xl border bg-card overflow-hidden">
          {activity.map((a: any) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 hover:bg-muted/50 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium"><span className="text-foreground">{a.user_name || a.user_email}</span> <span className="text-muted-foreground">{a.action}</span></p>
                <p className="text-muted-foreground">{a.workspace_name} · {a.entity_type}</p>
              </div>
              <span className="text-muted-foreground">{timeAgo(a.created_at)}</span>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} setPage={setPage} />
    </div>
  );
}

// ── Payments ──────────────────────────────────────────────

export function AdminPaymentsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<any>('/api/admin/payments').then(d => { if (d.ok) setData(d); }).catch(() => {}).finally(() => setLoading(false)); }, []);

  if (loading) return <LoadingSkeleton />;
  if (!data) return <p className="text-sm text-muted-foreground">Failed to load.</p>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-5">Payments</h1>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">Active Paid</p><p className="text-2xl font-bold">{data.stats?.active_paid ?? 0}</p></div>
        <div className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">Past Due</p><p className="text-2xl font-bold text-amber-600">{data.stats?.past_due ?? 0}</p></div>
        <div className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">Churned</p><p className="text-2xl font-bold text-destructive">{data.stats?.churned ?? 0}</p></div>
      </div>
      {data.revenue_by_plan?.length > 0 && (
        <div className="rounded-xl border bg-card p-4 mb-5">
          <p className="text-sm font-semibold mb-3">Revenue by Plan</p>
          {data.revenue_by_plan.map((p: any) => (
            <div key={p.plan} className="flex justify-between py-1.5 text-xs border-b last:border-b-0">
              <span className="capitalize">{p.plan}</span><span className="font-medium">${(p.revenue_cents / 100).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Emails ────────────────────────────────────────────────

export function AdminEmailsPage() {
  const { items: emails, page, setPage, totalPages, loading, search, setSearch } = usePaginated<any>('/api/admin/emails', 'emails');
  return (
    <div className="max-w-4xl">
      <AdminHeader title="Emails" search={search} setSearch={setSearch} />
      {loading ? <LoadingSkeleton /> : (
        <div className="rounded-xl border bg-card overflow-hidden">
          {emails.map((e: any) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{e.subject}</p>
                <p className="text-muted-foreground truncate">{e.recipient}</p>
              </div>
              <Badge variant={e.status === 'sent' ? 'secondary' : 'destructive'} className="text-[9px]">{e.status}</Badge>
              <span className="text-muted-foreground">{timeAgo(e.created_at)}</span>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} setPage={setPage} />
    </div>
  );
}

// ── Invites ───────────────────────────────────────────────

export function AdminInvitesPage() {
  const { items: invites, page, setPage, totalPages, loading, search, setSearch } = usePaginated<any>('/api/admin/invites', 'invites');
  return (
    <div className="max-w-4xl">
      <AdminHeader title="Invites" search={search} setSearch={setSearch} />
      {loading ? <LoadingSkeleton /> : (
        <div className="rounded-xl border bg-card overflow-hidden">
          {invites.map((inv: any) => (
            <div key={inv.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{inv.email}</p>
                <p className="text-muted-foreground">{inv.workspace_name} · by {inv.inviter_name}</p>
              </div>
              <Badge variant="secondary" className="text-[9px]">{inv.status}</Badge>
              <span className="text-muted-foreground">{timeAgo(inv.created_at)}</span>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} setPage={setPage} />
    </div>
  );
}

// ── Announcements ─────────────────────────────────────────

export function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMsg, setNewMsg] = useState('');
  const [creating, setCreating] = useState(false);

  const load = () => { api<any>('/api/admin/announcements').then(d => { if (d.ok) setAnnouncements(d.announcements ?? []); }).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newMsg.trim()) return;
    setCreating(true);
    try { await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ action: 'create', message: newMsg.trim(), type: 'info' }) }); setNewMsg(''); load(); toast.success('Announcement created', 'It is now live for all users.'); } catch { toast.error('Create failed', 'The announcement could not be created.'); }
    setCreating(false);
  };

  const toggle = async (id: string) => { try { await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ action: 'toggle', id }) }); load(); } catch {} };
  const remove = async (id: string) => { try { await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ action: 'delete', id }) }); load(); } catch {} };

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-5">Announcements</h1>
      <div className="flex gap-2 mb-4">
        <Input value={newMsg} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewMsg(e.target.value)} placeholder="New announcement..." className="h-8 text-xs flex-1" onKeyDown={(e) => e.key === 'Enter' && create()} />
        <Button size="sm" className="h-8 text-xs" onClick={create} disabled={creating}>{creating && <Loader2 className="size-3 animate-spin mr-1" />}Create</Button>
      </div>
      {loading ? <LoadingSkeleton /> : (
        <div className="rounded-xl border bg-card overflow-hidden">
          {announcements.map((a: any) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-xs">
              <div className="flex-1 min-w-0"><p className="truncate">{a.message}</p></div>
              <Badge variant={a.is_active ? 'secondary' : 'outline'} className="text-[9px]">{a.is_active ? 'Active' : 'Inactive'}</Badge>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => toggle(a.id)}>{a.is_active ? 'Disable' : 'Enable'}</Button>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] text-destructive" onClick={() => remove(a.id)}><Trash2 className="size-3" /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Health ─────────────────────────────────────────────────

export function AdminHealthPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<any>('/api/admin/health').then(d => { if (d.ok) setData(d); }).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <LoadingSkeleton />;
  if (!data) return <p className="text-sm text-muted-foreground">Failed to load.</p>;
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-5">Health</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        {Object.entries(data.table_counts ?? {}).map(([k, v]) => (
          <div key={k} className="border rounded-xl p-4"><p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</p><p className="text-xl font-bold">{String(v)}</p></div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">Active Sessions</p><p className="text-xl font-bold">{data.sessions?.active ?? 0}</p></div>
        <div className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">Active Storage</p><p className="text-xl font-bold">{humanSize(data.storage?.active_bytes ?? 0)}</p></div>
      </div>
    </div>
  );
}

// ── Growth ────────────────────────────────────────────────

export function AdminGrowthPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<any>('/api/admin/growth').then(d => { if (d.ok) setData(d); }).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <LoadingSkeleton />;
  if (!data) return <p className="text-sm text-muted-foreground">Failed to load.</p>;
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-5">Growth</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">Today</p><p className="text-2xl font-bold">{data.signups?.today ?? 0}</p></div>
        <div className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">This Week</p><p className="text-2xl font-bold">{data.signups?.week ?? 0}</p></div>
        <div className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">This Month</p><p className="text-2xl font-bold">{data.signups?.month ?? 0}</p></div>
        <div className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold">{data.signups?.total ?? 0}</p></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">Conversion Rate</p><p className="text-2xl font-bold">{data.conversion?.rate ?? 0}%</p><p className="text-xs text-muted-foreground">{data.conversion?.paid ?? 0} paid / {data.conversion?.free ?? 0} free</p></div>
        <div className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">MRR</p><p className="text-2xl font-bold">${((data.mrr_cents ?? 0) / 100).toFixed(0)}</p></div>
      </div>
    </div>
  );
}

// ── Security ──────────────────────────────────────────────

export function AdminSecurityPage() {
  const { items: audit, page, setPage, totalPages, loading, search, setSearch } = usePaginated<any>('/api/admin/security', 'audit_log');
  return (
    <div className="max-w-4xl">
      <AdminHeader title="Security" search={search} setSearch={setSearch} />
      {loading ? <LoadingSkeleton /> : (
        <div className="rounded-xl border bg-card overflow-hidden">
          {audit.map((a: any, i: number) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium">{a.action} <span className="text-muted-foreground">— {a.user_email || a.ip_address}</span></p>
                <p className="text-muted-foreground">{a.ip_address} · {a.status}</p>
              </div>
              <span className="text-muted-foreground">{timeAgo(a.created_at)}</span>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} setPage={setPage} />
    </div>
  );
}

// ── Contact ───────────────────────────────────────────────

export function AdminContactPage() {
  const { items: submissions, page, setPage, totalPages, loading, search, setSearch, reload } = usePaginated<any>('/api/admin/contact', 'submissions');
  const [replyModal, setReplyModal] = useState<any>(null);
  const [replyText, setReplyText] = useState('');
  const [acting, setActing] = useState(false);

  const doAction = async (id: string, action: string, reply?: string) => {
    setActing(true);
    try {
      const body: Record<string, unknown> = { id, action };
      if (reply) body.reply = reply;
      await api('/api/admin/contact', { method: 'POST', body: JSON.stringify(body) });
      toast.success('Reply sent', 'Your reply has been emailed.'); reload(); setReplyModal(null);
    } catch { toast.error('Reply failed', 'The reply could not be sent.'); }
    setActing(false);
  };

  return (
    <div className="max-w-4xl">
      <AdminHeader title="Contact Submissions" search={search} setSearch={setSearch} />
      {loading ? <LoadingSkeleton /> : (
        <div className="rounded-xl border bg-card overflow-hidden">
          {submissions.map((s: any) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{s.subject}</p>
                <p className="text-muted-foreground">{s.name} ({s.email}) · {s.topic}</p>
              </div>
              <Badge variant={s.status === 'open' ? 'secondary' : 'outline'} className="text-[9px]">{s.status}</Badge>
              <span className="text-muted-foreground">{timeAgo(s.created_at)}</span>
              {s.status === 'open' && <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => { setReplyModal(s); setReplyText(''); }}>Reply</Button>}
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} setPage={setPage} />

      <Dialog open={!!replyModal} onOpenChange={() => setReplyModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reply to {replyModal?.name}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground mb-2">{replyModal?.description}</p>
          <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} className="w-full h-24 border rounded-md px-3 py-2 text-xs resize-y" placeholder="Your reply..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyModal(null)}>Cancel</Button>
            <Button onClick={() => doAction(replyModal?.id, 'reply', replyText)} disabled={acting || !replyText.trim()}>{acting && <Loader2 className="size-4 animate-spin mr-1.5" />}Send Reply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Plans ─────────────────────────────────────────────────

export function AdminPlansPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = () => { api<any>('/api/admin/plans').then(d => { if (d.ok) setPlans(d.plans ?? []); }).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-5">Plans</h1>
      {loading ? <LoadingSkeleton /> : (
        <div className="rounded-xl border bg-card overflow-hidden">
          {plans.map((p: any) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 text-xs">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium capitalize">{p.name}</p>
                <p className="text-muted-foreground">{p.storage_display} · ${p.price_display}/mo</p>
              </div>
              <Badge variant="secondary" className="text-[9px] font-mono">{p.stripe_price_id || 'no stripe'}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
