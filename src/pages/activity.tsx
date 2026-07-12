import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { timeAgo, avatarColor, initials } from '@/lib/helpers';
import { parseUA } from '@/lib/ua';

// ── Types ─────────────────────────────────────────────────

interface Activity {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, any> | null;
  created_at: number;
  user_name: string;
  user_id: string;
  user_email: string;
  user_avatar: string | null;
  // Forensic / enrichment fields (Task 3 endpoint) — nulled server-side by
  // gateActivityRow for non-privileged viewers looking at another member's row.
  source_ip?: string | null;
  user_agent?: string | null;
  outcome?: string | null;
  source?: string | null;
  action_group?: string | null;
  on_behalf_of?: string | null;
  obo_name?: string | null;
  obo_email?: string | null;
  resource_name?: string | null;
  request_id?: string | null;
  session_id?: string | null;
  actor_type?: string | null;
  meta?: ({ geo?: { country?: string | null; city?: string | null } | null } & Record<string, any>) | null;
}


interface Member { id: string; name: string; email: string; avatar_url: string | null }
interface Pagination { page: number; per_page: number; total: number; total_pages: number }

// ── Constants ─────────────────────────────────────────────

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'files', label: 'Files' },
  { value: 'folders', label: 'Folders' },
  { value: 'sharing', label: 'Sharing' },
  { value: 'members', label: 'Members' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'comments', label: 'Comments' },
];

const CATEGORY_ACTIONS: Record<string, { value: string; label: string }[]> = {
  files: [
    { value: 'file_uploaded', label: 'File uploaded' },
    { value: 'file_version_uploaded', label: 'Version uploaded' },
    { value: 'file_downloaded', label: 'File downloaded' },
    { value: 'file_deleted', label: 'File deleted' },
    { value: 'file_permanently_deleted', label: 'Permanently deleted' },
    { value: 'file_restored', label: 'File restored' },
    { value: 'file_renamed', label: 'File renamed' },
    { value: 'file_moved', label: 'File moved' },
    { value: 'file_copied', label: 'File copied' },
    { value: 'file_locked', label: 'File locked' },
    { value: 'file_hidden', label: 'File hidden' },
  ],
  folders: [
    { value: 'folder_created', label: 'Folder created' },
    { value: 'folder_renamed', label: 'Folder renamed' },
    { value: 'folder_moved', label: 'Folder moved' },
    { value: 'folder_deleted', label: 'Folder deleted' },
  ],
  sharing: [
    { value: 'file_shared', label: 'File shared (link)' },
    { value: 'file_shared_email', label: 'File shared (email)' },
    { value: 'folder_shared', label: 'Folder shared' },
    { value: 'link_revoked', label: 'Link revoked' },
    { value: 'file_request_created', label: 'File request created' },
    { value: 'file_request_uploaded', label: 'Request upload' },
    { value: 'file_request_revoked', label: 'Request revoked' },
  ],
  members: [
    { value: 'member_invited', label: 'Member invited' },
    { value: 'member_joined', label: 'Member joined' },
    { value: 'member_removed', label: 'Member removed' },
    { value: 'member_left', label: 'Member left' },
    { value: 'invite_revoked', label: 'Invite revoked' },
    { value: 'ownership_transferred', label: 'Ownership transferred' },
  ],
  workspace: [
    { value: 'workspace_created', label: 'Workspace created' },
    { value: 'workspace_updated', label: 'Workspace updated' },
    { value: 'workspace_settings_changed', label: 'Settings changed' },
    { value: 'role_updated', label: 'Role updated' },
    { value: 'role_deleted', label: 'Role deleted' },
  ],
  comments: [
    { value: 'comment_added', label: 'Comment added' },
    { value: 'comment_deleted', label: 'Comment deleted' },
  ],
};

