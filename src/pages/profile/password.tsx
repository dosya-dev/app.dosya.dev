import { useState, useEffect, useCallback } from 'react';
import { req } from '@/api/req';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, ShieldCheck, Smartphone, Download, RefreshCw } from 'lucide-react';
import { CopyCheck } from '@/components/ui/copy-check';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import { SettingRow, type ProfileContext, type TfaStatus } from './shared';

export default function PasswordPage({ user }: ProfileContext) {
  const [tfa, setTfa] = useState<TfaStatus | null>(null);

  const load2fa = useCallback(async () => {
    const res = await req<{ ok: boolean } & TfaStatus>('/api/me/2fa/status');
    if (res.ok) setTfa({ method: res.method, totp_enabled: res.totp_enabled, recovery_codes_remaining: res.recovery_codes_remaining });
  }, []);

  useEffect(() => { void load2fa(); }, [load2fa]);

  // Default to true while /api/me is loading: better to show an action that may
  // 401 than to hide a working one from someone who does have a password.
  return <PasswordSection tfa={tfa} onTfaChanged={load2fa} hasPassword={user?.has_password ?? true} />;
}

// ── Password & 2FA ─────────────────────────────────────────

export function PasswordSection({ tfa, onTfaChanged, hasPassword }: { tfa: TfaStatus | null; onTfaChanged: () => void; hasPassword: boolean }) {
  const t = useT();
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

  // Contract 7 (2026-09-02 field report): an account created through OAuth has
  // no password to confirm, so the API accepts a missing current_password
  // while password_set_at IS NULL. The dialog reads "Set a password" and asks
  // only for the new one.
  const changePassword = async () => {
    if (newPw !== confirm) { toast.error(t('profile.error.passwordsDoNotMatch'), t('profile.error.theNewPasswordAndConfirmationAreDifferent')); return; }
    if (newPw.length < 8) { toast.error(t('profile.error.passwordTooShort'), t('profile.error.passwordMustBeAtLeast8Characters', { min: 8 })); return; }
    setSaving(true);
    const body = hasPassword ? { current_password: current, new_password: newPw } : { new_password: newPw };
    const res = await req('/api/me/password', { method: 'PUT', body: JSON.stringify(body) });
    if (res.ok) {
      toast.success(
        hasPassword ? t('profile.feedback.passwordChanged') : t('profile.feedback.passwordSet'),
        hasPassword ? t('profile.feedback.yourPasswordHasBeenUpdated') : t('profile.feedback.youCanNowSignInWithYourEmailAndPasswordToo'),
      );
      setPasswordModal(false); setCurrent(''); setNewPw(''); setConfirm('');
      if (!hasPassword) onTfaChanged();
    } else toast.error(t('common.error.updateFailed'), res.error ?? (hasPassword ? t('profile.error.thePasswordCouldNotBeChanged') : t('profile.error.thePasswordCouldNotBeSet')));
    setSaving(false);
  };
  const passwordVerb = hasPassword ? t('profile.label.changePassword') : t('profile.label.setAPassword');

  const enableEmail = async () => {
    setEnablingEmail(true);
    const res = await req('/api/me/2fa/enable-email', { method: 'POST' });
    if (res.ok) { toast.success(t('profile.feedback.enabled'), t('profile.feedback.emailTwoFactorAuthenticationIsNowOn')); onTfaChanged(); } else toast.error(t('common.error.updateFailed'), res.error ?? t('profile.error.emailTwoFactorAuthenticationCouldNotBeEnabled'));
    setEnablingEmail(false);
  };

  const method = tfa?.method ?? null;

  return (
    <section id="section-password">
      <h2 className="text-base font-semibold mb-3">{t('profile.heading.passwordTwoFactorAuth')}</h2>
      <Card>
        <CardContent className="divide-y">
          {hasPassword ? (
            // The rule the API actually enforces is length, both ends: the
            // composition mandates (upper/lower/digit/symbol) were dropped
            // from the shared policy - they push people toward short mangled
            // passwords and reject strong passphrases - so promising them here
            // would describe a check that no longer exists.
            <SettingRow label={t('common.label.password')} desc={t('profile.description.atLeast8CharactersALongPassphraseIsStrongerThanA')}>
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setPasswordModal(true)}>{t('profile.action.changePassword')}</Button>
            </SettingRow>
          ) : (
            <SettingRow
              label={t('common.label.password')}
              desc={t('profile.description.youSignedInWithGoogleGithubOrAppleSoThisAccount')}
            >
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">{t('profile.status.notSet')}</Badge>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setPasswordModal(true)}>{t('profile.action.setAPassword')}</Button>
              </div>
            </SettingRow>
          )}

          <SettingRow
            label={t('common.heading.twoFactorAuthentication')}
            desc={
              method === 'email' ? t('profile.description.enabledViaEmailACodeIsSentOnEachLogin')
                : method === 'totp' ? t('profile.description.enabledViaAuthenticatorApp')
                : t('profile.description.notEnabledAddASecondVerificationStepToSecureYourAccount')
            }
          >
            {method ? (
              <div className="flex items-center gap-2">
                <Badge className="text-[10px] gap-1"><ShieldCheck className="size-3" />{method === 'totp' ? t('profile.status.authenticator') : t('profile.status.email')}</Badge>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setDisableModal(true)} disabled={!hasPassword}>{t('profile.action.disable')}</Button>
              </div>
            ) : !hasPassword ? (
              // Enrolling needs no password but disabling verifies one, so without a
              // password this is a one-way door. Block the door, don't just warn later.
              <p className="text-[11px] text-muted-foreground max-w-[16rem] text-end">
                {t('profile.description.setYourPasswordFirstAboveTurning2faOffLaterRequires')}
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={enableEmail} disabled={enablingEmail}>
                  {enablingEmail ? <Loader2 className="size-3 animate-spin me-1" /> : null} {t('profile.action.enableEmail2fa')}
                </Button>
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setTotpModal(true)}>
                  <Smartphone className="size-3" /> {t('profile.action.enableAuthenticator')}
                </Button>
              </div>
            )}
          </SettingRow>

          {method && !hasPassword && (
            <SettingRow
              label={t('common.error.passwordRequired')}
              desc={t('profile.description.turningTwoFactorAuthenticationOffRequiresAPasswordSetOneAboveFirst')}
            >
              <span />
            </SettingRow>
          )}

          {method === 'totp' && (
            <SettingRow label={t('profile.heading.recoveryCodes')} desc={t('profile.label.tfarecoveryCodesRemainingOf10CodesRemaining', { tfaRecovery_codes_remaining: tfa?.recovery_codes_remaining ?? 0 })}>
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setRegenModal(true)} disabled={!hasPassword}>
                <RefreshCw className="size-3" /> {t('profile.action.regenerateCodes')}
              </Button>
            </SettingRow>
          )}
        </CardContent>
      </Card>

      {/* Change / set password modal */}
      <Dialog open={passwordModal} onOpenChange={setPasswordModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{passwordVerb}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {hasPassword && (
              <Input type="password" placeholder={t('profile.placeholder.currentPassword')} value={current} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrent(e.target.value)} className="h-9 text-sm" />
            )}
            <Input type="password" placeholder={t('profile.placeholder.newPassword')} value={newPw} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPw(e.target.value)} className="h-9 text-sm" />
            <Input type="password" placeholder={t('profile.placeholder.confirmNewPassword')} value={confirm} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)} className="h-9 text-sm" onKeyDown={(e) => e.key === 'Enter' && changePassword()} />
            <p className="text-[11px] text-muted-foreground">{t('profile.description.atLeast8CharactersALongPassphraseIsStrongerThanA')}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={changePassword} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin me-1.5" /> : null} {passwordVerb}
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
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copyAll = async () => {
    await navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const download = () => {
    const body = `${t('profile.description.dosyaDevRecoveryCodesFile', { codesJoin: codes.join('\n') })}\n`;
    const blob = new Blob([body], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dosya-recovery-codes.txt';
    a.click();
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('profile.description.saveTheseRecoveryCodesSomewhereSafeEachCanBeUsedOnce')}</p>
      <div className="grid grid-cols-2 gap-1.5 bg-muted p-3 rounded-md">
        {codes.map((c) => <code dir="ltr" key={c} className="text-[11px] font-mono text-center">{c}</code>)}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="text-xs flex-1 gap-1" onClick={copyAll}>
          <CopyCheck copied={copied} className="size-3" /> {copied ? t('common.action.copied') : t('profile.action.copyAll')}
        </Button>
        <Button variant="outline" size="sm" className="text-xs flex-1 gap-1" onClick={download}>
          <Download className="size-3" /> {t('common.action.download')}
        </Button>
      </div>
    </div>
  );
}

