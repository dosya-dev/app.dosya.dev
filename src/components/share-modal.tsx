import { useState, useRef, useCallback, useEffect } from 'react';
import { api, apiErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Mail, Link2, X, Loader2, Copy, ChevronDown, Files, Folder, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { validateSharePassword, validateShareExpiryAt, validateShareBundle } from '@/lib/validation-policy.generated';
import { translateExternal } from '@/lib/external-text';
import { useWorkspace } from '@/stores/workspace';
import { useSession } from '@/stores/session';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';
import { rememberShareDefault, readShareDefault, clearShareDefaultsCache } from '@/lib/share-defaults';

// Re-exported so callers (and this component's tests) have one import for the
// modal and its cache; the cache itself lives in lib/share-defaults so the
// settings save path and logout can invalidate it without importing this UI.
export { clearShareDefaultsCache };

/**
 * What is being shared. A share link is one file, one bundle of files, or one
 * folder - the API has no shape for "this folder plus these files", which is
 * why the caller must resolve the selection into exactly one of these before
 * opening the modal.
 */
export type ShareTarget =
  | { kind: 'file'; fileIds: [string] }
  | { kind: 'bundle'; fileIds: string[] }
  | { kind: 'folder'; folderId: string };

interface ShareModalProps {
  open: boolean;
  target: ShareTarget | null;
  /** Display name: the file name, "N files", or the folder name. */
  name: string;
  /**
   * The workspace the TARGET lives in, whose default share expiry pre-fills
   * the form (Contract 8). Falls back to the active workspace, which is right
   * for every caller today but wrong the moment something shares an item from
   * another workspace - a default is a property of the item's workspace, not
   * of whatever the sidebar has selected.
   */
  workspaceId?: string;
  onClose: () => void;
}

type Tab = 'email' | 'link';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The share page note's ceilings, mirrored from the API (share_title_too_long
 *  at 120, SHARE_MESSAGE_MAX at 500) so a long note is refused here first. */
export const SHARE_TITLE_MAX = 120;
export const SHARE_MESSAGE_MAX = 500;

/**
 * Values are seconds from now, except 'never' and 'custom'. The API takes an
 * absolute `expires_at`, so anything expressible as an instant works here -
 * which is what makes sub-day options and a picked date possible at all.
 */
const EXPIRY_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: '3600', labelKey: 'common.label.oneHour' },
  { value: '86400', labelKey: 'common.label.24Hours' },
  { value: '604800', labelKey: 'common.label.sevenDays' },
  { value: '2592000', labelKey: 'common.label.thirtyDays' },
  { value: '7776000', labelKey: 'common.label.ninetyDays' },
  { value: 'custom', labelKey: 'files.label.customDate' },
  { value: 'never', labelKey: 'common.label.never' },
];

/**
 * Splits a translated "Lead sentence. Rest of it." message at the first
 * sentence end so the lead can stay bold; a message with no such break is
 * returned whole.
 */
function leadAndRest(message: string): [string, string] {
  const m = /^(.+?[.!?\u3002])\s+([\s\S]*)$/.exec(message);
  return m ? [m[1], m[2]] : [message, ''];
}

