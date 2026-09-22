import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Eye, EyeOff, FileText, Folder, KeyRound, Loader2, Lock, LockOpen } from 'lucide-react';
import { toast } from '@/lib/toast';
import { humanSize, timeAgo } from '@/lib/helpers';
import {
  LOCK_MODE_OPTIONS, MIN_LOCK_PASSWORD_LENGTH,
  canApplyLock, describeLockMode, describeLockStatus, describeLockTarget,
  lockActionLabel, passwordFieldLabel, passwordHint, type LockMode,
} from '@/lib/lock-mode';

export interface LockTarget {
  id: string;
  name: string;
  type: 'file' | 'folder';
  /** Files: shown in the chip as "PDF · 2.4 MB". */
  size_bytes?: number;
  extension?: string | null;
  /** Folders: shown as "Folder · 128 files · 1.90 GB". */
  file_count?: number;
  total_size_bytes?: number;
  /**
   * The row's own lock_mode. Seeds the dialog so it is right before the GET
   * answers and stays right if the GET fails; the GET adds who and when.
   */
  lock_mode?: string;
}

interface LockModalProps {
  open: boolean;
  target: LockTarget | null;
  onClose: () => void;
  onDone: () => void;
}

const MODE_ICONS: Record<LockMode, typeof Lock> = { none: LockOpen, view_only: Eye, full_lock: KeyRound };

function asLockMode(value: string | undefined): LockMode {
  return value === 'view_only' || value === 'full_lock' ? value : 'none';
}

