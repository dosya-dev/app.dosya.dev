import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  UserPlus, X, Copy, Check, Loader2, Link2, Mail,
  Settings, Plus, Users, Clock, Share2,
} from 'lucide-react';
import { timeAgo, avatarColor, initials, actionLabel } from '@/lib/helpers';
import { toast } from '@/lib/toast';

// ── Types ──────────────────────────────────────────────────

interface TeamMember {
  membership_id: string; user_id: string; role_id: string;
  joined_at: number; name: string; email: string; is_you: boolean;
}
interface Invite {
  id: string; email: string; role_id: string;
  created_at: number; expires_at: number; invited_by_name: string | null;
}
interface InviteLink {
  id: string; url: string; role_name: string;
  max_uses: number | null; use_count: number;
  expires_at: number | null; created_by_name: string | null;
}
interface Activity {
  user_id: string; user_name: string; action: string;
  meta: { name?: string; email?: string }; created_at: number;
}
interface TeamStats { members: number; pending: number; shares_this_week: number }

const ROLE_LABELS: Record<string, string> = { role_owner: 'Owner', role_admin: 'Admin', role_member: 'Member', role_viewer: 'Viewer' };
const ROLE_COLORS: Record<string, string> = {
  role_owner: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  role_admin: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400',
  role_member: 'bg-secondary text-secondary-foreground',
  role_viewer: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
};

// ── Page ───────────────────────────────────────────────────

