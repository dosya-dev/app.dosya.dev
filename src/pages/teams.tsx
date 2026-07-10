import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage, API_BASE } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  UserPlus, X, Copy, Check, Loader2, Link2, Mail,
  Settings, Plus, Users, Clock, Share2, Send,
} from 'lucide-react';
import { timeAgo, avatarColor, initials, actionLabel } from '@/lib/helpers';
import { toast } from '@/lib/toast';

// ── Avatar with guaranteed initials fallback ───────────────
// Shows the profile photo when present AND loadable; otherwise the colored
// circle with the user's name+surname initials.

function UserAvatar({ url, userId, name, className = 'w-8 h-8 text-xs' }: {
  url: string | null; userId: string; name: string; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // avatar_url in the DB is an R2 key, not a URL — treat it as a "has photo"
  // flag and load the image through the API (auth via cookie).
  if (url && !failed) {
    return (
      <img
        src={`${API_BASE}/api/users/${userId}/avatar`}
        alt=""
        crossOrigin="use-credentials"
        className={`${className} rounded-full object-cover shrink-0`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className={`${className} rounded-full flex items-center justify-center font-semibold text-white shrink-0`} style={{ background: avatarColor(userId) }}>
      {initials(name)}
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────

interface TeamMember {
  membership_id: string; user_id: string; role_id: string;
  joined_at: number; name: string; email: string; is_you: boolean;
  avatar_url: string | null;
  last_active_at: number | null;
}
interface Invite {
  id: string; email: string; role_id: string;
  created_at: number; expires_at: number; invited_by_name: string | null;
  invite_url: string;
}
interface InviteLink {
  id: string; url: string; role_name: string;
  max_uses: number | null; use_count: number;
  expires_at: number | null; created_by_name: string | null;
}
interface Activity {
  user_id: string; user_name: string; action: string;
  meta: { name?: string; email?: string }; created_at: number;
  avatar_url: string | null;
}
interface TeamStats { members: number; pending: number; shares_this_week: number }
interface Role { id: string; name: string; is_builtin?: boolean; is_custom?: boolean }

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
  const [roles, setRoles] = useState<Role[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [wsName, setWsName] = useState('');
  const [loading, setLoading] = useState(true);

  // Modals
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteTab, setInviteTab] = useState<'email' | 'link'>('email');
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; email: string } | null>(null);
  const [profileMember, setProfileMember] = useState<TeamMember | null>(null);

  const load = useCallback(async () => {
    if (!wsId) return;
    try {
      const [teamRes, linksRes, rolesRes] = await Promise.all([
        api<{ ok: boolean; members: TeamMember[]; invites: Invite[]; activity: Activity[]; stats: TeamStats; workspace?: { name: string } }>(`/api/team?workspace_id=${wsId}`),
        api<{ ok: boolean; links: InviteLink[] }>(`/api/team/invite-link?workspace_id=${wsId}`),
        api<{ ok: boolean; roles: Role[] }>(`/api/roles?workspace_id=${wsId}`),
      ]);
      if (teamRes.ok) {
        setMembers(teamRes.members); setInvites(teamRes.invites);
        setActivity(teamRes.activity); setStats(teamRes.stats);
        if (teamRes.workspace) setWsName(teamRes.workspace.name);
      }
      if (linksRes.ok) setLinks(linksRes.links);
      if (rolesRes.ok) setRoles(rolesRes.roles);
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

  const [resendingId, setResendingId] = useState<string | null>(null);
  const resendInvite = async (inv: Invite) => {
    setResendingId(inv.id);
    try {
      const res = await api<{ ok: boolean }>(`/api/team/invites/${inv.id}/resend`, { method: 'POST' });
      if (res.ok) toast.success('Invite resent', `The invitation email was sent to ${inv.email} again.`);
    } catch (err) { toast.error('Resend failed', apiErrorMessage(err)); }
    setResendingId(null);
  };

  const copyInviteLink = async (inv: Invite) => {
    try {
      await navigator.clipboard.writeText(inv.invite_url);
      toast.success('Link copied', 'Send it to the person directly. Anyone with the link can accept the invite.');
    } catch { toast.error('Copy failed', 'The link could not be copied.'); }
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

  // Resolve a role id to its display name (built-in or custom).
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? ROLE_LABELS[id] ?? id;

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
                    <UserAvatar url={m.avatar_url} userId={m.user_id} name={m.name} />
                    <div>
                      <p className="text-sm font-medium">
                        <button className="hover:underline text-left" onClick={() => setProfileMember(m)} title="View profile">{m.name}</button>
                        {m.is_you && <Badge variant="secondary" className="text-[9px] ml-1">you</Badge>}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                  <div><Badge className={`text-[11px] ${ROLE_COLORS[m.role_id] ?? ROLE_COLORS.role_member}`}>{roleName(m.role_id)}</Badge></div>
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
                  <Badge variant="secondary" className="text-[10px]">{roleName(inv.role_id)}</Badge>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => copyInviteLink(inv)} title="Copy the invite link to share it yourself">
                    <Copy className="size-3" /> Copy link
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => resendInvite(inv)} disabled={resendingId === inv.id} title="Send the invitation email again">
                    {resendingId === inv.id ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />} Resend
                  </Button>
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
              <UserAvatar url={a.avatar_url} userId={a.user_id ?? ''} name={a.user_name ?? 'Unknown'} className="w-5 h-5 text-[8px] mt-0.5" />
              <div>
                <p className="text-[11px] text-muted-foreground leading-snug"><span className="font-semibold text-foreground">{a.user_name ?? 'Unknown'}</span> {actionLabel(a.action)} {a.meta?.name && <span className="font-semibold text-foreground">{a.meta.name}</span>}</p>
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
      <InviteModal open={inviteOpen} tab={inviteTab} onTabChange={setInviteTab} onClose={() => setInviteOpen(false)} wsId={wsId} roles={roles} onInvited={load} />

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
      {/* Member profile modal */}
      <Dialog open={!!profileMember} onOpenChange={(v) => { if (!v) setProfileMember(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Profile</DialogTitle></DialogHeader>
          {profileMember && (
            <div className="flex flex-col items-center text-center gap-3 py-2">
              <UserAvatar
                url={profileMember.avatar_url}
                userId={profileMember.user_id}
                name={profileMember.name}
                className="w-24 h-24 text-2xl"
              />
              <div>
                <p className="text-sm font-semibold">
                  {profileMember.name}
                  {profileMember.is_you && <Badge variant="secondary" className="text-[9px] ml-1.5">you</Badge>}
                </p>
                <Badge className={`text-[10px] mt-1 ${ROLE_COLORS[profileMember.role_id] ?? ROLE_COLORS.role_member}`}>{roleName(profileMember.role_id)}</Badge>
              </div>
              <div className="w-full space-y-2 text-left border rounded-lg p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-muted-foreground shrink-0">Email</span>
                  <span className="text-xs font-medium break-all text-right">{profileMember.email}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-muted-foreground shrink-0">Last active</span>
                  <span className="text-xs font-medium">{profileMember.last_active_at ? timeAgo(profileMember.last_active_at) : 'No activity yet'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-muted-foreground shrink-0">Joined</span>
                  <span className="text-xs font-medium">{new Date(profileMember.joined_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Revoke invite</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Revoke the invitation sent to <span className="font-semibold text-foreground break-all">{revokeTarget?.email}</span>?
            {' '}Their invite link will stop working immediately.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={revokeInvite}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Invite Modal ───────────────────────────────────────────

const MAX_USES_OPTIONS = [
  { value: '', label: 'Unlimited' }, { value: '1', label: '1' }, { value: '5', label: '5' },
  { value: '10', label: '10' }, { value: '25', label: '25' }, { value: '100', label: '100' },
];
const LINK_EXPIRY_OPTIONS = [
  { value: '', label: 'Never' }, { value: '1', label: '1 day' }, { value: '7', label: '7 days' },
  { value: '30', label: '30 days' }, { value: '90', label: '90 days' },
];

function InviteModal({ open, tab, onTabChange, onClose, wsId, roles, onInvited }: {
  open: boolean; tab: 'email' | 'link'; onTabChange: (t: 'email' | 'link') => void; onClose: () => void; wsId: string; roles: Role[]; onInvited: () => void;
}) {
  const assignable = roles.filter((r) => r.id !== 'role_owner');
  const roleItems = assignable.map((r) => ({ value: r.id, label: r.name }));
  // Multi-email invite: each address gets its own invite with a unique,
  // email-bound accept link.
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');

  const addEmail = (raw: string) => {
    const e = raw.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || emails.includes(e)) return;
    setEmails((prev) => [...prev, e]);
  };

  const handleEmailKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addEmail(emailInput);
      setEmailInput('');
    } else if (e.key === 'Backspace' && !emailInput && emails.length) {
      setEmails((prev) => prev.slice(0, -1));
    }
  };
  const [role, setRole] = useState('role_member');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Link tab
  const [linkRole, setLinkRole] = useState('role_member');
  const [linkMaxUses, setLinkMaxUses] = useState('');
  const [linkExpires, setLinkExpires] = useState('7');
  const [createdLink, setCreatedLink] = useState('');
  const [creatingLink, setCreatingLink] = useState(false);

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    // Include whatever is still typed in the input
    const pending = emailInput.trim().toLowerCase();
    const list = [...emails];
    if (pending && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pending) && !list.includes(pending)) list.push(pending);
    if (list.length === 0) { setError('Add at least one email address.'); return; }

    setError(''); setSending(true);
    // One invite per address — each gets its own unique, email-bound link
    const failures: string[] = [];
    for (const addr of list) {
      try {
        const res = await api<{ ok: boolean; error?: string }>('/api/team/invite', {
          method: 'POST', body: JSON.stringify({ workspace_id: wsId, email: addr, role }),
        });
        if (!res.ok) failures.push(`${addr}: ${res.error ?? 'failed'}`);
      } catch (err) { failures.push(`${addr}: ${apiErrorMessage(err, 'failed')}`); }
    }
    const sent = list.length - failures.length;
    if (sent > 0) {
      toast.success('Invites sent', `Sent ${sent} invite${sent === 1 ? '' : 's'}.`);
      onInvited();
    }
    if (failures.length > 0) {
      // Keep only the failed addresses so the user can correct/retry
      setEmails(list.filter((a) => failures.some((f) => f.startsWith(`${a}:`))));
      setEmailInput('');
      setError(failures.join(' · '));
    } else {
      setEmails([]); setEmailInput('');
      onClose();
    }
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
    } catch (err) { setError(apiErrorMessage(err)); }
    setCreatingLink(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md p-0">
        <div className="px-5 pt-5 pb-0">
          <DialogTitle>Invite to workspace</DialogTitle>
        </div>
        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as 'email' | 'link')}>
          <TabsList variant="line" className="w-full gap-0 border-b p-0 group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="email" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Mail className="size-3.5" /> Email invite
            </TabsTrigger>
            <TabsTrigger value="link" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Link2 className="size-3.5" /> Invite link
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="px-5 pb-5 pt-3">
          {error && <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-lg px-3 py-2 mb-3">{error}</div>}

          {tab === 'email' ? (
            <form onSubmit={sendInvite} className="space-y-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">Email addresses</Label>
                <div className="flex flex-wrap gap-1 min-h-9 border rounded-md px-2 py-1.5 cursor-text focus-within:ring-1 focus-within:ring-ring">
                  {emails.map((e, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-muted rounded px-1.5 py-0.5 text-[11px] font-medium">
                      {e}
                      <button type="button" onClick={() => setEmails((prev) => prev.filter((_, j) => j !== i))}><X className="size-2.5" /></button>
                    </span>
                  ))}
                  <input
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={handleEmailKeyDown}
                    onBlur={() => { if (emailInput.trim()) { addEmail(emailInput); setEmailInput(''); } }}
                    placeholder={emails.length === 0 ? 'colleague@company.com (press Enter to add)' : ''}
                    className="flex-1 min-w-24 bg-transparent outline-none text-sm"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Each person gets their own invite link, valid only for their email address.</p>
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as string)} items={roleItems}>
                  <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assignable.map((r) => (<SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={sending}>
                {sending ? <Loader2 className="size-4 animate-spin mr-2" /> : null} Send invite
              </Button>
              <p className="text-[11px] text-muted-foreground">Invite expires after 7 days.</p>
            </form>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">Role for new members</Label>
                <Select value={linkRole} onValueChange={(v) => setLinkRole(v as string)} items={roleItems}>
                  <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assignable.map((r) => (<SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">Max uses</Label>
                  <Select value={linkMaxUses} onValueChange={(v) => setLinkMaxUses(v as string)} items={MAX_USES_OPTIONS}>
                    <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MAX_USES_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">Expires</Label>
                  <Select value={linkExpires} onValueChange={(v) => setLinkExpires(v as string)} items={LINK_EXPIRY_OPTIONS}>
                    <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LINK_EXPIRY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button className="w-full" onClick={createLink} disabled={creatingLink}>
                {creatingLink ? <Loader2 className="size-4 animate-spin mr-2" /> : null} Create invite link
              </Button>
              {createdLink && (
                <div className="mt-3">
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">Share this link</Label>
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
