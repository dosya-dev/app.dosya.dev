import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { api, API_BASE, ApiError } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  User, Lock, Key, Monitor, Bell, Plug, Building2, Trash2,
  Plus, Copy, Check, Loader2, LogOut, X, Camera, ShieldCheck,
  Smartphone, Download, RefreshCw, Mail, Palette, ChartColumn, ShieldAlert,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { timeAgo } from '@/lib/helpers';
import { THEMES, type Mode } from '@/lib/themes';
import { readCache, writeCache, applyTheme, applyThemeAnimated, subscribeThemeChange, type ThemePref } from '@/lib/theme';
import { enableWebPush } from '../lib/web-push';
import { PROVIDER_LABELS } from '@/components/cloud-import/import-progress-card';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';

// ── Types ──────────────────────────────────────────────────

interface UserProfile {
  id: string; name: string; email: string; initials: string;
  avatar_url: string | null; preferred_language: string;
  created_at: number; email_verified_at: number | null; workspace_count: number;
  // False for OAuth-created accounts: their stored password is a random value they were
  // never told, so every password-gated action fails permanently.
  has_password: boolean;
}
interface TfaStatus {
  method: string | null; totp_enabled: boolean; recovery_codes_remaining: number;
}
interface ApiKey {
  id: string; name: string; scope: string; key_prefix: string;
  created_at: number; s3_access_key_id: string | null;
  surfaces: string | null;
  // Folder anchor (migration 0095). NULL/NULL means the key sees the whole
  // account - see apps/api/src/lib/access/anchor.ts.
  workspace_id: string | null;
  root_folder_id: string | null;
  // Access conditions (migration 0097). NULL means unrestricted for that one
  // condition - see apps/api/src/lib/access/{cidr,active-hours}.ts.
  allowed_ips: string | null;
  active_hours: string | null;
}
// Mirrors what GET /api/me/sessions actually returns. It previously declared
// ip/user_agent/login_method/last_active_at - none of which the API sends - so every
// row rendered "undefined · undefined · undefined NaN". `device`/`browser`/`meta` come
// pre-formatted from the server, which also classifies mobile app devices.
interface Session {
  id: string;
  device: string;
  kind: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  browser: string;
  meta: string;
  is_current: boolean;
  created_at: number;
}
interface Workspace {
  id: string; name: string; icon_initials: string; icon_color: string;
  role_id: string; joined_at: number;
}
// Shape of GET /api/cloud/accounts rows (see apps/api/src/pages/api/cloud/accounts/index.ts):
// id/provider/account_email/account_name/created_at only - tokens never leave that route.
interface DriveAccount {
  id: string; provider: string; account_email: string; account_name: string; created_at: number;
}

const NAV = [
  { id: 'identity', label: 'Identity', icon: User, group: 'Profile' },
  { id: 'appearance', label: 'Appearance', icon: Palette, group: 'Profile' },
  { id: 'password', label: 'Password & 2FA', icon: Lock, group: 'Profile' },
  { id: 'api', label: 'API keys', icon: Key, group: 'Profile' },
  { id: 'sessions', label: 'Sessions', icon: Monitor, group: 'Profile' },
  { id: 'notifications', label: 'Notifications', icon: Bell, group: 'Profile' },
  { id: 'integrations', label: 'Integrations', icon: Plug, group: 'Profile' },
  { id: 'workspaces', label: 'My workspaces', icon: Building2, group: 'Workspaces' },
  { id: 'delete', label: 'Delete account', icon: Trash2, group: 'Danger', danger: true },
];

const SCOPE_LABELS: Record<string, string> = { full: 'Full access', read: 'Read only', upload: 'Upload only' };

// Order also drives the create-form checkbox list.
const SURFACE_OPTIONS: { value: string; label: string }[] = [
  { value: 'webdav', label: 'WebDAV' },
  { value: 'sftp', label: 'SFTP' },
  { value: 's3', label: 'S3 gateway' },
  { value: 'api', label: 'REST API' },
];
const SURFACE_LABELS: Record<string, string> = Object.fromEntries(SURFACE_OPTIONS.map((o) => [o.value, o.label]));

// null (or unset) means the key was created before migration 0094, or was
// created with no restriction - both are unrestricted, matching the API's
// `parseSurfaces()` in apps/api/src/lib/access/credential.ts.
function formatSurfaces(surfaces: string | null): string {
  if (!surfaces) return 'All protocols';
  return surfaces.split(',').map((s) => SURFACE_LABELS[s] ?? s).join(', ');
}

// Sentinel for the "no workspace pin" option in the create-key workspace
// Select - '' isn't usable there since an unselected/placeholder value reads
// the same way in that component.
const WHOLE_ACCOUNT = '__whole_account__';

// A key with no workspace_id sees the whole account (see anchor.ts's
// isAnchored/workspaceAllowed). A workspace_id with no root_folder_id is
// pinned to that workspace but not narrowed inside it, so it shows just the
// workspace name; a root_folder_id narrows further to "workspace / folder".
function formatAnchor(
  k: ApiKey,
  workspaces: Workspace[],
  folderNames: Record<string, string>,
): string {
  if (!k.workspace_id) return 'Whole account';
  const wsName = workspaces.find((w) => w.id === k.workspace_id)?.name ?? 'Unknown workspace';
  if (!k.root_folder_id) return wsName;
  const folderName = folderNames[k.root_folder_id] ?? '…';
  return `${wsName} / ${folderName}`;
}

// Day-of-week checkboxes for active_hours.days (0 = Sunday, matching
// apps/api/src/lib/access/active-hours.ts). Order is display order, not the
// stored value order.
const DAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

// IANA timezone names for the active-hours zone picker. Intl.supportedValuesOf
// isn't implemented everywhere (older Safari/WebKit) - fall back to a short
// list anchored on the browser's own zone so the picker is never empty.
function timezoneOptions(): string[] {
  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
    if (zones && zones.length > 0) return zones;
  } catch { /* not supported in this runtime */ }
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([here, 'Etc/UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney'])];
}

// A short, non-revealing summary for the key list - deliberately does NOT
// echo the allowlist/window contents (same "name the kind, not the details"
// rule the API's own refusal messages follow - see conditions.ts).
function formatConditions(k: ApiKey): string | null {
  const parts: string[] = [];
  if (k.allowed_ips) parts.push('IP-restricted');
  if (k.active_hours) parts.push('time-restricted');
  return parts.length > 0 ? parts.join(' + ') : null;
}

const LANGUAGES = [
  { value: 'en', label: 'English (AU)' },
  { value: 'en-us', label: 'English (US)' },
  { value: 'tr', label: 'Turkish' },
  { value: 'de', label: 'German' },
];

// ── API helper (never throws; normalises to { ok, error }) ──

interface OkResult { ok: boolean; error?: string }

async function req<T extends OkResult = OkResult>(path: string, options?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, options);
  } catch (e) {
    if (e instanceof ApiError) {
      try { return JSON.parse(e.body) as T; } catch { /* not json */ }
      return { ok: false, error: e.body || `Request failed (${e.status})` } as T;
    }
    return { ok: false, error: "Can't reach the server. Check your connection and try again." } as T;
  }
}

// ── Page ───────────────────────────────────────────────────

