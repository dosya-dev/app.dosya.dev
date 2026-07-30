import { useEffect, useState } from 'react';
import { useE2ee } from '@/stores/e2ee';
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
import { Lock, ShieldCheck, KeyRound, Copy, TriangleAlert } from 'lucide-react';
import { toast } from '@/lib/toast';

/**
 * Gate shown whenever the encrypted workspaces aren't unlocked yet. Resolves
 * first-time (no identity → set up) vs. returning (identity exists → unlock)
 * by asking the store, then renders the matching Card. Never renders or logs
 * a passphrase/recovery key anywhere but their own fields.
 */
export function UnlockGate() {
  const hasIdentity = useE2ee((s) => s.hasIdentity);
  const error = useE2ee((s) => s.error);
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
          Your files are encrypted in this browser before they ever leave your device. dosya only ever
          stores ciphertext.
        </p>
        <a
          href="https://dosya.dev/vault"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80"
        >
          What is Vault? Learn more
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
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">Couldn&apos;t check encryption status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            <button type="button" onClick={onRetry} className="mt-1 font-medium underline underline-offset-2">
              Retry
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SetupCard({ error }: { error: string | null }) {
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
          <ShieldCheck className="size-4 text-primary" /> Set up encryption
        </CardTitle>
        <CardDescription>Choose a passphrase to protect your Vault.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          {/* Only ever a real `setup()` submission failure here (e.g. the
              server call failed) - checkIdentity's own "couldn't tell"
              errors never reach this card, since hasIdentity stays `null`
              (not `false`) in that case; see the top-level RetryCard. */}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="e2ee-setup-pass">Passphrase</Label>
            <Input
              id="e2ee-setup-pass"
              type="password"
              autoComplete="new-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="Enter a strong passphrase"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e2ee-setup-pass-confirm">Confirm passphrase</Label>
            <Input
              id="e2ee-setup-pass-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onBlur={() => setConfirmTouched(true)}
              placeholder="Re-enter your passphrase"
              disabled={busy}
            />
            {mismatch && <p className="text-xs text-destructive">Passphrases do not match.</p>}
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            If you lose this passphrase <strong>and</strong> your recovery key, your encrypted files are
            unrecoverable. We cannot reset it.
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {busy ? 'Setting up…' : 'Set up'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function UnlockCard({ error }: { error: string | null }) {
  const status = useE2ee((s) => s.status);
  const unlock = useE2ee((s) => s.unlock);
  const [pass, setPass] = useState('');
  const unlocking = status === 'unlocking';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pass || unlocking) return;
    unlock(pass);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="size-4 text-primary" /> Unlock Vault
        </CardTitle>
        <CardDescription>Enter your passphrase to decrypt your files in this browser.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="e2ee-unlock-pass">Passphrase</Label>
            <Input
              id="e2ee-unlock-pass"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              disabled={unlocking}
              placeholder="Your encryption passphrase"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={unlocking || !pass}>
            {unlocking ? 'Unlocking…' : 'Unlock'}
          </Button>
        </CardFooter>
      </form>
    </Card>
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
  const recoveryKeyHex = useE2ee((s) => s.recoveryKeyOnce);
  const dismissRecoveryKey = useE2ee((s) => s.dismissRecoveryKey);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!recoveryKeyHex) return;
    try {
      await navigator.clipboard.writeText(recoveryKeyHex);
      setCopied(true);
      toast.success('Copied', 'Recovery key copied to clipboard.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed', 'Select and copy the key manually.');
    }
  };

  return (
    <Dialog open={!!recoveryKeyHex} onOpenChange={() => {}}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" /> Save your recovery key
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          This is the only time this key will ever be shown. Store it somewhere safe, in a password manager
          or an offline note. If you forget your passphrase, this key is the only way to recover your
          encrypted files.
        </p>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <code className="flex-1 break-all font-mono text-xs">{recoveryKeyHex}</code>
          <Button type="button" variant="outline" size="icon-sm" onClick={handleCopy} title="Copy recovery key">
            <Copy className="size-3.5" />
          </Button>
        </div>
        {copied && <p className="text-[11px] text-green-600">Copied to clipboard.</p>}
        <DialogFooter>
          <Button type="button" className="w-full sm:w-auto" onClick={() => dismissRecoveryKey()}>
            I&apos;ve saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