export default function TeamsPage() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [wsName, setWsName] = useState('');
  const [loading, setLoading] = useState(true);

  // Modals
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteTab, setInviteTab] = useState<'email' | 'link'>('email');
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; email: string } | null>(null);

  const load = useCallback(async () => {
    if (!wsId) return;
    try {
      const [teamRes, linksRes] = await Promise.all([
        api<{ ok: boolean; members: TeamMember[]; invites: Invite[]; activity: Activity[]; stats: TeamStats; workspace?: { name: string } }>(`/api/team?workspace_id=${wsId}`),
        api<{ ok: boolean; links: InviteLink[] }>(`/api/team/invite-link?workspace_id=${wsId}`),
      ]);
      if (teamRes.ok) {
        setMembers(teamRes.members); setInvites(teamRes.invites);
        setActivity(teamRes.activity); setStats(teamRes.stats);
        if (teamRes.workspace) setWsName(teamRes.workspace.name);
      }
      if (linksRes.ok) setLinks(linksRes.links);
    } catch { /* */ }
    setLoading(false);
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  // Actions
  const removeMember = async () => {
    if (!removeTarget) return;
    try {
      const res = await api<{ ok: boolean }>(`/api/team/members/${removeTarget.id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Member removed', 'They no longer have access to this workspace.'); setRemoveTarget(null); load(); }
    } catch { toast.error('Remove failed', 'The member could not be removed.'); }
  };

  const revokeInvite = async () => {
    if (!revokeTarget) return;
    try {
      const res = await api<{ ok: boolean }>(`/api/team/invites/${revokeTarget.id}/revoke`, { method: 'POST' });
      if (res.ok) { toast.success('Invite revoked', 'The invitation is no longer valid.'); setRevokeTarget(null); load(); }
    } catch { toast.error('Revoke failed', 'The invite could not be revoked.'); }
  };

  const revokeLink = async (id: string) => {
    try {
      await api(`/api/team/invite-link?id=${id}`, { method: 'DELETE' });
      load();
    } catch { toast.error('Revoke failed', 'The invite link could not be revoked.'); }
  };

  if (loading) return <TeamSkeleton />;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <h1 className="text-xl font-bold tracking-tight">Team</h1>
          <Button className="gap-1.5" onClick={() => { setInviteOpen(true); setInviteTab('email'); }}>
            <UserPlus className="size-4" /> Invite to workspace
          </Button>
        </div>

        {wsName && <Badge variant="secondary" className="text-xs">{wsName} workspace</Badge>}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={<Users className="size-4" />} value={stats?.members ?? 0} label="Members" />
          <StatCard icon={<Clock className="size-4" />} value={stats?.pending ?? 0} label="Pending invites" />
          <StatCard icon={<Share2 className="size-4" />} value={stats?.shares_this_week ?? 0} label="Shares this week" />
        </div>

        {/* Members */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Members · {members.length}</p>
          <Card>
            <CardContent className="p-0">
              {/* Header */}
              <div className="grid grid-cols-[2.2fr_1.6fr_1fr_1fr_80px] px-5 py-2 border-b">
                {['Member', 'Role', 'Joined', 'Last active', ''].map((h) => (
                  <span key={h} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</span>
                ))}
              </div>
              {members.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">No members</p>
              ) : members.map((m) => (
                <div key={m.membership_id} className="grid grid-cols-[2.2fr_1.6fr_1fr_1fr_80px] px-5 items-center min-h-[58px] border-b last:border-b-0 hover:bg-muted/50 group">
                  <div className="flex items-center gap-3 py-2.5">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0" style={{ background: avatarColor(m.user_id) }}>{initials(m.name)}</div>
                    <div>
                      <p className="text-sm font-medium">{m.name} {m.is_you && <Badge variant="secondary" className="text-[9px] ml-1">you</Badge>}</p>
                      <p className="text-[11px] text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                  <div><Badge className={`text-[11px] ${ROLE_COLORS[m.role_id] ?? ROLE_COLORS.role_member}`}>{ROLE_LABELS[m.role_id] ?? m.role_id}</Badge></div>
                  <span className="text-xs text-muted-foreground">{timeAgo(m.joined_at)}</span>
                  <span className="text-xs text-muted-foreground">&nbsp;</span>
                  <div className="flex justify-end opacity-0 group-hover:opacity-100">
                    {!m.is_you && m.role_id !== 'role_owner' && (
                      <Button variant="outline" size="sm" className="h-6 w-6 p-0 text-destructive border-destructive/30" onClick={() => setRemoveTarget({ id: m.membership_id, name: m.name })}>
                        <X className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Pending Invites */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pending invites · {invites.length}</p>
          <Card>
            <CardContent className="p-0">
              {invites.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No pending invites</p>
              ) : invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-5 py-3 border-b last:border-b-0">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0"><Mail className="size-3.5 text-muted-foreground" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{inv.email}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Invited by {inv.invited_by_name ?? 'Unknown'} · expires in {timeUntil(inv.expires_at)}
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{ROLE_LABELS[inv.role_id] ?? 'Member'}</Badge>
                  <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30" onClick={() => setRevokeTarget({ id: inv.id, email: inv.email })}>
                    Revoke
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Invite Links */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Invite links</p>
          <Card>
            <CardContent className="p-0">
              {links.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No active invite links</p>
              ) : links.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-5 py-3 border-b last:border-b-0">
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0"><Link2 className="size-3.5 text-muted-foreground" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono truncate">{l.url}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {l.role_name} · {l.max_uses ? `${l.use_count}/${l.max_uses} used` : `${l.use_count} used`} · {l.expires_at ? `Expires ${timeAgo(l.expires_at)}` : 'No expiry'}
                    </p>
                  </div>
                  <CopyButton text={l.url} />
                  <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30" onClick={() => revokeLink(l.id)}>Revoke</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Right panel */}
      <div className="w-56 shrink-0 border-l overflow-y-auto hidden lg:block">
        {/* Activity */}
        <div className="p-4 border-b">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent activity</p>
          {activity.length === 0 ? (
            <p className="text-xs text-muted-foreground">No activity yet</p>
          ) : activity.slice(0, 8).map((a, i) => (
            <div key={i} className="flex gap-2 items-start mb-2.5">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold text-white shrink-0 mt-0.5" style={{ background: avatarColor(a.user_id ?? '') }}>{initials(a.user_name)}</div>
              <div>
                <p className="text-[11px] text-muted-foreground leading-snug"><span className="font-semibold text-foreground">{a.user_name}</span> {actionLabel(a.action)} {a.meta?.name && <span className="font-semibold text-foreground">{a.meta.name}</span>}</p>
                <p className="text-[10px] text-muted-foreground/60">{timeAgo(a.created_at)}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Role guide */}
        <div className="p-4 border-b">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Role guide</p>
          {[
            { role: 'Owner', color: '#16A34A', desc: 'Full control, billing, delete workspace' },
            { role: 'Admin', color: '#4338CA', desc: 'Manage members and all files' },
            { role: 'Member', color: '#706E69', desc: 'Upload, share, manage own files' },
            { role: 'Viewer', color: '#92400E', desc: 'Download and view only' },
          ].map((r) => (
            <div key={r.role} className="flex gap-2 items-start mb-2">
              <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: r.color }} />
              <div>
                <p className="text-xs font-semibold">{r.role}</p>
                <p className="text-[10px] text-muted-foreground">{r.desc}</p>
              </div>
            </div>
          ))}
          <Link to="/role-create" className="mt-3 flex items-center justify-center gap-1.5 py-2 border border-dashed rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors no-underline">
            <Plus className="size-3" /> Create custom role
          </Link>
        </div>

        {/* Workspace link */}
        <div className="p-4">
          <Link to="/settings" className="flex items-center gap-2 px-3 py-2.5 border rounded-lg text-xs font-medium hover:bg-muted/50 transition-colors no-underline text-foreground">
            <Settings className="size-3.5" /> Workspace settings
          </Link>
        </div>
      </div>

      {/* Invite modal */}
      <InviteModal open={inviteOpen} tab={inviteTab} onTabChange={setInviteTab} onClose={() => setInviteOpen(false)} wsId={wsId} onInvited={load} />

      {/* Remove member dialog */}
      <Dialog open={!!removeTarget} onOpenChange={() => setRemoveTarget(null)}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader><DialogTitle>Remove member</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Remove <span className="font-semibold text-foreground">{removeTarget?.name}</span> from this workspace? They will lose access immediately.</p>
          <DialogFooter className="justify-center">
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={removeMember}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke invite dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader><DialogTitle>Revoke invite</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Revoke the invitation sent to <span className="font-semibold text-foreground">{revokeTarget?.email}</span>?</p>
          <DialogFooter className="justify-center">
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={revokeInvite}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Invite Modal ───────────────────────────────────────────

function InviteModal({ open, tab, onTabChange, onClose, wsId, onInvited }: {
  open: boolean; tab: 'email' | 'link'; onTabChange: (t: 'email' | 'link') => void; onClose: () => void; wsId: string; onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Member');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Link tab
  const [linkRole, setLinkRole] = useState('Member');
  const [linkMaxUses, setLinkMaxUses] = useState('');
  const [linkExpires, setLinkExpires] = useState('7');
  const [createdLink, setCreatedLink] = useState('');
  const [creatingLink, setCreatingLink] = useState(false);

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError(''); setSending(true);
    try {
      const res = await api<{ ok: boolean; error?: string }>('/api/team/invite', {
        method: 'POST', body: JSON.stringify({ workspace_id: wsId, email: email.trim(), role }),
      });
      if (res.ok) { toast.success('Invite sent', `Invite sent to ${email}`); setEmail(''); onClose(); onInvited(); }
      else setError(res.error ?? 'Failed');
    } catch { setError('Network error'); }
    setSending(false);
  };

  const createLink = async () => {
    setError(''); setCreatingLink(true); setCreatedLink('');
    try {
      const res = await api<{ ok: boolean; link?: { url: string }; error?: string }>('/api/team/invite-link', {
        method: 'POST', body: JSON.stringify({
          workspace_id: wsId, role: linkRole,
          max_uses: linkMaxUses ? Number(linkMaxUses) : null,
          expires_in_days: linkExpires ? Number(linkExpires) : null,
        }),
      });
      if (res.ok && res.link) { setCreatedLink(res.link.url); onInvited(); }
      else setError(res.error ?? 'Failed');
    } catch { setError('Network error'); }
    setCreatingLink(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md p-0">
        <div className="px-5 pt-5 pb-0">
          <DialogTitle>Invite to workspace</DialogTitle>
        </div>
        {/* Tabs */}
        <div className="flex border-b">
          {(['email', 'link'] as const).map((t) => (
            <button key={t} onClick={() => onTabChange(t)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 transition-colors ${tab === t ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {t === 'email' ? <Mail className="size-3.5" /> : <Link2 className="size-3.5" />}
              {t === 'email' ? 'Email invite' : 'Invite link'}
            </button>
          ))}
        </div>
        <div className="px-5 pb-5 pt-3">
          {error && <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-lg px-3 py-2 mb-3">{error}</div>}

          {tab === 'email' ? (
            <form onSubmit={sendInvite} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Email address</label>
                <Input type="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} placeholder="colleague@company.com" required className="h-9 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full h-9 text-sm border rounded-md px-3 bg-background">
                  <option>Member</option><option>Admin</option><option>Viewer</option>
                </select>
              </div>
              <Button type="submit" className="w-full" disabled={sending}>
                {sending ? <Loader2 className="size-4 animate-spin mr-2" /> : null} Send invite
              </Button>
              <p className="text-[11px] text-muted-foreground">Invite expires after 7 days.</p>
            </form>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Role for new members</label>
                <select value={linkRole} onChange={(e) => setLinkRole(e.target.value)} className="w-full h-9 text-sm border rounded-md px-3 bg-background">
                  <option>Member</option><option>Admin</option><option>Viewer</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Max uses</label>
                  <select value={linkMaxUses} onChange={(e) => setLinkMaxUses(e.target.value)} className="w-full h-9 text-sm border rounded-md px-3 bg-background">
                    <option value="">Unlimited</option><option value="1">1</option><option value="5">5</option><option value="10">10</option><option value="25">25</option><option value="100">100</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Expires</label>
                  <select value={linkExpires} onChange={(e) => setLinkExpires(e.target.value)} className="w-full h-9 text-sm border rounded-md px-3 bg-background">
                    <option value="">Never</option><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
                  </select>
                </div>
              </div>
              <Button className="w-full" onClick={createLink} disabled={creatingLink}>
                {creatingLink ? <Loader2 className="size-4 animate-spin mr-2" /> : null} Create invite link
              </Button>
              {createdLink && (
                <div className="mt-3">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Share this link</label>
                  <div className="flex gap-2">
                    <Input value={createdLink} readOnly className="h-8 text-xs font-mono flex-1" />
                    <CopyButton text={createdLink} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function timeUntil(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'expired';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  const days = Math.ceil(diff / 86400);
  return days === 1 ? '1 day' : `${days} days`;
}

function StatCard({ value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <Card><CardContent className="pt-4 pb-4">
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
    </CardContent></Card>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={copy}>
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  );
}

function TeamSkeleton() {
  return (
    <div className="p-6 space-y-5">
      <div className="flex justify-between"><Skeleton className="h-6 w-24" /><Skeleton className="h-9 w-40" /></div>
      <div className="grid grid-cols-3 gap-3">{[1,2,3].map((i) => <Card key={i}><CardContent className="pt-4 pb-4"><Skeleton className="h-7 w-12" /><Skeleton className="h-3 w-20 mt-2" /></CardContent></Card>)}</div>
      <Card><CardContent className="pt-4 space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</CardContent></Card>
    </div>
  );
}