function TotpSetupModal({ open, onOpenChange, onEnabled }: { open: boolean; onOpenChange: (v: boolean) => void; onEnabled: () => void }) {
  const t = useT();
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
      else toast.error(t('profile.error.setupFailed'), res.error ?? t('profile.error.authenticatorSetupCouldNotBeStarted'));
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
        if (!cancelled) toast.error(t('profile.error.setupFailed'), t('profile.error.couldNotRenderTheQrCode'));
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
    else toast.error(t('common.error.verificationFailed'), res.error ?? t('profile.error.theCodeCouldNotBeVerified'));
    setVerifying(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{codes ? t('profile.heading.recoveryCodes') : t('profile.heading.setUpAuthenticatorApp')}</DialogTitle></DialogHeader>
        {codes ? (
          <>
            <RecoveryCodes codes={codes} />
            <DialogFooter><Button onClick={() => onOpenChange(false)}>{t('common.done')}</Button></DialogFooter>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t('profile.description.scanThisQrCodeWithYourAuthenticatorAppThenEnterThe')}</p>
            <div className="flex justify-center">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={t('profile.alternative.qrCode')} width={180} height={180} className="rounded-md border" />
              ) : <Skeleton className="size-[180px]" />}
            </div>
            {secret && <code dir="ltr" className="block text-[11px] bg-muted px-3 py-2 rounded-md break-all text-center font-mono">{secret}</code>}
            <Input
              value={code}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('common.placeholder.6DigitCode')} inputMode="numeric"
              className="h-9 text-sm text-center tracking-[6px] font-semibold"
              onKeyDown={(e) => e.key === 'Enter' && verify()}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button onClick={verify} disabled={verifying || code.length !== 6}>
                {verifying ? <Loader2 className="size-4 animate-spin me-1.5" /> : null} {t('profile.action.verifyEnable')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableTfaModal({ open, onOpenChange, onDisabled }: { open: boolean; onOpenChange: (v: boolean) => void; onDisabled: () => void }) {
  const t = useT();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setPw(''); }, [open]);

  const disable = async () => {
    if (!pw) { toast.error(t('common.error.passwordRequired'), t('profile.error.enterYourCurrentPasswordToContinue')); return; }
    setBusy(true);
    const res = await req('/api/me/2fa/disable', { method: 'POST', body: JSON.stringify({ password: pw }) });
    if (res.ok) { toast.success(t('profile.feedback.disabled'), t('profile.feedback.twoFactorAuthenticationIsNowOff')); onOpenChange(false); onDisabled(); }
    else toast.error(t('common.error.updateFailed'), res.error ?? t('profile.error.twoFactorAuthenticationCouldNotBeDisabled'));
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('profile.heading.disableTwoFactorAuthentication')}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{t('profile.description.enterYourPasswordToTurnOff2faYourAccountWillBe')}</p>
        <Input type="password" placeholder={t('profile.placeholder.currentPassword')} value={pw} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPw(e.target.value)} className="h-9 text-sm" onKeyDown={(e) => e.key === 'Enter' && disable()} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={disable} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin me-1.5" /> : null} {t('profile.action.disable2FA')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegenCodesModal({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const t = useT();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  useEffect(() => { if (!open) { setPw(''); setCodes(null); } }, [open]);

  const regen = async () => {
    if (!pw) { toast.error(t('common.error.passwordRequired'), t('profile.error.enterYourCurrentPasswordToContinue')); return; }
    setBusy(true);
    const res = await req<{ ok: boolean; recovery_codes?: string[]; error?: string }>('/api/me/2fa/recovery-codes', {
      method: 'POST', body: JSON.stringify({ password: pw }),
    });
    if (res.ok && res.recovery_codes) { setCodes(res.recovery_codes); onDone(); }
    else toast.error(t('common.error.updateFailed'), res.error ?? t('profile.error.yourRecoveryCodesCouldNotBeRegenerated'));
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('profile.heading.regenerateRecoveryCodes')}</DialogTitle></DialogHeader>
        {codes ? (
          <>
            <RecoveryCodes codes={codes} />
            <DialogFooter><Button onClick={() => onOpenChange(false)}>{t('common.done')}</Button></DialogFooter>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t('profile.error.thisInvalidatesYourExistingCodesEnterYourPasswordToContinue')}</p>
            <Input type="password" placeholder={t('profile.placeholder.currentPassword')} value={pw} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPw(e.target.value)} className="h-9 text-sm" onKeyDown={(e) => e.key === 'Enter' && regen()} />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button onClick={regen} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin me-1.5" /> : null} {t('profile.action.regenerate')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
