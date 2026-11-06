import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Check, Loader2, Save,
  Trash2, LogOut, Upload, X, Plus, ArrowRightLeft,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { humanSize, regionLabel } from '@/lib/helpers';
import { DeleteWorkspaceDialog } from '@/components/delete-workspace-dialog';
import { usePermissions } from '@/hooks/use-permissions';
import { clearShareDefaultsCache } from '@/lib/share-defaults';
import { SwatchPicker } from '@/components/brand/swatch-picker';
import { SETTINGS_SECTIONS as NAV, sectionFromHash } from '@/lib/settings-sections';
import { AiSearchSection } from '@/pages/settings/ai-search';
import { t as translate, useT, useLocale } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';


// ── Types ──────────────────────────────────────────────────

interface WsSettings {
  max_file_size_gb: number | null;
  max_storage_per_member_gb: number | null;
  max_total_storage_gb: number | null;
  max_concurrent_uploads: number | null;
  allowed_extensions: string | null;
  blocked_extensions: string | null;
  ip_allowlist: string | null;
  ip_blocklist: string | null;
  country_allowlist: string | null;
  country_blocklist: string | null;
  allowed_email_domains: string | null;
  /** Accepted and ignored by the API; no web surface. */
  available_regions: string | null;
  session_timeout_minutes: number | null;
  download_rate_limit: number | null;
  disable_share_links: number;
  force_share_password: number;
  share_max_expiry_days: number | null;
  default_share_expiry_days: number | null;
  require_2fa: number;
  disable_password_login: number;
  record_upload_origin: number;
}

interface WsData {
  workspace: { id: string; name: string; icon_initials: string; icon_color: string; icon_image_url: string | null; default_region: string; plan: string; storage_used_bytes?: number };
  settings: WsSettings | null;
  is_owner: boolean;
  plan: string;
  plan_limits?: { storage_gb?: number };
  allocation?: { plan_gb: number; allocated_gb: number; remaining_gb: number };
  roles: { id: string; name: string; is_default: number; is_builtin: boolean; is_custom: boolean }[];
  permissions: Record<string, { [perm: string]: boolean }>;
  /** Shape mirrors /api/team: the row id is `membership_id`; there is no `id`. */
  members?: { membership_id: string; user_id: string; name: string; email: string; role_id: string }[];
}

// `my_permissions` used to be derived here, by fetching /api/roles AND
// /api/team, finding the row flagged `is_you`, and looking its role_id up in
// the roles list. That was the only way any page could learn what the current
// user may do, and it cost two extra requests to answer a question the server
// can answer directly. GET /api/me/permissions exists now, so this page uses
// the same usePermissions hook as everything else - see the hook for why it
// deliberately fails OPEN while loading.
const NO_PERM = (what: string) => translate('settings.description.youDonTHavePermissionToChangeWhat', { what });


/**
 * The permission matrix on this page.
 *
 * It used to list eleven keys, two of which - `share_files` and
 * `manage_members` - are not permissions at all. No role has ever had a row
 * for either, so both columns rendered as a dash for every role forever, while
 * the real keys behind them (`create_share_links`, `invite_members`) were
 * missing from the table entirely. Twenty-three other real permissions were
 * absent too, including both file-management keys.
 *
 * This is the full registry, in the same order and grouping as
 * apps/api/src/lib/permissions.ts and the role editor. Rows are grouped so 34
 * of them stay readable.
 */
const PERM_GROUPS: { groupKey: MessageKey; perms: [string, MessageKey][] }[] = [
  { groupKey: 'common.label.files', perms: [
    ['upload_files', 'common.label.uploadFiles'], ['download_files', 'common.label.downloadFiles'],
    ['delete_own_files', 'common.label.deleteOwnFiles'], ['delete_any_file', 'common.label.deleteAnyFile'],
    ['rename_files', 'common.label.renameFiles'],
  ] },
  { groupKey: 'common.label.folders', perms: [
    ['create_folders', 'common.label.createFolders'], ['rename_folders', 'common.label.renameFolders'],
  ] },
  { groupKey: 'common.label.sharing', perms: [
    ['create_share_links', 'common.label.createShareLinks'], ['view_own_shares', 'common.label.viewOwnSharedLinks'],
    ['view_all_shares', 'common.label.viewAllSharedLinks'],
  ] },
  { groupKey: 'common.label.team', perms: [
    ['invite_members', 'common.label.inviteMembers'], ['view_team_members', 'common.label.viewTeamMembers'],
    ['manage_roles', 'common.label.manageRoles'],
  ] },
  { groupKey: 'common.label.fileManagement', perms: [
    ['lock_files', 'common.label.lockFilesFolders'], ['hide_files', 'common.label.hideFilesFolders'],
  ] },
  { groupKey: 'common.label.workspaceIdentity', perms: [
    ['change_workspace_name', 'common.label.changeWorkspaceName'], ['change_workspace_icon', 'common.label.changeWorkspaceIcon'],
  ] },
  { groupKey: 'common.label.workspaceLimits', perms: [
    ['change_max_file_size', 'settings.label.changeMaxFileSize'], ['change_storage_per_member', 'common.label.changeStoragePerMember'],
    ['change_total_storage_cap', 'settings.label.changeTotalStorageCap'], ['change_max_concurrent_uploads', 'common.label.changeMaxSimultaneousUploads'],
    ['change_allowed_file_types', 'common.label.changeAllowedFileTypes'], ['change_blocked_file_types', 'common.label.changeBlockedFileTypes'],
    ['change_duplicate_scan', 'common.label.changeDuplicateScanning'],
    ['change_ai_search', 'common.label.changeAiSearch'],
  ] },
  { groupKey: 'common.label.workspaceGeneral', perms: [
    ['manage_settings', 'common.label.manageSettings'], ['view_activity', 'common.label.viewActivityLog'],
  ] },
  { groupKey: 'common.label.pageAccess', perms: [
    ['access_dashboard', 'common.label.accessDashboard'], ['access_files', 'common.label.accessFiles'],
    ['access_upload', 'common.label.accessUpload'], ['access_shared', 'common.label.accessShared'],
    ['access_team', 'common.label.accessTeam'], ['access_settings', 'common.label.accessSettings'],
  ] },
  { groupKey: 'common.label.protocolAccess', perms: [
    ['access_webdav', 'common.label.useWebdav'], ['access_s3', 'common.label.useTheS3Gateway'],
    ['access_sftp', 'common.label.sftpAccess'],
  ] },
];

