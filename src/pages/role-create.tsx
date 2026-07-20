import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, apiErrorMessage } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { ChevronLeft, Loader2, Check, X, Pencil, Trash2, Eye } from 'lucide-react';
import { toast } from '@/lib/toast';

// ── Permission definitions ────────────────────────────────

interface PermInfo { key: string; label: string; hint: string; category: string }

const PERM_INFO: PermInfo[] = [
  { key: 'upload_files', label: 'Upload files', hint: 'Upload new files to the workspace.', category: 'Files' },
  { key: 'download_files', label: 'Download files', hint: 'Download any file in the workspace.', category: 'Files' },
  { key: 'delete_own_files', label: 'Delete own files', hint: 'Delete files they uploaded themselves.', category: 'Files' },
  { key: 'delete_any_file', label: 'Delete any file', hint: 'Delete any file, including other members\' uploads.', category: 'Files' },
  { key: 'rename_files', label: 'Rename files', hint: 'Change file names within the workspace.', category: 'Files' },
  { key: 'create_folders', label: 'Create folders', hint: 'Create new folders to organize files.', category: 'Folders' },
  { key: 'rename_folders', label: 'Rename folders', hint: 'Change folder names within the workspace.', category: 'Folders' },
  { key: 'create_share_links', label: 'Create share links', hint: 'Generate public or private share URLs for files.', category: 'Sharing' },
  { key: 'view_own_shares', label: 'View own shared links', hint: 'See share links they created and their stats.', category: 'Sharing' },
  { key: 'view_all_shares', label: 'View all shared links', hint: 'See all share links created by any workspace member.', category: 'Sharing' },
  { key: 'invite_members', label: 'Invite members', hint: 'Send workspace invitations to new people via email.', category: 'Team' },
  { key: 'view_team_members', label: 'View team members', hint: 'See the list of workspace members and their roles.', category: 'Team' },
  { key: 'manage_roles', label: 'Manage roles', hint: 'Create, edit, and delete custom roles and assign permissions.', category: 'Team' },
  { key: 'change_workspace_name', label: 'Change workspace name', hint: 'Rename the workspace shown in the switcher.', category: 'Workspace identity' },
  { key: 'change_workspace_icon', label: 'Change workspace icon', hint: 'Update the initials and color of the workspace icon.', category: 'Workspace identity' },
  { key: 'change_workspace_region', label: 'Change default region', hint: 'Set the default upload region for new files.', category: 'Workspace identity' },
  { key: 'change_max_file_size', label: 'Change max upload file size', hint: 'Set the maximum size for a single file upload.', category: 'Workspace limits' },
  { key: 'change_storage_per_member', label: 'Change storage per member', hint: 'Set the max storage any single member can consume.', category: 'Workspace limits' },
  { key: 'change_total_storage_cap', label: 'Change total workspace storage cap', hint: 'Set the hard ceiling on total storage.', category: 'Workspace limits' },
  { key: 'change_max_concurrent_uploads', label: 'Change max simultaneous uploads', hint: 'Limit concurrent uploads per member.', category: 'Workspace limits' },
  { key: 'change_allowed_file_types', label: 'Change allowed file types', hint: 'Restrict which file extensions can be uploaded.', category: 'Workspace limits' },
  { key: 'change_blocked_file_types', label: 'Change blocked file types', hint: 'Block specific file extensions from being uploaded.', category: 'Workspace limits' },
  { key: 'manage_settings', label: 'Manage settings', hint: 'Edit workspace security settings and access controls.', category: 'Workspace general' },
  { key: 'view_activity', label: 'View activity log', hint: 'See the full activity history of the workspace.', category: 'Workspace general' },
  { key: 'lock_files', label: 'Lock files & folders', hint: 'Lock files or folders to prevent edits by other members.', category: 'File management' },
  { key: 'hide_files', label: 'Hide files & folders', hint: 'Hide files or folders from other members.', category: 'File management' },
  { key: 'access_dashboard', label: 'Access Dashboard', hint: 'View the workspace dashboard with stats and recent files.', category: 'Page access' },
  { key: 'access_files', label: 'Access Files', hint: 'Browse and manage files and folders.', category: 'Page access' },
  { key: 'access_upload', label: 'Access Upload', hint: 'Open the upload page.', category: 'Page access' },
  { key: 'access_shared', label: 'Access Shared', hint: 'View the shared links page.', category: 'Page access' },
  { key: 'access_team', label: 'Access Team', hint: 'View the team page.', category: 'Page access' },
  { key: 'access_settings', label: 'Access Settings', hint: 'Open the workspace settings page.', category: 'Page access' },
];

