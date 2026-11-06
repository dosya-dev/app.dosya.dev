import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, apiErrorMessage } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { usePermissions } from '@/hooks/use-permissions';
import { permissionsNamedInRefusal } from '@/lib/role-grant';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { ChevronLeft, Loader2, Check, X, Pencil, Trash2, Eye } from 'lucide-react';
import { toast } from '@/lib/toast';
import { richText } from '@/lib/rich-text';
import { gbToBytes, mbToBytes, bytesToGb, bytesToMb } from '@/lib/usage-units';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';

// Day-of-week checkboxes for active_hours.days (0 = Sunday, matching
// apps/api/src/lib/access/active-hours.ts). Kept page-local, same as
// profile.tsx's identical picker - the two forms don't share a component.
const DAY_OPTIONS: { value: number; labelKey: MessageKey }[] = [
  { value: 0, labelKey: 'common.label.sun' }, { value: 1, labelKey: 'common.label.mon' }, { value: 2, labelKey: 'common.label.tue' },
  { value: 3, labelKey: 'common.label.wed' }, { value: 4, labelKey: 'common.label.thu' }, { value: 5, labelKey: 'common.label.fri' },
  { value: 6, labelKey: 'common.label.sat' },
];

function timezoneOptions(): string[] {
  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
    if (zones && zones.length > 0) return zones;
  } catch { /* not supported in this runtime */ }
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([here, 'Etc/UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney'])];
}

// ── Permission definitions ────────────────────────────────

interface PermInfo { key: string; labelKey: MessageKey; hintKey: MessageKey; categoryKey: MessageKey }

