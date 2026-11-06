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
import { formatNumber } from '@/lib/format-locale';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Mail, Check, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/api/client';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import type { MessageKey } from '@/i18n/keys';
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

const BLOCKER_COPY: Record<string, MessageKey> = {
  has_members: 'settings.description.thisWorkspaceStillHasOtherMembersRemoveThemOrTransferOwnership',
  last_workspace: 'settings.description.thisIsYourOnlyWorkspaceCreateAnotherOneFirstAn',
};

type Step = 'review' | 'verify' | 'confirm' | 'deleting';

const STEP_ORDER: Step[] = ['review', 'verify', 'confirm'];

interface DeleteWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Logical removal permits navigation while physical cleanup can be pending. */
  onDeleted: (pending: boolean) => void;
}

export function DeleteWorkspaceDialog({ open, onOpenChange, workspaceId, onDeleted }: DeleteWorkspaceDialogProps) {
  const t = useT();
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
      setPreviewError(apiErrorMessage(err, t('settings.error.couldNotLoadThisWorkspace')));
    }
    setLoadingPreview(false);
  }, [workspaceId, t]);

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
      setError(apiErrorMessage(err, t('settings.error.couldNotSendTheConfirmationCode')));
    }
    setSending(false);
  };

  const doDelete = async () => {
    setStep('deleting');
    setError('');
    try {
      const result = await api<{ ok: boolean; pending?: boolean; operation_id?: string }>(`/api/workspaces/${workspaceId}`, {
        method: 'DELETE',
        body: JSON.stringify({ code: code.trim(), confirm_name: typedName }),
      });
      onDeleted(result.pending === true);
    } catch (err) {
      // Back to the confirm step rather than closing: the code may simply have
      // been mistyped, and it is still valid for another few attempts.
      setError(apiErrorMessage(err, t('settings.error.theWorkspaceCouldNotBeDeleted')));
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
            <AlertTriangle className="size-4" /> {t('settings.heading.deleteWorkspace')}
          </DialogTitle>
        </DialogHeader>

        {/* Step meter. Tracks the ceremony, not the server's work - there is no
            progress to report from a single DELETE, and a bar that invented one
            would be a lie told at the worst possible moment. */}
        <div className="flex items-center gap-1.5" aria-label={t('settings.accessibility.stepMathminOfStepOrdercount', { shown: Math.min(stepIndex + 1, STEP_ORDER.length), total: STEP_ORDER.length })}>
          {STEP_ORDER.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${i < stepIndex ? 'bg-destructive' : i === stepIndex ? 'bg-destructive/50' : 'bg-muted'}`}
            />
          ))}
        </div>

        {error && (
          <p dir="auto" className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {step === 'review' && (
          <>
            {loadingPreview ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {t('settings.description.countingWhatWouldBeDeleted')}
              </div>
            ) : previewError ? (
              <p dir="auto" className="text-sm text-muted-foreground py-4">{previewError}</p>
            ) : preview ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {richText(
                    t('settings.description.deletingPreviewworkspaceNameDestroysEverythingInItDeletedFilesAreNotRecoverable', { previewWorkspace_name: '{previewWorkspace_name}' }),
                    { previewWorkspace_name: <span className="font-semibold text-foreground break-all">{preview.workspace_name}</span> },
                  )}
                </p>
                <div className="rounded-lg border divide-y text-sm">
                  <Row label={t('settings.label.filesPermanentlyDeleted')} value={formatNumber(preview.file_count)} />
                  <Row label={t('settings.label.storageFreed')} value={humanSize(preview.total_bytes)} />
                  <Row label={t('settings.label.foldersRemoved')} value={formatNumber(preview.folder_count)} />
                  <Row
                    label={t('settings.label.teamMembersLosingAccess')}
                    value={formatNumber(preview.member_count)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('settings.error.shareLinksFileRequestsCommentsAndVersionHistoryForTheseFiles')}
                </p>
                {blockers.map((b) => (
                  <p key={b} className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                    {BLOCKER_COPY[b] ? t(BLOCKER_COPY[b]) : b}
                  </p>
                ))}
              </>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button variant="destructive" onClick={sendCode} disabled={sending || blocked || !preview}>
                {sending && <Loader2 className="size-4 animate-spin me-1.5" />} {t('common.continue')}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'verify' && (
          <>
            <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5">
              <Mail className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                {richText(
                  t('settings.description.weSentA6DigitCodeToSenttoyouremailItExpiresIn15', { sentToYourEmail: '{sentToYourEmail}' }),
                  { sentToYourEmail: <span className="font-medium text-foreground break-all">{sentTo || t('settings.label.yourEmail')}</span> },
                )}
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
              {sending ? t('common.action.sending') : t('settings.action.sendANewCode')}
            </button>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('review')}>{t('common.back')}</Button>
              <Button variant="destructive" onClick={() => setStep('confirm')} disabled={code.length !== 6}>
                {t('common.continue')}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'confirm' && preview && (
          <>
            <p className="text-sm text-muted-foreground">
              {richText(
                t('settings.description.typePreviewworkspaceNameToConfirmThisDeletesFileCounttolocalestringFilesPreviewtotalBytesForever', {
                  previewWorkspace_name: '{previewWorkspace_name}',
                  file_countToLocaleString: formatNumber(preview.file_count),
                  previewTotal_bytes: humanSize(preview.total_bytes),
                }),
                { previewWorkspace_name: <span className="font-semibold text-foreground break-all">{preview.workspace_name}</span> },
              )}
            </p>
            <Input
              value={typedName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTypedName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && nameMatches && void doDelete()}
              placeholder={t('settings.placeholder.workspaceName')}
              className="h-9"
              autoFocus
            />
            {nameMatches && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="size-3 text-green-600" /> {t('settings.label.nameMatches')}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('verify')}>{t('common.back')}</Button>
              <Button variant="destructive" onClick={doDelete} disabled={!nameMatches}>
                <Trash2 className="size-4 me-1.5" /> {t('settings.action.deleteForever')}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'deleting' && (
          <div className="py-6 space-y-3">
            <p className="flex items-center gap-2 text-sm text-foreground">
              <Loader2 className="size-4 animate-spin" /> {t('settings.description.deletingWorkspace')}
            </p>
            {/* The response reports whether physical cleanup is still pending. */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 rounded-full bg-destructive animate-indeterminate" />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('settings.description.startingDeletionOfFilesFoldersShareLinksAndMembers')}
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