const ACTION_COLORS: Record<string, string> = {
  file_uploaded: '#22c55e', file_version_uploaded: '#22c55e', folder_created: '#22c55e',
  member_joined: '#22c55e', workspace_created: '#22c55e', comment_added: '#22c55e',
  file_request_uploaded: '#22c55e',
  file_downloaded: '#2563EB', file_restored: '#2563EB', file_request_created: '#2563EB',
  file_deleted: '#ef4444', file_permanently_deleted: '#ef4444', folder_deleted: '#ef4444',
  member_removed: '#ef4444', member_left: '#ef4444', link_revoked: '#ef4444',
  invite_revoked: '#ef4444', file_request_revoked: '#ef4444', comment_deleted: '#ef4444',
  role_deleted: '#ef4444',
  file_renamed: '#D97706', file_moved: '#D97706', file_locked: '#D97706',
  file_hidden: '#D97706', folder_renamed: '#D97706', folder_moved: '#D97706',
  member_invited: '#D97706', ownership_transferred: '#D97706',
  workspace_updated: '#D97706', workspace_settings_changed: '#D97706', role_updated: '#D97706',
  file_shared: '#7C3AED', file_shared_email: '#7C3AED', folder_shared: '#7C3AED',
  file_copied: '#706e69',
  // New action codes (richer activity feed)
  file_unlocked: '#22c55e', folder_unlocked: '#22c55e', file_unhidden: '#22c55e',
  folder_unhidden: '#22c55e', role_created: '#22c55e', favourite_added: '#22c55e',
  group_created: '#22c55e', group_item_added: '#22c55e',
  sync_session_completed: '#22c55e',
  folder_locked: '#D97706', folder_hidden: '#D97706', comment_edited: '#D97706',
  group_updated: '#D97706', profile_updated: '#D97706', plan_changed: '#D97706',
  files_batch_deleted: '#ef4444', favourite_removed: '#ef4444', group_deleted: '#ef4444',
  group_item_removed: '#ef4444', dmca_reported: '#ef4444', sync_session_failed: '#ef4444',
  share_link_unlocked: '#7C3AED',
  sync_session_started: '#2563EB',
};

const ACTION_LABELS: Record<string, string> = {
  file_uploaded: 'uploaded', file_version_uploaded: 'uploaded a new version of',
  file_downloaded: 'downloaded', file_deleted: 'deleted', file_permanently_deleted: 'permanently deleted',
  file_restored: 'restored', file_renamed: 'renamed', file_moved: 'moved', file_copied: 'copied',
  file_locked: 'locked', file_hidden: 'changed visibility of',
  folder_created: 'created folder', folder_renamed: 'renamed folder', folder_moved: 'moved folder', folder_deleted: 'deleted folder',
  file_shared: 'shared', file_shared_email: 'shared via email', folder_shared: 'shared folder',
  link_revoked: 'revoked link for', file_request_created: 'created file request',
  file_request_uploaded: 'uploaded to request', file_request_revoked: 'revoked file request',
  member_invited: 'invited', member_joined: 'joined', member_removed: 'removed',
  member_left: 'left the workspace', invite_revoked: 'revoked invite for',
  ownership_transferred: 'transferred ownership to',
  workspace_created: 'created workspace', workspace_updated: 'updated workspace',
  workspace_settings_changed: 'changed settings', role_updated: 'updated role', role_deleted: 'deleted role',
  comment_added: 'commented on', comment_deleted: 'deleted comment on',
  // New action codes (richer activity feed)
  file_unlocked: 'unlocked', folder_unlocked: 'unlocked folder', folder_locked: 'locked folder',
  file_unhidden: 'changed visibility of', folder_hidden: 'changed visibility of folder', folder_unhidden: 'changed visibility of folder',
  files_batch_deleted: 'deleted multiple files', share_link_unlocked: 'unlocked share link',
  comment_edited: 'edited comment on', role_created: 'created role',
  favourite_added: 'favourited', favourite_removed: 'unfavourited',
  group_created: 'created group', group_updated: 'updated group', group_deleted: 'deleted group',
  group_item_added: 'added to group', group_item_removed: 'removed from group',
  dmca_reported: 'reported (DMCA)',
  sync_session_started: 'started a sync', sync_session_completed: 'completed a sync', sync_session_failed: 'sync failed',
  profile_updated: 'updated profile', plan_changed: 'changed plan',
};

