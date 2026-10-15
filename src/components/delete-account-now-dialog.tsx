import { useState, useEffect, useCallback } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  CODE_LENGTH, normaliseCode, isCompleteCode, cooldownRemaining, classifyDeleteError, daysRemaining,
  type DeletePreview,
} from '@/lib/account-deletion';

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export interface DeleteAccountNowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Counts for the warning; null while the preview is still loading. */
  preview: DeletePreview | null;
  /** Epoch seconds of the deletion this skips ahead of. */
  scheduledFor: number;
  /**
   * False for OAuth-created accounts, which have no password they were ever
   * told: they prove ownership with an emailed code instead.
   */
  hasPassword: boolean;
  /** The server has accepted: sessions are gone, the account is closing. */
  onDeleted: () => void;
}

/**
 * Confirmation for skipping the rest of the 30-day deletion window.
 *
 * It asks for proof again rather than trusting the open session. The window
 * is what lets the real owner of a hijacked account sign in and cancel; a
 * button that ends it on a click would hand the hijacker the one thing the
 * window withheld. The password is the proof when the account has one, the
 * emailed code when it does not, mirroring POST /api/me/delete-now.
 */
export function DeleteAccountNowDialog({
  open, onOpenChange, preview, scheduledFor, hasPassword, onDeleted,
}: DeleteAccountNowDialogProps) {
  // DialogContent unmounts when closed, so the form's state - the typed
  // password, a half-entered code, an error - resets by construction rather
  // than by an effect.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="delete-now-dialog">
        <DeleteNowForm
          preview={preview} scheduledFor={scheduledFor} hasPassword={hasPassword}
          onDeleted={onDeleted} onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DeleteNowForm({
  preview, scheduledFor, hasPassword, onDeleted, onClose,
}: Omit<DeleteAccountNowDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  // The clock, as state: read once on mount and advanced by the interval
  // below, so nothing impure runs during render.
  const [now, setNow] = useState(() => Date.now());

  // Promise callbacks rather than async/await: the mount effect below calls
  // this, and the compiler lint reads a `catch` in an async function as a
  // synchronous setState inside an effect (api() could throw before its
  // first await). With .then() every setState is provably deferred.
  const requestCode = useCallback(() => api('/api/me/delete-request', { method: 'POST' }).then(
    () => {
      const t = Date.now();
      setSentAt(t);
      setNow(t);
      setError(null);
    },
    (e: unknown) => { setError(classifyDeleteError(e).message); },
  ), []);

  // The code goes out when the dialog opens, not when the user asks: the
  // dialog IS the ask. Password accounts never need one.
  useEffect(() => {
    if (!hasPassword) void requestCode();
  }, [hasPassword, requestCode]);

  useEffect(() => {
    if (sentAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  const remaining = cooldownRemaining(sentAt, now);
  const ready = hasPassword ? password.length > 0 : isCompleteCode(code);

  const confirm = async () => {
    setError(null); setBusy(true);
    try {
      await api('/api/me/delete-now', {
        method: 'POST',
        body: JSON.stringify(hasPassword ? { password } : { code }),
      });
      onDeleted();
    } catch (e) {
      const f = classifyDeleteError(e);
      if (f.kind === 'code_burned') setCode('');
      if (f.kind === 'wrong_password') setPassword('');
      setError(f.message);
    } finally {
      setBusy(false);
    }
  };

  const days = daysRemaining(scheduledFor, Math.floor(now / 1000));
  const files = plural(preview?.file_count ?? 0, 'file');
  const workspaces = plural(preview?.workspaces.length ?? 0, 'workspace');

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete your account now?</DialogTitle>
        <DialogDescription>
          This skips the {plural(days, 'day')} left on your countdown. Your account closes
          immediately and {files} in {workspaces} are permanently erased within the hour.
          This cannot be undone.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        {hasPassword ? (
          <>
            <p className="text-xs text-muted-foreground">Enter your password to confirm.</p>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && ready && !busy) void confirm(); }}
              placeholder="Your password"
              data-testid="delete-now-password"
            />
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              We emailed you a {CODE_LENGTH}-digit code. Enter it to confirm.
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(normaliseCode(e.target.value))}
                onKeyDown={(e) => { if (e.key === 'Enter' && ready && !busy) void confirm(); }}
                placeholder="000000"
                inputMode="numeric"
                className="w-28 font-mono tracking-[0.3em] text-center"
                data-testid="delete-now-code"
              />
              {remaining > 0 ? (
                <span className="text-xs text-muted-foreground" data-testid="delete-now-resend-countdown">
                  {`Resend in ${remaining}s`}
                </span>
              ) : (
                <button
                  type="button"
                  className="text-xs underline text-muted-foreground hover:text-foreground"
                  onClick={() => void requestCode()}
                  data-testid="delete-now-resend"
                >
                  Resend code
                </button>
              )}
            </div>
          </>
        )}
        {error && (
          <p className="text-xs text-destructive" data-testid="delete-now-error">{error}</p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Keep the countdown
        </Button>
        <Button
          variant="destructive"
          onClick={() => void confirm()}
          disabled={!ready || busy}
          data-testid="delete-now-confirm"
        >
          {busy ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Trash2 className="size-4 mr-1.5" />}
          Delete now
        </Button>
      </DialogFooter>
    </>
  );
}

export default DeleteAccountNowDialog;
