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
    if (newPw !== confirm) { toast.error('Passwords do not match', 'The new password and confirmation are different.'); return; }
    if (newPw.length < 8) { toast.error('Password too short', 'Password must be at least 8 characters'); return; }
    setSaving(true);
    const body = hasPassword ? { current_password: current, new_password: newPw } : { new_password: newPw };
    const res = await req('/api/me/password', { method: 'PUT', body: JSON.stringify(body) });
    if (res.ok) {
      toast.success(hasPassword ? 'Password changed' : 'Password set', hasPassword ? 'Your password has been updated.' : 'You can now sign in with your email and password too.');
      setPasswordModal(false); setCurrent(''); setNewPw(''); setConfirm('');
      if (!hasPassword) onTfaChanged();
    } else toast.error('Update failed', res.error ?? (hasPassword ? 'The password could not be changed.' : 'The password could not be set.'));
    setSaving(false);
  };
  const passwordVerb = hasPassword ? 'Change password' : 'Set a password';

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
            // The rule the API actually enforces is length, both ends: the
            // composition mandates (upper/lower/digit/symbol) were dropped
            // from the shared policy - they push people toward short mangled
            // passwords and reject strong passphrases - so promising them here
            // would describe a check that no longer exists.
            <SettingRow label="Password" desc="At least 8 characters. A long passphrase is stronger than a short mix of symbols.">
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setPasswordModal(true)}>Change password</Button>
            </SettingRow>
          ) : (
            <SettingRow
              label="Password"
              desc="You signed in with Google, GitHub or Apple, so this account has no password yet. Set one to also sign in with email, and to turn two-factor authentication off later."
            >
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">Not set</Badge>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setPasswordModal(true)}>Set a password</Button>
              </div>
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
                Set your password first (above) - turning 2FA off later requires one.
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
              desc="Turning two-factor authentication off requires a password. Set one above first."
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

      {/* Change / set password modal */}
      <Dialog open={passwordModal} onOpenChange={setPasswordModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{passwordVerb}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {hasPassword && (
              <Input type="password" placeholder="Current password" value={current} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrent(e.target.value)} className="h-9 text-sm" />
            )}
            <Input type="password" placeholder="New password" value={newPw} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPw(e.target.value)} className="h-9 text-sm" />
            <Input type="password" placeholder="Confirm new password" value={confirm} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)} className="h-9 text-sm" onKeyDown={(e) => e.key === 'Enter' && changePassword()} />
            <p className="text-[11px] text-muted-foreground">At least 8 characters. A long passphrase is stronger than a short mix of symbols.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordModal(false)}>Cancel</Button>
            <Button onClick={changePassword} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null} {passwordVerb}
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
          <CopyCheck copied={copied} className="size-3" /> {copied ? 'Copied' : 'Copy all'}
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