export function LockModal({ open, target, onClose, onDone }: LockModalProps) {
  // The caller nulls `target` on close, which would unmount the body and
  // collapse the dialog to its title for the length of the exit animation.
  // Remember the last target so the closing dialog keeps its content.
  const [shown, setShown] = useState<LockTarget | null>(target);
  if (target && target !== shown) setShown(target);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      {/* sm: prefix required - a bare max-w-* loses to DialogContent's own sm:max-w-sm. */}
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Lock {shown?.type ?? 'file'}</DialogTitle>
        </DialogHeader>
        {/* Keyed so a different item gets fresh state, not the last one's password. */}
        {shown && <LockModalBody key={shown.id} target={shown} onClose={onClose} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Everything below the title. Split from the Dialog shell so it can be
 * exercised without a portal, and so the shell stays a thin frame.
 *
 * Reads the current lock on mount (GET /lock also says who set it and when,
 * which the old modal fetched and ignored) and writes it on apply. The copy
 * and the button rules live in lib/lock-mode so desktop and mobile say the
 * same things about the same lock_mode.
 */
export function LockModalBody({ target, onClose, onDone }: { target: LockTarget; onClose: () => void; onDone: () => void }) {
  const seed = asLockMode(target.lock_mode);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<LockMode>(seed);
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const [lockedAt, setLockedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<LockMode>(seed);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const [saving, setSaving] = useState(false);

  const endpoint = target.type === 'file' ? `/api/files/${target.id}/lock` : `/api/folders/${target.id}/lock`;
  const isFolder = target.type === 'folder';

  useEffect(() => {
    let cancelled = false;
    api<{ ok: boolean; lock_mode?: string; locked_by_name?: string | null; locked_at?: number | null }>(endpoint)
      .then((data) => {
        if (cancelled || !data.ok) return;
        const mode = asLockMode(data.lock_mode);
        setCurrent(mode);
        setSelected(mode);
        setLockedBy(data.locked_by_name ?? null);
        setLockedAt(data.locked_at ?? null);
      })
      // On a failed read the row's own lock_mode (the seed) stands; only who
      // and when are missing, and the server still validates what is applied.
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [endpoint]);

  const meta = describeLockTarget({
    kind: target.type,
    extension: target.extension,
    file_count: target.file_count,
    size: isFolder
      ? (typeof target.total_size_bytes === 'number' ? humanSize(target.total_size_bytes) : null)
      : (typeof target.size_bytes === 'number' ? humanSize(target.size_bytes) : null),
  });
  const statusLine = loading ? null : describeLockStatus({
    lock_mode: current,
    locked_by_name: lockedBy,
    lockedWhen: lockedAt ? timeAgo(lockedAt) : null,
  });
  const label = lockActionLabel({ selected, current, loading });
  const enabled = canApplyLock({ selected, current, password, loading }) && !saving;

  const pick = (mode: LockMode) => {
    setSelected(mode);
    setTooShort(false);
  };

  const submit = async () => {
    if (saving || loading) return;
    if (selected === 'full_lock' && password.trim().length < MIN_LOCK_PASSWORD_LENGTH) {
      setTooShort(true);
      return;
    }
    if (!canApplyLock({ selected, current, password })) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { lock_mode: selected };
      if (selected === 'full_lock') body.password = password;
      const res = await api<{ ok: boolean; error?: string }>(endpoint, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        toast.error("Couldn't update the lock", res.error ?? 'Try again.');
        return;
      }
      if (selected === 'none') toast.success('Lock removed', `${target.name} is open to everyone in the workspace.`);
      else if (selected === 'view_only') toast.success('View only', `${target.name} can be previewed but not downloaded.`);
      else if (current === 'full_lock') toast.success('Password updated', `${target.name} now needs the new password.`);
      else toast.success('Locked with a password', `${target.name} now needs a password to open.`);
      onDone();
      onClose();
    } catch (err) {
      toast.error("Couldn't update the lock", apiErrorMessage(err, "Can't reach the server. Check your connection and try again."));
    } finally {
      setSaving(false);
    }
  };

  const TargetIcon = isFolder ? Folder : FileText;
  const passwordId = `lock-password-${target.id}`;
  const hintId = `${passwordId}-hint`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`flex size-[34px] shrink-0 items-center justify-center rounded-lg ${isFolder ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground'}`}>
          <TargetIcon className="size-[17px]" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{target.name}</div>
          <div className="text-xs text-muted-foreground">{meta}</div>
        </div>
      </div>

      {statusLine && (
        <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          {current === 'full_lock' ? <Lock className="size-3.5 shrink-0" /> : <Eye className="size-3.5 shrink-0" />}
          <span>{statusLine}</span>
        </div>
      )}

      {loading ? (
        <div data-testid="lock-skeleton" aria-busy="true" className="rounded-[10px] border border-border overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid grid-cols-[16px_1fr] gap-2.5 px-3 py-3 border-t border-border first:border-t-0">
              <span className="size-4 rounded-full bg-muted animate-pulse motion-reduce:animate-none" />
              <div>
                <div className="h-3 w-1/3 rounded-md bg-muted animate-pulse motion-reduce:animate-none mb-2" />
                <div className="h-2.5 w-4/5 rounded-md bg-muted animate-pulse motion-reduce:animate-none" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <RadioGroup
          value={selected}
          onValueChange={(v) => pick(asLockMode(String(v)))}
          aria-label="Access level"
          className="gap-0 rounded-[10px] border border-border overflow-hidden"
        >
          {LOCK_MODE_OPTIONS.map((m) => {
            const on = selected === m.value;
            const Icon = MODE_ICONS[m.value];
            return (
              <div
                key={m.value}
                data-testid={`lock-mode-${m.value}`}
                className={`border-t border-border first:border-t-0 transition-colors ${on ? 'bg-primary/8' : 'hover:bg-muted/40'}`}
              >
                <label className="grid grid-cols-[16px_1fr] gap-2.5 items-start px-3 py-2.5 cursor-pointer">
                  <RadioGroupItem value={m.value} className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium leading-5">
                      <Icon className={`size-[15px] ${on ? 'text-primary' : 'text-muted-foreground'}`} />
                      {m.label}
                    </div>
                    <p className="text-xs text-muted-foreground mt-px max-w-[46ch]">{describeLockMode(target.type, m.value)}</p>
                  </div>
                </label>

                {on && m.value === 'full_lock' && (
                  <div className="px-3 pb-3 pl-[38px]">
                    <Label htmlFor={passwordId} className="text-xs mb-1.5">{passwordFieldLabel(current)}</Label>
                    <div className="relative">
                      <Input
                        id={passwordId}
                        data-testid="lock-password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); setTooShort(false); }}
                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
                        placeholder={current === 'full_lock' ? 'Type a new password' : 'Choose a password'}
                        autoComplete="new-password"
                        spellCheck={false}
                        aria-invalid={tooShort || undefined}
                        aria-describedby={hintId}
                        className="h-9 pr-9 text-sm"
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute right-1 top-1 text-muted-foreground"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff /> : <Eye />}
                      </Button>
                    </div>
                    <p id={hintId} className={`text-xs mt-1.5 ${tooShort ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {tooShort ? `Use at least ${MIN_LOCK_PASSWORD_LENGTH} characters.` : passwordHint(current)}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </RadioGroup>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={!enabled}>
          {saving && <Loader2 className="size-4 animate-spin mr-1.5" />}
          {label}
        </Button>
      </div>
    </div>
  );
}
