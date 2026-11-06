import { formatDateWith, localDigits } from '@/lib/format-locale';
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage, API_BASE } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { usePermissions, permissionsQueryKey } from '@/hooks/use-permissions';
import { useQueryClient } from '@tanstack/react-query';
import { canGrantRole } from '@/lib/role-grant';
import { summarizeInviteFailures } from '@/lib/invite-failures';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
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
  Settings, Plus, Users, Clock, Share2, Send, AlertCircle, RefreshCw, Folder,
} from 'lucide-react';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { timeAgo, expiryLabel, avatarColor, initials, actionLabel } from '@/lib/helpers';
import { toast } from '@/lib/toast';
import { t as translate, useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import type { MessageKey } from '@/i18n/keys';

// ── Avatar with guaranteed initials fallback ───────────────
// Shows the profile photo when present AND loadable; otherwise the colored
// circle with the user's name+surname initials.

function UserAvatar({ url, userId, name, className = 'w-8 h-8 text-xs' }: {
  url: string | null; userId: string; name: string; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // avatar_url in the DB is an R2 key, not a URL - treat it as a "has photo"
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
  // Folder anchor (phase C). null means the member sees the whole workspace.
  // root_folder_name is null both when unset AND when the anchor folder was
  // since trashed (see the LEFT JOIN's is_deleted = 0 in /api/team) - either
  // way there's nothing sensible to show but "Folder" as a fallback.
  root_folder_id: string | null;
  root_folder_name: string | null;
}
interface Invite {
  id: string; email: string; role_id: string;
  created_at: number; expires_at: number; invited_by_name: string | null;
  invite_url: string;
}
interface InviteLink {
  id: string; url: string; role_id: string; role_name: string;
  max_uses: number | null; use_count: number;
  expires_at: number | null; created_by_name: string | null;
}
interface Activity {
  user_id: string; user_name: string; action: string;
  meta: { name?: string; email?: string }; created_at: number;
  avatar_url: string | null;
}
interface TeamStats { members: number; pending: number; shares_this_week: number }
interface Role { id: string; name: string; is_builtin?: boolean; is_custom?: boolean; permissions?: Record<string, boolean> }

// Built-in roles are labelled from the catalog; a custom role's name is user content and shows as sent.
const ROLE_LABEL_KEYS: Record<string, MessageKey> = {
  role_owner: 'common.label.owner', role_admin: 'common.label.admin', role_member: 'common.label.member', role_viewer: 'common.label.viewer',
};
const ROLE_COLORS: Record<string, string> = {
  role_owner: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  role_admin: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400',
  role_member: 'bg-secondary text-secondary-foreground',
  role_viewer: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
};
// Custom roles used to fall back to the Member colour, so a member and a
// custom-role holder were indistinguishable at a glance. Same rose the role
// editor's dot uses for "custom".
const CUSTOM_ROLE_COLOR = 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400';
const roleColor = (id: string) => ROLE_COLORS[id] ?? CUSTOM_ROLE_COLOR;

// ── Page ───────────────────────────────────────────────────

export default function TeamsPage() {
  const t = useT();
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  // Without `view_activity` the server narrows this panel to the member's own
  // rows, so the heading says whose rows these are rather than implying the
  // workspace's. Labelling only - the server is what withholds them.
  const { can, permissions: myPerms } = usePermissions();
  const queryClient = useQueryClient();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [wsName, setWsName] = useState('');
  const [loading, setLoading] = useState(true);
  /** Set in the catch below - `/api/team` always returns at least the caller's
   *  own owner row, so an empty member list on success is impossible. Without
   *  this flag a failed/offline load fell through to the initial `[]` and
   *  rendered the solo-user empty state over a real load failure. */
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modals
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteTab, setInviteTab] = useState<'email' | 'link'>('email');
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  /** membership_id of the row whose role select is mid-flight. */
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; email: string } | null>(null);
  const [profileMember, setProfileMember] = useState<TeamMember | null>(null);

  // Folder anchor (phase C, task 5) - "Limit to a folder" per member.
  const [anchorTarget, setAnchorTarget] = useState<TeamMember | null>(null);
  const [anchorFolderId, setAnchorFolderId] = useState<string | null>(null);
  const [anchorFolderName, setAnchorFolderName] = useState('');
  const [anchorPickerOpen, setAnchorPickerOpen] = useState(false);
  const [savingAnchor, setSavingAnchor] = useState(false);

  const load = useCallback(async () => {
    if (!wsId) return;
    setLoadError(null);
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
    } catch (err) {
      // `/api/team` always returns at least the caller's own owner row, so
      // `members` staying empty here means the request failed, not that the
      // workspace is solo. Distinct from the empty state on purpose.
      setLoadError(apiErrorMessage(err, t('teams.error.teamMembersCouldNotBeLoaded')));
    }
    setLoading(false);
  }, [wsId, t]);

  useEffect(() => { load(); }, [load]);

  // Actions
  const removeMember = async () => {
    if (!removeTarget) return;
    try {
      const res = await api<{ ok: boolean }>(`/api/team/members/${removeTarget.id}`, { method: 'DELETE' });
      if (res.ok) { toast.success(t('teams.feedback.memberRemoved'), t('teams.feedback.theyNoLongerHaveAccessToThisWorkspace')); setRemoveTarget(null); load(); }
    } catch { toast.error(t('common.error.removeFailed'), t('teams.error.theMemberCouldNotBeRemoved')); }
  };

  const openAnchorDialog = (m: TeamMember) => {
    setAnchorTarget(m);
    setAnchorFolderId(m.root_folder_id);
    setAnchorFolderName(m.root_folder_name ?? '');
  };

  const saveAnchor = async () => {
    if (!anchorTarget) return;
    setSavingAnchor(true);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/team/members/${anchorTarget.membership_id}`, {
        method: 'PUT', body: JSON.stringify({ root_folder_id: anchorFolderId }),
      });
      if (res.ok) {
        toast.success(
          t('teams.feedback.folderAccessUpdated'),
          anchorFolderId
            ? t('teams.feedback.anchortargetnameIsNowConfinedToTheSelectedFolder', { anchorTargetName: anchorTarget.name })
            : t('teams.feedback.anchortargetnameCanNowSeeTheWholeWorkspace', { anchorTargetName: anchorTarget.name }),
        );
        setAnchorTarget(null);
        load();
      } else {
        toast.error(t('common.error.updateFailed'), res.error ?? t('teams.error.theFolderRestrictionCouldNotBeSaved'));
      }
    } catch (err) { toast.error(t('common.error.updateFailed'), apiErrorMessage(err, t('teams.error.theFolderRestrictionCouldNotBeSaved'))); }
    setSavingAnchor(false);
  };

  /**
   * Move a member to another role.
   *
   * There was no way to do this at all: PUT /api/team/members/:id only ever
   * wrote root_folder_id, and the only statement in the whole API that touched
   * workspace_members.role_id was ownership transfer. A role was decided by
   * whoever sent the invite and frozen for good - promoting someone meant
   * removing them and inviting them again.
   */
  const changeRole = async (m: TeamMember, roleId: string) => {
    if (roleId === m.role_id) return;
    // The picker only offers grantable roles, but the member's current role
    // stays listed (disabled) so the control reads right; refuse it here too.
    const target = roles.find((r) => r.id === roleId);
    if (target && !grantable(target)) {
      toast.error(t('teams.error.canTAssignThatRole'), t('teams.error.itGrantsMoreThanYourOwnRoleHolds'));
      return;
    }
    setChangingRoleId(m.membership_id);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/team/members/${m.membership_id}`, {
        method: 'PUT', body: JSON.stringify({ role_id: roleId }),
      });
      if (res.ok) {
        toast.success(t('common.feedback.roleUpdated'), t('teams.feedback.mnameIsNowRoleid', { mName: m.name, roleId: roleName(roleId) }));
        load();
        // Not our own row (the endpoint refuses that), but the map is
        // 60s-stale and this is the one moment we know roles moved.
        void queryClient.invalidateQueries({ queryKey: permissionsQueryKey(wsId) });
      }
      else toast.error(t('common.error.updateFailed'), res.error ?? t('teams.error.theRoleCouldNotBeChanged'));
    } catch (err) { toast.error(t('common.error.updateFailed'), apiErrorMessage(err, t('teams.error.theRoleCouldNotBeChanged'))); }
    setChangingRoleId(null);
  };

  const [resendingId, setResendingId] = useState<string | null>(null);
  const resendInvite = async (inv: Invite) => {
    setResendingId(inv.id);
    try {
      const res = await api<{ ok: boolean }>(`/api/team/invites/${inv.id}/resend`, { method: 'POST' });
      if (res.ok) toast.success(t('teams.feedback.inviteResent'), t('teams.feedback.theInvitationEmailWasSentToInvemailAgain', { invEmail: inv.email }));
    } catch (err) { toast.error(t('teams.error.resendFailed'), apiErrorMessage(err)); }
    setResendingId(null);
  };

  const copyInviteLink = async (inv: Invite) => {
    try {
      await navigator.clipboard.writeText(inv.invite_url);
      toast.success(t('common.feedback.linkCopied'), t('teams.feedback.sendItToThePersonDirectlyAnyoneWithTheLinkCan'));
    } catch { toast.error(t('common.error.copyFailed'), t('teams.error.theLinkCouldNotBeCopied')); }
  };

  const revokeInvite = async () => {
    if (!revokeTarget) return;
    try {
      const res = await api<{ ok: boolean }>(`/api/team/invites/${revokeTarget.id}/revoke`, { method: 'POST' });
      if (res.ok) { toast.success(t('teams.feedback.inviteRevoked'), t('teams.feedback.theInvitationIsNoLongerValid')); setRevokeTarget(null); load(); }
    } catch { toast.error(t('common.error.revokeFailed'), t('teams.error.theInviteCouldNotBeRevoked')); }
  };

  const revokeLink = async (id: string) => {
    try {
      await api(`/api/team/invite-link?id=${id}`, { method: 'DELETE' });
      load();
    } catch { toast.error(t('common.error.revokeFailed'), t('teams.error.theInviteLinkCouldNotBeRevoked')); }
  };

  // Resolve a role id to its display name (built-in or custom).
  // Built-in roles read from the catalog, custom roles as sent.
  const roleLabel = (r: { id: string; name: string }) => (ROLE_LABEL_KEYS[r.id] ? t(ROLE_LABEL_KEYS[r.id]) : r.name);
  const roleName = (id: string) => (ROLE_LABEL_KEYS[id] ? t(ROLE_LABEL_KEYS[id]) : (roles.find((r) => r.id === id)?.name ?? id));

  // Whether the current user can set another member's folder anchor. The
  // server enforces manage_roles on every request regardless, but hiding the
  // control otherwise would just be a button that always 400s. Read from the
  // caller's own map rather than cross-referencing /api/roles with the is_you
  // row, which is the two-request detour usePermissions exists to replace.
  const canManageRoles = can('manage_roles');
  const canInvite = can('invite_members');

  // Roles the caller may hand out: the ceiling as the server applies it
  // (lib/role-grant.ts) - a role must grant nothing the caller lacks, and
  // role_owner is never grantable because ownership is transferred, not
  // assigned. Fails open while the map is loading, like can(); the server
  // still decides.
  const grantable = (r: Role) => !myPerms ? r.id !== 'role_owner' : canGrantRole(myPerms, r);
  const assignableRoles = roles.filter(grantable);
  // A member whose current role is not grantable keeps it listed, disabled,
  // so the select shows what they hold instead of a blank.
  const rowRoles = (m: TeamMember) => assignableRoles.some((r) => r.id === m.role_id)
    ? assignableRoles
    : [...assignableRoles, ...roles.filter((r) => r.id === m.role_id)];

  if (loading) return <TeamSkeleton />;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <h1 className="text-xl font-bold tracking-tight">{t('common.heading.team')}</h1>
          {/* Both invite endpoints need invite_members; a button that only
              ever 403s is not an invitation. */}
          {canInvite && (
            <Button className="gap-1.5" onClick={() => { setInviteOpen(true); setInviteTab('email'); }}>
              <UserPlus className="size-4" /> {t('teams.action.inviteToWorkspace')}
            </Button>
          )}
        </div>

        {wsName && <Badge variant="secondary" className="text-xs">{t('teams.status.wsnameWorkspace', { wsName })}</Badge>}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={<Users className="size-4" />} value={stats?.members ?? 0} label={t('common.label.members')} />
          <StatCard icon={<Clock className="size-4" />} value={stats?.pending ?? 0} label={t('team.label.pendingInvites')} />
          <StatCard icon={<Share2 className="size-4" />} value={stats?.shares_this_week ?? 0} label={t('team.label.sharesThisWeek')} />
        </div>

        {/* Members */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('teams.label.membersMemberscount', { membersCount: members.length })}</p>
          <Card>
            <CardContent className="p-0">
              {/* Header */}
              <div className="grid grid-cols-[2.2fr_1.6fr_1fr_1fr_80px] px-5 py-2 border-b">
                {(['common.label.member', 'team.label.role', 'team.column.joined', 'teams.label.lastActive', ''] as const).map((h) => (
                  <span key={h || 'actions'} className="min-w-0 truncate text-[10px] font-semibold text-muted-foreground uppercase tracking-wider" title={h ? t(h) : undefined}>{h ? t(h) : ''}</span>
                ))}
              </div>
              {loadError ? (
                /* Distinct from the empty state on purpose - "you are the only
                   member" is a lie when the request failed, and without a
                   retry the only way out was a full page reload. */
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <AlertCircle className="size-8 text-destructive/40 mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">{t('teams.error.couldNotLoadTeamMembers')}</p>
                  <p dir="auto" className="text-xs text-muted-foreground max-w-80 mb-3">{loadError}</p>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={load}>
                    <RefreshCw className="size-3 me-1" /> {t('common.action.tryAgain')}
                  </Button>
                </div>
              ) : members.length === 1 ? (
                <EmptyState
                  icon={Users}
                  title={t('teams.tooltip.youAreTheOnlyMember')}
                  description={t('teams.description.invitePeopleToShareThisWorkspaceRolesControlWhoCanUpload')}
                  actions={canInvite ? (
                    <Button size="sm" className="h-7 text-xs" onClick={() => { setInviteOpen(true); setInviteTab('email'); }}>
                      {t('teams.action.inviteSomeone')}
                    </Button>
                  ) : undefined}
                />
              ) : members.map((m) => (
                <div key={m.membership_id} className="grid grid-cols-[2.2fr_1.6fr_1fr_1fr_80px] px-5 items-center min-h-[58px] border-b last:border-b-0 hover:bg-muted/50 group">
                  <div className="flex items-center gap-3 py-2.5">
                    <UserAvatar url={m.avatar_url} userId={m.user_id} name={m.name} />
                    <div>
                      <p className="text-sm font-medium">
                        <button className="hover:underline text-start" onClick={() => setProfileMember(m)} title={t('teams.action.viewProfile')}><bdi>{m.name}</bdi></button>
                        {m.is_you && <Badge variant="secondary" className="text-[9px] ms-1">{t('common.status.you')}</Badge>}
                      </p>
                      <p className="text-[11px] text-muted-foreground"><bdi dir="ltr">{m.email}</bdi></p>
                    </div>
                  </div>
                  <div>
                    {/* The role is a control, not a label, for anyone who may
                        manage roles - the owner's row stays a badge because
                        ownership moves by transfer, and so does your own,
                        because the endpoint refuses self-changes. */}
                    {canManageRoles && !m.is_you && m.role_id !== 'role_owner' ? (
                      <Select
                        value={m.role_id}
                        onValueChange={(v) => changeRole(m, v as string)}
                        items={rowRoles(m).map((r) => ({ value: r.id, label: roleLabel(r) }))}
                        disabled={changingRoleId === m.membership_id}
                      >
                        <SelectTrigger className="h-6 text-[11px] w-[130px]" aria-label={t('team.accessibility.roleForMName', { mName: m.name })}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {rowRoles(m).map((r) => (
                            <SelectItem key={r.id} value={r.id} disabled={!grantable(r)}>{roleLabel(r)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge className={`text-[11px] ${roleColor(m.role_id)}`}>{roleName(m.role_id)}</Badge>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[160px]">
                      {m.root_folder_id ? (m.root_folder_name ?? t('common.label.folder')) : t('teams.label.wholeWorkspace')}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">{timeAgo(m.joined_at)}</span>
                  <span className="text-xs text-muted-foreground">&nbsp;</span>
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                    {!m.is_you && m.role_id !== 'role_owner' && canManageRoles && (
                      <Button variant="outline" size="sm" className="h-6 w-6 p-0" title={t('teams.action.setFolderAccess')} onClick={() => openAnchorDialog(m)}>
                        <Folder className="size-3" />
                      </Button>
                    )}
                    {/* Removal needs manage_roles, which the endpoint now
                        checks instead of comparing role ids. This button was
                        shown to every member, including viewers, whose only
                        feedback was the 403. */}
                    {!m.is_you && m.role_id !== 'role_owner' && canManageRoles && (
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
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('teams.label.pendingInvitesInvitescount', { invitesCount: invites.length })}</p>
          <Card>
            <CardContent className="p-0">
              {invites.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">{t('teams.label.noPendingInvites')}</p>
              ) : invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-5 py-3 border-b last:border-b-0">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0"><Mail className="size-3.5 text-muted-foreground" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium"><bdi dir="ltr">{inv.email}</bdi></p>
                    <p className="text-[11px] text-muted-foreground">
                      {t('teams.description.invitedByInvinvitedByNameunknownExpiresInInvexpiresAt', { invInvited_by_nameUnknown: inv.invited_by_name ?? t('common.label.unknown'), invExpires_at: timeUntil(inv.expires_at) })}
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{roleName(inv.role_id)}</Badge>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => copyInviteLink(inv)} title={t('teams.action.copyTheInviteLinkToShareItYourself')}>
                    <Copy className="size-3" /> {t('common.action.copyLink')}
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => resendInvite(inv)} disabled={resendingId === inv.id} title={t('teams.action.sendTheInvitationEmailAgain')}>
                    {resendingId === inv.id ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3 rtl:-scale-x-100" />} {t('common.action.resend')}
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30" onClick={() => setRevokeTarget({ id: inv.id, email: inv.email })}>
                    {t('common.action.revoke')}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Invite Links */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('teams.label.inviteLinks')}</p>
          <Card>
            <CardContent className="p-0">
              {links.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">{t('teams.label.noActiveInviteLinks')}</p>
              ) : links.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-5 py-3 border-b last:border-b-0">
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0"><Link2 className="size-3.5 text-muted-foreground" /></div>
                  <div className="flex-1 min-w-0">
                    <p dir="ltr" className="text-xs font-mono truncate">{l.url}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {roleName(l.role_id) || l.role_name} · {t('teams.label.luseCountUsed', { lUse_count: l.max_uses ? `${localDigits(l.use_count)}/${localDigits(l.max_uses)}` : localDigits(l.use_count) })} · {expiryLabel(l.expires_at)}
                    </p>
                  </div>
                  <CopyButton text={l.url} />
                  <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30" onClick={() => revokeLink(l.id)}>{t('common.action.revoke')}</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Right panel */}
      <div className="w-56 shrink-0 border-s overflow-y-auto hidden lg:block">
        {/* Activity */}
        <div className="p-4 border-b">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{can('view_activity') ? t('team.heading.recentActivity') : t('teams.label.yourRecentActivity')}</p>
          {activity.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('common.empty.noActivityYet')}</p>
          ) : activity.slice(0, 8).map((a, i) => (
            <div key={i} className="flex gap-2 items-start mb-2.5">
              <UserAvatar url={a.avatar_url} userId={a.user_id ?? ''} name={a.user_name ?? t('common.label.unknown')} className="w-5 h-5 text-[8px] mt-0.5" />
              <div>
                <p className="text-[11px] text-muted-foreground leading-snug"><span className="font-semibold text-foreground"><bdi>{a.user_name ?? t('common.label.unknown')}</bdi></span> {actionLabel(a.action)} {a.meta?.name && <span className="font-semibold text-foreground"><bdi>{a.meta.name}</bdi></span>}</p>
                <p className="text-[10px] text-muted-foreground/60">{timeAgo(a.created_at)}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Role guide */}
        <div className="p-4 border-b">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t('team.heading.roleGuide')}</p>
          {([
            { role: 'common.label.owner', color: '#16A34A', desc: 'teams.description.fullControlBillingDeleteWorkspace' },
            { role: 'common.label.admin', color: '#4338CA', desc: 'teams.description.manageMembersAndAllFiles' },
            { role: 'common.label.member', color: '#706E69', desc: 'teams.description.uploadShareManageOwnFiles' },
            { role: 'common.label.viewer', color: '#92400E', desc: 'teams.description.downloadAndViewOnly' },
          ] as const).map((r) => (
            <div key={r.role} className="flex gap-2 items-start mb-2">
              <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: r.color }} />
              <div>
                <p className="text-xs font-semibold">{t(r.role)}</p>
                <p className="text-[10px] text-muted-foreground">{t(r.desc)}</p>
              </div>
            </div>
          ))}
          <Link to="/role-create" className="mt-3 flex items-center justify-center gap-1.5 py-2 border border-dashed rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors no-underline">
            <Plus className="size-3" /> {t('teams.action.createCustomRole')}
          </Link>
        </div>

        {/* Workspace link */}
        <div className="p-4">
          <Link to="/settings" className="flex items-center gap-2 px-3 py-2.5 border rounded-lg text-xs font-medium hover:bg-muted/50 transition-colors no-underline text-foreground">
            <Settings className="size-3.5" /> {t('common.action.workspaceSettings')}
          </Link>
        </div>
      </div>

      {/* Invite modal */}
      <InviteModal open={inviteOpen} tab={inviteTab} onTabChange={setInviteTab} onClose={() => setInviteOpen(false)} wsId={wsId} roles={assignableRoles} onInvited={load} />

      {/* Remove member dialog */}
      <Dialog open={!!removeTarget} onOpenChange={() => setRemoveTarget(null)}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader><DialogTitle>{t('team.heading.removeMember')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{richText(t('teams.description.removeRemovetargetnameFromThisWorkspaceTheyWillLoseAccessImmediately', { removeTargetName: '{removeTargetName}' }), { removeTargetName: <span className="font-semibold text-foreground"><bdi>{removeTarget?.name}</bdi></span> })}</p>
          <DialogFooter className="justify-center">
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={removeMember}>{t('common.remove')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder access dialog (phase C, task 5) */}
      <Dialog open={!!anchorTarget} onOpenChange={(v) => { if (!v) setAnchorTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('teams.heading.folderAccess')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {richText(t('teams.description.controlWhatAnchortargetnameCanSeeInThisWorkspace', { anchorTargetName: '{anchorTargetName}' }), { anchorTargetName: <span className="font-semibold text-foreground"><bdi>{anchorTarget?.name}</bdi></span> })}
          </p>
          <div>
            <p className="text-xs font-medium mb-0.5">{t('teams.label.limitToAFolder')}</p>
            <p className="text-[11px] text-muted-foreground mb-2">
              {t('teams.description.optionalThisMemberWillOnlySeeThisFolderAndEverythingInside')}
            </p>
            {anchorFolderId ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs truncate border rounded-lg px-3 py-2">{anchorFolderName || t('common.label.folder')}</span>
                <Button variant="outline" size="sm" onClick={() => { setAnchorFolderId(null); setAnchorFolderName(''); }}>{t('common.action.clear')}</Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full h-9 text-xs" onClick={() => setAnchorPickerOpen(true)}>
                {t('common.action.chooseFolder')}
              </Button>
            )}
          </div>

          {/* Shown only when a folder is actually chosen. Confinement is
              enforced by REFUSING every route that has not been audited for
              it, which is the safe default but means real parts of the app
              stop working - and an owner had no way to know that before
              applying it. Saying so here is what turns a trap into a choice.
              Remove these lines as the routes are covered. */}
          {/* Written when confinement refused most of the app, and rewritten
              once every data path was scoped. It is a description of reach
              now, not a warning about breakage - the earlier copy named
              Dashboard, Search, Shared and desktop sync as things that would
              not work, and all four work and are scoped. Stale UI copy about a
              permission boundary is worse than none: an owner makes a
              confinement decision on it. */}
          {anchorFolderId && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-[11px] font-medium mb-1">{t('teams.label.whatThisChangesForThem')}</p>
              <p className="text-[11px] text-muted-foreground">
                {t('teams.description.everywhereTheyLookTheWebAppDesktopSyncWebdavAnd')}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnchorTarget(null)}>{t('common.cancel')}</Button>
            <Button onClick={saveAnchor} disabled={savingAnchor}>
              {savingAnchor ? <Loader2 className="size-4 animate-spin me-1.5" /> : null} {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder picker for the anchor dialog above. Reuses the same dialog
          phase B2 put on the profile page for anchored API keys - no new
          tree, no new dependency. */}
      {anchorPickerOpen && wsId && (
        <FolderPickerDialog
          open
          onClose={() => setAnchorPickerOpen(false)}
          workspaceId={wsId}
          selectedId={anchorFolderId}
          selectedName={anchorFolderName}
          onSelect={(id, name) => { setAnchorFolderId(id); setAnchorFolderName(name); setAnchorPickerOpen(false); }}
          title={t('teams.tooltip.limitToAFolder')}
          confirmLabel={t('common.label.selectFolder')}
        />
      )}

      {/* Revoke invite dialog */}
      {/* Member profile modal */}
      <Dialog open={!!profileMember} onOpenChange={(v) => { if (!v) setProfileMember(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>{t('common.heading.profile')}</DialogTitle></DialogHeader>
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
                  <bdi>{profileMember.name}</bdi>
                  {profileMember.is_you && <Badge variant="secondary" className="text-[9px] ms-1.5">{t('common.status.you')}</Badge>}
                </p>
                <Badge className={`text-[10px] mt-1 ${roleColor(profileMember.role_id)}`}>{roleName(profileMember.role_id)}</Badge>
              </div>
              <div className="w-full space-y-2 text-start border rounded-lg p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-muted-foreground shrink-0">{t('common.label.email')}</span>
                  <span className="text-xs font-medium break-all text-end"><bdi dir="ltr">{profileMember.email}</bdi></span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-muted-foreground shrink-0">{t('teams.label.lastActive')}</span>
                  <span className="text-xs font-medium">{profileMember.last_active_at ? timeAgo(profileMember.last_active_at) : t('common.empty.noActivityYet')}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-muted-foreground shrink-0">{t('team.column.joined')}</span>
                  <span className="text-xs font-medium">{formatDateWith(profileMember.joined_at, { year: 'numeric', month: 'short', day: 'numeric' }, 'en-US')}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>{t('teams.heading.revokeInvite')}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            {richText(t('teams.description.revokeTheInvitationSentToRevoketargetemailTheirInviteLinkWillStop', { revokeTargetEmail: '{revokeTargetEmail}' }), { revokeTargetEmail: <span className="font-semibold text-foreground break-all"><bdi dir="ltr">{revokeTarget?.email}</bdi></span> })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={revokeInvite}>{t('common.action.revoke')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Invite Modal ───────────────────────────────────────────

// A label is either a catalog key or a plain number.
type Option = { value: string; labelKey?: MessageKey; label?: string };
const MAX_USES_OPTIONS: Option[] = [
  { value: '', labelKey: 'teams.label.unlimited' }, { value: '1', label: '1' }, { value: '5', label: '5' },
  { value: '10', label: '10' }, { value: '25', label: '25' }, { value: '100', label: '100' },
];
const LINK_EXPIRY_OPTIONS: Option[] = [
  { value: '', labelKey: 'common.label.never' }, { value: '1', labelKey: 'common.label.oneDay' }, { value: '7', labelKey: 'common.label.sevenDays' },
  { value: '30', labelKey: 'common.label.thirtyDays' }, { value: '90', labelKey: 'common.label.ninetyDays' },
];

function InviteModal({ open, tab, onTabChange, onClose, wsId, roles, onInvited }: {
  open: boolean; tab: 'email' | 'link'; onTabChange: (t: 'email' | 'link') => void; onClose: () => void; wsId: string;
  /** Already filtered to what the caller may grant - see `grantable` in TeamsPage. */
  roles: Role[]; onInvited: () => void;
}) {
  const t = useT();
  const roleLabel = (r: { id: string; name: string }) => (ROLE_LABEL_KEYS[r.id] ? t(ROLE_LABEL_KEYS[r.id]) : r.name);
  const optionLabel = (o: Option) => (o.labelKey ? t(o.labelKey) : (o.label ?? ''));
  const assignable = roles;
  const roleItems = assignable.map((r) => ({ value: r.id, label: roleLabel(r) }));
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
  const [pickedRole, setRole] = useState('role_member');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Link tab
  const [pickedLinkRole, setLinkRole] = useState('role_member');

  // role_member is the sensible default but not always grantable (a custom
  // role without manage_roles may only add viewers), and the list arrives
  // after this mounts. Derived, not synced: the first grantable role stands
  // in until a pick lands on one that is.
  const settle = (picked: string) => (assignable.some((r) => r.id === picked) ? picked : (assignable[0]?.id ?? picked));
  const role = settle(pickedRole);
  const linkRole = settle(pickedLinkRole);
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
    if (list.length === 0) { setError(t('common.error.addAtLeastOneEmailAddress')); return; }

    setError(''); setSending(true);
    // One invite per address - each gets its own unique, email-bound link
    const failures: { addr: string; message: string }[] = [];
    for (const addr of list) {
      try {
        const res = await api<{ ok: boolean; error?: string }>('/api/team/invite', {
          method: 'POST', body: JSON.stringify({ workspace_id: wsId, email: addr, role }),
        });
        if (!res.ok) failures.push({ addr, message: res.error ?? t('teams.error.failed') });
      } catch (err) { failures.push({ addr, message: apiErrorMessage(err, t('teams.error.failed')) }); }
    }
    const sent = list.length - failures.length;
    if (sent > 0) {
      toast.success(t('teams.feedback.invitesSent'), t('teams.feedback.sentSentPluralOneInviteOtherInvites', { sent }));
      onInvited();
    }
    if (failures.length > 0) {
      // Keep only the failed addresses so the user can correct/retry
      setEmails(list.filter((a) => failures.some((f) => f.addr === a)));
      setEmailInput('');
      setError(summarizeInviteFailures(failures));
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
      else setError(res.error ?? t('common.error.failed'));
    } catch (err) { setError(apiErrorMessage(err)); }
    setCreatingLink(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md p-0">
        <div className="px-5 pt-5 pb-0">
          <DialogTitle>{t('team.heading.inviteToWorkspace')}</DialogTitle>
        </div>
        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as 'email' | 'link')}>
          <TabsList variant="line" className="w-full gap-0 border-b p-0 group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="email" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Mail className="size-3.5" /> {t('teams.action.emailInvite')}
            </TabsTrigger>
            <TabsTrigger value="link" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Link2 className="size-3.5" /> {t('teams.action.inviteLink')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="px-5 pb-5 pt-3">
          {error && <div dir="auto" className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-lg px-3 py-2 mb-3">{error}</div>}

          {tab === 'email' ? (
            <form onSubmit={sendInvite} className="space-y-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.label.emailAddresses')}</Label>
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
                    placeholder={emails.length === 0 ? t('teams.placeholder.colleagueCompanyComPressEnterToAdd') : ''}
                    className="flex-1 min-w-24 bg-transparent outline-none text-sm"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{t('teams.description.eachPersonGetsTheirOwnInviteLinkValidOnlyForTheir')}</p>
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('team.label.role')}</Label>
                <Select value={role} onValueChange={(v) => setRole(v as string)} items={roleItems}>
                  <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assignable.map((r) => (<SelectItem key={r.id} value={r.id}>{roleLabel(r)}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={sending}>
                {sending ? <Loader2 className="size-4 animate-spin me-2" /> : null} {t('team.action.sendInvite')}
              </Button>
              <p className="text-[11px] text-muted-foreground">{t('teams.description.inviteExpiresAfter7Days')}</p>
            </form>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('teams.label.roleForNewMembers')}</Label>
                <Select value={linkRole} onValueChange={(v) => setLinkRole(v as string)} items={roleItems}>
                  <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assignable.map((r) => (<SelectItem key={r.id} value={r.id}>{roleLabel(r)}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('teams.label.maxUses')}</Label>
                  <Select value={linkMaxUses} onValueChange={(v) => setLinkMaxUses(v as string)} items={MAX_USES_OPTIONS.map((o) => ({ value: o.value, label: optionLabel(o) }))}>
                    <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MAX_USES_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{optionLabel(o)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.label.expires')}</Label>
                  <Select value={linkExpires} onValueChange={(v) => setLinkExpires(v as string)} items={LINK_EXPIRY_OPTIONS.map((o) => ({ value: o.value, label: optionLabel(o) }))}>
                    <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LINK_EXPIRY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{optionLabel(o)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button className="w-full" onClick={createLink} disabled={creatingLink}>
                {creatingLink ? <Loader2 className="size-4 animate-spin me-2" /> : null} {t('teams.action.createInviteLink')}
              </Button>
              {createdLink && (
                <div className="mt-3">
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('teams.label.shareThisLink')}</Label>
                  <div className="flex gap-2">
                    <Input value={createdLink} readOnly dir="ltr" className="h-8 text-xs font-mono flex-1" />
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
  if (diff <= 0) return translate('teams.label.expired');
  if (diff < 3600) return translate('teams.label.countM', { count: Math.floor(diff / 60) });
  if (diff < 86400) return translate('teams.label.countH', { count: Math.floor(diff / 3600) });
  const days = Math.ceil(diff / 86400);
  return days === 1 ? translate('common.label.oneDay') : translate('teams.label.countDays', { count: days });
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
