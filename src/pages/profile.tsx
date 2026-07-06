import { useState, useEffect, useCallback, useRef } from 'react';
import { api, API_BASE, ApiError } from '@/api/client';
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
  User, Lock, Key, Monitor, Bell, Plug, Building2, Trash2,
  Plus, Copy, Check, Loader2, LogOut, X, Camera, ShieldCheck,
  Smartphone, Download, RefreshCw, Mail,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { timeAgo } from '@/lib/helpers';

// ── Types ──────────────────────────────────────────────────

interface UserProfile {
  id: string; name: string; email: string; initials: string;
  avatar_url: string | null; preferred_language: string;
  created_at: number; email_verified_at: number | null; workspace_count: number;
}
interface TfaStatus {
  method: string | null; totp_enabled: boolean; recovery_codes_remaining: number;
}
interface ApiKey {
  id: string; name: string; scope: string; key_prefix: string;
  created_at: number; s3_access_key_id: string | null;
}
interface Session {
  id: string; ip: string; user_agent: string; login_method: string;
  created_at: number; last_active_at: number; is_current: boolean;
}
interface Workspace {
  id: string; name: string; icon_initials: string; icon_color: string;
  role_id: string; joined_at: number;
}
interface DriveAccount {
  id: string; google_email: string; google_name: string; created_at: number;
}

const NAV = [
  { id: 'identity', label: 'Identity', icon: User, group: 'Profile' },
  { id: 'password', label: 'Password & 2FA', icon: Lock, group: 'Profile' },
  { id: 'api', label: 'API keys', icon: Key, group: 'Profile' },
  { id: 'sessions', label: 'Sessions', icon: Monitor, group: 'Profile' },
  { id: 'notifications', label: 'Notifications', icon: Bell, group: 'Profile' },
  { id: 'integrations', label: 'Integrations', icon: Plug, group: 'Profile' },
  { id: 'workspaces', label: 'My workspaces', icon: Building2, group: 'Workspaces' },
  { id: 'delete', label: 'Delete account', icon: Trash2, group: 'Danger', danger: true },
];

const SCOPE_LABELS: Record<string, string> = { full: 'Full access', read: 'Read only', upload: 'Upload only' };

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
    return { ok: false, error: 'Network error' } as T;
  }
}

// ── Page ───────────────────────────────────────────────────

export default function ProfilePage() {
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
    const res = await req<{ ok: boolean; accounts: DriveAccount[] }>('/api/drive/accounts');
    if (res.ok) setDriveAccounts(res.accounts);
  }, []);

  const load = useCallback(async () => {
    const wsRes = await req<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
    if (wsRes.ok) setWorkspaces(wsRes.workspaces);
    await Promise.all([loadProfile(), load2fa(), loadKeys(), loadSessions(), loadDrive()]);
    setLoading(false);
  }, [loadProfile, load2fa, loadKeys, loadSessions, loadDrive]);

  useEffect(() => { load(); }, [load]);

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
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors mb-0.5 ${activeSection === n.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'} ${n.danger ? 'text-destructive' : ''}`}
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
        <PasswordSection tfa={tfa} onTfaChanged={load2fa} />
        <ApiKeysSection keys={keys} onChanged={loadKeys} />
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
    } catch { toast.error('Something went wrong', 'Network error'); }
    setUploading(false);
  };

  const memberSince = user
    ? `Member since ${new Date(user.created_at * 1000).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} · ${user.workspace_count} workspace${user.workspace_count === 1 ? '' : 's'}`
    : '';
  // avatar_url is an R2 object key, not a URL — the image is served by GET /api/me/avatar.
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

// ── Password & 2FA ─────────────────────────────────────────