const PERM_INFO: PermInfo[] = [
  { key: 'upload_files', labelKey: 'common.label.uploadFiles', hintKey: 'role-create.description.uploadNewFilesToTheWorkspace', categoryKey: 'common.label.files' },
  { key: 'download_files', labelKey: 'common.label.downloadFiles', hintKey: 'role-create.description.downloadAnyFileInTheWorkspace', categoryKey: 'common.label.files' },
  { key: 'delete_own_files', labelKey: 'common.label.deleteOwnFiles', hintKey: 'role-create.description.deleteFilesTheyUploadedThemselves', categoryKey: 'common.label.files' },
  { key: 'delete_any_file', labelKey: 'common.label.deleteAnyFile', hintKey: 'role-create.description.deleteAnyFileIncludingOtherMembersUploads', categoryKey: 'common.label.files' },
  { key: 'rename_files', labelKey: 'common.label.renameFiles', hintKey: 'role-create.description.changeFileNamesWithinTheWorkspace', categoryKey: 'common.label.files' },
  { key: 'create_folders', labelKey: 'common.label.createFolders', hintKey: 'role-create.description.createNewFoldersToOrganizeFiles', categoryKey: 'common.label.folders' },
  { key: 'rename_folders', labelKey: 'common.label.renameFolders', hintKey: 'role-create.description.changeFolderNamesWithinTheWorkspace', categoryKey: 'common.label.folders' },
  { key: 'create_share_links', labelKey: 'common.label.createShareLinks', hintKey: 'role-create.description.generatePublicOrPrivateShareUrlsForFiles', categoryKey: 'common.label.sharing' },
  { key: 'view_own_shares', labelKey: 'common.label.viewOwnSharedLinks', hintKey: 'role-create.description.seeShareLinksTheyCreatedAndTheirStats', categoryKey: 'common.label.sharing' },
  { key: 'view_all_shares', labelKey: 'common.label.viewAllSharedLinks', hintKey: 'role-create.description.seeAllShareLinksCreatedByAnyWorkspaceMember', categoryKey: 'common.label.sharing' },
  { key: 'invite_members', labelKey: 'common.label.inviteMembers', hintKey: 'role-create.description.sendWorkspaceInvitationsToNewPeopleViaEmail', categoryKey: 'common.label.team' },
  { key: 'view_team_members', labelKey: 'common.label.viewTeamMembers', hintKey: 'role-create.description.seeTheListOfWorkspaceMembersAndTheirRoles', categoryKey: 'common.label.team' },
  { key: 'manage_roles', labelKey: 'common.label.manageRoles', hintKey: 'role-create.description.createEditAndDeleteCustomRolesAndAssignPermissions', categoryKey: 'common.label.team' },
  { key: 'change_workspace_name', labelKey: 'common.label.changeWorkspaceName', hintKey: 'role-create.description.renameTheWorkspaceShownInTheSwitcher', categoryKey: 'common.label.workspaceIdentity' },
  { key: 'change_workspace_icon', labelKey: 'common.label.changeWorkspaceIcon', hintKey: 'role-create.description.updateTheInitialsAndColorOfTheWorkspaceIcon', categoryKey: 'common.label.workspaceIdentity' },
  { key: 'manage_branding', labelKey: 'role-create.label.manageBranding', hintKey: 'role-create.description.setTheLogoNameAndColourShownToPeopleOutsideThe', categoryKey: 'common.label.workspaceIdentity' },
  { key: 'change_max_file_size', labelKey: 'role-create.label.changeMaxUploadFileSize', hintKey: 'role-create.description.setTheMaximumSizeForASingleFileUpload', categoryKey: 'common.label.workspaceLimits' },
  { key: 'change_storage_per_member', labelKey: 'common.label.changeStoragePerMember', hintKey: 'role-create.description.setTheMaxStorageAnySingleMemberCanConsume', categoryKey: 'common.label.workspaceLimits' },
  { key: 'change_total_storage_cap', labelKey: 'role-create.label.changeTotalWorkspaceStorageCap', hintKey: 'role-create.description.setTheHardCeilingOnTotalStorage', categoryKey: 'common.label.workspaceLimits' },
  { key: 'change_max_concurrent_uploads', labelKey: 'common.label.changeMaxSimultaneousUploads', hintKey: 'role-create.description.limitConcurrentUploadsPerMember', categoryKey: 'common.label.workspaceLimits' },
  { key: 'change_allowed_file_types', labelKey: 'common.label.changeAllowedFileTypes', hintKey: 'role-create.description.restrictWhichFileExtensionsCanBeUploaded', categoryKey: 'common.label.workspaceLimits' },
  { key: 'change_blocked_file_types', labelKey: 'common.label.changeBlockedFileTypes', hintKey: 'role-create.description.blockSpecificFileExtensionsFromBeingUploaded', categoryKey: 'common.label.workspaceLimits' },
  { key: 'change_duplicate_scan', labelKey: 'common.label.changeDuplicateScanning', hintKey: 'role-create.description.turnTheDuplicateFinderOnOrOffScanningReadsEveryFile', categoryKey: 'common.label.workspaceLimits' },
  { key: 'change_ai_search', labelKey: 'common.label.changeAiSearch', hintKey: 'role-create.description.turnAiSearchOnOrOffAndChooseWhichFoldersAreIndexed', categoryKey: 'common.label.workspaceLimits' },
  { key: 'manage_settings', labelKey: 'common.label.manageSettings', hintKey: 'role-create.description.editWorkspaceSecuritySettingsAndAccessControls', categoryKey: 'common.label.workspaceGeneral' },
  { key: 'view_activity', labelKey: 'common.label.viewActivityLog', hintKey: 'role-create.description.seeTheFullActivityHistoryOfTheWorkspace', categoryKey: 'common.label.workspaceGeneral' },
  { key: 'lock_files', labelKey: 'common.label.lockFilesFolders', hintKey: 'role-create.description.lockFilesOrFoldersToPreventEditsByOtherMembers', categoryKey: 'common.label.fileManagement' },
  { key: 'hide_files', labelKey: 'common.label.hideFilesFolders', hintKey: 'role-create.description.hideFilesOrFoldersFromOtherMembers', categoryKey: 'common.label.fileManagement' },
  { key: 'access_dashboard', labelKey: 'common.label.accessDashboard', hintKey: 'role-create.description.viewTheWorkspaceDashboardWithStatsAndRecentFiles', categoryKey: 'common.label.pageAccess' },
  { key: 'access_files', labelKey: 'common.label.accessFiles', hintKey: 'role-create.description.browseAndManageFilesAndFolders', categoryKey: 'common.label.pageAccess' },
  { key: 'access_upload', labelKey: 'common.label.accessUpload', hintKey: 'role-create.description.openTheUploadPage', categoryKey: 'common.label.pageAccess' },
  { key: 'access_shared', labelKey: 'common.label.accessShared', hintKey: 'role-create.description.viewTheSharedLinksPage', categoryKey: 'common.label.pageAccess' },
  { key: 'access_team', labelKey: 'common.label.accessTeam', hintKey: 'role-create.description.viewTheTeamPage', categoryKey: 'common.label.pageAccess' },
  { key: 'access_settings', labelKey: 'common.label.accessSettings', hintKey: 'role-create.description.openTheWorkspaceSettingsPage', categoryKey: 'common.label.pageAccess' },
  { key: 'access_webdav', labelKey: 'common.label.useWebdav', hintKey: 'role-create.description.mountTheWorkspaceOverWebdavInFinderExplorerOrAWebdav', categoryKey: 'common.label.protocolAccess' },
  { key: 'access_s3', labelKey: 'common.label.useTheS3Gateway', hintKey: 'role-create.description.accessTheWorkspaceWithS3ToolsSuchAsRcloneOrThe', categoryKey: 'common.label.protocolAccess' },
  { key: 'access_sftp', labelKey: 'common.label.sftpAccess', hintKey: 'role-create.description.connectToTheWorkspaceOverSftpWithAnApiKey', categoryKey: 'common.label.protocolAccess' },
];

