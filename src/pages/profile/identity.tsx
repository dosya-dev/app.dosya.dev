import { formatDateWith } from '@/lib/format-locale';
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
import { richText } from '@/lib/rich-text';
import { useT } from '@/lib/i18n';
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
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [bust, setBust] = useState(0);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error(t('common.error.fileTooLarge'), t('profile.error.imageMustBeUnder2Mb')); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const res = await fetch(`${API_BASE}/api/me/avatar`, { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json().catch(() => ({ ok: false })) as OkResult;
      if (res.ok && data.ok) { toast.success(t('profile.feedback.avatarUpdated'), t('profile.feedback.yourNewProfilePhotoIsLive')); setBust(Date.now()); onAvatarChanged(); }
      else toast.error(t('common.error.uploadFailed'), data.error ?? t('common.error.uploadFailed'));
    } catch { toast.error(t('common.error.somethingWentWrong'), t('common.error.canTReachTheServerCheckYourConnectionAnd')); }
    setUploading(false);
  };

  const memberSince = user
    ? t('profile.description.memberSinceFormatteddateUserworkspaceCountPluralOneWorkspaceOther', {
        formattedDate: formatDateWith(user.created_at, { month: 'long', year: 'numeric' }, 'en-US'),
        userWorkspace_count: user.workspace_count,
      })
    : '';
  // avatar_url is an R2 object key, not a URL - the image is served by GET /api/me/avatar.
  const avatarSrc = user?.avatar_url ? `${API_BASE}/api/me/avatar?t=${bust}` : null;

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="relative size-16 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0 group"
        aria-label={t('profile.action.changeAvatar')}
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
  const t = useT();
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
    if (res.ok) { toast.success(t('common.feedback.saved'), t('profile.feedback.yourNameHasBeenUpdated')); onSaved(); } else toast.error(t('common.error.updateFailed'), res.error ?? t('profile.error.theChangeCouldNotBeSaved'));
    setSavingName(false);
  };

  const startEmailChange = () => {
    if (!emailChanged) return;
    setPw(''); setPwModal(true);
  };

  const sendCode = async () => {
    if (!pw) { toast.error(t('common.error.passwordRequired'), t('profile.error.enterYourCurrentPasswordToContinue')); return; }
    setSending(true);
    const res = await req<{ ok: boolean; pending?: boolean; error?: string }>('/api/me/email', {
      method: 'PUT', body: JSON.stringify({ email: email.trim().toLowerCase(), current_password: pw }),
    });
    if (res.ok && res.pending) {
      setPwModal(false); setPendingEmail(email.trim().toLowerCase()); setCode('');
      toast.success(t('profile.feedback.codeSent'), t('profile.feedback.checkYourInboxForThe6DigitCode'));
    } else if (res.ok) {
      setPwModal(false); toast.info(t('profile.feedback.noChangeNeeded'), t('profile.feedback.theEmailAddressIsAlreadySetToThatValue'));
    } else toast.error(t('common.error.updateFailed'), res.error ?? t('profile.error.theVerificationCodeCouldNotBeSent'));
    setSending(false);
  };

  const confirmCode = async () => {
    if (!/^\d{6}$/.test(code)) { toast.error(t('common.error.invalidCode'), t('profile.error.enterThe6DigitCode')); return; }
    setConfirming(true);
    const res = await req<{ ok: boolean; email?: string; error?: string }>('/api/me/email/confirm', {
      method: 'POST', body: JSON.stringify({ code }),
    });
    if (res.ok && res.email) { toast.success(t('profile.feedback.emailUpdated'), t('profile.feedback.yourEmailAddressHasBeenChanged')); setPendingEmail(null); onSaved(); }
    else toast.error(t('common.error.verificationFailed'), res.error ?? t('profile.error.theCodeCouldNotBeVerified'));
    setConfirming(false);
  };

  return (
    <section id="section-identity">
      <h2 className="text-base font-semibold mb-3">{t('profile.heading.identity')}</h2>
      <Card>
        <CardContent className="divide-y">
          <SettingRow label={t('profile.label.fullName')} desc={t('profile.description.visibleToTeammatesAcrossAllWorkspaces')}>
            <div className="flex items-center gap-2">
              <Input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="h-8 text-xs w-48" />
              <SaveBtn loading={savingName} onClick={saveName} />
            </div>
          </SettingRow>

          <SettingRow
            label={t('profile.label.emailAddress')}
            desc={t('profile.description.usedForLoginNotificationsAndBilling')}
            badge={user && (
              user.email_verified_at
                ? <Badge className="text-[10px] bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 border-transparent">{t('profile.status.verified')}</Badge>
                : <Badge variant="secondary" className="text-[10px]">{t('profile.status.unverified')}</Badge>
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
                  <Badge variant="secondary" className="text-[10px]">{t('common.status.pending')}</Badge>
                ) : emailChanged ? (
                  <Button size="sm" className="h-7 text-xs" onClick={startEmailChange}>{t('profile.action.change')}</Button>
                ) : null}
              </div>
              {pendingEmail && (
                <div className="flex items-center gap-2">
                  <Input
                    value={code}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder={t('common.placeholder.6DigitCode')}
                    inputMode="numeric"
                    className="h-8 text-xs w-28 text-center tracking-[4px] font-semibold"
                    onKeyDown={(e) => e.key === 'Enter' && confirmCode()}
                  />
                  <Button size="sm" className="h-7 text-xs" onClick={confirmCode} disabled={confirming}>
                    {confirming ? <Loader2 className="size-3 animate-spin" /> : t('profile.action.confirm')}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setPendingEmail(null); setEmail(user?.email ?? ''); }}>{t('common.cancel')}</Button>
                </div>
              )}
            </div>
          </SettingRow>
        </CardContent>
      </Card>

      {/* Password confirm modal for email change */}
      <Dialog open={pwModal} onOpenChange={setPwModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('profile.heading.confirmYourPassword')}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">{richText(t('profile.description.enterYourCurrentPasswordToSendAVerificationCodeToEmail', { email: '{email}' }), { email: <span className="font-medium">{email}</span> })}</p>
          <Input type="password" placeholder={t('profile.placeholder.currentPassword')} value={pw} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPw(e.target.value)} className="h-9 text-sm" onKeyDown={(e) => e.key === 'Enter' && sendCode()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={sendCode} disabled={sending}>
              {sending ? <Loader2 className="size-4 animate-spin me-1.5" /> : <Mail className="size-4 me-1.5" />} {t('profile.action.sendCode')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