function PasswordSection({ tfa, onTfaChanged }: { tfa: TfaStatus | null; onTfaChanged: () => void }) {
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
          <SettingRow label="Password" desc="Min. 8 characters. Mix of upper, lower, and numbers.">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setPasswordModal(true)}>Change password</Button>
          </SettingRow>

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
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setDisableModal(true)}>Disable</Button>
              </div>
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

          {method === 'totp' && (
            <SettingRow label="Recovery codes" desc={`${tfa?.recovery_codes_remaining ?? 0} of 10 codes remaining`}>
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setRegenModal(true)}>
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

  useEffect(() => {
    if (!open) { setSecret(''); setUri(''); setCode(''); setCodes(null); return; }
    (async () => {
      const res = await req<{ ok: boolean; secret?: string; uri?: string; error?: string }>('/api/me/2fa/setup-totp', { method: 'POST' });
      if (res.ok && res.secret && res.uri) { setSecret(res.secret); setUri(res.uri); }
      else toast.error('Setup failed', res.error ?? 'Authenticator setup could not be started.');
    })();
  }, [open]);

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
              {uri ? (
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`} alt="QR code" width={180} height={180} className="rounded-md border" />
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

function ApiKeysSection({ keys, onChanged }: { keys: ApiKey[]; onChanged: () => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyScope, setKeyScope] = useState('full');
  const [creating, setCreating] = useState(false);
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // S3 modal
  const [s3Open, setS3Open] = useState(false);
  const [s3Loading, setS3Loading] = useState(false);
  const [s3Creds, setS3Creds] = useState<S3Creds | null>(null);

  const createKey = async () => {
    if (!keyName.trim()) return;
    setCreating(true);
    const res = await req<{ ok: boolean; key?: { plain_key: string }; error?: string }>('/api/me/api-keys', {
      method: 'POST', body: JSON.stringify({ name: keyName.trim(), scope: keyScope }),
    });
    if (res.ok && res.key) { setPlainKey(res.key.plain_key); setCreateOpen(false); setKeyName(''); onChanged(); }
    else toast.error('Create failed', res.error ?? 'The API key could not be created.');
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
      secret_access_key: '(secret key is not retrievable — delete and recreate the key to rotate)',
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
          <div className="grid grid-cols-[1.2fr_1.3fr_0.8fr_0.7fr_auto_36px] gap-2 px-1 pb-2 border-b">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Name</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Token</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Scope</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Created</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">S3</span>
            <span />
          </div>
          {/* Rows */}
          {keys.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No API keys yet</p>
          ) : (
            keys.map((k) => (
              <div key={k.id} className="grid grid-cols-[1.2fr_1.3fr_0.8fr_0.7fr_auto_36px] gap-2 px-1 py-3 border-b last:border-b-0 items-center group">
                <span className="text-xs font-medium truncate">{k.name}</span>
                <span className="text-[11px] text-muted-foreground font-mono">dos_···· {k.key_prefix.slice(0, 4)}</span>
                <Badge variant={k.scope === 'full' ? 'default' : 'secondary'} className="text-[10px] w-fit">{SCOPE_LABELS[k.scope] ?? k.scope}</Badge>
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
                <Button variant="outline" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-destructive border-destructive/30" onClick={() => deleteKey(k.id)}>
                  <X className="size-3" />
                </Button>
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
          <div className="space-y-3">
            <Input placeholder="Key name" value={keyName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyName(e.target.value)} className="h-9 text-sm" />
            <Select value={keyScope} onValueChange={(v) => setKeyScope(v as string)} items={SCOPE_LABELS}>
              <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SCOPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createKey} disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null} Generate key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

  const parseUA = (ua: string | null | undefined) => {
    if (!ua) return 'Browser';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    return 'Browser';
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
                    <Monitor className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{parseUA(s.user_agent)} {s.is_current && <Badge className="ml-1 text-[9px] bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400">Current</Badge>}</p>
                    <p className="text-[11px] text-muted-foreground">{s.ip} · {s.login_method} · {timeAgo(s.last_active_at)}</p>
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

function NotificationsSection() {
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    (async () => {
      const res = await req<{ ok: boolean; preferences?: Record<string, boolean> }>('/api/me/notifications');
      if (res.ok && res.preferences) setPrefs(res.preferences);
      else setPrefs({});
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

  const loading = prefs === null;

  return (
    <section id="section-notifications">
      <h2 className="text-base font-semibold mb-3">Notifications</h2>
      <Card>
        <CardContent>
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

function IntegrationsSection({ accounts, onChanged }: { accounts: DriveAccount[]; onChanged: () => void }) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const disconnect = async (id: string) => {
    setDisconnecting(id);
    const res = await req(`/api/drive/accounts/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Account disconnected', 'The Google account has been removed.'); onChanged(); } else toast.error('Disconnect failed', res.error ?? 'The account could not be disconnected.');
    setDisconnecting(null);
  };

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
            <a href={`${API_BASE}/api/drive/connect`}>
              <Button variant="outline" size="sm" className="text-xs gap-1">
                <Plus className="size-3" /> Connect account
              </Button>
            </a>
          </div>
          {accounts.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No Google accounts connected</p>
          ) : (
            accounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between py-3 border-b last:border-b-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <img src="/google-color.svg" width="16" height="16" alt="" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{acc.google_email}</p>
                    <p className="text-[11px] text-muted-foreground">Connected {timeAgo(acc.created_at)}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="text-xs text-destructive border-destructive/30" onClick={() => disconnect(acc.id)} disabled={disconnecting === acc.id}>
                  {disconnecting === acc.id ? <Loader2 className="size-3 animate-spin" /> : 'Disconnect'}
                </Button>
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