const ROLE_COLORS: Record<string, string> = { owner: '#16A34A', admin: '#4338CA', member: '#706E69', viewer: '#92400E' };
const CUSTOM_ROLE_COLOR = '#BE123C';

interface ExistingRole {
  id: string; name: string; is_builtin: boolean; is_custom: boolean;
  permissions: Record<string, boolean>;
  // Access conditions (migration 0097). Always null for builtin roles - see
  // apps/api/src/pages/api/roles/[id].ts's PUT handler for why a condition
  // can never bind to a shared builtin role id.
  allowed_ips: string | null;
  active_hours: string | null;
  // Usage limits (migration 0098). Same row, same "always null for builtin
  // roles" reasoning as the two conditions fields above.
  requests_per_minute: number | null;
  egress_bytes_per_day: number | null;
  max_file_size_bytes: number | null;
  max_concurrent_transfers: number | null;
}

// ── Page ──────────────────────────────────────────────────

export default function RoleCreatePage() {
  const t = useT();
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
  // The rows a ceiling refusal named, so they can be marked in a form long
  // enough that the error text alone sits several screens away from them.
  const [offending, setOffending] = useState<Set<string>>(new Set());
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [existingRoles, setExistingRoles] = useState<ExistingRole[]>([]);
  // The ceiling, browser-side: POST/PUT /api/roles refuse any grant the
  // caller does not hold themselves (apps/api/src/lib/role-rank.ts). Fails
  // open while loading, as the hook does; the server still decides.
  const { can, roleId: myRoleId } = usePermissions();
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // Access conditions (migration 0097). Blank/disabled means unrestricted -
  // sent as an absent field on save, same rule as profile.tsx's identical
  // API-key fields (see handleSave below).
  const [roleAllowedIps, setRoleAllowedIps] = useState('');
  const [roleHoursEnabled, setRoleHoursEnabled] = useState(false);
  const [roleTz, setRoleTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [roleDays, setRoleDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [roleFrom, setRoleFrom] = useState('09:00');
  const [roleTo, setRoleTo] = useState('17:00');

  // Usage limits (migration 0098). Blank means unlimited. Kept as strings
  // (not numbers) so the input can be legitimately empty without coercing to
  // 0 - see handleSave's Math.round(Number(...)) conversion, same pattern as
  // profile.tsx's identical API-key fields.
  const [roleRequestsPerMinute, setRoleRequestsPerMinute] = useState('');
  const [roleEgressGbPerDay, setRoleEgressGbPerDay] = useState('');
  const [roleMaxFileSizeMb, setRoleMaxFileSizeMb] = useState('');
  const [roleMaxConcurrentTransfers, setRoleMaxConcurrentTransfers] = useState('');

  const toggleRoleDay = (value: number) => {
    if (isViewMode) return;
    setRoleDays((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const title = isViewMode ? t('role-create.label.viewRolePermissions') : editId ? t('role-create.label.editCustomRole') : t('role-create.label.createCustomRole');

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
      setRoleAllowedIps(role.allowed_ips ?? '');
      if (role.active_hours) {
        try {
          const parsed = JSON.parse(role.active_hours) as { tz: string; days: number[]; from: string; to: string };
          setRoleHoursEnabled(true);
          setRoleTz(parsed.tz);
          setRoleDays(new Set(parsed.days));
          setRoleFrom(parsed.from);
          setRoleTo(parsed.to);
        } catch { /* leave the active-hours fields at their defaults */ }
      } else {
        setRoleHoursEnabled(false);
      }
      // Usage limits (migration 0098) - loaded the same way as the two
      // conditions fields above, and for the SAME reason: without this, a
      // save that only touches permissions would re-submit blank limit
      // fields and silently clear a restriction nobody meant to touch.
      setRoleRequestsPerMinute(role.requests_per_minute !== null ? String(role.requests_per_minute) : '');
      setRoleEgressGbPerDay(role.egress_bytes_per_day !== null ? bytesToGb(role.egress_bytes_per_day) : '');
      setRoleMaxFileSizeMb(role.max_file_size_bytes !== null ? bytesToMb(role.max_file_size_bytes) : '');
      setRoleMaxConcurrentTransfers(role.max_concurrent_transfers !== null ? String(role.max_concurrent_transfers) : '');
    }).catch(() => {});
  }, [roleId, wsId]);

  /**
   * A permission the caller lacks may be switched OFF if the role already has
   * it (PUT only counts newly added grants) but never ON. Expressed on the
   * current state rather than the loaded one: once off, it stays off.
   */
  const isLocked = (key: string) => !can(key) && !permState[key];

  const togglePerm = (key: string) => {
    if (isViewMode || isLocked(key)) return;
    setPermState((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // The error renders below a long form; bring it into view rather than let
  // a failed save look like nothing happened.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [error]);

  const failSave = (msg: string) => {
    setError(msg);
    setOffending(new Set(permissionsNamedInRefusal(msg)));
  };

  const handleSave = async () => {
    if (!roleName.trim()) { setError(t('role-create.error.roleNameIsRequired')); return; }
    setError('');
    setOffending(new Set());
    setSaving(true);
    // Access conditions. Unlike the API-key create form (profile.tsx), this
    // page ALSO edits an existing role - so blank must be sent EXPLICITLY,
    // not omitted: an absent field means "leave role_conditions untouched"
    // on the server (see roles/[id].ts's PUT), which would make clearing a
    // previously-set restriction impossible from this form. Sending "" /
    // null here is exactly what the server's own validators already
    // normalise to "no restriction" (validateAllowedIps("") and
    // validateActiveHours(null) both -> null), so always sending concrete
    // values works identically for create and for a genuine clear-on-edit.
    const conditions = {
      allowed_ips: roleAllowedIps.trim(),
      active_hours: roleHoursEnabled
        ? { tz: roleTz, days: [...roleDays].sort(), from: roleFrom, to: roleTo }
        : null,
      // Usage limits (migration 0098). Same "always send a concrete value,
      // never omit" reasoning as the two conditions fields above: this form
      // also EDITS an existing role, so a blank field must be sent as
      // explicit `null` to clear a previously-set limit, not omitted (which
      // the PUT endpoint reads as "leave it untouched"). Egress (GB) and max
      // file size (MB) convert to bytes via the shared lib/usage-units.ts
      // helpers (also used by profile.tsx - see that module's doc), which
      // already return `null` for blank input, matching this form's own
      // null-not-omitted rule for free.
      requests_per_minute: roleRequestsPerMinute.trim() ? Math.round(Number(roleRequestsPerMinute)) : null,
      egress_bytes_per_day: gbToBytes(roleEgressGbPerDay),
      max_file_size_bytes: mbToBytes(roleMaxFileSizeMb),
      max_concurrent_transfers: roleMaxConcurrentTransfers.trim() ? Math.round(Number(roleMaxConcurrentTransfers)) : null,
    };
    try {
      if (editId) {
        const res = await api<{ ok: boolean; error?: string }>(`/api/roles/${editId}`, {
          method: 'PUT', body: JSON.stringify({ name: roleName.trim(), permissions: permState, ...conditions }),
        });
        if (res.ok) { toast.success(t('common.feedback.roleUpdated'), t('role-create.feedback.theRoleAndItsPermissionsHaveBeenSaved')); window.location.href = '/settings#roles'; }
        else failSave(res.error ?? t('common.label.failed'));
      } else {
        const res = await api<{ ok: boolean; error?: string }>('/api/roles', {
          method: 'POST', body: JSON.stringify({ workspace_id: wsId, name: roleName.trim(), permissions: permState, ...conditions }),
        });
        if (res.ok) { toast.success(t('role-create.feedback.roleCreated'), t('role-create.feedback.yourNewRoleIsReadyToAssign')); window.location.href = '/settings#roles'; }
        else failSave(res.error ?? t('common.label.failed'));
      }
    } catch (err) { failSave(apiErrorMessage(err, t('common.error.canTReachTheServerCheckYourConnectionAnd'))); }
    setSaving(false);
  };

  const handleDeleteRole = async (id: string) => {
    try {
      await api(`/api/roles/${id}`, { method: 'DELETE' });
      toast.success(t('role-create.feedback.roleDeleted'), t('role-create.feedback.theRoleHasBeenRemoved')); loadRoles();
    } catch (err) { toast.error(t('common.error.deleteFailed'), apiErrorMessage(err, t('role-create.error.theRoleCouldNotBeDeleted'))); }
    setDeleteConfirm(null);
  };

  // Group permissions by category
  const categories = [...new Set(PERM_INFO.map((p) => p.categoryKey))];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <Link to="/settings" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
            <ChevronLeft className="size-3.5 rtl:-scale-x-100" /> {t('common.action.backToSettings')}
          </Link>
          <h1 className="text-xl font-bold mb-1">{title}</h1>
          <p className="text-sm text-muted-foreground mb-6">{t('role-create.description.configureExactlyWhatThisRoleCanDoInYourWorkspace')}</p>

          {/* Role name */}
          <Card className="gap-0 py-0 mb-5">
            <div className="px-5 py-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('role-create.label.roleIdentity')}</p>
            </div>
            <div className="px-5 py-4">
              <label className="text-sm font-medium block mb-1">{t('role-create.label.roleName')}</label>
              <p className="text-xs text-muted-foreground mb-2">{t('role-create.description.visibleToWorkspaceAdminsWhenAssigningRoles')}</p>
              <Input
                value={roleName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoleName(e.target.value)}
                placeholder={t('role-create.placeholder.eGExternalReviewer')}
                className="h-9 text-sm max-w-xs"
                maxLength={50}
                disabled={isViewMode}
              />
            </div>
          </Card>

          {/* Permissions */}
          <Card className="gap-0 py-0 mb-5">
            <div className="px-5 py-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('role-create.label.permissions')}</p>
            </div>
            <div className="divide-y">
              {categories.map((cat) => (
                <div key={cat}>
                  <div className="px-5 py-2 bg-muted/30">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t(cat)}</span>
                  </div>
                  {PERM_INFO.filter((p) => p.categoryKey === cat).map((p) => {
                    const locked = !isViewMode && isLocked(p.key);
                    const flagged = offending.has(p.key);
                    return (
                    <div
                      key={p.key}
                      className={`flex items-center justify-between px-5 py-3 border-b last:border-b-0 ${flagged ? 'border-s-2 border-s-destructive bg-destructive/5' : ''}`}
                      title={locked ? t('role-create.action.youDonTHoldThisPermission') : undefined}
                    >
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${flagged ? 'text-destructive' : locked ? 'text-muted-foreground' : ''}`}>{t(p.labelKey)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t(p.hintKey)}</p>
                        {locked && <p className="text-[11px] text-muted-foreground/80 mt-0.5">{t('role-create.error.youDonTHoldThisPermissionSoYouCanTGrantIt')}</p>}
                        {flagged && <p className="text-[11px] text-destructive mt-0.5">{t('role-create.description.theServerRefusedThisGrant')}</p>}
                      </div>
                      {isViewMode ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {permState[p.key] ? (
                            <><Check className="size-4 text-green-500" /><span className="text-xs font-medium text-green-600">{t('role-create.label.enabled')}</span></>
                          ) : (
                            <><X className="size-4 text-muted-foreground/40" /><span className="text-xs text-muted-foreground">{t('role-create.label.disabled')}</span></>
                          )}
                        </div>
                      ) : (
                        <button
                          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${permState[p.key] ? 'bg-green-600' : 'bg-muted'} disabled:opacity-40 disabled:cursor-not-allowed`}
                          onClick={() => togglePerm(p.key)}
                          disabled={locked}
                          aria-disabled={locked || undefined}
                          title={locked ? t('role-create.action.youDonTHoldThisPermission') : undefined}
                        >
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${permState[p.key] ? 'inset-s-4.5' : 'inset-s-0.5'}`} />
                        </button>
                      )}
                    </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>

          {/* Access conditions (migration 0097) - applies to every member seated
              on this role, intersected with any conditions their own API key sets
              (neither layer can widen the other - see conditions.ts). */}
          <Card className="gap-0 py-0 mb-5">
            <div className="px-5 py-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('role-create.label.accessConditions')}</p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">{t('common.label.allowedIpRanges')}</label>
                <p className="text-xs text-muted-foreground mb-2">
                  {t('role-create.description.optionalCommaSeparatedMembersUsingThisRoleWillBeRefusedFromAny')}
                </p>
                <Textarea
                  placeholder={t('common.placeholder.20301130242001Db832')}
                  value={roleAllowedIps}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRoleAllowedIps(e.target.value)}
                  className="text-sm min-h-[3.5rem] max-w-md"
                  disabled={isViewMode}
                />
              </div>
              <div>
                <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer mb-1">
                  <Checkbox
                    className="size-4"
                    checked={roleHoursEnabled}
                    onCheckedChange={() => !isViewMode && setRoleHoursEnabled((v) => !v)}
                    disabled={isViewMode}
                  />
                  {t('role-create.label.restrictToActiveHours')}
                </label>
                <p className="text-xs text-muted-foreground mb-2">
                  {t('role-create.description.optionalMembersUsingThisRoleWillBeRefusedOutsideThisWeekly')}
                </p>
                {roleHoursEnabled && (
                  <div className="space-y-2 rounded-lg border p-3 max-w-md">
                    <Select
                      value={roleTz}
                      onValueChange={(v) => setRoleTz(v as string)}
                      items={timezoneOptions().map((tz) => ({ value: tz, label: tz }))}
                    >
                      <SelectTrigger className="w-full h-8 text-xs" disabled={isViewMode}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {timezoneOptions().map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="flex flex-wrap gap-2">
                      {DAY_OPTIONS.map((d) => (
                        <label key={d.value} className="flex items-center gap-1 text-[11px] cursor-pointer">
                          <Checkbox className="size-3.5" checked={roleDays.has(d.value)} onCheckedChange={() => toggleRoleDay(d.value)} disabled={isViewMode} />
                          {t(d.labelKey)}
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input type="time" value={roleFrom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoleFrom(e.target.value)} className="h-8 text-xs flex-1" disabled={isViewMode} />
                      <span className="text-[11px] text-muted-foreground">{t('common.label.to')}</span>
                      <Input type="time" value={roleTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoleTo(e.target.value)} className="h-8 text-xs flex-1" disabled={isViewMode} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Usage limits (migration 0098) - applies to every member seated on
              this role, composing with any limits their own API key sets as
              min(key, role) per metric (neither layer can widen the other -
              see apps/api/src/lib/usage/enforce.ts). */}
          <Card className="gap-0 py-0 mb-5">
            <div className="px-5 py-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('role-create.label.usageLimits')}</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-muted-foreground mb-3 max-w-md">
                {t('role-create.description.optionalTheseLimitsApplyToEveryMemberUsingThisRoleAcross')}
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <div>
                  <label className="text-xs font-medium block mb-1">{t('role-create.label.requestsPerMinute')}</label>
                  <Input
                    type="number" min="1" step="1" placeholder={t('role-create.placeholder.requestsPerMinute')}
                    value={roleRequestsPerMinute}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoleRequestsPerMinute(e.target.value)}
                    className="h-9 text-sm" disabled={isViewMode}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">{t('role-create.label.egressPerDayGb')}</label>
                  <Input
                    type="number" min="1" step="any" placeholder={t('role-create.placeholder.gbPerDay')}
                    value={roleEgressGbPerDay}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoleEgressGbPerDay(e.target.value)}
                    className="h-9 text-sm" disabled={isViewMode}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">{t('common.label.maxFileSizeMb')}</label>
                  <Input
                    type="number" min="1" step="any" placeholder="MB"
                    value={roleMaxFileSizeMb}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoleMaxFileSizeMb(e.target.value)}
                    className="h-9 text-sm" disabled={isViewMode}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">{t('sync.label.maxConcurrentTransfers')}</label>
                  <Input
                    type="number" min="1" step="1" placeholder={t('role-create.placeholder.count')}
                    value={roleMaxConcurrentTransfers}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoleMaxConcurrentTransfers(e.target.value)}
                    className="h-9 text-sm" disabled={isViewMode}
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Actions */}
          {!isViewMode && (
            <div className="flex items-center gap-3 mb-8">
              <Link to="/settings"><Button variant="outline">{t('common.cancel')}</Button></Link>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin me-1.5" />}
                {editId ? t('common.action.saveChanges') : t('role-create.action.createRole')}
              </Button>
            </div>
          )}

          {error && <p dir="auto" ref={errorRef} className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 mb-6">{error}</p>}

          {/* Existing roles */}
          <Card className="gap-0 py-0 mb-8">
            <div className="px-5 py-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('role-create.label.existingRolesMiddotExistingrolescount', { existingRolesCount: existingRoles.length })}
              </p>
            </div>
            <div className="divide-y">
              {existingRoles.map((r) => {
                const permCount = Object.values(r.permissions).filter(Boolean).length;
                const totalPerms = Object.keys(r.permissions).length;
                // Colour by tier, never by name: a custom role called "Admin"
                // is still a custom role.
                const dotColor = r.is_builtin ? (ROLE_COLORS[r.name.toLowerCase()] ?? '#706E69') : CUSTOM_ROLE_COLOR;
                // PUT /api/roles/:id refuses the role the caller holds, so
                // it gets View like a built-in; deleting it fails the same
                // way (a role someone still holds cannot be deleted).
                const isMine = r.id === myRoleId;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="size-2.5 rounded-full shrink-0" style={{ background: dotColor }} />
                      <span className="text-sm font-medium">{r.name}</span>
                      <Badge variant={r.is_builtin ? 'secondary' : 'outline'} className="text-[9px]">
                        {r.is_builtin ? t('role-create.label.builtIn') : t('role-create.label.custom')}
                      </Badge>
                      {isMine && <Badge variant="secondary" className="text-[9px]">{t('role-create.status.yourRole')}</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{t('role-create.label.permcountTotalpermsPermissions', { permCount, totalPerms })}</span>
                    <div className="flex gap-1 shrink-0">
                      {r.is_custom && !isMine ? (
                        <>
                          <Link to={`/role-create?edit=${r.id}`}>
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Pencil className="size-3" /> {t('common.edit')}</Button>
                          </Link>
                          <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => setDeleteConfirm({ id: r.id, name: r.name })}>
                            <Trash2 className="size-3" />
                          </Button>
                        </>
                      ) : (
                        <Link to={`/role-create?view=${r.id}`}>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Eye className="size-3" /> {t('common.view')}</Button>
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
          <DialogHeader><DialogTitle>{t('role-create.heading.deleteRole')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {richText(t('role-create.error.deleteTheDeleteconfirmnameRoleMembersMustBeMovedToAnotherRole', { deleteConfirmName: '{deleteConfirmName}' }), { deleteConfirmName: <span className="font-semibold text-foreground">{deleteConfirm?.name}</span> })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDeleteRole(deleteConfirm.id)}>{t('role-create.action.deleteRole')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
