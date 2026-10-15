import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '@/api/client';
import { req, type OkResult } from '@/api/req';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Camera, Mail } from 'lucide-react';
import { toast } from '@/lib/toast';
import { SettingRow, SaveBtn, type ProfileContext, type UserProfile } from './shared';

export default function IdentityPage({ user, reloadUser }: ProfileContext) {
  return (
    <div className="space-y-8">
      <ProfileHero user={user} onAvatarChanged={reloadUser} />
      <IdentitySection user={user} onSaved={reloadUser} />
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


// the interface is English only today, and the old "Preferred language"
// dropdown saved nothing and changed nothing.
export function IdentitySection({ user, onSaved }: { user: UserProfile | null; onSaved: () => void }) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [savingName, setSavingName] = useState(false);

  // Email change flow
  const [pwModal, setPwModal] = useState(false);
  const [pw, setPw] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (user) { setName(user.name); setEmail(user.email); }
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