export default function ProfilePage() {
  const location = useLocation();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [tfa, setTfa] = useState<TfaStatus | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [driveAccounts, setDriveAccounts] = useState<DriveAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('identity');

  const loadProfile = useCallback(async () => {
    const res = await req<{ ok: boolean; user: UserProfile }>('/api/me');
    if (res.ok) setUser(res.user);
  }, []);

  const load2fa = useCallback(async () => {
    const res = await req<{ ok: boolean } & TfaStatus>('/api/me/2fa/status');
    if (res.ok) setTfa({ method: res.method, totp_enabled: res.totp_enabled, recovery_codes_remaining: res.recovery_codes_remaining });
  }, []);

  const loadKeys = useCallback(async () => {
    const res = await req<{ ok: boolean; keys: ApiKey[] }>('/api/me/api-keys');
    if (res.ok) setKeys(res.keys);
  }, []);

  const loadSessions = useCallback(async () => {
    const res = await req<{ ok: boolean; sessions: Session[] }>('/api/me/sessions');
    if (res.ok) setSessions(res.sessions);
  }, []);

  const loadDrive = useCallback(async () => {
    const res = await req<{ ok: boolean; accounts: DriveAccount[] }>('/api/cloud/accounts');
    if (res.ok) setDriveAccounts(res.accounts);
  }, []);

  const load = useCallback(async () => {
    const wsRes = await req<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
    if (wsRes.ok) setWorkspaces(wsRes.workspaces);
    await Promise.all([loadProfile(), load2fa(), loadKeys(), loadSessions(), loadDrive()]);
    setLoading(false);
  }, [loadProfile, load2fa, loadKeys, loadSessions, loadDrive]);

  useEffect(() => { load(); }, [load]);

  // Deep-link: /profile?section=appearance scrolls to + highlights a section,
  // including when navigated to while already on the Profile page.
  useEffect(() => {
    if (loading) return;
    const section = new URLSearchParams(location.search).get('section');
    if (section && NAV.some((n) => n.id === section)) {
      setActiveSection(section);
      setTimeout(() => document.getElementById(`section-${section}`)?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [loading, location.search]);

  if (loading) return <ProfileSkeleton />;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Side nav */}
      <nav className="w-48 shrink-0 border-r p-4 overflow-y-auto hidden md:block">
        {['Profile', 'Workspaces', 'Danger'].map((group) => (
          <div key={group} className="mb-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{group}</p>
            {NAV.filter((n) => n.group === group).map((n) => (
              <button
                key={n.id}
                onClick={() => { setActiveSection(n.id); document.getElementById(`section-${n.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors mb-0.5 ${
                  activeSection === n.id
                    ? n.danger ? 'bg-destructive text-destructive-foreground' : 'bg-accent text-accent-foreground'
                    : n.danger ? 'text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <n.icon className="size-3.5" />
                {n.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <ProfileHero user={user} onAvatarChanged={loadProfile} />
        <IdentitySection user={user} onSaved={loadProfile} />
        <AppearanceSection />
        {/* Default to true while /api/me is loading: better to show an action that may
            401 than to hide a working one from someone who does have a password. */}
        <PasswordSection tfa={tfa} onTfaChanged={load2fa} hasPassword={user?.has_password ?? true} />
        <ApiKeysSection keys={keys} workspaces={workspaces} onChanged={loadKeys} />
        <SessionsSection sessions={sessions} onChanged={loadSessions} />
        <NotificationsSection />
        <IntegrationsSection accounts={driveAccounts} onChanged={loadDrive} />
        <WorkspacesSection workspaces={workspaces} />
        <DeleteAccountSection />
      </div>
    </div>
  );
}

// ── Hero ───────────────────────────────────────────────────

function ProfileHero({ user, onAvatarChanged }: { user: UserProfile | null; onAvatarChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [bust, setBust] = useState(0);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('File too large', 'Image must be under 2 MB'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const res = await fetch(`${API_BASE}/api/me/avatar`, { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json().catch(() => ({ ok: false })) as OkResult;
      if (res.ok && data.ok) { toast.success('Avatar updated', 'Your new profile photo is live.'); setBust(Date.now()); onAvatarChanged(); }
      else toast.error('Upload failed', data.error ?? 'Upload failed');
    } catch { toast.error('Something went wrong', "Can't reach the server. Check your connection and try again."); }
    setUploading(false);
  };

  const memberSince = user
    ? `Member since ${new Date(user.created_at * 1000).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} · ${user.workspace_count} workspace${user.workspace_count === 1 ? '' : 's'}`
    : '';
  // avatar_url is an R2 object key, not a URL - the image is served by GET /api/me/avatar.
  const avatarSrc = user?.avatar_url ? `${API_BASE}/api/me/avatar?t=${bust}` : null;

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="relative size-16 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0 group"
        aria-label="Change avatar"
      >
        {avatarSrc ? (
          <img src={avatarSrc} alt="" crossOrigin="use-credentials" className="w-full h-full object-cover" />
        ) : (
          <span className="text-lg font-semibold text-muted-foreground">{user?.initials ?? ''}</span>
        )}
        <span className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          {uploading ? <Loader2 className="size-4 text-white animate-spin" /> : <Camera className="size-4 text-white" />}
        </span>
      </button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPick} />
      <div className="min-w-0">
        <p className="text-lg font-semibold truncate">{user?.name ?? <Skeleton className="h-5 w-32" />}</p>
        <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{memberSince}</p>
      </div>
    </div>
  );
}

// ── Identity ───────────────────────────────────────────────

function IdentitySection({ user, onSaved }: { user: UserProfile | null; onSaved: () => void }) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [language, setLanguage] = useState(user?.preferred_language ?? 'en');
  const [savingName, setSavingName] = useState(false);

  // Email change flow
  const [pwModal, setPwModal] = useState(false);
  const [pw, setPw] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (user) { setName(user.name); setEmail(user.email); setLanguage(user.preferred_language); }
  }, [user]);

  const emailChanged = !!user && email.trim().toLowerCase() !== user.email.toLowerCase() && email.trim() !== '';

  const saveName = async () => {
    if (!name.trim()) return;
    setSavingName(true);
    const res = await req('/api/me/name', { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
    if (res.ok) { toast.success('Saved', 'Your name has been updated.'); onSaved(); } else toast.error('Update failed', res.error ?? 'The change could not be saved.');
    setSavingName(false);
  };

  const startEmailChange = () => {
    if (!emailChanged) return;
    setPw(''); setPwModal(true);
  };

  const sendCode = async () => {
    if (!pw) { toast.error('Password required', 'Enter your current password to continue.'); return; }
    setSending(true);
    const res = await req<{ ok: boolean; pending?: boolean; error?: string }>('/api/me/email', {
      method: 'PUT', body: JSON.stringify({ email: email.trim().toLowerCase(), current_password: pw }),
    });
    if (res.ok && res.pending) {
      setPwModal(false); setPendingEmail(email.trim().toLowerCase()); setCode('');
      toast.success('Code sent', 'Check your inbox for the 6-digit code.');
    } else if (res.ok) {
      setPwModal(false); toast.info('No change needed', 'The email address is already set to that value.');
    } else toast.error('Update failed', res.error ?? 'The verification code could not be sent.');
    setSending(false);
  };

  const confirmCode = async () => {
    if (!/^\d{6}$/.test(code)) { toast.error('Invalid code', 'Enter the 6-digit code'); return; }
    setConfirming(true);
    const res = await req<{ ok: boolean; email?: string; error?: string }>('/api/me/email/confirm', {
      method: 'POST', body: JSON.stringify({ code }),
    });
    if (res.ok && res.email) { toast.success('Email updated', 'Your email address has been changed.'); setPendingEmail(null); onSaved(); }
    else toast.error('Verification failed', res.error ?? 'The code could not be verified.');
    setConfirming(false);
  };

  return (
    <section id="section-identity">
      <h2 className="text-base font-semibold mb-3">Identity</h2>
      <Card>
        <CardContent className="divide-y">
          <SettingRow label="Full name" desc="Visible to teammates across all workspaces.">
            <div className="flex items-center gap-2">
              <Input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="h-8 text-xs w-48" />
              <SaveBtn loading={savingName} onClick={saveName} />
            </div>
          </SettingRow>

          <SettingRow
            label="Email address"
            desc="Used for login, notifications and billing."
            badge={user && (
              user.email_verified_at
                ? <Badge className="text-[10px] bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 border-transparent">Verified</Badge>
                : <Badge variant="secondary" className="text-[10px]">Unverified</Badge>
            )}
          >
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <Input
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                  disabled={!!pendingEmail}
                  className="h-8 text-xs w-56"
                />
                {pendingEmail ? (
                  <Badge variant="secondary" className="text-[10px]">Pending</Badge>
                ) : emailChanged ? (
                  <Button size="sm" className="h-7 text-xs" onClick={startEmailChange}>Change</Button>
                ) : null}
              </div>
              {pendingEmail && (
                <div className="flex items-center gap-2">
                  <Input
                    value={code}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    className="h-8 text-xs w-28 text-center tracking-[4px] font-semibold"
                    onKeyDown={(e) => e.key === 'Enter' && confirmCode()}
                  />
                  <Button size="sm" className="h-7 text-xs" onClick={confirmCode} disabled={confirming}>
                    {confirming ? <Loader2 className="size-3 animate-spin" /> : 'Confirm'}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setPendingEmail(null); setEmail(user?.email ?? ''); }}>Cancel</Button>
                </div>
              )}
            </div>
          </SettingRow>

          <SettingRow label="Preferred language" desc="Interface language for your account.">
            <Select value={language} onValueChange={(v) => setLanguage(v as string)} items={LANGUAGES}>
              <SelectTrigger className="h-8 text-xs w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </SettingRow>
        </CardContent>
      </Card>

      {/* Password confirm modal for email change */}
      <Dialog open={pwModal} onOpenChange={setPwModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Confirm your password</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Enter your current password to send a verification code to <span className="font-medium">{email}</span>.</p>
          <Input type="password" placeholder="Current password" value={pw} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPw(e.target.value)} className="h-9 text-sm" onKeyDown={(e) => e.key === 'Enter' && sendCode()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwModal(false)}>Cancel</Button>
            <Button onClick={sendCode} disabled={sending}>
              {sending ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Mail className="size-4 mr-1.5" />} Send code
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ── Appearance ─────────────────────────────────────────────

function AppearanceSection() {
  const [pref, setPref] = useState<ThemePref>(() => readCache());

  useEffect(() => subscribeThemeChange((next) => setPref(next)), []);

  const save = async (next: ThemePref) => {
    const prev = pref;
    setPref(next);
    applyThemeAnimated(next);
    writeCache(next);
    const res = await req('/api/me/appearance', {
      method: 'PUT', body: JSON.stringify(next),
    });
    if (!res.ok) {
      setPref(prev);
      applyTheme(prev); // instant: a second wipe on a failed save reads as a bug
      writeCache(prev);
      toast.error('Couldn\'t save', res.error ?? 'Your theme could not be saved.');
    }
  };

  const MODES: { value: Mode; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];

  return (
    <section id="section-appearance">
      <h2 className="text-base font-semibold mb-3">Appearance</h2>
      <Card>
        <CardContent className="divide-y">
          <div className="py-4">
            <p className="text-xs font-medium mb-0.5">Mode</p>
            <p className="text-[11px] text-muted-foreground mb-3">Light, dark, or follow your device.</p>
            <div className="inline-flex gap-1 bg-muted rounded-lg p-1">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => save({ ...pref, mode: m.value })}
                  className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    pref.mode === m.value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="py-4">
            <p className="text-xs font-medium mb-0.5">Theme</p>
            <p className="text-[11px] text-muted-foreground mb-3">Applies instantly and saves to your account, so it follows you across devices.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => save({ ...pref, theme: t.id })}
                  className={`text-left rounded-lg border overflow-hidden transition-all ${
                    pref.theme === t.id ? 'ring-2 ring-primary border-transparent' : 'hover:border-foreground/30'
                  }`}
                >
                  <div className="h-11 flex items-center gap-1.5 px-2.5" style={{ background: t.swatch.bg }}>
                    <span className="size-4 rounded" style={{ background: t.swatch.primary }} />
                    <span className="h-1.5 flex-1 max-w-[42px] rounded" style={{ background: t.swatch.accent }} />
                  </div>
                  <div className="px-2.5 py-1.5 text-[11px] font-medium flex items-center justify-between">
                    {t.label}
                    {pref.theme === t.id && <Check className="size-3 text-primary" />}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ── Password & 2FA ─────────────────────────────────────────

function PasswordSection({ tfa, onTfaChanged, hasPassword }: { tfa: TfaStatus | null; onTfaChanged: () => void; hasPassword: boolean }) {
  const [passwordModal, setPasswordModal] = useState(false);
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  // 2FA modals
  const [totpModal, setTotpModal] = useState(false);
  const [disableModal, setDisableModal] = useState(false);
  const [regenModal, setRegenModal] = useState(false);
  const [enablingEmail, setEnablingEmail] = useState(false);

  const changePassword = async () => {
    if (newPw !== confirm) { toast.error('Passwords do not match', 'The new password and confirmation are different.'); return; }
    if (newPw.length < 8) { toast.error('Password too short', 'Password must be at least 8 characters'); return; }
    setSaving(true);
    const res = await req('/api/me/password', {
      method: 'PUT', body: JSON.stringify({ current_password: current, new_password: newPw }),
    });
    if (res.ok) { toast.success('Password changed', 'Your password has been updated.'); setPasswordModal(false); setCurrent(''); setNewPw(''); setConfirm(''); }
    else toast.error('Update failed', res.error ?? 'The password could not be changed.');
    setSaving(false);
  };

  const enableEmail = async () => {
    setEnablingEmail(true);
    const res = await req('/api/me/2fa/enable-email', { method: 'POST' });
    if (res.ok) { toast.success('Enabled', 'Email two-factor authentication is now on.'); onTfaChanged(); } else toast.error('Update failed', res.error ?? 'Email two-factor authentication could not be enabled.');
    setEnablingEmail(false);
  };

  const method = tfa?.method ?? null;

  return (
    <section id="section-password">
      <h2 className="text-base font-semibold mb-3">Password & two-factor auth</h2>
      <Card>
        <CardContent className="divide-y">
          {hasPassword ? (
            // The API also requires a special character and rejects reusing the current
            // password; the old copy mentioned neither, so users hit a 400 unprepared.
            <SettingRow label="Password" desc="Min. 8 characters, with upper and lower case, a number, and a special character.">
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setPasswordModal(true)}>Change password</Button>
            </SettingRow>
          ) : (
            <SettingRow
              label="Password"
              desc="You signed up with Google or GitHub, so this account has no password yet. Use “Forgot password” to set one - you'll need it to turn two-factor authentication off later."
            >
              <Badge variant="secondary" className="text-[10px]">Not set</Badge>
            </SettingRow>
          )}

          <SettingRow
            label="Two-factor authentication"
            desc={
              method === 'email' ? 'Enabled via email. A code is sent on each login.'
                : method === 'totp' ? 'Enabled via authenticator app.'
                : 'Not enabled. Add a second verification step to secure your account.'
            }
          >
            {method ? (
              <div className="flex items-center gap-2">
                <Badge className="text-[10px] gap-1"><ShieldCheck className="size-3" />{method === 'totp' ? 'Authenticator' : 'Email'}</Badge>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setDisableModal(true)} disabled={!hasPassword}>Disable</Button>
              </div>
            ) : !hasPassword ? (
              // Enrolling needs no password but disabling verifies one, so without a
              // password this is a one-way door. Block the door, don't just warn later.
              <p className="text-[11px] text-muted-foreground max-w-[16rem] text-right">
                Set a password first - turning 2FA off later requires one.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={enableEmail} disabled={enablingEmail}>
                  {enablingEmail ? <Loader2 className="size-3 animate-spin mr-1" /> : null} Enable email 2FA
                </Button>
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setTotpModal(true)}>
                  <Smartphone className="size-3" /> Enable authenticator
                </Button>
              </div>
            )}
          </SettingRow>

          {method && !hasPassword && (
            <SettingRow
              label="Password required"
              desc="Turning two-factor authentication off requires a password. Use “Forgot password” to set one first."
            >
              <span />
            </SettingRow>
          )}

          {method === 'totp' && (
            <SettingRow label="Recovery codes" desc={`${tfa?.recovery_codes_remaining ?? 0} of 10 codes remaining`}>
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setRegenModal(true)} disabled={!hasPassword}>
                <RefreshCw className="size-3" /> Regenerate codes
              </Button>
            </SettingRow>
          )}
        </CardContent>
      </Card>

      {/* Change password modal */}
      <Dialog open={passwordModal} onOpenChange={setPasswordModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Change password</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="password" placeholder="Current password" value={current} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrent(e.target.value)} className="h-9 text-sm" />
            <Input type="password" placeholder="New password" value={newPw} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPw(e.target.value)} className="h-9 text-sm" />
            <Input type="password" placeholder="Confirm new password" value={confirm} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)} className="h-9 text-sm" onKeyDown={(e) => e.key === 'Enter' && changePassword()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordModal(false)}>Cancel</Button>
            <Button onClick={changePassword} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null} Change password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TotpSetupModal open={totpModal} onOpenChange={setTotpModal} onEnabled={onTfaChanged} />
      <DisableTfaModal open={disableModal} onOpenChange={setDisableModal} onDisabled={onTfaChanged} />
      <RegenCodesModal open={regenModal} onOpenChange={setRegenModal} onDone={onTfaChanged} />
    </section>
  );
}

// ── Recovery codes view (shared) ───────────────────────────

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const copyAll = async () => {
    await navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const download = () => {
    const blob = new Blob([`dosya.dev Recovery Codes\n${'='.repeat(30)}\n\n${codes.join('\n')}\n\nKeep these codes safe. Each can only be used once.\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dosya-recovery-codes.txt';
    a.click();
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Save these recovery codes somewhere safe. Each can be used once if you lose your authenticator.</p>
      <div className="grid grid-cols-2 gap-1.5 bg-muted p-3 rounded-md">
        {codes.map((c) => <code key={c} className="text-[11px] font-mono text-center">{c}</code>)}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="text-xs flex-1 gap-1" onClick={copyAll}>
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? 'Copied' : 'Copy all'}
        </Button>
        <Button variant="outline" size="sm" className="text-xs flex-1 gap-1" onClick={download}>
          <Download className="size-3" /> Download
        </Button>
      </div>
    </div>
  );
}

function TotpSetupModal({ open, onOpenChange, onEnabled }: { open: boolean; onOpenChange: (v: boolean) => void; onEnabled: () => void }) {
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    if (!open) { setSecret(''); setUri(''); setCode(''); setCodes(null); return; }
    (async () => {
      const res = await req<{ ok: boolean; secret?: string; uri?: string; error?: string }>('/api/me/2fa/setup-totp', { method: 'POST' });
      if (res.ok && res.secret && res.uri) { setSecret(res.secret); setUri(res.uri); }
      else toast.error('Setup failed', res.error ?? 'Authenticator setup could not be started.');
    })();
  }, [open]);

  // The otpauth:// URI embeds the raw TOTP shared secret, so the QR must be
  // rendered on-device - never sent to a third-party image service. Error
  // correction H (30% recovery) leaves room for the centered logo overlay
  // (~4% of the area), which authenticator scanners handle fine.
  useEffect(() => {
    if (!uri) { setQrDataUrl(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const QRCode = await import('qrcode');
        const size = 360;
        const canvas = document.createElement('canvas');
        await QRCode.toCanvas(canvas, uri, { width: size, margin: 1, errorCorrectionLevel: 'H' });
        try {
          const logo = new Image();
          logo.src = '/logo.svg';
          await new Promise<void>((res, rej) => { logo.onload = () => res(); logo.onerror = () => rej(new Error('logo load failed')); });
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const badge = 76;
            const bx = (size - badge) / 2;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.roundRect(bx, bx, badge, badge, 14);
            ctx.fill();
            const icon = 56;
            ctx.drawImage(logo, (size - icon) / 2, (size - icon) / 2, icon, icon);
          }
        } catch { /* logo unavailable - ship the plain QR */ }
        if (!cancelled) setQrDataUrl(canvas.toDataURL('image/png'));
      } catch {
        if (!cancelled) toast.error('Setup failed', 'Could not render the QR code.');
      }
    })();
    return () => { cancelled = true; };
  }, [uri]);

  const verify = async () => {
    if (code.length !== 6) return;
    setVerifying(true);
    const res = await req<{ ok: boolean; recovery_codes?: string[]; error?: string }>('/api/me/2fa/verify-totp', {
      method: 'POST', body: JSON.stringify({ code }),
    });
    if (res.ok && res.recovery_codes) { setCodes(res.recovery_codes); onEnabled(); }
    else toast.error('Verification failed', res.error ?? 'The code could not be verified.');
    setVerifying(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{codes ? 'Recovery codes' : 'Set up authenticator app'}</DialogTitle></DialogHeader>
        {codes ? (
          <>
            <RecoveryCodes codes={codes} />
            <DialogFooter><Button onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Scan this QR code with your authenticator app, then enter the 6-digit code.</p>
            <div className="flex justify-center">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR code" width={180} height={180} className="rounded-md border" />
              ) : <Skeleton className="size-[180px]" />}
            </div>
            {secret && <code className="block text-[11px] bg-muted px-3 py-2 rounded-md break-all text-center font-mono">{secret}</code>}
            <Input
              value={code}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code" inputMode="numeric"
              className="h-9 text-sm text-center tracking-[6px] font-semibold"
              onKeyDown={(e) => e.key === 'Enter' && verify()}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={verify} disabled={verifying || code.length !== 6}>
                {verifying ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null} Verify & enable
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableTfaModal({ open, onOpenChange, onDisabled }: { open: boolean; onOpenChange: (v: boolean) => void; onDisabled: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setPw(''); }, [open]);

  const disable = async () => {
    if (!pw) { toast.error('Password required', 'Enter your current password to continue.'); return; }
    setBusy(true);
    const res = await req('/api/me/2fa/disable', { method: 'POST', body: JSON.stringify({ password: pw }) });
    if (res.ok) { toast.success('Disabled', 'Two-factor authentication is now off.'); onOpenChange(false); onDisabled(); }
    else toast.error('Update failed', res.error ?? 'Two-factor authentication could not be disabled.');
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Disable two-factor authentication</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Enter your password to turn off 2FA. Your account will be less secure.</p>
        <Input type="password" placeholder="Current password" value={pw} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPw(e.target.value)} className="h-9 text-sm" onKeyDown={(e) => e.key === 'Enter' && disable()} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={disable} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null} Disable 2FA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegenCodesModal({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  useEffect(() => { if (!open) { setPw(''); setCodes(null); } }, [open]);

  const regen = async () => {
    if (!pw) { toast.error('Password required', 'Enter your current password to continue.'); return; }
    setBusy(true);
    const res = await req<{ ok: boolean; recovery_codes?: string[]; error?: string }>('/api/me/2fa/recovery-codes', {
      method: 'POST', body: JSON.stringify({ password: pw }),
    });
    if (res.ok && res.recovery_codes) { setCodes(res.recovery_codes); onDone(); }
    else toast.error('Update failed', res.error ?? 'Your recovery codes could not be regenerated.');
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Regenerate recovery codes</DialogTitle></DialogHeader>
        {codes ? (
          <>
            <RecoveryCodes codes={codes} />
            <DialogFooter><Button onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">This invalidates your existing codes. Enter your password to continue.</p>
            <Input type="password" placeholder="Current password" value={pw} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPw(e.target.value)} className="h-9 text-sm" onKeyDown={(e) => e.key === 'Enter' && regen()} />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={regen} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null} Regenerate
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── API Keys ───────────────────────────────────────────────

interface S3Creds { access_key_id: string; secret_access_key: string; endpoint: string; region: string }

function ApiKeysSection({ keys, workspaces, onChanged }: { keys: ApiKey[]; workspaces: Workspace[]; onChanged: () => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyScope, setKeyScope] = useState('full');
  // Defaults to none selected: an empty set means unrestricted, sent as an
  // absent `surfaces` field rather than an empty array (see createKey below).
  const [keySurfaces, setKeySurfaces] = useState<Set<string>>(new Set());
  // Anchor: WHOLE_ACCOUNT means no workspace_id is sent at all. A folder can
  // only be chosen once a real workspace is, so picking WHOLE_ACCOUNT clears
  // any previously-chosen folder too (see the Select's onValueChange below).
  const [keyWorkspaceId, setKeyWorkspaceId] = useState(WHOLE_ACCOUNT);
  const [keyFolderId, setKeyFolderId] = useState<string | null>(null);
  const [keyFolderName, setKeyFolderName] = useState('');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  // Access conditions (migration 0097). Blank/disabled means unrestricted -
  // sent as an absent field, same "don't send what wasn't set" rule as
  // surfaces above (see createKey below).
  const [keyAllowedIps, setKeyAllowedIps] = useState('');
  const [keyHoursEnabled, setKeyHoursEnabled] = useState(false);
  const [keyTz, setKeyTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [keyDays, setKeyDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [keyFrom, setKeyFrom] = useState('09:00');
  const [keyTo, setKeyTo] = useState('17:00');
  const [creating, setCreating] = useState(false);
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toggleKeyDay = (value: number) => {
    setKeyDays((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const workspaceSelectItems = [
    { value: WHOLE_ACCOUNT, label: 'Whole account' },
    ...workspaces.map((w) => ({ value: w.id, label: w.name })),
  ];

  // Folder anchors on existing keys arrive as bare IDs (GET /api/me/api-keys
  // deliberately doesn't join folder names in - see the phase B2 brief). The
  // key list needs the name, not just the ID, so resolve any unseen ones
  // through the same GET /api/folders/:id every other folder-detail lookup
  // in this app uses. Membership is guaranteed: a key's root_folder_id can
  // only be set to a folder in a workspace the creating user belonged to.
  const [folderNames, setFolderNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = [...new Set(keys.map((k) => k.root_folder_id).filter((id): id is string => !!id))];
    const missing = ids.filter((id) => !(id in folderNames));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(missing.map(async (id) => {
        const res = await req<{ ok: boolean; folder?: { name: string } }>(`/api/folders/${id}`);
        return [id, res.ok && res.folder ? res.folder.name : 'Unknown folder'] as const;
      }));
      if (!cancelled) setFolderNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
    return () => { cancelled = true; };
  }, [keys, folderNames]);

  const toggleSurface = (value: string) => {
    setKeySurfaces((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  // S3 modal
  const [s3Open, setS3Open] = useState(false);
  const [s3Loading, setS3Loading] = useState(false);
  const [s3Creds, setS3Creds] = useState<S3Creds | null>(null);

  const createKey = async () => {
    if (!keyName.trim()) return;
    setCreating(true);
    const hasWorkspace = keyWorkspaceId !== WHOLE_ACCOUNT;
    const res = await req<{ ok: boolean; key?: { plain_key: string }; error?: string }>('/api/me/api-keys', {
      method: 'POST',
      body: JSON.stringify({
        name: keyName.trim(),
        scope: keyScope,
        // Send surfaces only when at least one is chosen - an absent field
        // (not an empty array) is what the endpoint treats as unrestricted.
        ...(keySurfaces.size > 0 ? { surfaces: [...keySurfaces] } : {}),
        // root_folder_id requires workspace_id (see the endpoint's validation
        // order) - only send the folder when a real workspace is pinned.
        ...(hasWorkspace ? { workspace_id: keyWorkspaceId } : {}),
        ...(hasWorkspace && keyFolderId ? { root_folder_id: keyFolderId } : {}),
        // Access conditions (migration 0097) - blank/disabled means
        // unrestricted, sent as an absent field so the server's own
        // trim()||null normalisation never even runs on a value we didn't
        // mean to set.
        ...(keyAllowedIps.trim() ? { allowed_ips: keyAllowedIps.trim() } : {}),
        ...(keyHoursEnabled
          ? { active_hours: { tz: keyTz, days: [...keyDays].sort(), from: keyFrom, to: keyTo } }
          : {}),
      }),
    });
    if (res.ok && res.key) {
      setPlainKey(res.key.plain_key); setCreateOpen(false);
      setKeyName(''); setKeySurfaces(new Set());
      setKeyWorkspaceId(WHOLE_ACCOUNT); setKeyFolderId(null); setKeyFolderName('');
      setKeyAllowedIps(''); setKeyHoursEnabled(false); setKeyDays(new Set([1, 2, 3, 4, 5]));
      setKeyFrom('09:00'); setKeyTo('17:00');
      onChanged();
    } else toast.error('Create failed', res.error ?? 'The API key could not be created.');
    setCreating(false);
  };

  const deleteKey = async (id: string) => {
    const res = await req(`/api/me/api-keys/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Key deleted', 'The API key has been removed.'); onChanged(); } else toast.error('Delete failed', res.error ?? 'The API key could not be deleted.');
  };

  const copyKey = async () => {
    if (plainKey) { await navigator.clipboard.writeText(plainKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const enableS3 = async (id: string) => {
    setS3Open(true); setS3Loading(true); setS3Creds(null);
    const res = await req<{ ok: boolean; s3_credentials?: S3Creds; error?: string }>('/api/me/api-keys/s3-credentials', {
      method: 'POST', body: JSON.stringify({ api_key_id: id }),
    });
    if (res.ok && res.s3_credentials) { setS3Creds(res.s3_credentials); onChanged(); }
    else { toast.error('Could not enable S3', res.error ?? 'S3 access could not be enabled.'); setS3Open(false); }
    setS3Loading(false);
  };

  const viewS3 = (k: ApiKey) => {
    if (!k.s3_access_key_id) return;
    setS3Creds({
      access_key_id: k.s3_access_key_id,
      secret_access_key: '(secret key is not retrievable - delete and recreate the key to rotate)',
      endpoint: `${window.location.origin}/s3`,
      region: 'auto',
    });
    setS3Loading(false); setS3Open(true);
  };

  return (
    <section id="section-api">
      <h2 className="text-base font-semibold mb-3">API keys</h2>
      <Card>
        <CardContent>
          {/* Header */}
          <div className="grid grid-cols-[1fr_1.1fr_0.6fr_0.8fr_0.9fr_0.6fr_auto_64px] gap-2 px-1 pb-2 border-b">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Name</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Token</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Scope</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Protocols</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Anchor</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Created</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">S3</span>
            <span />
          </div>
          {/* Rows */}
          {keys.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No API keys yet</p>
          ) : (
            keys.map((k) => (
              <div key={k.id} className="grid grid-cols-[1fr_1.1fr_0.6fr_0.8fr_0.9fr_0.6fr_auto_64px] gap-2 px-1 py-3 border-b last:border-b-0 items-center group">
                <span className="text-xs font-medium truncate">{k.name}</span>
                <span className="text-[11px] text-muted-foreground font-mono">dos_···· {k.key_prefix.slice(0, 4)}</span>
                <Badge variant={k.scope === 'full' ? 'default' : 'secondary'} className="text-[10px] w-fit">{SCOPE_LABELS[k.scope] ?? k.scope}</Badge>
                <span className="text-[11px] text-muted-foreground truncate" title={formatSurfaces(k.surfaces)}>{formatSurfaces(k.surfaces)}</span>
                <span className="text-[11px] text-muted-foreground truncate flex items-center gap-1" title={formatAnchor(k, workspaces, folderNames)}>
                  {formatAnchor(k, workspaces, folderNames)}
                  {formatConditions(k) && (
                    <span title={formatConditions(k) ?? undefined} className="shrink-0">
                      <ShieldAlert className="size-3 text-amber-600 dark:text-amber-400" aria-label={formatConditions(k) ?? undefined} />
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground">{new Date(k.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <span>
                  {k.s3_access_key_id ? (
                    <button onClick={() => viewS3(k)} className="text-[9px] font-medium text-green-700 dark:text-green-400 hover:underline flex items-center gap-0.5">
                      <Check className="size-2.5" /> Active
                    </button>
                  ) : (
                    <button onClick={() => enableS3(k.id)} className="text-[9px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                      <Plus className="size-2.5" /> Enable
                    </button>
                  )}
                </span>
                <div className="flex items-center gap-1 justify-end">
                  <Link to={`/api-analytics?key=${k.id}`} title="View analytics">
                    <Button variant="outline" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100">
                      <ChartColumn className="size-3" />
                    </Button>
                  </Link>
                  <Button variant="outline" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-destructive border-destructive/30" onClick={() => deleteKey(k.id)}>
                    <X className="size-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
          {/* Add button */}
          <button className="w-full py-2.5 mt-2 border border-dashed rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex items-center justify-center gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3" /> Generate new API key
          </button>
        </CardContent>
      </Card>

      {/* Create key dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create API key</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
            <Input placeholder="Key name" value={keyName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyName(e.target.value)} className="h-9 text-sm" />
            <Select value={keyScope} onValueChange={(v) => setKeyScope(v as string)} items={SCOPE_LABELS}>
              <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SCOPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div>
              <p className="text-xs font-medium mb-0.5">Protocols</p>
              <p className="text-[11px] text-muted-foreground mb-2">Leave all unchecked to allow every protocol. Selecting some restricts this key to only those.</p>
              <div className="space-y-1.5">
                {SURFACE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2.5 text-xs cursor-pointer">
                    <Checkbox className="size-4" checked={keySurfaces.has(opt.value)} onCheckedChange={() => toggleSurface(opt.value)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium mb-0.5">Workspace</p>
              <p className="text-[11px] text-muted-foreground mb-2">Optional. Pins the key to one workspace instead of your whole account.</p>
              <Select
                value={keyWorkspaceId}
                onValueChange={(v) => {
                  setKeyWorkspaceId((v as string) ?? WHOLE_ACCOUNT);
                  setKeyFolderId(null);
                  setKeyFolderName('');
                }}
                items={workspaceSelectItems}
              >
                <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={WHOLE_ACCOUNT}>Whole account</SelectItem>
                  {workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {keyWorkspaceId !== WHOLE_ACCOUNT && (
              <div>
                <p className="text-xs font-medium mb-0.5">Limit to a folder</p>
                <p className="text-[11px] text-muted-foreground mb-2">Optional. The key will only see this folder and everything inside it, and can only be used over WebDAV or the S3 gateway.</p>
                {keyFolderId ? (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-xs truncate border rounded-lg px-3 py-2">{keyFolderName || 'Folder'}</span>
                    <Button variant="outline" size="sm" onClick={() => { setKeyFolderId(null); setKeyFolderName(''); }}>Clear</Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="w-full h-9 text-xs" onClick={() => setFolderPickerOpen(true)}>
                    Choose folder…
                  </Button>
                )}
              </div>
            )}
            <div>
              <p className="text-xs font-medium mb-0.5">Allowed IP ranges</p>
              <p className="text-[11px] text-muted-foreground mb-2">
                Optional, comma-separated. Requests from other addresses will be refused.
              </p>
              <Textarea
                placeholder="203.0.113.0/24, 2001:db8::/32"
                value={keyAllowedIps}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setKeyAllowedIps(e.target.value)}
                className="text-sm min-h-[3.5rem]"
              />
            </div>
            <div>
              <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer mb-0.5">
                <Checkbox className="size-4" checked={keyHoursEnabled} onCheckedChange={() => setKeyHoursEnabled((v) => !v)} />
                Restrict to active hours
              </label>
              <p className="text-[11px] text-muted-foreground mb-2">
                Optional. Requests outside this weekly window will be refused.
              </p>
              {keyHoursEnabled && (
                <div className="space-y-2 rounded-lg border p-2.5">
                  <Select
                    value={keyTz}
                    onValueChange={(v) => setKeyTz(v as string)}
                    items={timezoneOptions().map((tz) => ({ value: tz, label: tz }))}
                  >
                    <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {timezoneOptions().map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap gap-2">
                    {DAY_OPTIONS.map((d) => (
                      <label key={d.value} className="flex items-center gap-1 text-[11px] cursor-pointer">
                        <Checkbox className="size-3.5" checked={keyDays.has(d.value)} onCheckedChange={() => toggleKeyDay(d.value)} />
                        {d.label}
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input type="time" value={keyFrom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyFrom(e.target.value)} className="h-8 text-xs flex-1" />
                    <span className="text-[11px] text-muted-foreground">to</span>
                    <Input type="time" value={keyTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyTo(e.target.value)} className="h-8 text-xs flex-1" />
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createKey} disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null} Generate key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder picker for the "Limit to a folder" anchor, scoped to whichever
          workspace is currently chosen above. Reuses the same dialog the
          move-file flow uses (see files.tsx) rather than a bespoke tree. */}
      {folderPickerOpen && keyWorkspaceId !== WHOLE_ACCOUNT && (
        <FolderPickerDialog
          open
          onClose={() => setFolderPickerOpen(false)}
          workspaceId={keyWorkspaceId}
          selectedId={keyFolderId}
          selectedName={keyFolderName}
          onSelect={(id, name) => { setKeyFolderId(id); setKeyFolderName(name); setFolderPickerOpen(false); }}
          title="Limit key to a folder"
          confirmLabel="Select folder"
        />
      )}

      {/* Show plain key dialog */}
      <Dialog open={!!plainKey} onOpenChange={() => setPlainKey(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>API key created</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Copy this key now. It won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md break-all">{plainKey}</code>
            <Button variant="outline" size="sm" onClick={copyKey}>
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </Button>
          </div>
          <DialogFooter><Button onClick={() => setPlainKey(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* S3 credentials dialog */}
      <Dialog open={s3Open} onOpenChange={setS3Open}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>S3 credentials</DialogTitle></DialogHeader>
          {s3Loading || !s3Creds ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Use these with any S3-compatible client. The secret is shown only once.</p>
              <S3Field label="Access key ID" value={s3Creds.access_key_id} copyable />
              <S3Field label="Secret access key" value={s3Creds.secret_access_key} copyable={!s3Creds.secret_access_key.startsWith('(')} />
              <S3Field label="Endpoint" value={s3Creds.endpoint} copyable />
              <S3Field label="Region" value={s3Creds.region} copyable />
            </div>
          )}
          <DialogFooter><Button onClick={() => setS3Open(false)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function S3Field({ label, value, copyable }: { label: string; value: string; copyable: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[11px] bg-muted px-2.5 py-1.5 rounded-md break-all font-mono">{value}</code>
        {copyable && (
          <Button variant="outline" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={copy}>
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Sessions ───────────────────────────────────────────────

function SessionsSection({ sessions, onChanged }: { sessions: Session[]; onChanged: () => void }) {
  const [revoking, setRevoking] = useState(false);

  const revokeAll = async () => {
    setRevoking(true);
    const res = await req('/api/me/sessions', { method: 'DELETE' });
    if (res.ok) { toast.success('Sessions revoked', 'You are now signed out everywhere else.'); onChanged(); } else toast.error('Revoke failed', res.error ?? 'The other sessions could not be revoked.');
    setRevoking(false);
  };

  return (
    <section id="section-sessions">
      <h2 className="text-base font-semibold mb-3">Active sessions</h2>
      <Card>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No sessions</p>
          ) : (
            <>
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-3 border-b last:border-b-0">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    {s.kind === 'mobile' || s.kind === 'tablet'
                      ? <Smartphone className="size-4 text-muted-foreground" />
                      : <Monitor className="size-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{s.device} {s.is_current && <Badge className="ml-1 text-[9px] bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400">Current</Badge>}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{s.meta}</p>
                  </div>
                </div>
              ))}
              {sessions.length > 1 && (
                <div className="pt-3 text-center">
                  <Button variant="destructive" size="sm" className="text-xs" onClick={revokeAll} disabled={revoking}>
                    {revoking ? <Loader2 className="size-3 animate-spin mr-1.5" /> : <LogOut className="size-3 mr-1.5" />}
                    Revoke all other sessions
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ── Notifications ──────────────────────────────────────────

const NOTIF_GROUPS: { name: string; items: { key: string; label: string; desc: string }[] }[] = [
  { name: 'Security & Account', items: [
    { key: 'security_new_login', label: 'New login from unknown device', desc: 'Get alerted when someone signs in from a new device or location.' },
    { key: 'security_failed_attempts', label: 'Failed login attempts', desc: 'Receive a warning when multiple failed login attempts are detected.' },
    { key: 'security_password_changed', label: 'Password changed', desc: 'Confirmation email when your password is updated.' },
  ] },
  { name: 'Files & Sharing', items: [
    { key: 'files_uploaded', label: 'File uploaded to workspace', desc: 'Get notified when a new file is uploaded to your workspace.' },
    { key: 'files_downloaded', label: 'Shared file downloaded', desc: 'Know when someone downloads a file you shared.' },
    { key: 'files_share_expiring', label: 'Share link expiring soon', desc: 'Reminder before your share links expire.' },
  ] },
  { name: 'File Requests', items: [
    { key: 'requests_new_upload', label: 'New upload to your request', desc: 'Get notified when someone uploads files to your request.' },
    { key: 'requests_expiring', label: 'File request expiring', desc: 'Reminder before your file requests reach their deadline.' },
  ] },
  { name: 'Collaboration', items: [
    { key: 'collab_new_comment', label: 'New comment on your file', desc: 'Someone commented on a file you uploaded.' },
    { key: 'collab_comment_reply', label: 'Reply to your comment', desc: 'Someone replied to a comment you posted.' },
    { key: 'collab_member_joined', label: 'New member joined workspace', desc: 'Someone accepted an invitation and joined your workspace.' },
  ] },
  { name: 'Billing & Storage', items: [
    { key: 'billing_payment_failed', label: 'Payment failed', desc: 'Alert when a subscription payment fails.' },
    { key: 'billing_storage_warning', label: 'Storage limit warning', desc: 'Get warned when your workspace is running low on storage.' },
    { key: 'billing_renewal', label: 'Subscription renewal reminder', desc: 'Heads-up before your next billing date.' },
  ] },
  { name: 'Google Drive', items: [
    { key: 'drive_import_completed', label: 'Import completed', desc: 'Summary when your Google Drive import finishes successfully.' },
    { key: 'drive_import_failed', label: 'Import failed', desc: 'Get alerted if a Google Drive import encounters errors.' },
  ] },
  { name: 'Product & Updates', items: [
    { key: 'marketing_product_updates', label: 'Product updates & announcements', desc: 'New features, improvements, and important changes.' },
    { key: 'marketing_tips', label: 'Tips & feature highlights', desc: 'Helpful tips to get the most out of dosya.dev.' },
  ] },
];

const CHANNELS = [
  ['in_app', 'In-app'],
  ['email', 'Email'],
  ['push', 'Browser push'],
] as const;

function NotificationsSection() {
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const [channels, setChannels] = useState<Record<string, boolean>>({ in_app: true, email: true, push: true });

  useEffect(() => {
    (async () => {
      const res = await req<{ ok: boolean; preferences?: Record<string, boolean>; channels?: Record<string, boolean> }>('/api/me/notifications');
      if (res.ok && res.preferences) setPrefs(res.preferences);
      else setPrefs({});
      const loadedChannels = res.ok ? res.channels : undefined;
      if (loadedChannels) setChannels((c) => ({ ...c, ...loadedChannels }));
    })();
  }, []);

  const toggle = async (key: string, next: boolean) => {
    setPrefs((p) => ({ ...(p ?? {}), [key]: next }));
    const res = await req('/api/me/notifications', {
      method: 'PUT', body: JSON.stringify({ preferences: { [key]: next } }),
    });
    if (!res.ok) {
      setPrefs((p) => ({ ...(p ?? {}), [key]: !next }));
      toast.error('Couldn\'t save', res.error ?? 'Your notification preference could not be saved.');
    }
  };

  const toggleChannel = async (key: string, next: boolean) => {
    setChannels((c) => ({ ...c, [key]: next }));
    const res = await req('/api/me/notifications', {
      method: 'PUT', body: JSON.stringify({ channels: { [key]: next } }),
    });
    if (!res.ok) {
      setChannels((c) => ({ ...c, [key]: !next }));
      toast.error('Couldn\'t save', res.error ?? 'Your channel preference could not be saved.');
    }
  };

  const handleEnablePush = async () => {
    const r = await enableWebPush();
    if (r === 'enabled') toast.success('Browser notifications enabled');
    else if (r === 'denied') toast.error('Permission denied', 'Allow notifications in your browser settings');
    else toast.error('Not supported', "This browser can't receive web push");
  };

  const loading = prefs === null;

  return (
    <section id="section-notifications">
      <h2 className="text-base font-semibold mb-3">Notifications</h2>
      <Card>
        <CardContent>
          <div className="mb-6">
            <h3 className="text-sm font-medium mb-2">Delivery channels</h3>
            {CHANNELS.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between py-2">
                <span className="text-sm">{label}</span>
                <Toggle
                  checked={channels[key] ?? true}
                  onChange={(v) => toggleChannel(key, v)}
                />
              </div>
            ))}
            <button
              type="button"
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted mt-2"
              onClick={handleEnablePush}
            >
              Enable browser notifications
            </button>
          </div>
          {NOTIF_GROUPS.map((g) => (
            <details key={g.name} className="group border-b last:border-b-0" open>
              <summary className="flex items-center justify-between py-3 cursor-pointer select-none text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                {g.name}
                <span className="text-[10px] transition-transform group-open:rotate-180">▼</span>
              </summary>
              <div className="pb-2">
                {g.items.map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-2 gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{item.label}</p>
                      <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                    </div>
                    <Toggle
                      checked={prefs?.[item.key] ?? true}
                      disabled={loading}
                      onChange={(v) => toggle(item.key, v)}
                    />
                  </div>
                ))}
              </div>
            </details>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-green-600' : 'bg-muted-foreground/30'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-[2px] w-4 h-4 bg-white rounded-full shadow transition-all ${checked ? 'left-[18px]' : 'left-[2px]'}`} />
    </button>
  );
}

// ── Integrations ───────────────────────────────────────────

// MINOR 16 (2026-07-30 review): a per-account row icon, keyed by provider id
// - NOT hardcoded to google-color.svg. Only google has a real icon asset
// today, so an unmapped provider falls back to a generic icon rather than
// silently reusing google's, which would render every onedrive/dropbox
// account with a Google icon the moment a second provider actually connects.
const PROVIDER_ICONS: Record<string, string> = {
  google: '/google-color.svg',
};

export function IntegrationsSection({ accounts, onChanged }: { accounts: DriveAccount[]; onChanged: () => void }) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const disconnect = async (id: string) => {
    setDisconnecting(id);
    const res = await req(`/api/cloud/accounts/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Account disconnected', 'The account has been removed.'); onChanged(); } else toast.error('Disconnect failed', res.error ?? 'The account could not be disconnected.');
    setDisconnecting(null);
  };

  // /api/cloud/accounts already orders rows by provider ASC, so a stable list
  // of the distinct providers present is enough to build each group - no
  // need for a separate Map.
  const providers = [...new Set(accounts.map((a) => a.provider))];

  return (
    <section id="section-integrations">
      <h2 className="text-base font-semibold mb-3">Integrations</h2>
      <Card>
        <CardContent>
          <div className="flex items-center justify-between py-3 border-b">
            <div className="flex items-center gap-3">
              <img src="/google-color.svg" width="20" height="20" alt="Google" />
              <div>
                <p className="text-sm font-medium">Google Drive</p>
                <p className="text-xs text-muted-foreground">Import files directly from your Google Drive</p>
              </div>
            </div>
            <a href={`${API_BASE}/api/cloud/connect/google`}>
              <Button variant="outline" size="sm" className="text-xs gap-1">
                <Plus className="size-3" /> Connect account
              </Button>
            </a>
          </div>
          {accounts.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No accounts connected</p>
          ) : (
            providers.map((provider) => (
              <div key={provider}>
                {/*
                  PROVIDER_LABELS is keyed by provider id ('google'), NOT by
                  files.import_source ('google-drive') - IMPORT_SOURCE_LABELS
                  looks identical but is the wrong map here. Because of the
                  `?? provider` fallback below, using it wouldn't blank this
                  heading out; it would silently render the raw provider id
                  ("google") instead of "Google Drive" - just as wrong, only
                  quieter, since it still looks like a rendered label rather
                  than an obviously broken one.
                */}
                <p
                  data-testid="provider-group-heading"
                  className="pt-3 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  {PROVIDER_LABELS[provider] ?? provider}
                </p>
                {accounts.filter((a) => a.provider === provider).map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between py-3 border-b last:border-b-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        {PROVIDER_ICONS[acc.provider] ? (
                          <img src={PROVIDER_ICONS[acc.provider]} width="16" height="16" alt="" />
                        ) : (
                          <Plug className="size-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{acc.account_email}</p>
                        <p className="text-[11px] text-muted-foreground">Connected {timeAgo(acc.created_at)}</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="text-xs text-destructive border-destructive/30" onClick={() => disconnect(acc.id)} disabled={disconnecting === acc.id}>
                      {disconnecting === acc.id ? <Loader2 className="size-3 animate-spin" /> : 'Disconnect'}
                    </Button>
                  </div>
                ))}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ── Workspaces ─────────────────────────────────────────────

function WorkspacesSection({ workspaces }: { workspaces: Workspace[] }) {
  return (
    <section id="section-workspaces">
      <h2 className="text-base font-semibold mb-3">My workspaces</h2>
      <Card>
        <CardContent>
          {workspaces.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No workspaces</p>
          ) : (
            workspaces.map((w) => (
              <div key={w.id} className="flex items-center gap-3 py-3 border-b last:border-b-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: w.icon_color }}>
                  {w.icon_initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{w.name}</p>
                  <p className="text-[11px] text-muted-foreground">Joined {timeAgo(w.joined_at)}</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">{w.role_id === 'owner' ? 'Owner' : 'Member'}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ── Delete Account ─────────────────────────────────────────

function DeleteAccountSection() {
  return (
    <section id="section-delete">
      <h2 className="text-base font-semibold text-destructive mb-3">Delete account</h2>
      <Card className="border-destructive/30">
        <CardContent className="divide-y divide-destructive/20">
          <div className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium">Export your data</p>
              <p className="text-xs text-muted-foreground">Download all your files, links and activity before leaving.</p>
            </div>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => toast.info('Not available yet', 'Data export is not available yet.')}>Request export</Button>
          </div>
          <div className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium">Delete account</p>
              <p className="text-xs text-muted-foreground">Permanently deletes your account and all workspaces you own.</p>
            </div>
            <Button variant="destructive" size="sm" className="text-xs" onClick={() => toast.error('Not available yet', 'Account deletion is not available yet. Contact support.')}>
              <Trash2 className="size-3 mr-1.5" /> Delete my account
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ── Shared ─────────────────────────────────────────────────

function SettingRow({ label, desc, badge, children }: { label: string; desc: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          {badge}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SaveBtn({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Button size="sm" className="h-7 text-xs gap-1" onClick={onClick} disabled={loading}>
      {loading ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Save
    </Button>
  );
}

function ProfileSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <div className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-56" /></div>
      </div>
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}><CardContent className="pt-6 space-y-4">
          <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
        </CardContent></Card>
      ))}
    </div>
  );
}
