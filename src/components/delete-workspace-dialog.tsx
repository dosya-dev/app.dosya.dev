/**
 * The three-step gate in front of workspace deletion.
 *
 * Deleting a workspace destroys every file in it, permanently, with no restore
 * path on our side either. It used to sit behind one "Delete workspace" button
 * and a single "Cannot be undone" sentence - the same weight as dismissing a
 * toast. This makes the cost explicit and hard to click through by accident:
 *
 *   1. Review    - the actual numbers: files, bytes, folders, people.
 *   2. Verify    - a 6-digit code mailed to the owner. Proves whoever is
 *                  clicking also holds the inbox, not just a live session, and
 *                  gives the real owner an out-of-band warning if they don't.
 *   3. Confirm   - retype the workspace name, so the last action is deliberate
 *                  and specific to THIS workspace rather than muscle memory.
 *
 * The server enforces all three independently (see the DELETE handler); nothing
 * here is the actual gate. This is the part that makes the gate legible.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Mail, Check, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/api/client';
import { humanSize } from '@/lib/helpers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface DeletePreview {
  ok: boolean;
  workspace_name: string;
  file_count: number;
  total_bytes: number;
  folder_count: number;
  member_count: number;
  /** Server-side reasons this deletion would be refused: 'has_members' | 'last_workspace'. */
  blockers: string[];
}

const BLOCKER_COPY: Record<string, string> = {
  has_members:
    'This workspace still has other members. Remove them (or transfer ownership) before deleting it.',
  last_workspace:
    'This is your only workspace. Create another one first - an account must always have at least one.',
};

type Step = 'review' | 'verify' | 'confirm' | 'deleting';

const STEP_ORDER: Step[] = ['review', 'verify', 'confirm'];

interface DeleteWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Called after the workspace is gone, so the caller can navigate away. */
  onDeleted: () => void;
}

