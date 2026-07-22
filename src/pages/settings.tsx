import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, apiErrorMessage, ApiError, API_BASE } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
  Info, Shield, Users, AlertTriangle, Check, Loader2, Save,
  Lock, Trash2, LogOut, Upload, X, Plus, ArrowRightLeft,
} from 'lucide-react';
import { toast } from '@/lib/toast';


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
  available_regions: string | null;
  session_timeout_minutes: number | null;
  download_rate_limit: number | null;
  disable_share_links: number;
  force_share_password: number;
  share_max_expiry_days: number | null;
  require_2fa: number;
  disable_password_login: number;
  record_upload_origin: number;
}

interface WsData {
  workspace: { id: string; name: string; icon_initials: string; icon_color: string; icon_image_url: string | null; default_region: string; plan: string };
  settings: WsSettings | null;
  is_owner: boolean;
  plan: string;
  plan_limits?: { storage_gb?: number };
  roles: { id: string; name: string; is_default: number }[];
  permissions: Record<string, { [perm: string]: boolean }>;
  /** Shape mirrors /api/team: the row id is `membership_id`; there is no `id`. */
  members?: { membership_id: string; user_id: string; name: string; email: string; role_id: string }[];
  /** Current user's permission map — used to disable controls up front */
  my_permissions?: Record<string, boolean>;
}

/** True when the current user may perform `perm`. Unknown map → optimistic
 *  (controls stay enabled; the API remains the authority). */
function canPerm(data: WsData, perm: string): boolean {
  if (!data.my_permissions) return true;
  return data.my_permissions[perm] ?? false;
}
const NO_PERM = (what: string) => `You don't have permission to change ${what}.`;

interface RegionInfo { code: string; city: string; country: string; continent?: string }

const ICON_COLORS = ['#22c55e', '#7C3AED', '#3b82f6', '#f59e0b', '#06b6d4', '#ec4899', '#1a1917'];
const PERM_LABELS: Record<string, string> = {
  upload_files: 'Upload files', download_files: 'Download files', delete_own_files: 'Delete own files',
  delete_any_file: 'Delete any file', share_files: 'Share files', create_folders: 'Create folders',
  manage_members: 'Manage members', manage_settings: 'Manage settings', manage_roles: 'Manage roles',
  view_activity: 'View activity', hide_files: 'Hide files',
};

const NAV = [
  { id: 'info', label: 'Workspace info', icon: Info, group: 'General' },
  { id: 'limits', label: 'Hard limits', icon: Shield, group: 'General' },
  { id: 'security', label: 'Security', icon: Lock, group: 'General' },
  { id: 'roles', label: 'Roles & permissions', icon: Users, group: 'Members' },
  { id: 'danger', label: 'Danger zone', icon: AlertTriangle, group: 'Danger', danger: true },
];

// ── Page ───────────────────────────────────────────────────

