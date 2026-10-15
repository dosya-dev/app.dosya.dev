import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { useSession } from '@/stores/session';
import { toast } from '@/lib/toast';
import {
  CODE_LENGTH, normaliseCode, isCompleteCode, cooldownRemaining,
  describeBlocker, formatScheduledDate, daysRemaining, classifyDeleteError,
  type DeletePreview,
} from '@/lib/account-deletion';
import { Card, CardContent } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Zap } from 'lucide-react';
import { DeleteAccountNowDialog } from '@/components/delete-account-now-dialog';
import { sectionPath, type ProfileContext } from './shared';

// ── Delete Account ─────────────────────────────────────────

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function describeDeletion(preview: DeletePreview | null): string {
  const days = preview?.window_days ?? 30;
  const workspaces = plural(preview?.workspaces.length ?? 0, 'workspace');
  const files = plural(preview?.file_count ?? 0, 'file');
  return `Scheduled for ${days} days later, so you can cancel. Deletes ${workspaces} and ${files}.`;
}

/**
 * `user` is the profile layout's context. Only `has_password` is read, to pick
 * the proof the "Delete immediately" dialog asks for. Optional, because the
 * section is also rendered on its own; with no user it falls back to the
 * emailed code, which works for every account.
 */
export function DeleteAccountSection({ user }: Partial<ProfileContext> = {}) {
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [nowOpen, setNowOpen] = useState(false);
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduledFor, setScheduledFor] = useState<number | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await api<{ ok: boolean } & DeletePreview>('/api/me/delete-preview');
      if (res.ok) {
        setPreview(res);
        setScheduledFor(res.deletion_scheduled_for);
      }
    } catch { /* the section still renders; the action will report its own error */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A live countdown rather than a dead button: the server rejects a resend
  // inside its cooldown, so the control has to say when it will work.
  useEffect(() => {
    if (sentAt == null) return;
    const update = () => setRemaining(cooldownRemaining(sentAt, Date.now()));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  const blockers = preview?.blockers ?? [];
  const nowSeconds = Math.floor(Date.now() / 1000);

  const requestCode = async () => {
    setError(null); setBusy(true);
    try {
      await api('/api/me/delete-request', { method: 'POST' });
      setSentAt(Date.now());
      setStep('code');
    } catch (e) { setError(classifyDeleteError(e).message); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    setError(null); setBusy(true);
    try {
      const res = await api<{ ok: boolean; deletion_scheduled_for: number }>('/api/me', {
        method: 'DELETE',
        body: JSON.stringify({ code }),
      });
      setScheduledFor(res.deletion_scheduled_for);
      setStep('idle');
      // The server signed out every OTHER device and kept this session, so
      // the person lands on the scheduled state with "Cancel deletion" and
      // "Delete immediately" right in front of them. Signing them out here
      // used to strand exactly the person who had just proved themselves.
      toast.success('Deletion scheduled', 'Your other devices were signed out. You can cancel or delete immediately from here.');
      // The layout's banner reads the session store, not this page's state.
      void useSession.getState().fetchMe().catch(() => { /* the banner shows on the next load */ });
    } catch (e) {
      const f = classifyDeleteError(e);
      if (f.kind === 'code_burned') setCode('');
      setError(f.message);
    } finally { setBusy(false); }
  };

  const deletedNow = () => {
    setNowOpen(false);
    // The server has already revoked every session and bearer; the next
    // request would 401. Say so, then leave.
    toast.success('Account deleted', 'Your account is closed and your files are being erased.');
    setTimeout(() => { window.location.href = '/login'; }, 2500);
  };

  const cancel = async () => {
    setError(null); setBusy(true);
    try {
      await api('/api/me/delete-cancel', { method: 'POST' });
      setScheduledFor(null);
      toast.success('Deletion cancelled', 'Your account will not be deleted.');
      // The layout's banner reads the session store, not this page's state.
      void useSession.getState().fetchMe().catch(() => { /* the banner clears on the next load */ });
      await load();
    } catch (e) { setError(classifyDeleteError(e).message); }
    finally { setBusy(false); }
  };

  return (
    <section id="section-delete">
      <h2 className="text-base font-semibold text-destructive mb-3">Delete account</h2>
      <Card className="border-destructive/30">
        <CardContent className="divide-y divide-destructive/20">
          <div className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium">Take a copy of your data first</p>
              <p className="text-xs text-muted-foreground">Everything is destroyed at the end of the countdown. Take a copy before you start.</p>
            </div>
            {/* Privacy is its own page now, so this is a link rather than a scroll. */}
            <Link to={sectionPath('privacy')} className={buttonVariants({ variant: 'outline', size: 'sm', className: 'text-xs' })}>
              Get a copy
            </Link>
          </div>

          <div className="py-4 space-y-3">
            {error && (
              <p className="text-xs text-destructive" data-testid="delete-error">{error}</p>
            )}

            {scheduledFor != null ? (
              <div data-testid="delete-scheduled">
                <p className="text-sm font-medium">Deletion scheduled</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your account and its files will be deleted on{' '}
                  <span className="font-medium text-foreground">{formatScheduledDate(scheduledFor)}</span>
                  {' '}- {daysRemaining(scheduledFor, nowSeconds)} days from now. Nothing has been deleted yet.
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <Button size="sm" className="text-xs" onClick={cancel} disabled={busy} data-testid="cancel-deletion">
                    Cancel deletion
                  </Button>
                  {/* The countdown is a safety net, not a sentence. Someone who
                      has taken their copy can end it here - after proving it is
                      them again, in the dialog. */}
                  <Button
                    variant="outline" size="sm"
                    className="text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setNowOpen(true)} disabled={busy}
                    data-testid="delete-now"
                  >
                    <Zap className="size-3 mr-1.5" /> Delete immediately
                  </Button>
                </div>
                <DeleteAccountNowDialog
                  open={nowOpen}
                  onOpenChange={setNowOpen}
                  preview={preview}
                  scheduledFor={scheduledFor}
                  hasPassword={user?.has_password ?? false}
                  onDeleted={deletedNow}
                />
              </div>
            ) : step === 'code' ? (
              <div data-testid="delete-code-step">
                <p className="text-sm font-medium">Enter your code</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  We emailed you a {CODE_LENGTH}-digit code. Entering it schedules the deletion.
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <Input
                    value={code}
                    onChange={(e) => setCode(normaliseCode(e.target.value))}
                    placeholder="000000"
                    inputMode="numeric"
                    className="w-28 font-mono tracking-[0.3em] text-center"
                    data-testid="delete-code"
                  />
                  <Button
                    variant="destructive" size="sm" className="text-xs"
                    onClick={confirm}
                    disabled={!isCompleteCode(code) || busy}
                    data-testid="confirm-delete"
                  >
                    <Trash2 className="size-3 mr-1.5" /> Delete my account
                  </Button>
                  {remaining > 0 ? (
                    <span className="text-xs text-muted-foreground" data-testid="resend-countdown">
                      {`Resend in ${remaining}s`}
                    </span>
                  ) : (
                    <button className="text-xs underline text-muted-foreground hover:text-foreground" onClick={requestCode} data-testid="resend">
                      Resend code
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Delete account</p>
                  {/* One string, not a run of sibling text nodes. Chrome's page
                      translation detaches text nodes and drops <font> elements
                      in their place; when the preview arrived and the plural
                      "s" went away, React removed a node the browser had
                      already moved and the router's error page replaced the
                      profile. A single text child is set as textContent
                      instead, which survives the rewrite. */}
                  <p className="text-xs text-muted-foreground mt-0.5" data-testid="delete-summary">
                    {describeDeletion(preview)}
                  </p>
                  {blockers.length > 0 && (
                    <ul className="mt-2 space-y-1" data-testid="delete-blockers">
                      {blockers.map((b) => (
                        <li key={b.workspace_id} className="text-xs text-muted-foreground">{describeBlocker(b)}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button
                  variant="destructive" size="sm" className="text-xs shrink-0"
                  onClick={requestCode}
                  disabled={blockers.length > 0 || busy}
                  data-testid="start-delete"
                >
                  <Trash2 className="size-3 mr-1.5" /> Delete my account
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

export default DeleteAccountSection;
