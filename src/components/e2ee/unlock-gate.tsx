import { useEffect, useState } from 'react';
import { useE2ee, errorText } from '@/stores/e2ee';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Lock, ShieldCheck, KeyRound, Copy, TriangleAlert, Trash2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { api, apiErrorMessage, ApiError } from '@/api/client';
import { useSession } from '@/stores/session';

/**
 * Gate shown whenever the encrypted workspaces aren't unlocked yet. Resolves
 * first-time (no identity → set up) vs. returning (identity exists → unlock)
 * by asking the store, then renders the matching Card. Never renders or logs
 * a passphrase/recovery key anywhere but their own fields.
 */
export function UnlockGate() {
  const t = useT();
  const hasIdentity = useE2ee((s) => s.hasIdentity);
  const error = useE2ee((s) => errorText(s, t));
  const checkIdentity = useE2ee((s) => s.checkIdentity);

  useEffect(() => {
    checkIdentity();
    // Run once on mount - checkIdentity is a stable store action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center justify-center px-4 py-16">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="size-5" />
        </div>
        <h1 className="text-lg font-semibold">Vault</h1>
        <p className="text-xs text-muted-foreground">
          {t('vault.description.yourFilesAreEncryptedInThisBrowserBeforeTheyEverLeave')}
        </p>
        <a
          href="https://dosya.dev/vault"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80"
        >
          {t('vault.action.whatIsVaultLearnMore')}
        </a>
      </div>

      {/* hasIdentity is null while we're checking, OR when checkIdentity
          couldn't tell (transient error). Only the latter gets an `error` -
          never fall through to Setup here, or a network blip would let
          `setup()` silently overwrite a returning user's real identity keys. */}
      {hasIdentity === null && error && <RetryCard error={error} onRetry={checkIdentity} />}

      {hasIdentity === null && !error && (
        <Card className="w-full">
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      )}

      {hasIdentity === false && <SetupCard error={error} />}
      {hasIdentity === true && <UnlockCard error={error} />}
    </div>
  );
}

/** hasIdentity===null with an error: checkIdentity couldn't determine
 * whether an identity exists (e.g. transient network failure). Deliberately
 * distinct from SetupCard/UnlockCard - offers a retry, not a form that could
 * end up overwriting real keys. */
function RetryCard({ error, onRetry }: { error: string; onRetry: () => void }) {
  const t = useT();
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">{t('vault.error.couldnTCheckEncryptionStatus')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <div className="flex-1">
            <p dir="auto">{error}</p>
            <button type="button" onClick={onRetry} className="mt-1 font-medium underline underline-offset-2">
              {t('common.retry')}
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** First-time Vault setup (also embedded by the Personas first run). */
export function SetupCard({ error }: { error: string | null }) {
  const t = useT();
  const setup = useE2ee((s) => s.setup);
  const busy = useE2ee((s) => s.busy);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);

  const mismatch = confirmTouched && confirm.length > 0 && pass !== confirm;
  const canSubmit = pass.length > 0 && pass === confirm && !busy;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setup(pass);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-primary" /> {t('vault.heading.setUpEncryption')}
        </CardTitle>
        <CardDescription>{t('vault.description.chooseAPassphraseToProtectYourVault')}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          {/* Only ever a real `setup()` submission failure here (e.g. the
              server call failed) - checkIdentity's own "couldn't tell"
              errors never reach this card, since hasIdentity stays `null`
              (not `false`) in that case; see the top-level RetryCard. */}
          {error && <p dir="auto" className="text-xs text-destructive">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="e2ee-setup-pass">{t('vault.label.passphrase')}</Label>
            <Input
              id="e2ee-setup-pass"
              type="password"
              autoComplete="new-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={t('vault.placeholder.enterAStrongPassphrase')}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e2ee-setup-pass-confirm">{t('vault.label.confirmPassphrase')}</Label>
            <Input
              id="e2ee-setup-pass-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onBlur={() => setConfirmTouched(true)}
              placeholder={t('vault.placeholder.reEnterYourPassphrase')}
              disabled={busy}
            />
            {mismatch && <p className="text-xs text-destructive">{t('vault.error.passphrasesDoNotMatch')}</p>}
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {richText(t('vault.error.ifYouLoseThisPassphraseEmphasis1YourRecoveryKeyYourEncrypted'), {
              emphasis1: <strong>{t('vault.label.and')}</strong>,
            })}
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {busy ? t('vault.action.settingUp') : t('common.action.setUp')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

/**
 * Returning user: passphrase unlock, with the two ways out of a forgotten
 * passphrase (2026-09-02 field report, Contract 6). The recovery key is the
 * one shown once at setup; destroying the Vault is the last resort when that
 * is gone too, and is confirmed with the account password or an emailed code.
 * The Personas first run embeds it too.
 */
export function UnlockCard({ error }: { error: string | null }) {
  const t = useT();
  const status = useE2ee((s) => s.status);
  const unlock = useE2ee((s) => s.unlock);
  const unlockWithRecoveryKey = useE2ee((s) => s.unlockWithRecoveryKey);
  const [pass, setPass] = useState('');
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [destroyOpen, setDestroyOpen] = useState(false);
  const unlocking = status === 'unlocking';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (unlocking) return;
    if (mode === 'recovery') {
      if (!recoveryKey.trim()) return;
      unlockWithRecoveryKey(recoveryKey.trim());
    } else {
      if (!pass) return;
      unlock(pass);
    }
  };

  const canSubmit = mode === 'recovery' ? recoveryKey.trim().length > 0 : pass.length > 0;

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {mode === 'recovery'
              ? <><KeyRound className="size-4 text-primary" /> {t('vault.heading.unlockWithRecoveryKey')}</>
              : <><Lock className="size-4 text-primary" /> {t('vault.heading.unlockVault')}</>}
          </CardTitle>
          <CardDescription>
            {mode === 'recovery'
              ? t('vault.description.pasteTheRecoveryKeyYouSavedWhenYouSet')
              : t('vault.description.enterYourPassphraseToDecryptYourFilesInThisBrowser')}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-3">
            {error && <p dir="auto" className="text-xs text-destructive">{error}</p>}
            {mode === 'recovery' ? (
              <div className="space-y-1.5">
                <Label htmlFor="e2ee-recovery-key">{t('vault.label.recoveryKey')}</Label>
                <Input
                  id="e2ee-recovery-key"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  value={recoveryKey}
                  onChange={(e) => setRecoveryKey(e.target.value)}
                  disabled={unlocking}
                  placeholder={t('vault.placeholder.yourRecoveryKey')}
                  className="font-mono"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="e2ee-unlock-pass">{t('vault.label.passphrase')}</Label>
                <Input
                  id="e2ee-unlock-pass"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  disabled={unlocking}
                  placeholder={t('vault.placeholder.yourEncryptionPassphrase')}
                />
              </div>
            )}
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button type="submit" className="w-full" disabled={unlocking || !canSubmit}>
              {unlocking ? t('vault.status.unlocking') : t('common.action.unlock')}
            </Button>
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => setMode(mode === 'recovery' ? 'passphrase' : 'recovery')}
                disabled={unlocking}
              >
                {mode === 'recovery' ? t('vault.action.usePassphrase') : t('vault.action.useRecoveryKey')}
              </button>
              <button
                type="button"
                className="text-destructive/80 underline underline-offset-2 hover:text-destructive"
                onClick={() => setDestroyOpen(true)}
                disabled={unlocking}
              >
                {t('vault.action.destroyVaultAndStartOver')}
              </button>
            </div>
          </CardFooter>
        </form>
      </Card>
      <DestroyVaultDialog open={destroyOpen} onOpenChange={setDestroyOpen} />
    </>
  );
}

/**
 * Last resort for a Vault whose passphrase and recovery key are both lost:
 * delete the identity so setup can run again. Everything encrypted under it
 * is unrecoverable afterwards, which is said in plain words before the
 * button. Confirmed with the account password, or - for an Apple or Google
 * sign-in account, which has no password, and an email-code 2FA account,
 * which the password path refuses - a code mailed to the account address.
 * An authenticator-app account also gives its 2FA code either way.
 */
function DestroyVaultDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const destroyIdentity = useE2ee((s) => s.destroyIdentity);
  const busy = useE2ee((s) => s.busy);
  const hasPassword = useSession((s) => s.user?.has_password) !== false;
  const [twoFaMethod, setTwoFaMethod] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [forceEmailCode, setForceEmailCode] = useState(false);
  const [sending, setSending] = useState(false);
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const useEmailCode = forceEmailCode || !hasPassword || twoFaMethod === 'email';

  useEffect(() => {
    if (!open) return;
    setPassword(''); setEmailCode(''); setCodeSent(false); setForceEmailCode(false); setCode('');
    setConfirmed(false); setLocalError(null); setNeedsCode(false); setTwoFaMethod(null);
    let cancelled = false;
    api<{ ok: boolean; method: string | null }>('/api/me/2fa/status')
      .then((r) => {
        if (cancelled) return;
        setTwoFaMethod(r.method);
        setNeedsCode(r.method === 'totp');
      })
      .catch(() => { /* the server still refuses without a code; the field just appears after the first refusal */ });
    return () => { cancelled = true; };
  }, [open]);

  const sendCode = async () => {
    if (sending || busy) return;
    setSending(true);
    setLocalError(null);
    try {
      await api('/api/e2ee/destroy-request', { method: 'POST' });
      setCodeSent(true);
      toast.success(t('profile.label.weEmailedYouACode'), t('profile.feedback.checkYourInboxForThe6DigitCode'));
    } catch (e) {
      setLocalError(apiErrorMessage(e));
      // 429 within the cooldown means a code from a moment ago is still live
      // (the dialog was closed and reopened): let them type that one.
      if (e instanceof ApiError && e.status === 429) setCodeSent(true);
    } finally {
      setSending(false);
    }
  };

  const proofReady = useEmailCode ? emailCode.length === 6 : password.length > 0;

  const submit = async () => {
    if (!proofReady || busy) return;
    setLocalError(null);
    const proof = useEmailCode ? { code: emailCode } : password;
    const ok = await destroyIdentity(proof, needsCode && code ? code : undefined);
    if (ok) {
      toast.success(t('vault.feedback.vaultDestroyed'), t('vault.feedback.setUpEncryptionAgainWheneverYouAreReady'));
      onOpenChange(false);
      return;
    }
    const state = useE2ee.getState();
    const err = state.error;
    setLocalError(errorText(state, t));
    // Contract 6: 400 `2fa_required` when the account has 2FA and no code
    // came. The store surfaces that code as its sentence (api/error-copy.ts),
    // so match either spelling - the copy can change, the meaning cannot.
    // The password path refused an account it cannot serve (no password, or
    // email-code 2FA): move to the emailed code rather than dead-ending. This
    // must be checked first - the email-2FA refusal also says "two-factor".
    if (err && /emailed code|email codes for two-factor/i.test(err)) setForceEmailCode(true);
    else if (err && /two-factor|2fa/i.test(err)) setNeedsCode(true);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="size-4" /> {t('vault.heading.destroyVaultAndStartOver')}
          </DialogTitle>
        </DialogHeader>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {t('vault.description.thisDeletesYourVaultIdentityEveryFileInEverySpaceYou')}
        </div>
        {localError && <p dir="auto" className="text-xs text-destructive">{localError}</p>}
        {useEmailCode ? (
          codeSent ? (
            <div className="space-y-1.5">
              <Label htmlFor="e2ee-destroy-email-code">{t('profile.label.enterYourCode')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('profile.description.weEmailedYouACodeLengthDigitCodeEnterItToConfirm', { CODE_LENGTH: 6 })}
              </p>
              <Input
                id="e2ee-destroy-email-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={busy}
                placeholder={t('common.placeholder.6DigitCode')}
              />
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={sendCode}
                disabled={sending || busy}
              >
                {t('common.action.resendCode')}
              </button>
            </div>
          ) : (
            <Button type="button" variant="outline" className="w-full" onClick={sendCode} disabled={sending || busy}>
              {t('profile.action.sendCode')}
            </Button>
          )
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="e2ee-destroy-password">{t('vault.label.accountPassword')}</Label>
            <Input
              id="e2ee-destroy-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              placeholder={t('vault.placeholder.yourDosyaPassword')}
            />
          </div>
        )}
        {needsCode && (
          <div className="space-y-1.5">
            <Label htmlFor="e2ee-destroy-code">{t('vault.label.twoFactorCode')}</Label>
            <Input
              id="e2ee-destroy-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\s/g, '').slice(0, 10))}
              disabled={busy}
              placeholder={t('common.placeholder.6DigitCode')}
            />
          </div>
        )}
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={busy}
          />
          <span>{t('vault.error.iUnderstandMyEncryptedFilesCannotBeRecoveredAfterThis')}</span>
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={busy || !proofReady || !confirmed}>
            {busy ? t('vault.action.destroying') : t('vault.action.destroyMyVault')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one-time recovery-key reveal. Deliberately NOT nested only inside
 * `<UnlockGate>`: `setup()` flips `status` to 'unlocked' in the same state
 * update that sets `recoveryKeyOnce`, so by the time this would render,
 * `EncryptedPage` has already swapped from `<UnlockGate>` to
 * `<EncryptedBrowser>` and unmounted the gate. Mounting this dialog at the
 * page level (alongside both branches) means it survives that transition and
 * still blocks the very first view of the encrypted browser until the user
 * confirms they've saved the key.
 */
export function RecoveryKeyDialog() {
  const t = useT();
  const recoveryKeyHex = useE2ee((s) => s.recoveryKeyOnce);
  const dismissRecoveryKey = useE2ee((s) => s.dismissRecoveryKey);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!recoveryKeyHex) return;
    try {
      await navigator.clipboard.writeText(recoveryKeyHex);
      setCopied(true);
      toast.success(t('common.feedback.copied'), t('vault.feedback.recoveryKeyCopiedToClipboard'));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('common.error.copyFailed'), t('vault.error.selectAndCopyTheKeyManually'));
    }
  };

  return (
    <Dialog open={!!recoveryKeyHex} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" /> {t('vault.heading.saveYourRecoveryKey')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {t('vault.description.thisIsTheOnlyTimeThisKeyWillEver')}
        </p>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <code className="flex-1 break-all font-mono text-xs">{recoveryKeyHex}</code>
          <Button type="button" variant="outline" size="icon-sm" onClick={handleCopy} title={t('vault.action.copyRecoveryKey')}>
            <Copy className="size-3.5" />
          </Button>
        </div>
        {copied && <p className="text-[11px] text-green-600">{t('common.description.copiedToClipboard')}</p>}
        <DialogFooter>
          <Button type="button" className="w-full sm:w-auto" onClick={() => dismissRecoveryKey()}>
            {t('vault.action.iVeSavedIt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