const ROLE_COLORS: Record<string, string> = { owner: '#16A34A', admin: '#4338CA', member: '#706E69', viewer: '#92400E' };

interface ExistingRole {
  id: string; name: string; is_builtin: boolean; is_custom: boolean;
  permissions: Record<string, boolean>;
}

// ── Page ──────────────────────────────────────────────────

export default function RoleCreatePage() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [searchParams] = useSearchParams();

  const editId = searchParams.get('edit');
  const viewId = searchParams.get('view');
  const isViewMode = !!viewId;
  const roleId = editId || viewId;

  const [roleName, setRoleName] = useState('');
  const [permState, setPermState] = useState<Record<string, boolean>>(() => {
    const s: Record<string, boolean> = {};
    PERM_INFO.forEach((p) => { s[p.key] = false; });
    return s;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [existingRoles, setExistingRoles] = useState<ExistingRole[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  const title = isViewMode ? 'View role permissions' : editId ? 'Edit custom role' : 'Create custom role';

  // Load existing roles
  const loadRoles = useCallback(async () => {
    if (!wsId) return;
    try {
      const data = await api<{ ok: boolean; roles: ExistingRole[] }>(`/api/roles?workspace_id=${wsId}`);
      if (data.ok) setExistingRoles(data.roles);
    } catch {}
  }, [wsId]);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  // Load role data if editing or viewing
  useEffect(() => {
    if (!roleId || !wsId) return;
    api<{ ok: boolean; roles: ExistingRole[] }>(`/api/roles?workspace_id=${wsId}`).then((data) => {
      if (!data.ok) return;
      const role = data.roles.find((r) => r.id === roleId);
      if (!role) return;
      setRoleName(role.name);
      setPermState((prev) => {
        const next = { ...prev };
        Object.entries(role.permissions).forEach(([k, v]) => { next[k] = v; });
        return next;
      });
    }).catch(() => {});
  }, [roleId, wsId]);

  const togglePerm = (key: string) => {
    if (isViewMode) return;
    setPermState((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    if (!roleName.trim()) { setError('Role name is required.'); return; }
    setError('');
    setSaving(true);
    try {
      if (editId) {
        const res = await api<{ ok: boolean; error?: string }>(`/api/roles/${editId}`, {
          method: 'PUT', body: JSON.stringify({ name: roleName.trim(), permissions: permState }),
        });
        if (res.ok) { toast.success('Role updated', 'The role and its permissions have been saved.'); window.location.href = '/settings#roles'; }
        else setError(res.error ?? 'Failed');
      } else {
        const res = await api<{ ok: boolean; error?: string }>('/api/roles', {
          method: 'POST', body: JSON.stringify({ workspace_id: wsId, name: roleName.trim(), permissions: permState }),
        });
        if (res.ok) { toast.success('Role created', 'Your new role is ready to assign.'); window.location.href = '/settings#roles'; }
        else setError(res.error ?? 'Failed');
      }
    } catch (err) { setError(apiErrorMessage(err, "Can't reach the server. Check your connection and try again.")); }
    setSaving(false);
  };

  const handleDeleteRole = async (id: string) => {
    try {
      await api(`/api/roles/${id}`, { method: 'DELETE' });
      toast.success('Role deleted', 'The role has been removed.'); loadRoles();
    } catch { toast.error('Delete failed', 'The role could not be deleted.'); }
    setDeleteConfirm(null);
  };

  // Group permissions by category
  const categories = [...new Set(PERM_INFO.map((p) => p.category))];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <Link to="/settings" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
            <ChevronLeft className="size-3.5" /> Back to settings
          </Link>
          <h1 className="text-xl font-bold mb-1">{title}</h1>
          <p className="text-sm text-muted-foreground mb-6">Configure exactly what this role can do in your workspace.</p>

          {/* Role name */}
          <Card className="gap-0 py-0 mb-5">
            <div className="px-5 py-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role identity</p>
            </div>
            <div className="px-5 py-4">
              <label className="text-sm font-medium block mb-1">Role name</label>
              <p className="text-xs text-muted-foreground mb-2">Visible to workspace admins when assigning roles.</p>
              <Input
                value={roleName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoleName(e.target.value)}
                placeholder="e.g. External reviewer"
                className="h-9 text-sm max-w-xs"
                maxLength={50}
                disabled={isViewMode}
              />
            </div>
          </Card>

          {/* Permissions */}
          <Card className="gap-0 py-0 mb-5">
            <div className="px-5 py-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Permissions</p>
            </div>
            <div className="divide-y">
              {categories.map((cat) => (
                <div key={cat}>
                  <div className="px-5 py-2 bg-muted/30">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{cat}</span>
                  </div>
                  {PERM_INFO.filter((p) => p.category === cat).map((p) => (
                    <div key={p.key} className="flex items-center justify-between px-5 py-3 border-b last:border-b-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{p.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{p.hint}</p>
                      </div>
                      {isViewMode ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {permState[p.key] ? (
                            <><Check className="size-4 text-green-500" /><span className="text-xs font-medium text-green-600">Enabled</span></>
                          ) : (
                            <><X className="size-4 text-muted-foreground/40" /><span className="text-xs text-muted-foreground">Disabled</span></>
                          )}
                        </div>
                      ) : (
                        <button
                          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${permState[p.key] ? 'bg-green-600' : 'bg-muted'}`}
                          onClick={() => togglePerm(p.key)}
                        >
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${permState[p.key] ? 'left-4.5' : 'left-0.5'}`} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>

          {/* Actions */}
          {!isViewMode && (
            <div className="flex items-center gap-3 mb-8">
              <Link to="/settings"><Button variant="outline">Cancel</Button></Link>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin mr-1.5" />}
                {editId ? 'Save changes' : 'Create role'}
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 mb-6">{error}</p>}

          {/* Existing roles */}
          <Card className="gap-0 py-0 mb-8">
            <div className="px-5 py-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Existing roles &middot; {existingRoles.length}
              </p>
            </div>
            <div className="divide-y">
              {existingRoles.map((r) => {
                const permCount = Object.values(r.permissions).filter(Boolean).length;
                const totalPerms = Object.keys(r.permissions).length;
                const dotColor = ROLE_COLORS[r.name.toLowerCase()] ?? (r.is_custom ? '#BE123C' : '#706E69');
                return (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="size-2.5 rounded-full shrink-0" style={{ background: dotColor }} />
                      <span className="text-sm font-medium">{r.name}</span>
                      <Badge variant={r.is_builtin ? 'secondary' : 'outline'} className="text-[9px]">
                        {r.is_builtin ? 'built-in' : 'custom'}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{permCount}/{totalPerms} permissions</span>
                    <div className="flex gap-1 shrink-0">
                      {r.is_custom ? (
                        <>
                          <Link to={`/role-create?edit=${r.id}`}>
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Pencil className="size-3" /> Edit</Button>
                          </Link>
                          <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => setDeleteConfirm({ id: r.id, name: r.name })}>
                            <Trash2 className="size-3" />
                          </Button>
                        </>
                      ) : (
                        <Link to={`/role-create?view=${r.id}`}>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Eye className="size-3" /> View</Button>
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      {/* Delete confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete role?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete the "<span className="font-semibold text-foreground">{deleteConfirm?.name}</span>" role? Members assigned this role will need to be reassigned.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDeleteRole(deleteConfirm.id)}>Delete role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