export default function SettingsPage() {
  const navigate = useNavigate();
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [data, setData] = useState<WsData | null>(null);
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('info');

  const load = useCallback(async () => {
    if (!wsId) return;
    try {
      const [wsRes, regRes, rolesRes, teamRes] = await Promise.all([
        api<{ ok: boolean } & WsData>(`/api/workspaces/${wsId}`),
        api<{ ok: boolean; regions: RegionInfo[] }>('/api/regions'),
        api<{ ok: boolean; roles: { id: string; name: string; is_default: number; is_builtin: boolean; is_custom: boolean; permissions: Record<string, boolean> }[] }>(`/api/roles?workspace_id=${wsId}`),
        api<{ ok: boolean; members?: { membership_id: string; user_id: string; name: string; email: string; role_id: string; is_you?: boolean }[] }>(`/api/team?workspace_id=${wsId}`),
      ]);
      if (wsRes.ok) {
        const d = wsRes;
        // Merge roles + permissions from /api/roles into workspace data
        if (rolesRes.ok && rolesRes.roles) {
          d.roles = rolesRes.roles.map((r) => ({ id: r.id, name: r.name, is_default: r.is_default ?? 0 }));
          d.permissions = {};
          rolesRes.roles.forEach((r) => { d.permissions[r.id] = r.permissions; });
        }
        if (teamRes.ok && teamRes.members) {
          d.members = teamRes.members;
          // Resolve the current user's permissions so controls can disable up front
          const me = teamRes.members.find((m) => m.is_you);
          if (me && d.permissions?.[me.role_id]) d.my_permissions = d.permissions[me.role_id];
        }
        setData(d);
      }
      if (regRes.ok) setRegions(regRes.regions);
    } catch {}
    setLoading(false);
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <SettingsSkeleton />;
  if (!data) return <div className="p-6 text-center text-muted-foreground">Failed to load settings</div>;

  return (
    <div className="flex h-full overflow-hidden">
      <nav className="w-52 shrink-0 border-r p-4 overflow-y-auto hidden md:block">
        {['General', 'Members', 'Danger'].map((group) => (
          <div key={group} className="mb-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{group}</p>
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
          <h1 className="text-xl font-bold tracking-tight">Workspace settings</h1>
          <p className="text-sm text-muted-foreground mt-1">{data.workspace.name} · you are {data.is_owner ? 'the owner' : 'a member'}</p>
        </div>
        <WorkspaceInfoSection data={data} wsId={wsId} regions={regions} onSaved={load} />
        <HardLimitsSection data={data} wsId={wsId} />
        <SecuritySection data={data} wsId={wsId} onSaved={load} />
        <RolesSection data={data} wsId={wsId} onSaved={load} />
        <DangerSection data={data} wsId={wsId} isOwner={data.is_owner} navigate={navigate} onSaved={load} />
      </div>
    </div>
  );
}

// ── Workspace Info ─────────────────────────────────────────

function WorkspaceInfoSection({ data, wsId, regions, onSaved }: { data: WsData; wsId: string; regions: RegionInfo[]; onSaved: () => void }) {
  const [name, setName] = useState(data.workspace.name);
  const [region, setRegion] = useState(data.workspace.default_region);
  const [initials, setInitials] = useState(data.workspace.icon_initials);
  const [iconColor, setIconColor] = useState(data.workspace.icon_color);
  const [iconUrl, setIconUrl] = useState(data.workspace.icon_image_url);
  const [iconVersion, setIconVersion] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [regionsModalOpen, setRegionsModalOpen] = useState(false);
  const [availableRegions, setAvailableRegions] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(data.settings?.available_regions || '[]')); } catch { return new Set(); }
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const canName = canPerm(data, 'change_workspace_name');
  const canIcon = canPerm(data, 'change_workspace_icon');
  const canRegion = canPerm(data, 'change_workspace_region');
  const canManage = canPerm(data, 'manage_settings');

  const save = async (body: Record<string, unknown>, field: string) => {
    setSaving(field);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/workspaces/${wsId}`, { method: 'PUT', body: JSON.stringify(body) });
      if (res.ok) { toast.success('Saved', 'Your workspace settings have been updated.'); onSaved(); } else toast.error('Couldn\'t save', res.error ?? 'Your workspace settings were not updated.');
    } catch (err) { toast.error('Couldn\'t save', apiErrorMessage(err, 'Could not reach the server. Please try again.')); }
    setSaving(null);
  };

  const uploadIcon = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) { toast.error('File too large', 'The workspace icon must be 2MB or smaller.'); return; }
    setSaving('icon');
    try {
      const formData = new FormData();
      formData.append('icon', file); // API reads formData.get('icon')
      const res = await fetch(`${API_BASE}/api/workspaces/${wsId}/icon`, { method: 'POST', body: formData, credentials: 'include' });
      const d = await res.json() as { ok: boolean; icon_image_url?: string; error?: string };
      if (d.ok && d.icon_image_url) {
        setIconUrl(d.icon_image_url);
        setIconVersion(Date.now()); // cache-bust the served image
        toast.success('Icon updated', 'Your new workspace icon has been uploaded.'); onSaved();
      } else toast.error('Upload failed', d.error ?? 'The workspace icon could not be uploaded.');
    } catch { toast.error('Upload failed', 'The workspace icon could not be uploaded.'); }
    setSaving(null);
  };

  const removeIcon = async () => {
    setSaving('icon');
    try {
      await fetch(`${API_BASE}/api/workspaces/${wsId}/icon`, { method: 'DELETE', credentials: 'include' });
      setIconUrl(null); toast.success('Icon removed', 'Your workspace icon has been removed.'); onSaved();
    } catch { toast.error('Couldn\'t remove icon', 'The workspace icon could not be removed.'); }
    setSaving(null);
  };

  const saveRegions = async () => {
    setSaving('regions');
    try {
      await api(`/api/workspaces/${wsId}/settings`, { method: 'PUT', body: JSON.stringify({ available_regions: JSON.stringify([...availableRegions]) }) });
      toast.success('Regions updated', 'Your available upload regions have been saved.'); setRegionsModalOpen(false); onSaved();
    } catch (err) {
      toast.error('Couldn\'t save', err instanceof ApiError && err.status === 403
        ? 'You don\'t have permission to change the workspace regions.'
        : apiErrorMessage(err, 'Your available regions were not updated.'));
    }
    setSaving(null);
  };

  return (
    <section id="section-info">
      <SectionHeader title="Workspace info" desc="Name, identity and basic configuration." />
      <Card>
        <CardContent className="divide-y">
          <SettingRow label="Workspace name" desc="Shown in the switcher and notifications.">
            <div className="flex items-center gap-2">
              <Input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="h-8 text-xs w-48" />
              <SaveBtn loading={saving === 'name'} onClick={() => save({ name }, 'name')} disabled={!canName} disabledReason={NO_PERM('the workspace name')} />
            </div>
          </SettingRow>

          <SettingRow label="Workspace icon" desc="Upload an image or use initials with a color.">
            <div className="flex items-center gap-3">
              {/* Preview */}
              <div className={`size-10 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0 overflow-hidden ${iconUrl ? 'bg-muted' : ''}`} style={iconUrl ? undefined : { background: iconColor }}>
                {iconUrl ? <img src={`${API_BASE}/api/workspaces/${wsId}/icon${iconVersion ? `?v=${iconVersion}` : ''}`} alt="" className="w-full h-full object-cover" /> : initials}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5" title={!canIcon ? NO_PERM('the workspace icon') : undefined}>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => fileRef.current?.click()} disabled={saving === 'icon' || !canIcon}>
                    <Upload className="size-3" /> Upload
                  </Button>
                  {iconUrl && <Button variant="outline" size="sm" className="h-7 text-xs" onClick={removeIcon} disabled={saving === 'icon' || !canIcon}>Remove</Button>}
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadIcon(e.target.files[0]); e.target.value = ''; }} />
                </div>
                <div className="flex items-center gap-1.5">
                  <Input value={initials} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInitials(e.target.value.slice(0, 3).toUpperCase())} className="h-7 text-xs w-14" maxLength={3} placeholder="AB" />
                  {ICON_COLORS.map((c) => (
                    <button key={c} onClick={() => setIconColor(c)} className={`size-5 rounded-full ${iconColor === c ? 'ring-2 ring-offset-1 ring-foreground' : ''}`} style={{ background: c }} />
                  ))}
                  <SaveBtn loading={saving === 'initials'} onClick={() => save({ icon_initials: initials, icon_color: iconColor }, 'initials')} disabled={!canIcon} disabledReason={NO_PERM('the workspace icon')} />
                </div>
              </div>
            </div>
          </SettingRow>

          <SettingRow label="Default upload region" desc="Members can override per upload.">
            <div className="flex items-center gap-2">
              <Select value={region} onValueChange={(v) => setRegion(v as string)} items={regions.map((r) => ({ value: r.code, label: `${r.code} (${r.city})` }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {regions.map((r) => <SelectItem key={r.code} value={r.code}>{r.code} ({r.city})</SelectItem>)}
                </SelectContent>
              </Select>
              <SaveBtn loading={saving === 'region'} onClick={() => save({ default_region: region }, 'region')} disabled={!canRegion} disabledReason={NO_PERM('the default upload region')} />
            </div>
          </SettingRow>

          <SettingRow label="Available regions" desc="Restrict which regions members can upload to.">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">{availableRegions.size === 0 ? 'All' : `${availableRegions.size} selected`}</Badge>
              <span title={!canManage ? NO_PERM('the workspace regions') : undefined} className={!canManage ? 'cursor-not-allowed' : ''}>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setRegionsModalOpen(true)} disabled={!canManage}>Manage</Button>
              </span>
            </div>
          </SettingRow>
        </CardContent>
      </Card>

      {/* Regions modal */}
      <Dialog open={regionsModalOpen} onOpenChange={setRegionsModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Available regions</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground mb-2">Uncheck regions to restrict. Empty = all allowed.</p>
          <div className="max-h-64 overflow-y-auto border rounded-lg">
            {regions.map((r) => (
              <label key={r.code} className="flex items-center gap-2.5 px-3 py-2 text-xs border-b last:border-b-0 hover:bg-muted/50 cursor-pointer">
                <Checkbox className="size-4" checked={availableRegions.size === 0 || availableRegions.has(r.code)}
                  onCheckedChange={() => { setAvailableRegions((prev) => { const next = new Set(prev); if (next.has(r.code)) next.delete(r.code); else next.add(r.code); return next; }); }} />
                <span className="flex-1">{r.code}</span>
                <span className="text-muted-foreground">{r.city}, {r.country}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegionsModalOpen(false)}>Cancel</Button>
            <Button onClick={saveRegions} disabled={saving === 'regions'}>{saving === 'regions' && <Loader2 className="size-4 animate-spin mr-1.5" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ── Hard Limits ────────────────────────────────────────────

function HardLimitsSection({ data, wsId }: { data: WsData; wsId: string }) {
  const s = data.settings;
  const planCap = data.plan_limits?.storage_gb;
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
      toast.success('Limit updated', 'Your hard limit has been saved.');
    } catch (err) { toast.error('Couldn\'t save', apiErrorMessage(err, 'Your hard limit was not updated.')); }
    setSaving(null);
  };

  const rows = [
    { field: 'max_file_size_gb', label: 'Max upload file size', desc: 'Single file size cap.', unit: 'GB', showCap: false },
    { field: 'max_storage_per_member_gb', label: 'Storage per member', desc: 'Max storage any single member can consume.', unit: 'GB', showCap: true },
    { field: 'max_total_storage_gb', label: 'Total workspace storage cap', desc: 'Hard ceiling across all members.', unit: 'GB', showCap: true },
    { field: 'max_concurrent_uploads', label: 'Max simultaneous uploads', desc: 'Recommended: 5.', unit: 'files', showCap: false },
    { field: 'allowed_extensions', label: 'Allowed file types', desc: 'Comma-separated. Blank = allow all.', unit: '', showCap: false },
    { field: 'blocked_extensions', label: 'Blocked file types', desc: 'Always rejected.', unit: '', showCap: false },
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
      <SectionHeader title="Hard limits" desc="Enforced caps on uploads and storage." />
      <Card>
        <CardContent className="divide-y">
          {rows.map((row) => (
            <SettingRow key={row.field} label={row.label} desc={row.desc}>
              <div className="flex items-center gap-2">
                <Input value={String((limits as Record<string, unknown>)[row.field] ?? '')}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLimits((prev) => ({ ...prev, [row.field]: e.target.value }))}
                  className="h-8 text-xs w-24" type={row.unit ? 'number' : 'text'} placeholder={row.unit ? '0' : 'e.g. .exe,.bat'} />
                {row.unit && <span className="text-[11px] text-muted-foreground">{row.unit}</span>}
                {row.showCap && planCap && <Badge variant="outline" className="text-[9px] text-muted-foreground">plan max: {planCap} GB</Badge>}
                <SaveBtn loading={saving === row.field} onClick={() => saveLimit(row.field)}
                  disabled={!canPerm(data, LIMIT_PERMS[row.field])}
                  disabledReason={NO_PERM(row.label.toLowerCase())} />
              </div>
            </SettingRow>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

// ── Security ───────────────────────────────────────────────

const SESSION_TIMEOUT_OPTIONS = [
  { value: '', label: 'No timeout' }, { value: '15', label: '15 min' }, { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' }, { value: '240', label: '4 hours' }, { value: '480', label: '8 hours' }, { value: '1440', label: '24 hours' },
];
const SHARE_EXPIRY_OPTIONS = [
  { value: '', label: 'No limit' }, { value: '1', label: '1 day' }, { value: '7', label: '7 days' },
  { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' },
];

function SecuritySection({ data, wsId, onSaved }: { data: WsData; wsId: string; onSaved: () => void }) {
  const s = data.settings;
  const canManageSec = canPerm(data, 'manage_settings');
  const [toggles, setToggles] = useState({
    disable_share_links: s?.disable_share_links === 1, force_share_password: s?.force_share_password === 1,
    require_2fa: s?.require_2fa === 1, disable_password_login: s?.disable_password_login === 1,
    record_upload_origin: s?.record_upload_origin !== 0,
  });
  const [sessionTimeout, setSessionTimeout] = useState(s?.session_timeout_minutes != null ? String(s.session_timeout_minutes) : '');
  const [shareExpiry, setShareExpiry] = useState(s?.share_max_expiry_days != null ? String(s.share_max_expiry_days) : '');
  const [downloadRate, setDownloadRate] = useState(s?.download_rate_limit != null ? String(s.download_rate_limit) : '');
  const [saving, setSaving] = useState<string | null>(null);

  // List modals
  const [listModal, setListModal] = useState<{ field: string; title: string; placeholder: string } | null>(null);
  const [listItems, setListItems] = useState<string[]>([]);
  const [listInput, setListInput] = useState('');

  const saveSetting = async (field: string, value: unknown) => {
    setSaving(field);
    try { await api(`/api/workspaces/${wsId}/settings`, { method: 'PUT', body: JSON.stringify({ [field]: value }) }); toast.success('Settings updated', 'Your security setting has been saved.'); } catch (err) { toast.error('Couldn\'t save', apiErrorMessage(err, 'Your security setting was not updated.')); }
    setSaving(null);
  };

  const openListModal = (field: string, title: string, placeholder: string) => {
    const raw = (s as unknown as Record<string, unknown>)?.[field] as string | null;
    let items: string[] = [];
    try { items = JSON.parse(raw || '[]'); } catch {}
    setListItems(items);
    setListInput('');
    setListModal({ field, title, placeholder });
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
      toast.success('List updated', 'Your access list has been saved.'); onSaved(); setListModal(null);
    } catch (err) { toast.error('Couldn\'t save', apiErrorMessage(err, 'Your access list was not updated.')); }
    setSaving(null);
  };

  const getListCount = (field: string) => {
    try { return JSON.parse((s as unknown as Record<string, unknown>)?.[field] as string || '[]').length; } catch { return 0; }
  };

  const toggleItems = [
    { field: 'disable_share_links', label: 'Disable public share links', desc: 'Block all share link creation.' },
    { field: 'force_share_password', label: 'Force password on share links', desc: 'Every share link must have a password.' },
    { field: 'require_2fa', label: 'Require 2FA for all members', desc: 'Members without 2FA will be prompted.' },
    { field: 'disable_password_login', label: 'Disable password login', desc: 'Force SSO-only login.' },
    { field: 'record_upload_origin', label: 'Record upload-origin location', desc: 'Fall back to the uploader\'s approximate (IP-based) location on the map when a file or folder has no GPS data.' },
  ];

  const listItems2 = [
    { field: 'ip_allowlist', label: 'IP allowlist', desc: 'Only these IPs can access.', placeholder: '192.168.1.0/24' },
    { field: 'ip_blocklist', label: 'IP blocklist', desc: 'Block specific IPs.', placeholder: '10.0.0.1' },
    { field: 'country_allowlist', label: 'Country allowlist', desc: 'Only these countries allowed.', placeholder: 'US' },
    { field: 'country_blocklist', label: 'Country blocklist', desc: 'Block these countries.', placeholder: 'CN' },
    { field: 'allowed_email_domains', label: 'Allowed email domains', desc: 'Only these email domains can join.', placeholder: 'company.com' },
  ];

  return (
    <section id="section-security">
      <SectionHeader title="Security" desc="Access controls, authentication rules, and file protection." />

      {/* Toggles */}
      <Card className="mb-4">
        <CardContent className="divide-y">
          {toggleItems.map((item) => (
            <SettingRow key={item.field} label={item.label} desc={item.desc}>
              <button
                className={`relative w-9 h-5 rounded-full transition-colors ${(toggles as Record<string, boolean>)[item.field] ? 'bg-green-600' : 'bg-muted'} ${!canManageSec ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!canManageSec}
                title={!canManageSec ? NO_PERM('security settings') : undefined}
                onClick={() => { const nv = !(toggles as Record<string, boolean>)[item.field]; setToggles((p) => ({ ...p, [item.field]: nv })); saveSetting(item.field, nv ? 1 : 0); }}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${(toggles as Record<string, boolean>)[item.field] ? 'left-4.5' : 'left-0.5'}`} />
              </button>
            </SettingRow>
          ))}
        </CardContent>
      </Card>

      {/* Selects */}
      <Card className="mb-4">
        <CardContent className="divide-y">
          <SettingRow label="Session timeout" desc="Auto-logout after inactivity.">
            <div className="flex items-center gap-2">
              <Select value={sessionTimeout} onValueChange={(v) => setSessionTimeout(v as string)} items={SESSION_TIMEOUT_OPTIONS}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SESSION_TIMEOUT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <SaveBtn loading={saving === 'session_timeout'} onClick={() => saveSetting('session_timeout_minutes', sessionTimeout || null)} disabled={!canManageSec} disabledReason={NO_PERM('the session timeout')} />
            </div>
          </SettingRow>
          <SettingRow label="Share link max expiry" desc="Cap how long share links can live.">
            <div className="flex items-center gap-2">
              <Select value={shareExpiry} onValueChange={(v) => setShareExpiry(v as string)} items={SHARE_EXPIRY_OPTIONS}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHARE_EXPIRY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <SaveBtn loading={saving === 'share_expiry'} onClick={() => saveSetting('share_max_expiry_days', shareExpiry || null)} disabled={!canManageSec} disabledReason={NO_PERM('the share link expiry cap')} />
            </div>
          </SettingRow>
          <SettingRow label="Download rate limit" desc="Max downloads per user per hour.">
            <div className="flex items-center gap-2">
              <Input value={downloadRate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDownloadRate(e.target.value)} type="number" className="h-8 text-xs w-24" placeholder="100" />
              <span className="text-[11px] text-muted-foreground">/ hour</span>
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
            return (
              <SettingRow key={item.field} label={item.label} desc={item.desc}>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">{count === 0 ? 'None' : `${count} entries`}</Badge>
                  <span title={!canManageSec ? NO_PERM(item.label.toLowerCase()) : undefined} className={!canManageSec ? 'cursor-not-allowed' : ''}>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openListModal(item.field, item.label, item.placeholder)} disabled={!canManageSec}>Manage</Button>
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
          <DialogHeader><DialogTitle>{listModal?.title}</DialogTitle></DialogHeader>
          <div className="flex gap-2">
            <Input value={listInput} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setListInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addListItem()}
              placeholder={listModal?.placeholder} className="h-8 text-xs flex-1" />
            <Button size="sm" className="h-8 text-xs" onClick={addListItem}><Plus className="size-3" /></Button>
          </div>
          <div className="max-h-48 overflow-y-auto border rounded-lg">
            {listItems.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No entries</p>
            ) : listItems.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 text-xs border-b last:border-b-0">
                <span className="font-mono">{item}</span>
                <button onClick={() => setListItems((prev) => prev.filter((_, j) => j !== i))}><X className="size-3 text-muted-foreground hover:text-destructive" /></button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setListModal(null)}>Cancel</Button>
            <Button onClick={saveList} disabled={saving === listModal?.field}>{saving === listModal?.field && <Loader2 className="size-4 animate-spin mr-1.5" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ── Roles ──────────────────────────────────────────────────

function RolesSection({ data }: { data: WsData; wsId: string; onSaved: () => void }) {
  const roles = data.roles ?? [];
  const perms = data.permissions ?? {};
  const builtinIds = new Set(roles.filter((r) => ['owner', 'admin', 'member', 'viewer'].includes(r.name.toLowerCase())).map((r) => r.id));

  return (
    <section id="section-roles">
      <SectionHeader title="Roles & permissions" desc="Manage access levels for your workspace members." />
      <Card>
        <CardContent>
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="h-auto py-2 px-3 text-muted-foreground">Permission</TableHead>
                {roles.map((r) => (
                  <TableHead key={r.id} className="h-auto text-center py-2 px-2">
                    <div className="flex flex-col items-center gap-1">
                      <span>{r.name}</span>
                      {!builtinIds.has(r.id) ? (
                        <Link to={`/role-create?edit=${r.id}`} className="text-[9px] text-muted-foreground hover:text-foreground underline">Edit</Link>
                      ) : (
                        <Link to={`/role-create?view=${r.id}`} className="text-[9px] text-muted-foreground hover:text-foreground underline">View</Link>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(PERM_LABELS).map(([perm, label]) => (
                <TableRow key={perm}>
                  <TableCell className="py-2 px-3 text-muted-foreground">{label}</TableCell>
                  {roles.map((r) => (
                    <TableCell key={r.id} className="text-center py-2 px-2">
                      {perms[r.id]?.[perm] ? (
                        <div className="w-5 h-5 rounded bg-green-100 dark:bg-green-950 flex items-center justify-center mx-auto"><Check className="size-3 text-green-600" /></div>
                      ) : (
                        <div className="w-5 h-5 rounded bg-muted flex items-center justify-center mx-auto"><span className="text-muted-foreground text-[10px]">—</span></div>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 pt-3 border-t">
            <Link to="/role-create"><Button variant="outline" size="sm" className="text-xs gap-1.5"><Plus className="size-3" /> Add role</Button></Link>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ── Danger Zone ────────────────────────────────────────────

function DangerSection({ data, wsId, isOwner, navigate, onSaved }: { data: WsData; wsId: string; isOwner: boolean; navigate: (path: string) => void; onSaved: () => void }) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const members = data.members ?? [];

  const handleLeave = async () => {
    setActing(true);
    try { const res = await api<{ ok: boolean }>(`/api/workspaces/${wsId}/leave`, { method: 'POST' }); if (res.ok) { toast.success('Left workspace', 'You no longer have access to this workspace.'); navigate('/'); } } catch { toast.error('Couldn\'t leave', 'You were not able to leave this workspace.'); }
    setActing(false);
  };

  const handleDelete = async () => {
    setActing(true);
    try { const res = await api<{ ok: boolean }>(`/api/workspaces/${wsId}`, { method: 'DELETE' }); if (res.ok) { toast.success('Workspace deleted', 'The workspace and all its files have been removed.'); navigate('/'); } } catch (err) { toast.error('Couldn\'t delete', apiErrorMessage(err, 'The workspace could not be deleted.')); }
    setActing(false);
  };

  const handleTransfer = async () => {
    if (!transferTarget) return;
    setActing(true);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/workspaces/${wsId}/transfer`, { method: 'POST', body: JSON.stringify({ user_id: transferTarget }) });
      if (res.ok) { toast.success('Ownership transferred', 'The selected member is now the workspace owner.'); setTransferOpen(false); onSaved(); }
      else toast.error('Transfer failed', res.error ?? 'Ownership could not be transferred.');
    } catch { toast.error('Transfer failed', 'Ownership could not be transferred.'); }
    setActing(false);
  };

  return (
    <section id="section-danger">
      <SectionHeader title="Danger zone" desc="Irreversible actions. Tread carefully." danger />
      <Card className="border-destructive/30">
        <CardContent className="divide-y divide-destructive/20">
          {isOwner && (
            <div className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium">Transfer ownership</p>
                <p className="text-xs text-muted-foreground">Hand this workspace to another member.</p>
              </div>
              <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setTransferOpen(true)}>
                <ArrowRightLeft className="size-3.5 mr-1.5" /> Transfer
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between py-4">
            <div><p className="text-sm font-medium">Leave workspace</p><p className="text-xs text-muted-foreground">You will lose access immediately.</p></div>
            <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setConfirmLeave(true)}><LogOut className="size-3.5 mr-1.5" /> Leave</Button>
          </div>
          {isOwner && (
            <div className="flex items-center justify-between py-4">
              <div><p className="text-sm font-medium">Delete workspace</p><p className="text-xs text-muted-foreground">Permanently deletes all files, members and links.</p></div>
              <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}><Trash2 className="size-3.5 mr-1.5" /> Delete</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transfer modal */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Transfer ownership</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground mb-2">Select a member to become the new owner. You will become a regular member.</p>
          <div className="max-h-48 overflow-y-auto border rounded-lg">
            {members.filter((m) => m.role_id !== 'role_owner').map((m) => (
              <button key={m.membership_id}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs border-b last:border-b-0 hover:bg-muted/50 text-left ${transferTarget === m.user_id ? 'bg-green-50 dark:bg-green-950/30' : ''}`}
                onClick={() => setTransferTarget(m.user_id)}>
                <span className="flex-1 truncate font-medium">{m.name}</span>
                <span className="text-muted-foreground truncate">{m.email}</span>
                {transferTarget === m.user_id && <Check className="size-3 text-green-600 shrink-0" />}
              </button>
            ))}
            {members.filter((m) => m.role_id !== 'role_owner').length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">No other members to transfer to.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleTransfer} disabled={acting || !transferTarget}>{acting && <Loader2 className="size-4 animate-spin mr-1.5" />}Transfer ownership</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Leave workspace?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">You will lose access to all files immediately.</p>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmLeave(false)}>Cancel</Button><Button variant="destructive" onClick={handleLeave} disabled={acting}>{acting && <Loader2 className="size-4 animate-spin mr-1.5" />}Leave</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete workspace?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This permanently deletes all files, members, and links. Cannot be undone.</p>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" onClick={handleDelete} disabled={acting}>{acting && <Loader2 className="size-4 animate-spin mr-1.5" />}Delete workspace</Button></DialogFooter>
        </DialogContent>
      </Dialog>
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
  const btn = (
    <Button size="sm" className="h-7 text-xs gap-1" onClick={onClick} disabled={loading || disabled}>
      {loading ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}Save
    </Button>
  );
  // Disabled buttons swallow pointer events, so the tooltip lives on a wrapper
  if (disabled && disabledReason) return <span title={disabledReason} className="cursor-not-allowed">{btn}</span>;
  return btn;
}

function SettingsSkeleton() {
  return <div className="p-6 space-y-6"><div className="space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-64" /></div>{[1, 2, 3].map((i) => <Card key={i}><CardContent className="pt-6 space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></CardContent></Card>)}</div>;
}