// ── Page ───────────────────────────────────────────────────

export default function SettingsPage() {
  const t = useT();
  const navigate = useNavigate();
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [data, setData] = useState<WsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('info');

  const load = useCallback(async () => {
    if (!wsId) return;
    try {
      const [wsRes, rolesRes, teamRes] = await Promise.all([
        api<{ ok: boolean } & WsData>(`/api/workspaces/${wsId}`),
        api<{ ok: boolean; roles: { id: string; name: string; is_default: number; is_builtin: boolean; is_custom: boolean; permissions: Record<string, boolean> }[] }>(`/api/roles?workspace_id=${wsId}`),
        api<{ ok: boolean; members?: { membership_id: string; user_id: string; name: string; email: string; role_id: string; is_you?: boolean }[] }>(`/api/team?workspace_id=${wsId}`),
      ]);
      if (wsRes.ok) {
        const d = wsRes;
        // Merge roles + permissions from /api/roles into workspace data
        if (rolesRes.ok && rolesRes.roles) {
          d.roles = rolesRes.roles.map((r) => ({ id: r.id, name: r.name, is_default: r.is_default ?? 0, is_builtin: r.is_builtin, is_custom: r.is_custom }));
          d.permissions = {};
          rolesRes.roles.forEach((r) => { d.permissions[r.id] = r.permissions; });
        }
        if (teamRes.ok && teamRes.members) {
          d.members = teamRes.members;
        }
        setData(d);
      }
    } catch {}
    setLoading(false);
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  // Search's "Go to" rows link to /settings#section-<id>. The sections only
  // exist after the first load, so wait for it, then scroll like a nav click.
  const location = useLocation();
  useEffect(() => {
    if (loading) return;
    const id = sectionFromHash(location.hash);
    if (!id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs the nav highlight to the URL hash
    setActiveSection(id);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth' });
  }, [loading, location.hash, location.key]);

  if (loading) return <SettingsSkeleton />;
  if (!data) return <div className="p-6 text-center text-muted-foreground">{t('settings.error.failedToLoadSettings')}</div>;

  return (
    <div className="flex h-full overflow-hidden">
      <nav className="w-52 shrink-0 border-e p-4 overflow-y-auto hidden md:block">
        {(['General', 'Members', 'Danger'] as const).map((group) => (
          <div key={group} className="mb-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t(NAV.find((n) => n.group === group)!.groupKey)}</p>
            {NAV.filter((n) => n.group === group).map((n) => (
              <button key={n.id}
                onClick={() => { setActiveSection(n.id); document.getElementById(`section-${n.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors mb-0.5 ${
                  activeSection === n.id
                    ? n.danger ? 'bg-destructive text-destructive-foreground' : 'bg-accent text-accent-foreground'
                    : n.danger ? 'text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <n.icon className="size-3.5" /> {n.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t('settings.heading.workspaceSettings')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('settings.description.workspacenameYouAreDataisOwnerSelectTrueTheOwnerOtherA', { workspaceName: data.workspace.name, dataIs_owner: String(!!data.is_owner) })}</p>
        </div>
        <WorkspaceInfoSection data={data} wsId={wsId} onSaved={load} />
        <HardLimitsSection data={data} wsId={wsId} onSaved={load} />
        <SecuritySection data={data} wsId={wsId} onSaved={load} />
        <section id="section-ai"><AiSearchSection wsId={wsId} /></section>
        <RolesSection data={data} wsId={wsId} onSaved={load} />
        <DangerSection data={data} wsId={wsId} isOwner={data.is_owner} navigate={navigate} onSaved={load} />
      </div>
    </div>
  );
}

// ── Workspace Info ─────────────────────────────────────────

export function WorkspaceInfoSection({ data, wsId, onSaved }: { data: WsData; wsId: string; onSaved: () => void }) {
  const t = useT();
  const [name, setName] = useState(data.workspace.name);
  const [initials, setInitials] = useState(data.workspace.icon_initials);
  const [iconColor, setIconColor] = useState(data.workspace.icon_color);
  const [iconUrl, setIconUrl] = useState(data.workspace.icon_image_url);
  const [iconVersion, setIconVersion] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { can } = usePermissions();

  const locationCode = data.workspace.default_region;
  const locationLabel = regionLabel(locationCode);

  const canName = can('change_workspace_name');
  const canIcon = can('change_workspace_icon');

  // onSaved() only reloads this page's own copy of the workspace. The sidebar
  // switcher holds a separate list it fetched at mount, so renaming a workspace
  // or swapping its icon left the old name and icon in the top-left corner until
  // a full page reload. Broadcasting lets the switcher refetch in place.
  const saved = () => {
    onSaved();
    window.dispatchEvent(new Event('dosya:workspace-changed'));
  };

  const save = async (body: Record<string, unknown>, field: string) => {
    setSaving(field);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/workspaces/${wsId}`, { method: 'PUT', body: JSON.stringify(body) });
      if (res.ok) { toast.success(t('common.feedback.saved'), t('settings.feedback.yourWorkspaceSettingsHaveBeenUpdated')); saved(); } else toast.error(t('common.error.couldnTSave'), res.error ?? t('settings.error.yourWorkspaceSettingsWereNotUpdated'));
    } catch (err) { toast.error(t('common.error.couldnTSave'), apiErrorMessage(err, t('settings.error.couldNotReachTheServerPleaseTryAgain'))); }
    setSaving(null);
  };

  const uploadIcon = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) { toast.error(t('common.error.fileTooLarge'), t('settings.error.theWorkspaceIconMustBe2mbOrSmaller')); return; }
    setSaving('icon');
    try {
      const formData = new FormData();
      formData.append('icon', file); // API reads formData.get('icon')
      const res = await fetch(`${API_BASE}/api/workspaces/${wsId}/icon`, { method: 'POST', body: formData, credentials: 'include' });
      const d = await res.json() as { ok: boolean; icon_image_url?: string; error?: string };
      if (d.ok && d.icon_image_url) {
        setIconUrl(d.icon_image_url);
        setIconVersion(Date.now()); // cache-bust the served image
        toast.success(t('settings.feedback.iconUpdated'), t('settings.feedback.yourNewWorkspaceIconHasBeenUploaded')); saved();
      } else toast.error(t('common.error.uploadFailed'), d.error ?? t('settings.error.theWorkspaceIconCouldNotBeUploaded'));
    } catch { toast.error(t('common.error.uploadFailed'), t('settings.error.theWorkspaceIconCouldNotBeUploaded')); }
    setSaving(null);
  };

  const removeIcon = async () => {
    setSaving('icon');
    try {
      await fetch(`${API_BASE}/api/workspaces/${wsId}/icon`, { method: 'DELETE', credentials: 'include' });
      setIconUrl(null); toast.success(t('settings.feedback.iconRemoved'), t('settings.feedback.yourWorkspaceIconHasBeenRemoved')); saved();
    } catch { toast.error(t('settings.error.couldnTRemoveIcon'), t('settings.error.theWorkspaceIconCouldNotBeRemoved')); }
    setSaving(null);
  };

  return (
    <section id="section-info">
      <SectionHeader title={t('settings.tooltip.workspaceInfo')} desc={t('settings.description.nameIdentityAndBasicConfiguration')} />
      <Card>
        <CardContent className="divide-y">
          <SettingRow label={t('common.label.workspaceName.workspaceName')} desc={t('settings.description.shownInTheSwitcherAndNotifications')}>
            <div className="flex items-center gap-2">
              <Input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="h-8 text-xs w-48" />
              <SaveBtn loading={saving === 'name'} onClick={() => save({ name }, 'name')} disabled={!canName} disabledReason={NO_PERM(t('settings.label.theWorkspaceName'))} />
            </div>
          </SettingRow>

          <SettingRow label={t('settings.label.workspaceIcon')} desc={t('settings.description.uploadAnImageOrUseInitialsWithAColor')}>
            <div className="flex items-center gap-3">
              {/* Preview */}
              <div className={`size-10 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0 overflow-hidden ${iconUrl ? 'bg-muted' : ''}`} style={iconUrl ? undefined : { background: iconColor }}>
                {iconUrl ? <img src={`${API_BASE}/api/workspaces/${wsId}/icon${iconVersion ? `?v=${iconVersion}` : ''}`} alt="" className="w-full h-full object-cover" /> : initials}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5" title={!canIcon ? NO_PERM(t('settings.tooltip.theWorkspaceIcon')) : undefined}>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => fileRef.current?.click()} disabled={saving === 'icon' || !canIcon}>
                    <Upload className="size-3" /> {t('common.action.upload')}
                  </Button>
                  {iconUrl && <Button variant="outline" size="sm" className="h-7 text-xs" onClick={removeIcon} disabled={saving === 'icon' || !canIcon}>{t('common.remove')}</Button>}
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadIcon(e.target.files[0]); e.target.value = ''; }} />
                </div>
                <div className="flex items-center gap-1.5">
                  <Input value={initials} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInitials(e.target.value.slice(0, 3).toUpperCase())} className="h-7 text-xs w-14" maxLength={3} placeholder={t('settings.placeholder.ab')} />
                  <SwatchPicker value={iconColor} onChange={setIconColor} size="sm" disabled={!canIcon} label={t('common.label.workspaceColour')} />
                  <SaveBtn loading={saving === 'initials'} onClick={() => save({ icon_initials: initials, icon_color: iconColor }, 'initials')} disabled={!canIcon} disabledReason={NO_PERM(t('settings.tooltip.theWorkspaceIcon'))} />
                </div>
              </div>
            </div>
          </SettingRow>

          {/* Read-only on purpose: the location was chosen when the workspace
              was created and the API answers 409 to any attempt to change it -
              a control here could only ever fail. */}
          <SettingRow label={t('common.label.location')} desc={t('settings.description.chosenWhenTheWorkspaceWasCreatedEveryFileInThisWorkspace')}>
            {/* regionLabel falls back to the code, so a legacy value would
                otherwise render as "weur (weur)". */}
            <span className="text-xs">{locationLabel}{locationLabel !== locationCode && <span className="text-muted-foreground"> ({locationCode})</span>}</span>
          </SettingRow>

          <BrandingCard wsId={wsId} />
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * The entry point to /settings/branding. Deliberately a card row and not a
 * SETTINGS_NAV entry. Three states: configure, "Starter and up" with a way to
 * the plans, and disabled with the reason. While the state is unknown (loading,
 * or the request failed) it offers Configure: the page itself shows the truth.
 */
const BRANDING_LINK = 'inline-flex h-7 items-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted';

export function BrandingCard({ wsId }: { wsId: string }) {
  const t = useT();
  const [state, setState] = useState<{ enabled: boolean; revoked: boolean; canEdit: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    api<{ enabled?: boolean; revoked?: boolean; can_edit?: boolean }>(`/api/workspaces/${wsId}/branding`)
      .then((res) => {
        if (live && typeof res?.enabled === 'boolean') setState({ enabled: res.enabled, revoked: !!res.revoked, canEdit: res.can_edit !== false });
      })
      .catch(() => { /* unknown state falls back to Configure */ });
    return () => { live = false; };
  }, [wsId]);

  let action: React.ReactNode;
  let desc = t('settings.description.yourLogoNameAndColourOnSharePagesAndEmail');
  if (state?.revoked) {
    desc = t('settings.description.brandingIsDisabledForThisWorkspaceContactSupport');
    action = <Button variant="outline" size="sm" className="h-7 text-xs" disabled>{t('settings.action.configure')}</Button>;
  } else if (state && !state.enabled) {
    desc = t('settings.description.brandingIsAvailableOnStarterAndUp');
    action = <Link to="/billing" className={BRANDING_LINK}>{t('common.action.seePlans')}</Link>;
  } else if (state && !state.canEdit) {
    desc = t('settings.error.yourRoleCannotChangeBranding');
    action = <Button variant="outline" size="sm" className="h-7 text-xs" disabled>{t('settings.action.configure')}</Button>;
  } else {
    action = <Link to="/settings/branding" className={BRANDING_LINK}>{t('settings.action.configure')}</Link>;
  }

  return <SettingRow label={t('common.label.branding')} desc={desc}>{action}</SettingRow>;
}

// ── Hard Limits ────────────────────────────────────────────

function HardLimitsSection({ data, wsId, onSaved }: { data: WsData; wsId: string; onSaved: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const s = data.settings;
  const { can } = usePermissions();
  const planCap = data.plan_limits?.storage_gb;
  const alloc = data.allocation;
  const savedCap = s?.max_total_storage_gb ?? null;
  // Headroom for THIS workspace's cap: unallocated pool + its own current cap
  const capRemaining = alloc ? Math.max(0, alloc.plan_gb - alloc.allocated_gb + (savedCap ?? 0)) : null;
  const usedBytes = data.workspace.storage_used_bytes ?? 0;
  const overAllocated = !!alloc && alloc.allocated_gb > alloc.plan_gb;
  const overCap = savedCap !== null && usedBytes > savedCap * 1073741824;
  const [limits, setLimits] = useState({
    max_file_size_gb: s?.max_file_size_gb ?? '', max_storage_per_member_gb: s?.max_storage_per_member_gb ?? '',
    max_total_storage_gb: s?.max_total_storage_gb ?? '', max_concurrent_uploads: s?.max_concurrent_uploads ?? '',
    allowed_extensions: s?.allowed_extensions ?? '', blocked_extensions: s?.blocked_extensions ?? '',
  });
  const [saving, setSaving] = useState<string | null>(null);

  const saveLimit = async (field: string) => {
    setSaving(field);
    try {
      const val = (limits as Record<string, unknown>)[field];
      await api(`/api/workspaces/${wsId}/settings`, { method: 'PUT', body: JSON.stringify({ [field]: val === '' ? null : val }) });
      toast.success(t('settings.feedback.limitUpdated'), t('settings.feedback.yourHardLimitHasBeenSaved'));
      onSaved();
    } catch (err) { toast.error(t('common.error.couldnTSave'), apiErrorMessage(err, t('settings.error.yourHardLimitWasNotUpdated'))); }
    setSaving(null);
  };

  const rows = [
    { field: 'max_file_size_gb', label: t('settings.label.maxUploadFileSize'), desc: t('settings.description.singleFileSizeCap'), unit: 'GB', showCap: false },
    { field: 'max_storage_per_member_gb', label: t('settings.label.storagePerMember'), desc: t('settings.description.maxStorageAnySingleMemberCanConsume'), unit: 'GB', showCap: true },
    { field: 'max_total_storage_gb', label: t('settings.label.totalWorkspaceStorageCap'), desc: t('settings.description.hardCeilingAcrossAllMembers'), unit: 'GB', showCap: true },
    { field: 'max_concurrent_uploads', label: t('settings.label.maxSimultaneousUploads'), desc: t('settings.description.recommended5'), unit: 'files', showCap: false },
    { field: 'allowed_extensions', label: t('settings.label.allowedFileTypes'), desc: t('settings.description.commaSeparatedBlankAllowAll'), unit: '', showCap: false },
    { field: 'blocked_extensions', label: t('settings.label.blockedFileTypes'), desc: t('settings.description.alwaysRejected'), unit: '', showCap: false },
  ];

  // Mirrors the API's field → permission mapping
  const LIMIT_PERMS: Record<string, string> = {
    max_file_size_gb: 'change_max_file_size',
    max_storage_per_member_gb: 'change_storage_per_member',
    max_total_storage_gb: 'change_total_storage_cap',
    max_concurrent_uploads: 'change_max_concurrent_uploads',
    allowed_extensions: 'change_allowed_file_types',
    blocked_extensions: 'change_blocked_file_types',
  };

  return (
    <section id="section-limits">
      <SectionHeader title={t('settings.tooltip.hardLimits')} desc={t('settings.description.enforcedCapsOnUploadsAndStorage')} />
      {overAllocated && alloc && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          {t('settings.description.yourWorkspaceStorageLimitsAddUpToAllocallocatedGbGbButYour', { allocAllocated_gb: alloc.allocated_gb, allocPlan_gb: alloc.plan_gb })}
        </div>
      )}
      {overCap && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          {t('settings.description.thisWorkspaceUsesUsedbytesAboveItsSavedcapGbLimitNewUploads', { usedBytes: humanSize(usedBytes), savedCap })}
        </div>
      )}
      <Card>
        <CardContent className="divide-y">
          {rows.map((row) => (
            <SettingRow key={row.field} label={row.label} desc={row.desc}>
              <div className="flex items-center gap-2">
                <Input value={String((limits as Record<string, unknown>)[row.field] ?? '')}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLimits((prev) => ({ ...prev, [row.field]: e.target.value }))}
                  className="h-8 text-xs w-24" type={row.unit ? 'number' : 'text'} placeholder={row.unit ? '0' : t('settings.placeholder.eGExeBat')} />
                {row.unit && <span className="text-[11px] text-muted-foreground">{row.unit}</span>}
                {row.showCap && row.field !== 'max_total_storage_gb' && planCap && <Badge variant="outline" className="text-[9px] text-muted-foreground">{t('settings.status.planMaxPlancapGb', { planCap })}</Badge>}
                {row.field === 'max_total_storage_gb' && capRemaining !== null && <Badge variant="outline" className="text-[9px] text-muted-foreground">{t('settings.status.capremainingGbLeftToAllocate', { capRemaining })}</Badge>}
                <SaveBtn loading={saving === row.field} onClick={() => saveLimit(row.field)}
                  disabled={!can(LIMIT_PERMS[row.field])}
                  disabledReason={NO_PERM(row.label.toLocaleLowerCase(locale))} />
              </div>
            </SettingRow>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

// ── Security ───────────────────────────────────────────────

// Option tables hold catalog keys; the label translates at render.
type Opt = { value: string; labelKey: MessageKey };
const SESSION_TIMEOUT_OPTIONS: Opt[] = [
  { value: '', labelKey: 'settings.label.noTimeout' }, { value: '15', labelKey: 'settings.label.15Min' }, { value: '30', labelKey: 'sync.label.thirtyMin' },
  { value: '60', labelKey: 'common.label.oneHour' }, { value: '240', labelKey: 'sync.label.fourHours' }, { value: '480', labelKey: 'sync.label.eightHours' }, { value: '1440', labelKey: 'common.label.24Hours' },
];
const SHARE_EXPIRY_OPTIONS: Opt[] = [
  { value: '', labelKey: 'settings.label.noLimit' }, { value: '1', labelKey: 'common.label.oneDay' }, { value: '7', labelKey: 'common.label.sevenDays' },
  { value: '30', labelKey: 'common.label.thirtyDays' }, { value: '90', labelKey: 'common.label.ninetyDays' }, { value: '365', labelKey: 'settings.label.1Year' },
];
// What the share modal starts on. Distinct from the cap above: a default is
// a suggestion the sharer can change, a cap clamps every link.
const SHARE_DEFAULT_EXPIRY_OPTIONS: Opt[] = [
  { value: '', labelKey: 'settings.label.7DaysStandard' }, { value: '1', labelKey: 'common.label.oneDay' }, { value: '7', labelKey: 'common.label.sevenDays' },
  { value: '30', labelKey: 'common.label.thirtyDays' }, { value: '90', labelKey: 'common.label.ninetyDays' }, { value: '365', labelKey: 'settings.label.1Year' },
];

// Exported for its tests.
export function SecuritySection({ data, wsId, onSaved }: { data: WsData; wsId: string; onSaved: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const optionItems = (opts: Opt[]) => opts.map((o) => ({ value: o.value, label: t(o.labelKey) }));
  const s = data.settings;
  const { can } = usePermissions();
  const canManageSec = can('manage_settings');
  // `require_2fa` and `disable_password_login` still exist on the API row but
  // are not offered here: the server stores them and enforces neither, and a
  // toggle that changes nothing is worse than no toggle.
  const [toggles, setToggles] = useState({
    disable_share_links: s?.disable_share_links === 1, force_share_password: s?.force_share_password === 1,
    record_upload_origin: s?.record_upload_origin !== 0,
  });
  const [sessionTimeout, setSessionTimeout] = useState(s?.session_timeout_minutes != null ? String(s.session_timeout_minutes) : '');
  const [shareExpiry, setShareExpiry] = useState(s?.share_max_expiry_days != null ? String(s.share_max_expiry_days) : '');
  const [shareDefaultExpiry, setShareDefaultExpiry] = useState(s?.default_share_expiry_days != null ? String(s.default_share_expiry_days) : '');
  const [downloadRate, setDownloadRate] = useState(s?.download_rate_limit != null ? String(s.download_rate_limit) : '');
  const [saving, setSaving] = useState<string | null>(null);

  // List modals
  const [listModal, setListModal] = useState<{ field: string; titleKey: MessageKey; placeholder: string } | null>(null);
  const [listItems, setListItems] = useState<string[]>([]);
  const [listInput, setListInput] = useState('');

  const saveSetting = async (field: string, value: unknown) => {
    setSaving(field);
    try {
      await api(`/api/workspaces/${wsId}/settings`, { method: 'PUT', body: JSON.stringify({ [field]: value }) });
      // The share modal memoises this workspace's default expiry for the
      // session; without this the admin who just changed it keeps sharing
      // with the old pre-fill until they reload.
      clearShareDefaultsCache();
      toast.success(t('settings.feedback.settingsUpdated'), t('settings.feedback.yourSecuritySettingHasBeenSaved'));
    } catch (err) { toast.error(t('common.error.couldnTSave'), apiErrorMessage(err, t('settings.error.yourSecuritySettingWasNotUpdated'))); }
    setSaving(null);
  };

  const openListModal = (field: string, titleKey: MessageKey, placeholder: string) => {
    const raw = (s as unknown as Record<string, unknown>)?.[field] as string | null;
    let items: string[] = [];
    try { items = JSON.parse(raw || '[]'); } catch {}
    setListItems(items);
    setListInput('');
    setListModal({ field, titleKey, placeholder });
  };

  const addListItem = () => {
    const v = listInput.trim();
    if (!v || listItems.includes(v)) return;
    setListItems((prev) => [...prev, v]);
    setListInput('');
  };

  const saveList = async () => {
    if (!listModal) return;
    setSaving(listModal.field);
    try {
      await api(`/api/workspaces/${wsId}/settings`, { method: 'PUT', body: JSON.stringify({ [listModal.field]: JSON.stringify(listItems) }) });
      toast.success(t('settings.feedback.listUpdated'), t('settings.feedback.yourAccessListHasBeenSaved')); onSaved(); setListModal(null);
    } catch (err) { toast.error(t('common.error.couldnTSave'), apiErrorMessage(err, t('settings.error.yourAccessListWasNotUpdated'))); }
    setSaving(null);
  };

  const getListCount = (field: string) => {
    try { return JSON.parse((s as unknown as Record<string, unknown>)?.[field] as string || '[]').length; } catch { return 0; }
  };

  const toggleItems = [
    { field: 'disable_share_links', label: t('settings.label.disablePublicShareLinks'), desc: t('settings.description.blockAllShareLinkCreation') },
    { field: 'force_share_password', label: t('settings.label.forcePasswordOnShareLinks'), desc: t('settings.description.everyShareLinkMustHaveAPassword') },
    { field: 'record_upload_origin', label: t('settings.label.recordUploadOriginLocation'), desc: t('settings.description.fallBackToTheUploaderSApproximateIpBasedLocationOnTheMap') },
  ];

  const listItems2: { field: string; labelKey: MessageKey; desc: string; placeholder: string }[] = [
    { field: 'ip_allowlist', labelKey: 'settings.label.ipAllowlist', desc: t('settings.description.onlyTheseIpsCanAccess'), placeholder: '192.168.1.0/24' },
    { field: 'ip_blocklist', labelKey: 'settings.label.ipBlocklist', desc: t('settings.description.blockSpecificIps'), placeholder: '10.0.0.1' },
    { field: 'country_allowlist', labelKey: 'settings.label.countryAllowlist', desc: t('settings.description.onlyTheseCountriesAllowed'), placeholder: t('settings.label.us') },
    { field: 'country_blocklist', labelKey: 'settings.label.countryBlocklist', desc: t('settings.description.blockTheseCountries'), placeholder: t('settings.label.cn') },
    { field: 'allowed_email_domains', labelKey: 'settings.label.allowedEmailDomains', desc: t('settings.description.onlyTheseEmailDomainsCanJoin'), placeholder: 'company.com' },
  ];

  return (
    <section id="section-security">
      <SectionHeader title={t('settings.tooltip.security')} desc={t('settings.description.accessControlsAuthenticationRulesAndFileProtection')} />

      {/* Toggles */}
      <Card className="mb-4">
        <CardContent className="divide-y">
          {toggleItems.map((item) => (
            <SettingRow key={item.field} label={item.label} desc={item.desc}>
              <button
                className={`relative w-9 h-5 rounded-full transition-colors ${(toggles as Record<string, boolean>)[item.field] ? 'bg-green-600' : 'bg-muted'} ${!canManageSec ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!canManageSec}
                title={!canManageSec ? NO_PERM(t('settings.action.securitySettings')) : undefined}
                onClick={() => { const nv = !(toggles as Record<string, boolean>)[item.field]; setToggles((p) => ({ ...p, [item.field]: nv })); saveSetting(item.field, nv ? 1 : 0); }}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${(toggles as Record<string, boolean>)[item.field] ? 'inset-s-4.5' : 'inset-s-0.5'}`} />
              </button>
            </SettingRow>
          ))}
        </CardContent>
      </Card>

      {/* Selects */}
      <Card className="mb-4">
        <CardContent className="divide-y">
          <SettingRow label={t('settings.label.sessionTimeout')} desc={t('settings.description.autoLogoutAfterInactivity')}>
            <div className="flex items-center gap-2">
              <Select value={sessionTimeout} onValueChange={(v) => setSessionTimeout(v as string)} items={optionItems(SESSION_TIMEOUT_OPTIONS)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SESSION_TIMEOUT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>)}
                </SelectContent>
              </Select>
              <SaveBtn loading={saving === 'session_timeout'} onClick={() => saveSetting('session_timeout_minutes', sessionTimeout || null)} disabled={!canManageSec} disabledReason={NO_PERM(t('settings.label.theSessionTimeout'))} />
            </div>
          </SettingRow>
          <SettingRow label={t('settings.label.shareLinkMaxExpiry')} desc={t('settings.description.capHowLongShareLinksCanLive')}>
            <div className="flex items-center gap-2">
              <Select value={shareExpiry} onValueChange={(v) => setShareExpiry(v as string)} items={optionItems(SHARE_EXPIRY_OPTIONS)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHARE_EXPIRY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>)}
                </SelectContent>
              </Select>
              <SaveBtn loading={saving === 'share_max_expiry_days'} onClick={() => saveSetting('share_max_expiry_days', shareExpiry || null)} disabled={!canManageSec} disabledReason={NO_PERM(t('settings.label.theShareLinkExpiryCap'))} />
            </div>
          </SettingRow>
          <SettingRow label={t('settings.label.defaultShareLinkExpiry')} desc={t('settings.description.whatNewShareLinksStartWithAnyoneSharingCanStillChange')}>
            <div className="flex items-center gap-2">
              <Select value={shareDefaultExpiry} onValueChange={(v) => setShareDefaultExpiry(v as string)} items={optionItems(SHARE_DEFAULT_EXPIRY_OPTIONS)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHARE_DEFAULT_EXPIRY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>)}
                </SelectContent>
              </Select>
              <SaveBtn loading={saving === 'default_share_expiry_days'} onClick={() => saveSetting('default_share_expiry_days', shareDefaultExpiry || null)} disabled={!canManageSec} disabledReason={NO_PERM(t('settings.label.theDefaultShareLinkExpiry'))} />
            </div>
          </SettingRow>
          <SettingRow label={t('settings.label.downloadRateLimit')} desc={t('settings.description.maxDownloadsPerUserPerHour')}>
            <div className="flex items-center gap-2">
              <Input value={downloadRate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDownloadRate(e.target.value)} type="number" className="h-8 text-xs w-24" placeholder="100" />
              <span className="text-[11px] text-muted-foreground">{t('settings.label.hour')}</span>
              <SaveBtn loading={saving === 'download_rate'} onClick={() => saveSetting('download_rate_limit', downloadRate || null)} />
            </div>
          </SettingRow>
        </CardContent>
      </Card>

      {/* Access lists */}
      <Card>
        <CardContent className="divide-y">
          {listItems2.map((item) => {
            const count = getListCount(item.field);
            const itemLabel = t(item.labelKey);
            return (
              <SettingRow key={item.field} label={itemLabel} desc={item.desc}>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">{count === 0 ? t('settings.status.none') : t('settings.status.countEntries', { count })}</Badge>
                  <span title={!canManageSec ? NO_PERM(itemLabel.toLocaleLowerCase(locale)) : undefined} className={!canManageSec ? 'cursor-not-allowed' : ''}>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openListModal(item.field, item.labelKey, item.placeholder)} disabled={!canManageSec}>{t('common.action.manage')}</Button>
                  </span>
                </div>
              </SettingRow>
            );
          })}
        </CardContent>
      </Card>

      {/* List management modal */}
      <Dialog open={!!listModal} onOpenChange={() => setListModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{listModal ? t(listModal.titleKey) : null}</DialogTitle></DialogHeader>
          <div className="flex gap-2">
            <Input value={listInput} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setListInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addListItem()}
              placeholder={listModal?.placeholder} className="h-8 text-xs flex-1" />
            <Button size="sm" className="h-8 text-xs" onClick={addListItem}><Plus className="size-3" /></Button>
          </div>
          <div className="max-h-48 overflow-y-auto border rounded-lg">
            {listItems.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{t('settings.label.noEntries')}</p>
            ) : listItems.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 text-xs border-b last:border-b-0">
                <span className="font-mono">{item}</span>
                <button onClick={() => setListItems((prev) => prev.filter((_, j) => j !== i))}><X className="size-3 text-muted-foreground hover:text-destructive" /></button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setListModal(null)}>{t('common.cancel')}</Button>
            <Button onClick={saveList} disabled={saving === listModal?.field}>{saving === listModal?.field && <Loader2 className="size-4 animate-spin me-1.5" />}{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ── Roles ──────────────────────────────────────────────────

export function RolesSection({ data }: { data: WsData; wsId: string; onSaved: () => void }) {
  const t = useT();
  const roles = data.roles ?? [];
  const perms = data.permissions ?? {};
  // PUT /api/roles/:id refuses the role the caller holds ("You cannot edit
  // your own role"), so that column gets View, like a built-in.
  const { roleId: myRoleId } = usePermissions();
  // Built-in vs custom used to be decided by NAME, so a custom role called
  // "Viewer" was shown as uneditable. /api/roles says which is which.
  const canEdit = (r: { id: string; is_builtin: boolean }) => !r.is_builtin && r.id !== myRoleId;

  return (
    <section id="section-roles">
      <SectionHeader title={t('settings.tooltip.rolesPermissions')} desc={t('settings.description.manageAccessLevelsForYourWorkspaceMembers')} />
      <Card>
        <CardContent>
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="h-auto py-2 px-3 text-muted-foreground">{t('common.label.permission')}</TableHead>
                {roles.map((r) => (
                  <TableHead key={r.id} className="h-auto text-center py-2 px-2">
                    <div className="flex flex-col items-center gap-1">
                      <span>{r.name}</span>
                      {canEdit(r) ? (
                        <Link to={`/role-create?edit=${r.id}`} className="text-[9px] text-muted-foreground hover:text-foreground underline">{t('common.edit')}</Link>
                      ) : (
                        <Link to={`/role-create?view=${r.id}`} className="text-[9px] text-muted-foreground hover:text-foreground underline">{t('common.view')}</Link>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERM_GROUPS.map((g) => (
                <Fragment key={g.groupKey}>
                  <TableRow>
                    <TableCell colSpan={roles.length + 1} className="py-1.5 px-3 bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t(g.groupKey)}
                    </TableCell>
                  </TableRow>
                  {g.perms.map(([perm, labelKey]) => (
                    <TableRow key={perm}>
                      <TableCell className="py-2 px-3 text-muted-foreground">{t(labelKey)}</TableCell>
                      {roles.map((r) => (
                        <TableCell key={r.id} className="text-center py-2 px-2">
                          {perms[r.id]?.[perm] ? (
                            <div className="w-5 h-5 rounded bg-green-100 dark:bg-green-950 flex items-center justify-center mx-auto"><Check className="size-3 text-green-600" /></div>
                          ) : (
                            <div className="w-5 h-5 rounded bg-muted flex items-center justify-center mx-auto"><span className="text-muted-foreground text-[10px]">-</span></div>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 pt-3 border-t">
            <Link to="/role-create"><Button variant="outline" size="sm" className="text-xs gap-1.5"><Plus className="size-3" /> {t('settings.action.addRole')}</Button></Link>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ── Danger Zone ────────────────────────────────────────────

function DangerSection({ data, wsId, isOwner, navigate, onSaved }: { data: WsData; wsId: string; isOwner: boolean; navigate: (path: string) => void; onSaved: () => void }) {
  const t = useT();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const members = data.members ?? [];

  const handleLeave = async () => {
    setActing(true);
    try { const res = await api<{ ok: boolean }>(`/api/workspaces/${wsId}/leave`, { method: 'POST' }); if (res.ok) { toast.success(t('settings.feedback.leftWorkspace'), t('settings.feedback.youNoLongerHaveAccessToThisWorkspace')); navigate('/'); } } catch { toast.error(t('settings.error.couldnTLeave'), t('settings.error.youWereNotAbleToLeaveThisWorkspace')); }
    setActing(false);
  };

  /**
   * Deletion itself lives in DeleteWorkspaceDialog: it is a three-step gate
   * (review the damage, enter a mailed code, retype the name), not something
   * this button can complete on its own.
   */
  const handleDeleted = (pending: boolean) => {
    toast.success(pending ? t('settings.feedback.workspaceDeletionStarted') : t('settings.feedback.workspaceDeleted'), pending
      ? t('settings.feedback.theWorkspaceIsUnavailableItsFilesAreBeingRemovedInThe')
      : t('settings.feedback.theWorkspaceAndAllItsFilesHaveBeenRemoved'));
    navigate('/');
  };

  const handleTransfer = async () => {
    if (!transferTarget) return;
    setActing(true);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/workspaces/${wsId}/transfer`, { method: 'POST', body: JSON.stringify({ user_id: transferTarget }) });
      if (res.ok) { toast.success(t('settings.feedback.ownershipTransferred'), t('settings.feedback.theSelectedMemberIsNowTheWorkspaceOwner')); setTransferOpen(false); onSaved(); }
      else toast.error(t('lan-transfer.error.transferFailed'), res.error ?? t('settings.error.ownershipCouldNotBeTransferred'));
    } catch { toast.error(t('lan-transfer.error.transferFailed'), t('settings.error.ownershipCouldNotBeTransferred')); }
    setActing(false);
  };

  return (
    <section id="section-danger">
      <SectionHeader title={t('settings.tooltip.dangerZone')} desc={t('settings.description.irreversibleActionsTreadCarefully')} danger />
      <Card className="border-destructive/30">
        <CardContent className="divide-y divide-destructive/20">
          {isOwner && (
            <div className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium">{t('settings.label.transferOwnership')}</p>
                <p className="text-xs text-muted-foreground">{t('settings.description.handThisWorkspaceToAnotherMember')}</p>
              </div>
              <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setTransferOpen(true)}>
                <ArrowRightLeft className="size-3.5 me-1.5" /> {t('settings.action.transfer')}
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between py-4">
            <div><p className="text-sm font-medium">{t('settings.heading.leaveWorkspace')}</p><p className="text-xs text-muted-foreground">{t('settings.description.youWillLoseAccessImmediately')}</p></div>
            <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setConfirmLeave(true)}><LogOut className="size-3.5 me-1.5 rtl:-scale-x-100" /> {t('common.action.leave')}</Button>
          </div>
          {isOwner && (
            <div className="flex items-center justify-between py-4">
              <div><p className="text-sm font-medium">{t('settings.heading.deleteWorkspace')}</p><p className="text-xs text-muted-foreground">{t('settings.description.permanentlyDeletesAllFilesMembersAndLinks')}</p></div>
              <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}><Trash2 className="size-3.5 me-1.5" /> {t('common.delete')}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transfer modal */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('settings.heading.transferOwnership')}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground mb-2">{t('settings.description.selectAMemberToBecomeTheNewOwnerYouWillBecome')}</p>
          <div className="max-h-48 overflow-y-auto border rounded-lg">
            {members.filter((m) => m.role_id !== 'role_owner').map((m) => (
              <button key={m.membership_id}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs border-b last:border-b-0 hover:bg-muted/50 text-start ${transferTarget === m.user_id ? 'bg-green-50 dark:bg-green-950/30' : ''}`}
                onClick={() => setTransferTarget(m.user_id)}>
                <span className="flex-1 truncate font-medium">{m.name}</span>
                <span className="text-muted-foreground truncate">{m.email}</span>
                {transferTarget === m.user_id && <Check className="size-3 text-green-600 shrink-0" />}
              </button>
            ))}
            {members.filter((m) => m.role_id !== 'role_owner').length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">{t('settings.description.noOtherMembersToTransferTo')}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleTransfer} disabled={acting || !transferTarget}>{acting && <Loader2 className="size-4 animate-spin me-1.5" />}{t('settings.action.transferOwnership')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('settings.heading.leaveWorkspace.leaveWorkspace')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('settings.description.youWillLoseAccessToAllFilesImmediately')}</p>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmLeave(false)}>{t('common.cancel')}</Button><Button variant="destructive" onClick={handleLeave} disabled={acting}>{acting && <Loader2 className="size-4 animate-spin me-1.5" />}{t('common.action.leave')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteWorkspaceDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        workspaceId={wsId}
        onDeleted={handleDeleted}
      />
    </section>
  );
}

// ── Shared Components ──────────────────────────────────────

function SectionHeader({ title, desc, danger }: { title: string; desc: string; danger?: boolean }) {
  return <div className="mb-3"><h2 className={`text-base font-semibold ${danger ? 'text-destructive' : ''}`}>{title}</h2><p className="text-xs text-muted-foreground mt-0.5">{desc}</p></div>;
}

function SettingRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between py-4 gap-4"><div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground mt-0.5">{desc}</p></div><div className="shrink-0">{children}</div></div>;
}

function SaveBtn({ loading, onClick, disabled, disabledReason }: { loading: boolean; onClick: () => void; disabled?: boolean; disabledReason?: string }) {
  const t = useT();
  const btn = (
    <Button size="sm" className="h-7 text-xs gap-1" onClick={onClick} disabled={loading || disabled}>
      {loading ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}{t('common.save')}
    </Button>
  );
  // Disabled buttons swallow pointer events, so the tooltip lives on a wrapper
  if (disabled && disabledReason) return <span title={disabledReason} className="cursor-not-allowed">{btn}</span>;
  return btn;
}

function SettingsSkeleton() {
  return <div className="p-6 space-y-6"><div className="space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-64" /></div>{[1, 2, 3].map((i) => <Card key={i}><CardContent className="pt-6 space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></CardContent></Card>)}</div>;
}