// ── Page ──────────────────────────────────────────────────

export default function ActivityPage() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // Filters
  const [selCategories, setSelCategories] = useState<Set<string>>(new Set());
  const [selMembers, setSelMembers] = useState<Set<string>>(new Set());
  const [selActions, setSelActions] = useState<Set<string>>(new Set());

  const hasFilters = selCategories.size > 0 || selMembers.size > 0 || selActions.size > 0;

  // Available actions based on selected categories
  const availableActions = selCategories.size > 0
    ? [...selCategories].flatMap((cat) => CATEGORY_ACTIONS[cat] ?? [])
    : Object.values(CATEGORY_ACTIONS).flat();

  const loadActivity = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    const params = new URLSearchParams({ workspace_id: wsId, page: String(page), per_page: '30' });
    if (selCategories.size > 0) params.set('category', [...selCategories].join(','));
    if (selActions.size > 0) params.set('action', [...selActions].join(','));
    if (selMembers.size > 0) params.set('user_id', [...selMembers].join(','));

    try {
      const data = await api<{
        ok: boolean;
        activities: Activity[];
        members?: Member[];
        pagination: Pagination;
      }>(`/api/activity?${params}`);
      if (data.ok) {
        setActivities(data.activities);
        setPagination(data.pagination);
        if (data.members && members.length === 0) setMembers(data.members);
      }
    } catch {}
    setLoading(false);
  }, [wsId, page, selCategories, selActions, selMembers]);

  useEffect(() => { loadActivity(); }, [loadActivity]);

  const clearFilters = () => {
    setSelCategories(new Set());
    setSelMembers(new Set());
    setSelActions(new Set());
    setPage(1);
  };

  const sub = pagination
    ? `${pagination.total} activit${pagination.total === 1 ? 'y' : 'ies'}${hasFilters ? ' (filtered)' : ''}`
    : 'Loading...';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="mb-5">
            <h1 className="text-xl font-bold">Activity log</h1>
            <p className="text-sm text-muted-foreground mt-1">{sub}</p>
          </div>

          {/* Filters */}
          <div className="flex items-end gap-2.5 flex-wrap mb-4">
            <FilterDropdown
              label="Category"
              placeholder="All categories"
              options={CATEGORIES}
              selected={selCategories}
              onChange={(v) => { setSelCategories(v); setSelActions(new Set()); setPage(1); }}
            />
            <FilterDropdown
              label="Member"
              placeholder="All members"
              options={members.map((m) => ({ value: m.id, label: m.name || m.email }))}
              selected={selMembers}
              onChange={(v) => { setSelMembers(v); setPage(1); }}
            />
            <FilterDropdown
              label="Action"
              placeholder="All actions"
              options={availableActions}
              selected={selActions}
              onChange={(v) => { setSelActions(v); setPage(1); }}
            />
            {hasFilters && (
              <button onClick={clearFilters} className="h-9 px-3 rounded-lg bg-muted text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground whitespace-nowrap">
                Clear filters
              </button>
            )}
          </div>

          {/* Activity list */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="size-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5 pt-1">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm font-medium text-muted-foreground">No activity found</p>
              {hasFilters && <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters</p>}
            </div>
          ) : (
            <div className="space-y-0">
              {activities.map((a) => (
                <ActivityRow key={a.id} activity={a} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.total_pages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6 pb-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {pagination.total_pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pagination.total_pages} onClick={() => setPage(page + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Activity row ──────────────────────────────────────────

function ActivityRow({ activity: a }: { activity: Activity }) {
  const [open, setOpen] = useState(false);
  const label = ACTION_LABELS[a.action] ?? a.action;
  const color = ACTION_COLORS[a.action] ?? '#706e69';
  // `meta` is the parsed, possibly server-gated metadata (Task 3); fall back
  // to the legacy `metadata` field for rows/responses that predate it.
  const meta = a.meta ?? a.metadata;
  const bgColor = avatarColor(a.user_id ?? '');
  const failed = a.outcome === 'failure' || a.outcome === 'denied';
  const device = parseUA(a.user_agent);
  const geo = a.meta?.geo;

  return (
    <div className="border-b last:border-b-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full text-left flex items-start gap-3 py-3">
        {/* Avatar */}
        <div
          className="size-8 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-0.5"
          style={{ background: bgColor }}
        >
          {a.user_avatar ? (
            <img src={a.user_avatar} alt="" className="w-full h-full rounded-full object-cover" />
          ) : (
            initials(a.user_name ?? 'Unknown')
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-snug">
            <span className="font-semibold">{a.user_name ?? 'Unknown'}</span>{' '}
            <span className="text-muted-foreground">{label}</span>
            {(a.resource_name || meta?.name) && (
              <>
                {' '}<span className="font-semibold">{a.resource_name ?? meta?.name}</span>
              </>
            )}
          </p>

          {/* Meta tags */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[11px] text-muted-foreground">{timeAgo(a.created_at)}</span>

            {failed && (
              <Badge variant="outline" className="text-[9px] h-4 text-red-600 border-red-300">
                {a.outcome}
              </Badge>
            )}
            {a.on_behalf_of && (
              <Badge variant="outline" className="text-[9px] h-4">
                on behalf of {a.obo_name ?? a.on_behalf_of}
              </Badge>
            )}
            {a.source && a.source !== 'web' && (
              <Badge variant="outline" className="text-[9px] h-4">{a.source}</Badge>
            )}
            {meta?.old_name && meta?.new_name && (
              <Badge variant="outline" className="text-[9px] h-4 gap-1">
                {meta.old_name} → {meta.new_name}
              </Badge>
            )}
            {meta?.email && (
              <Badge variant="outline" className="text-[9px] h-4">{meta.email}</Badge>
            )}
            {meta?.file_count && meta.file_count > 1 && (
              <Badge variant="outline" className="text-[9px] h-4">{meta.file_count} files</Badge>
            )}
            {meta?.via && (
              <Badge variant="outline" className="text-[9px] h-4">via {meta.via}</Badge>
            )}
          </div>
        </div>

        {/* Color dot */}
        <div className="size-2 rounded-full shrink-0 mt-2" style={{ background: color }} />
      </button>

      {open && (
        <dl className="pl-11 pb-3 grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-muted-foreground">When</dt>
          <dd>{new Date(a.created_at * 1000).toLocaleString()} · {timeAgo(a.created_at)}</dd>

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
              <dd>{a.outcome}{meta?.reason ? ` (${meta.reason})` : ''}</dd>
            </>
          )}
          {(a.resource_name || a.entity_type) && (
            <>
              <dt className="text-muted-foreground">Resource</dt>
              <dd>{a.resource_name ?? `${a.entity_type} ${a.entity_id ?? ''}`}</dd>
            </>
          )}
          {a.session_id && (
            <>
              <dt className="text-muted-foreground">Session</dt>
              <dd className="truncate">{a.session_id}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

// ── Filter dropdown ───────────────────────────────────────

function FilterDropdown({ label, placeholder, options, selected, onChange }: {
  label: string;
  placeholder: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value); else next.add(value);
    onChange(next);
  };

  const displayText = selected.size === 0
    ? placeholder
    : selected.size === 1
      ? options.find((o) => o.value === [...selected][0])?.label ?? '1 selected'
      : `${selected.size} selected`;

  return (
    <div>
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">{label}</label>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          className={`h-9 min-w-36 max-w-52 px-3 border rounded-lg text-xs flex items-center gap-2 hover:bg-muted/50 ${open ? 'bg-muted' : 'bg-background'} ${selected.size > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
        >
          <span className="truncate flex-1 text-left">{displayText}</span>
          <ChevronDown className={`size-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48 max-h-64 overflow-y-auto">
          {options.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No options</p>
          ) : (
            options.map((opt) => (
              <DropdownMenuCheckboxItem
                key={opt.value}
                checked={selected.has(opt.value)}
                onCheckedChange={() => toggle(opt.value)}
                closeOnClick={false}
                className="text-xs"
              >
                <span className="truncate">{opt.label}</span>
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