export function DeleteWorkspaceDialog({ open, onOpenChange, workspaceId, onDeleted }: DeleteWorkspaceDialogProps) {
  const [step, setStep] = useState<Step>('review');
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [typedName, setTypedName] = useState('');
  const [error, setError] = useState('');

  // Every open starts from step one with empty fields. Without this, cancelling
  // at "confirm" and reopening drops you straight back on the final screen with
  // the workspace name already typed - one click from deletion.
  useEffect(() => {
    if (!open) return;
    setStep('review');
    setCode('');
    setTypedName('');
    setError('');
    setSentTo('');
    setPreview(null);
    setPreviewError('');
  }, [open]);

  const loadPreview = useCallback(async () => {
    setLoadingPreview(true);
    setPreviewError('');
    try {
      setPreview(await api<DeletePreview>(`/api/workspaces/${workspaceId}/delete-preview`));
    } catch (err) {
      setPreviewError(apiErrorMessage(err, 'Could not load this workspace.'));
    }
    setLoadingPreview(false);
  }, [workspaceId]);

  useEffect(() => {
    if (open) void loadPreview();
  }, [open, loadPreview]);

  const blockers = preview?.blockers ?? [];
  const blocked = blockers.length > 0;

  const sendCode = async () => {
    setSending(true);
    setError('');
    try {
      const res = await api<{ ok: boolean; sent_to?: string }>(
        `/api/workspaces/${workspaceId}/delete-request`,
        { method: 'POST' },
      );
      if (res.ok) {
        setSentTo(res.sent_to ?? '');
        setStep('verify');
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send the confirmation code.'));
    }
    setSending(false);
  };

  const doDelete = async () => {
    setStep('deleting');
    setError('');
    try {
      await api<{ ok: boolean }>(`/api/workspaces/${workspaceId}`, {
        method: 'DELETE',
        body: JSON.stringify({ code: code.trim(), confirm_name: typedName }),
      });
      onDeleted();
    } catch (err) {
      // Back to the confirm step rather than closing: the code may simply have
      // been mistyped, and it is still valid for another few attempts.
      setError(apiErrorMessage(err, 'The workspace could not be deleted.'));
      setStep('confirm');
    }
  };

  const nameMatches = !!preview && typedName === preview.workspace_name;
  const stepIndex = step === 'deleting' ? STEP_ORDER.length : STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (step !== 'deleting') onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" /> Delete workspace
          </DialogTitle>
        </DialogHeader>

        {/* Step meter. Tracks the ceremony, not the server's work - there is no
            progress to report from a single DELETE, and a bar that invented one
            would be a lie told at the worst possible moment. */}
        <div className="flex items-center gap-1.5" aria-label={`Step ${Math.min(stepIndex + 1, STEP_ORDER.length)} of ${STEP_ORDER.length}`}>
          {STEP_ORDER.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${i < stepIndex ? 'bg-destructive' : i === stepIndex ? 'bg-destructive/50' : 'bg-muted'}`}
            />
          ))}
        </div>

        {error && (
          <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {step === 'review' && (
          <>
            {loadingPreview ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Counting what would be deleted...
              </div>
            ) : previewError ? (
              <p className="text-sm text-muted-foreground py-4">{previewError}</p>
            ) : preview ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Deleting <span className="font-semibold text-foreground break-all">{preview.workspace_name}</span> destroys
                  everything in it. Deleted files are not recoverable - not by you, and not by dosya.dev support.
                </p>
                <div className="rounded-lg border divide-y text-sm">
                  <Row label="Files permanently deleted" value={preview.file_count.toLocaleString()} />
                  <Row label="Storage freed" value={humanSize(preview.total_bytes)} />
                  <Row label="Folders removed" value={preview.folder_count.toLocaleString()} />
                  <Row
                    label="Team members losing access"
                    value={preview.member_count.toLocaleString()}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Share links, file requests, comments and version history for these files are removed too.
                  This action cannot be undone.
                </p>
                {blockers.map((b) => (
                  <p key={b} className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                    {BLOCKER_COPY[b] ?? b}
                  </p>
                ))}
              </>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="destructive" onClick={sendCode} disabled={sending || blocked || !preview}>
                {sending && <Loader2 className="size-4 animate-spin mr-1.5" />} Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'verify' && (
          <>
            <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5">
              <Mail className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                We sent a 6-digit code to <span className="font-medium text-foreground break-all">{sentTo || 'your email'}</span>.
                It expires in 15 minutes.
              </p>
            </div>
            <Input
              value={code}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && setStep('confirm')}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="h-10 text-center text-lg tracking-[0.4em] font-mono"
              autoFocus
            />
            <button
              type="button"
              onClick={sendCode}
              disabled={sending}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Send a new code'}
            </button>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('review')}>Back</Button>
              <Button variant="destructive" onClick={() => setStep('confirm')} disabled={code.length !== 6}>
                Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'confirm' && preview && (
          <>
            <p className="text-sm text-muted-foreground">
              Type <span className="font-semibold text-foreground break-all">{preview.workspace_name}</span> to confirm.
              This deletes {preview.file_count.toLocaleString()} files ({humanSize(preview.total_bytes)}) forever.
            </p>
            <Input
              value={typedName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTypedName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && nameMatches && void doDelete()}
              placeholder="Workspace name"
              className="h-9"
              autoFocus
            />
            {nameMatches && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="size-3 text-green-600" /> Name matches
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('verify')}>Back</Button>
              <Button variant="destructive" onClick={doDelete} disabled={!nameMatches}>
                <Trash2 className="size-4 mr-1.5" /> Delete forever
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'deleting' && (
          <div className="py-6 space-y-3">
            <p className="flex items-center gap-2 text-sm text-foreground">
              <Loader2 className="size-4 animate-spin" /> Deleting workspace...
            </p>
            {/* Indeterminate on purpose: the server does this in one batch and
                reports nothing until it is finished. */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 rounded-full bg-destructive animate-indeterminate" />
            </div>
            <p className="text-xs text-muted-foreground">
              Removing files, folders, share links and members. Please keep this tab open.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