/** `datetime-local` value (local wall time) → unix seconds. */
function localInputToUnix(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

const FALLBACK_EXPIRY_DAYS = 7;

/**
 * The API clamps a Free creator's links to 7 days (create.ts
 * FREE_SHARE_LINK_MAX_EXPIRY_DAYS) without refusing, so a longer pick used to
 * come back as 7 days with nothing said. The picker locks those options instead.
 */
export const FREE_MAX_EXPIRY_DAYS = 7;

/** True when `value` (an EXPIRY_OPTIONS value) is closed to a Free creator:
 *  anything past the cap, and a custom date, which is a paid-plan choice. */
export function isExpiryLockedOnFree(value: string): boolean {
  if (value === 'never' || value === 'custom') return true;
  return Number(value) > FREE_MAX_EXPIRY_DAYS * 86400;
}

/** Now + `days`, formatted for a `datetime-local` input's initial value. */
function defaultCustomExpiry(days: number = FALLBACK_EXPIRY_DAYS): string {
  const d = new Date(Date.now() + days * 86400 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Initial expiry state for a workspace default of `days` (Contract 8). A
 * default that matches a preset selects it; any other whole number becomes a
 * pre-filled custom date; no default falls back to 7 days.
 */
export function initialExpiryFor(days: number | null | undefined, maxDays?: number): { expiry: string; customExpiry: string } {
  let d = days != null && Number.isFinite(days) && days > 0 ? days : FALLBACK_EXPIRY_DAYS;
  if (maxDays != null && d > maxDays) d = maxDays;
  const seconds = String(d * 86400);
  if (EXPIRY_OPTIONS.some((o) => o.value === seconds)) return { expiry: seconds, customExpiry: defaultCustomExpiry(d) };
  // A capped (Free) picker has no custom date to fall back on, so a default
  // between presets takes the longest preset that does not outlast it.
  if (maxDays != null) {
    const fit = EXPIRY_OPTIONS.filter((o) => /^\d+$/.test(o.value) && Number(o.value) <= d * 86400).pop();
    return { expiry: fit?.value ?? '3600', customExpiry: defaultCustomExpiry(d) };
  }
  return { expiry: 'custom', customExpiry: defaultCustomExpiry(d) };
}

export function ShareModal({ open, target, name, workspaceId: targetWorkspaceId, onClose }: ShareModalProps) {
  const t = useT();
  const isFolder = target?.kind === 'folder';
  const isBundle = target?.kind === 'bundle';
  const [excludedCount, setExcludedCount] = useState(0);
  const [tab, setTab] = useState<Tab>('email');
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [expiry, setExpiry] = useState('604800');
  const [customExpiry, setCustomExpiry] = useState(defaultCustomExpiry);
  const activeWorkspaceId = useWorkspace((s) => s.activeId);
  const workspaceId = targetWorkspaceId ?? activeWorkspaceId;
  // The workspace's default_share_expiry_days, read once per open. Kept so
  // `reset()` (which runs on close) restores the workspace's choice rather
  // than the product-wide 7 days.
  const defaultDaysRef = useRef<number | null>(null);
  // Set the moment the user touches the expiry select, so a slow settings
  // response cannot overwrite a choice they already made.
  const userPickedExpiryRef = useRef(false);
  // The effective (lapse-aware) plan from /api/me, the same answer the API's
  // isUserEffectivelyFree gives. A ref too, so the open/reset paths below
  // read it without re-running the settings fetch.
  const isFreePlan = useSession((s) => s.user?.plan?.id === 'free');
  const maxDaysRef = useRef<number | undefined>(undefined);
  maxDaysRef.current = isFreePlan ? FREE_MAX_EXPIRY_DAYS : undefined;
  const [restrictToRecipients, setRestrictToRecipients] = useState(true);
  const [password, setPassword] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  /**
   * A link that opens but never downloads.
   *
   * lib/share/create.ts has accepted `lock_mode` since migration 0019 and
   * validates it; the CLI sends it as `--lock`. This dialog never sent the
   * field at all, so a feature that shipped years ago was reachable only from
   * a terminal.
   */
  const [viewOnly, setViewOnly] = useState(false);
  /**
   * Serve photos without their EXIF/XMP/IPTC (migration 0183): location,
   * camera, capture time. Off by default, and absent from the request when
   * off, so an ordinary link is what it always was.
   */
  const [stripMetadata, setStripMetadata] = useState(false);
  /** Download ceiling (migration 0143). Empty string means unlimited. */
  const [maxDownloads, setMaxDownloads] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);
  const expiryItems = EXPIRY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));

  // What a link for this folder will NOT include. Fetched when the modal opens
  // so the sharer sees it before committing, rather than discovering a partial
  // share from a confused recipient later.
  useEffect(() => {
    if (!open || target?.kind !== 'folder') { setExcludedCount(0); return; }
    let cancelled = false;
    api<{ ok: true; excluded_count: number }>(`/api/folders/${target.folderId}/share`)
      .then((r) => { if (!cancelled) setExcludedCount(r.excluded_count ?? 0); })
      .catch(() => { /* the notice is advisory - a failed count must not block sharing */ });
    return () => { cancelled = true; };
  }, [open, target]);

  // Pre-fill the expiry from the workspace default (Contract 8). Advisory: a
  // failed read leaves the 7-day fallback in place rather than blocking the
  // modal, and a response that arrives after the user already picked
  // something is ignored.
  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    userPickedExpiryRef.current = false;

    const apply = (days: number | null) => {
      defaultDaysRef.current = days;
      const next = initialExpiryFor(days, maxDaysRef.current);
      setExpiry(next.expiry);
      setCustomExpiry(next.customExpiry);
    };

    const remembered = readShareDefault(workspaceId);
    if (remembered) {
      apply(remembered.days);
      return () => { cancelled = true; };
    }

    api<{ ok: boolean; settings: { default_share_expiry_days?: number | null } | null }>(`/api/workspaces/${workspaceId}/settings`)
      .then((r) => {
        const days = r.settings?.default_share_expiry_days ?? null;
        rememberShareDefault(workspaceId, days);
        if (cancelled || userPickedExpiryRef.current) return;
        apply(days);
      })
      .catch(() => { /* fallback stays; a failed read is not cached */ });
    return () => { cancelled = true; };
  }, [open, workspaceId]);

  const reset = useCallback(() => {
    setTab('email');
    setEmails([]);
    setEmailInput('');
    const initial = initialExpiryFor(defaultDaysRef.current, maxDaysRef.current);
    setExpiry(initial.expiry);
    setCustomExpiry(initial.customExpiry);
    setRestrictToRecipients(true);
    setPassword('');
    setTitle('');
    setMessage('');
    setViewOnly(false);
    setStripMetadata(false);
    setMaxDownloads('');
    setShowAdvanced(false);
    setSubmitting(false);
    setError('');
    setResultUrl('');
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      reset();
      onClose();
    }
  };

  const addEmail = (raw: string) => {
    const e = raw.trim().toLowerCase();
    if (!e || !EMAIL_REGEX.test(e) || emails.includes(e)) return;
    setEmails((prev) => [...prev, e]);
  };

  const removeEmail = (idx: number) => {
    setEmails((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleEmailKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addEmail(emailInput);
      setEmailInput('');
    } else if (e.key === 'Backspace' && !emailInput && emails.length) {
      setEmails((prev) => prev.slice(0, -1));
    }
  };

  const handleEmailBlur = () => {
    if (emailInput.trim()) {
      addEmail(emailInput);
      setEmailInput('');
    }
  };

  const handleEmailPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    text.split(/[,;\s\n]+/).forEach(addEmail);
    setEmailInput('');
  };

  const handleSubmit = async () => {
    if (!target) return;
    setError('');

    if (tab === 'email' && emails.length === 0) {
      setError(t('common.error.addAtLeastOneEmailAddress'));
      emailRef.current?.focus();
      return;
    }

    // 1..100 files behind one link. The validator existed in the policy from
    // the start and nothing called it, so a 101-file selection was assembled,
    // sent, and refused.
    if (target.kind === 'bundle') {
      const bundleError = validateShareBundle(target.fileIds.length);
      if (bundleError) { setError(translateExternal(bundleError, 'error')); return; }
    }

    // The shared rule rather than a local copy of its length clause. This page
    // was the ONLY client checking the 8-character floor at all; the same
    // function now runs on desktop, mobile and the CLI, and it is the function
    // lib/share/create.ts applies on the server.
    const pw = password.trim();
    const pwError = validateSharePassword(pw);
    if (pwError) { setError(translateExternal(pwError, 'error')); return; }

    // Parsed here rather than trusted to the input's `type=number`: a browser
    // lets "1e3" and "  " through, and the API refuses 0 outright.
    let capField: number | null = null;
    if (maxDownloads.trim()) {
      const n = Number(maxDownloads);
      if (!Number.isInteger(n) || n < 1) {
        setError(t('files.error.downloadLimitMustBeAWholeNumberOfAtLeast1'));
        return;
      }
      capField = n;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    let expiresAt: number | null = null;
    if (expiry === 'custom') {
      expiresAt = localInputToUnix(customExpiry);
      if (!expiresAt) {
        setError(t('files.error.pickAValidExpiryDate'));
        return;
      }
      // Covers "in the future" AND the 3650-day ceiling, which nothing on the
      // client knew about - a date picked past it was accepted here and refused
      // by the API. NB the workspace's own share_max_expiry_days clamps silently
      // on the server and is deliberately invisible here: there is no refusal to
      // pre-empt, only a value quietly lowered.
      const expiryError = validateShareExpiryAt(expiresAt, nowSeconds + 60);
      if (expiryError) { setError(translateExternal(expiryError, 'error')); return; }
      // The Free cap is the one clamp the user can see coming, so a typed
      // date past it is stopped here rather than quietly cut to 7 days.
      if (isFreePlan && expiresAt > nowSeconds + FREE_MAX_EXPIRY_DAYS * 86400) {
        setError(t('sharing.label.freePlanLinksLastUpTo7Days'));
        return;
      }
    } else if (expiry !== 'never') {
      expiresAt = nowSeconds + Number(expiry);
    }

    // "Never" has to be SAID, not left out. The API applies the workspace's
    // default_share_expiry_days only when a payload names no expiry at all
    // (createShareLink's `hasExplicitExpiry`), so omitting the field made the
    // workspace default override the one choice that means "no expiry" - a
    // link the user set to never expire dying after N days. `expires_in_days:
    // 0` is the API's own spelling of never (lib/share/expiry.ts).
    const expiryFields: { expires_at?: number; expires_in_days?: number } =
      expiry === 'never' ? { expires_in_days: 0 } : (expiresAt ? { expires_at: expiresAt } : {});

    // The note the recipient sees on the share page. Trimmed and dropped when
    // empty so a blank field never stores "" where the API stores null; the
    // ceilings match the API's (share_title_too_long / SHARE_MESSAGE_MAX).
    const noteTitle = title.trim();
    const noteMessage = message.trim();
    if (noteTitle.length > SHARE_TITLE_MAX) {
      setError(t('shared.error.keepTheTitleUnderMaxCharacters', { max: SHARE_TITLE_MAX }));
      return;
    }
    if (noteMessage.length > SHARE_MESSAGE_MAX) {
      setError(t('shared.error.keepTheMessageUnderMaxCharacters', { max: SHARE_MESSAGE_MAX }));
      return;
    }
    const noteFields: { title?: string; message?: string } = {};
    if (noteTitle) noteFields.title = noteTitle;
    if (noteMessage) noteFields.message = noteMessage;

    setSubmitting(true);

    try {
      if (tab === 'email') {
        // One link for everyone, so a private share has a single recipient list
        // rather than one link per address. A multi-file share goes to the
        // bundle route, which is the only one that can put N files behind one
        // link; both return the same {ok, failed} shape.
        const body: Record<string, unknown> = isBundle
          ? {
              file_ids: target.fileIds,
              notify: true,
              recipient_emails: emails,
              message: noteMessage,
              access_mode: restrictToRecipients ? 'restricted' : 'public',
            }
          : {
              emails,
              message: noteMessage,
              restrict_to_recipients: restrictToRecipients,
            };
        if (noteTitle) body.title = noteTitle;
        if (pw) body.password = pw;
        if (viewOnly) body.lock_mode = 'view_only';
        if (stripMetadata) body.strip_metadata = true;
        if (capField !== null) body.max_downloads = capField;
        Object.assign(body, expiryFields);

        const endpoint = target.kind === 'folder'
          ? `/api/folders/${target.folderId}/share-email`
          : target.kind === 'bundle'
            ? '/api/files/share-bundle'
            : `/api/files/${target.fileIds[0]}/share-email`;
        const res = await api<{ ok: boolean; error?: string; failed?: string[] }>(endpoint, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const failedCount = res.failed?.length ?? 0;
          const sentCount = emails.length - failedCount;
          toast.success(
            restrictToRecipients ? t('files.feedback.privateShareSent') : t('files.feedback.shareSent'),
            failedCount
              ? t('sharing.error.sentToSentOfEmailCountCouldNotReachFailed', {
                  sent: String(sentCount), emailCount: String(emails.length), failed: res.failed!.join(', '),
                })
              : t('files.feedback.sharedWithSentcountPluralOneRecipientOtherRecipients', { sentCount }),
          );
          reset();
          onClose();
        } else {
          setError(res.error ?? t('sharing.error.couldNotSend'));
          setSubmitting(false);
        }
      } else {
        const linkBody: Record<string, unknown> = isBundle ? { file_ids: target.fileIds } : {};
        Object.assign(linkBody, expiryFields, noteFields);
        if (pw) linkBody.password = pw;
        if (viewOnly) linkBody.lock_mode = 'view_only';
        if (stripMetadata) linkBody.strip_metadata = true;
        if (capField !== null) linkBody.max_downloads = capField;

        const endpoint = target.kind === 'folder'
          ? `/api/folders/${target.folderId}/share`
          : target.kind === 'bundle'
            ? '/api/files/share-bundle'
            : `/api/files/${target.fileIds[0]}/share`;
        const data = await api<{ ok: boolean; link?: { url: string }; error?: string }>(endpoint, {
          method: 'POST',
          body: JSON.stringify(linkBody),
        });

        if (data.ok && data.link) {
          setResultUrl(data.link.url);
          try {
            await navigator.clipboard.writeText(data.link.url);
            toast.success(t('common.feedback.linkCopied'), t('files.feedback.shareLinkCopiedToClipboard'));
          } catch {
            toast.info(t('files.feedback.linkCreated'), t('files.feedback.shareLinkCreated'));
          }
          setSubmitting(false);
        } else {
          setError(data.error ?? t('sharing.error.somethingWentWrong'));
          setSubmitting(false);
        }
      }
    } catch (err) {
      // Surface the API's real message (e.g. "This file is fully locked and
      // cannot be shared", 403) instead of a generic network error.
      setError(apiErrorMessage(err));
      setSubmitting(false);
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(resultUrl);
      toast.success(t('common.feedback.linkCopied'), t('files.feedback.copiedToClipboard'));
    } catch {}
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('common.heading.share')}</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="-mx-4">
          <TabsList variant="line" className="w-full gap-0 border-b p-0 group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="email" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Mail className="size-3.5" /> {t('common.action.byEmail')}
            </TabsTrigger>
            <TabsTrigger value="link" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Link2 className="size-3.5" /> {t('common.action.byLink')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* File info */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isFolder ? (
            <Folder className="size-3.75 shrink-0" />
          ) : isBundle ? (
            <Files className="size-3.75 shrink-0" />
          ) : (
            <svg viewBox="0 0 14 14" fill="none" width="15" height="15" className="shrink-0">
              <path d="M3.5 1h5l3.5 3.5V12a1 1 0 01-1 1H3.5a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.1" />
              <path d="M8.5 1v3.5h3.5" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          )}
          <span className="truncate font-medium text-foreground" dir="auto">{name}</span>
          {isBundle && <span className="shrink-0">{t('files.description.oneLinkForAllOfThem')}</span>}
        </div>

        {/* Email tab */}
        {tab === 'email' && (
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('common.label.recipients')}</Label>
            <div
              className="flex flex-wrap gap-1 min-h-9 border rounded-md px-2 py-1.5 cursor-text focus-within:ring-1 focus-within:ring-ring"
              onClick={() => emailRef.current?.focus()}
            >
              {emails.map((e, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-muted rounded px-1.5 py-0.5 text-[11px] font-medium">
                  <bdi dir="ltr">{e}</bdi>
                  <button onClick={() => removeEmail(i)} className="hover:text-destructive">
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
              <input
                ref={emailRef}
                type="email"
                dir="ltr"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={handleEmailKeyDown}
                onBlur={handleEmailBlur}
                onPaste={handleEmailPaste}
                placeholder={emails.length === 0 ? t('sharing.placeholder.nameExampleComPressEnter') : ''}
                className="flex-1 min-w-24 bg-transparent outline-none text-xs"
                autoComplete="off"
              />
            </div>

            <label className="mt-2 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={restrictToRecipients}
                onChange={(e) => setRestrictToRecipients(e.target.checked)}
                className="mt-0.5 size-3.5 accent-green-600"
              />
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                {(() => {
                  const [lead, rest] = leadAndRest(t('files.description.onlyThesePeopleCanOpenItRecipientsConfirmTheirEmailWith'));
                  return (<><span className="font-medium text-foreground">{lead}</span>{rest ? <>{' '}{rest}</> : null}</>);
                })()}
              </span>
            </label>
          </div>
        )}

        {/* Link tab */}
        {tab === 'link' && !resultUrl && (
          <p className="text-xs text-muted-foreground">
            {t('files.description.anyoneWithTheLinkCanAccessIsfolderSelectTrueThisFolder', { isFolder: String(isFolder), isBundle: String(isBundle) })}
          </p>
        )}

        {/* Expiry */}
        {!resultUrl && (
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('sharing.label.expiresIn')}</Label>
            <Select value={expiry} onValueChange={(value) => { userPickedExpiryRef.current = true; setExpiry(value ?? 'never'); }} items={expiryItems}>
              <SelectTrigger className="w-full h-9 border rounded-md px-2.5 text-xs bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {expiryItems.map((opt) => {
                  const locked = isFreePlan && isExpiryLockedOnFree(opt.value);
                  return (
                    <SelectItem key={opt.value} value={opt.value} disabled={locked} className="text-xs">
                      {opt.label}
                      {locked && <Lock aria-label={t('sharing.label.freePlanLinksLastUpTo7Days')} className="ms-auto size-3" />}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {expiry === 'custom' && (
              <Input
                type="datetime-local"
                value={customExpiry}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomExpiry(e.target.value)}
                max={isFreePlan ? defaultCustomExpiry(FREE_MAX_EXPIRY_DAYS) : undefined}
                className="mt-2 h-9 text-xs"
              />
            )}
            {isFreePlan && (
              <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                <Lock className="size-3" aria-hidden="true" />
                {t('sharing.label.freePlanLinksLastUpTo7Days')}
                <Link to="/billing?upgrade=1" className="font-medium text-foreground underline underline-offset-2">
                  {t('dashboard.action.upgradeNow')}
                </Link>
              </p>
            )}
          </div>
        )}

        {/* Advanced options */}
        {!resultUrl && (
          <div>
            <button
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <ChevronDown className={`size-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              {t('common.action.advancedOptions')}
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-3">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">
                    {t('common.label.passwordOptional')}
                  </Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                    placeholder={t('common.placeholder.min8Characters')}
                    className="h-8 text-xs"
                    autoComplete="off"
                  />
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={viewOnly}
                    onChange={(e) => setViewOnly(e.target.checked)}
                    className="mt-0.5 size-3.5 accent-green-600"
                    data-testid="share-view-only"
                  />
                  <span className="text-[11px] leading-relaxed text-muted-foreground">
                    {(() => {
                      const [lead, rest] = leadAndRest(t('files.description.viewOnlyPeopleCanOpenIsfolderSelectTrueTheFolderOther', { isFolder: String(isFolder), isBundle: String(isBundle) }));
                      return (<><span className="font-medium text-foreground">{lead}</span>{rest ? <>{' '}{rest}</> : null}</>);
                    })()}
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stripMetadata}
                    onChange={(e) => setStripMetadata(e.target.checked)}
                    className="mt-0.5 size-3.5 accent-green-600"
                    data-testid="share-strip-metadata"
                  />
                  <span className="text-[11px] leading-relaxed text-muted-foreground">
                    {(() => {
                      const [lead, rest] = leadAndRest(t('files.description.removePhotoMetadataPhotosAreHandedOverWithoutLocationCameraAnd'));
                      return (<><span className="font-medium text-foreground">{lead}</span>{rest ? <>{' '}{rest}</> : null}</>);
                    })()}
                  </span>
                </label>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">
                    {t('files.label.downloadLimitOptional')}
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={maxDownloads}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxDownloads(e.target.value)}
                    placeholder={t('common.placeholder.unlimited')}
                    className="h-8 text-xs"
                    data-testid="share-max-downloads"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t('files.description.theLinkStopsServingTheIsfolderSelectTrueFolderOtherIsbundle', { isFolder: String(isFolder), isBundle: String(isBundle) })}
                  </p>
                </div>
                {/* The note. Both fields travel with the link itself and are
                    shown to the recipient on the share page as a card above the
                    file; a share by email also puts the message in the email. */}
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between">
                    <span>{t('common.label.titleOptional')}</span>
                    <span className="font-normal tabular-nums" data-testid="share-title-count">{title.trim().length}/{SHARE_TITLE_MAX}</span>
                  </Label>
                  <Input
                    value={title}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                    placeholder={t('sharing.placeholder.shareLinkTitle')}
                    maxLength={SHARE_TITLE_MAX}
                    className="h-8 text-xs"
                    data-testid="share-title"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between">
                    <span>{t('common.label.messageOptional')}</span>
                    <span className="font-normal tabular-nums" data-testid="share-message-count">{message.trim().length}/{SHARE_MESSAGE_MAX}</span>
                  </Label>
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t('sharing.placeholder.addAMessageForTheRecipient')}
                    maxLength={SHARE_MESSAGE_MAX}
                    className="w-full h-14 min-h-14 rounded-md px-2.5 py-2 text-xs bg-background resize-y"
                    data-testid="share-message"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {tab === 'email' ? t('shared.description.shownToTheRecipientOnTheSharePageLowercase') : t('shared.description.shownToTheRecipientOnTheSharePage')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Result. A rare moment - you create a link, not browse them - so it
            gets a touch more than the 120ms .animate-content-in fade the list
            views use: the small rise makes it read as something that arrived
            rather than something that was always there. */}
        {resultUrl && (
          <div className="animate-result-in">
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('sharing.label.shareLinkCreated')}</Label>
            <div className="flex items-center gap-2 bg-muted/50 border rounded-md px-3 py-2">
              <span dir="ltr" className="flex-1 text-[11px] font-mono text-muted-foreground truncate">{resultUrl}</span>
              <button onClick={handleCopyUrl} className="text-xs font-semibold text-green-600 hover:text-green-700 shrink-0">
                <Copy className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div dir="auto" className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {isFolder && excludedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('files.description.excludedcountHiddenOrLockedExcludedcountPluralOneItemOtherItemsIn', { excludedCount })}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>{t('common.cancel')}</Button>
          {resultUrl ? (
            <Button onClick={() => { reset(); onClose(); }}>{t('common.done')}</Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin me-1.5" />
              ) : tab === 'email' ? (
                <Mail className="size-3.5 me-1.5" />
              ) : (
                <Link2 className="size-3.5 me-1.5" />
              )}
              {submitting ? (tab === 'email' ? t('common.action.sending') : t('common.action.creating')) : (tab === 'email' ? t('sharing.action.send') : t('common.action.generateLink'))}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
