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
import { Mail, Link2, X, Loader2, Copy, ChevronDown, Files, Folder } from 'lucide-react';
import { toast } from '@/lib/toast';

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
  onClose: () => void;
}

type Tab = 'email' | 'link';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Values are seconds from now, except 'never' and 'custom'. The API takes an
 * absolute `expires_at`, so anything expressible as an instant works here -
 * which is what makes sub-day options and a picked date possible at all.
 */
const EXPIRY_OPTIONS = [
  { value: '3600', label: '1 hour' },
  { value: '86400', label: '24 hours' },
  { value: '604800', label: '7 days' },
  { value: '2592000', label: '30 days' },
  { value: '7776000', label: '90 days' },
  { value: 'custom', label: 'Custom date…' },
  { value: 'never', label: 'Never' },
];

/** `datetime-local` value (local wall time) → unix seconds. */
function localInputToUnix(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Now + 7 days, formatted for a `datetime-local` input's initial value. */
function defaultCustomExpiry(): string {
  const d = new Date(Date.now() + 7 * 86400 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ShareModal({ open, target, name, onClose }: ShareModalProps) {
  const isFolder = target?.kind === 'folder';
  const isBundle = target?.kind === 'bundle';
  const [excludedCount, setExcludedCount] = useState(0);
  const [tab, setTab] = useState<Tab>('email');
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [expiry, setExpiry] = useState('604800');
  const [customExpiry, setCustomExpiry] = useState(defaultCustomExpiry);
  const [restrictToRecipients, setRestrictToRecipients] = useState(true);
  const [password, setPassword] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);

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

  const reset = useCallback(() => {
    setTab('email');
    setEmails([]);
    setEmailInput('');
    setExpiry('604800');
    setCustomExpiry(defaultCustomExpiry());
    setRestrictToRecipients(true);
    setPassword('');
    setTitle('');
    setMessage('');
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
      setError('Add at least one email address.');
      emailRef.current?.focus();
      return;
    }

    const pw = password.trim();
    if (pw && pw.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    let expiresAt: number | null = null;
    if (expiry === 'custom') {
      expiresAt = localInputToUnix(customExpiry);
      if (!expiresAt) {
        setError('Pick a valid expiry date.');
        return;
      }
      if (expiresAt < Math.floor(Date.now() / 1000) + 60) {
        setError('Expiry must be in the future.');
        return;
      }
    } else if (expiry !== 'never') {
      expiresAt = Math.floor(Date.now() / 1000) + Number(expiry);
    }

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
              message: message.trim(),
              access_mode: restrictToRecipients ? 'restricted' : 'public',
            }
          : {
              emails,
              message: message.trim(),
              restrict_to_recipients: restrictToRecipients,
            };
        if (pw) body.password = pw;
        if (expiresAt) body.expires_at = expiresAt;

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
            restrictToRecipients ? 'Private share sent' : 'Share sent',
            failedCount
              ? `Sent to ${sentCount} of ${emails.length}. Could not reach: ${res.failed!.join(', ')}.`
              : `Shared with ${sentCount} recipient${sentCount === 1 ? '' : 's'}.`,
          );
          reset();
          onClose();
        } else {
          setError(res.error ?? 'Could not send.');
          setSubmitting(false);
        }
      } else {
        const linkBody: Record<string, unknown> = isBundle ? { file_ids: target.fileIds } : {};
        if (expiresAt) linkBody.expires_at = expiresAt;
        if (pw) linkBody.password = pw;

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
            toast.success('Link copied', 'Share link copied to clipboard.');
          } catch {
            toast.info('Link created', 'Share link created.');
          }
          setSubmitting(false);
        } else {
          setError(data.error ?? 'Something went wrong.');
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
      toast.success('Link copied', 'Copied to clipboard.');
    } catch {}
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="-mx-4">
          <TabsList variant="line" className="w-full gap-0 border-b p-0 group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="email" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Mail className="size-3.5" /> By email
            </TabsTrigger>
            <TabsTrigger value="link" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Link2 className="size-3.5" /> By link
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
          <span className="truncate font-medium text-foreground">{name}</span>
          {isBundle && <span className="shrink-0">· one link for all of them</span>}
        </div>

        {/* Email tab */}
        {tab === 'email' && (
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Recipients</Label>
            <div
              className="flex flex-wrap gap-1 min-h-9 border rounded-md px-2 py-1.5 cursor-text focus-within:ring-1 focus-within:ring-ring"
              onClick={() => emailRef.current?.focus()}
            >
              {emails.map((e, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-muted rounded px-1.5 py-0.5 text-[11px] font-medium">
                  {e}
                  <button onClick={() => removeEmail(i)} className="hover:text-destructive">
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
              <input
                ref={emailRef}
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={handleEmailKeyDown}
                onBlur={handleEmailBlur}
                onPaste={handleEmailPaste}
                placeholder={emails.length === 0 ? 'name@example.com, press Enter' : ''}
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
                <span className="font-medium text-foreground">Only these people can open it.</span>{' '}
                Recipients confirm their email with a one-time code, so forwarding the link
                gives no one else access.
              </span>
            </label>
          </div>
        )}

        {/* Link tab */}
        {tab === 'link' && !resultUrl && (
          <p className="text-xs text-muted-foreground">
            Anyone with the link can access {isFolder ? 'this folder' : isBundle ? 'these files' : 'this file'}.
          </p>
        )}

        {/* Expiry */}
        {!resultUrl && (
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Expires in</Label>
            <Select value={expiry} onValueChange={(value) => setExpiry(value ?? 'never')} items={EXPIRY_OPTIONS}>
              <SelectTrigger className="w-full h-9 border rounded-md px-2.5 text-xs bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {expiry === 'custom' && (
              <Input
                type="datetime-local"
                value={customExpiry}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomExpiry(e.target.value)}
                className="mt-2 h-9 text-xs"
              />
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
              Advanced options
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-3">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Password <span className="font-normal">(optional)</span>
                  </Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="h-8 text-xs"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Title <span className="font-normal">(optional)</span>
                  </Label>
                  <Input
                    value={title}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                    placeholder="Share link title"
                    className="h-8 text-xs"
                  />
                </div>
                {tab === 'email' && (
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Message <span className="font-normal">(optional)</span>
                    </Label>
                    <Textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Add a message for the recipient..."
                      className="w-full h-14 min-h-14 rounded-md px-2.5 py-2 text-xs bg-background resize-y"
                    />
                  </div>
                )}
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
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Share link created</Label>
            <div className="flex items-center gap-2 bg-muted/50 border rounded-md px-3 py-2">
              <span className="flex-1 text-[11px] font-mono text-muted-foreground truncate">{resultUrl}</span>
              <button onClick={handleCopyUrl} className="text-xs font-semibold text-green-600 hover:text-green-700 shrink-0">
                <Copy className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {isFolder && excludedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {excludedCount} hidden or locked {excludedCount === 1 ? 'item' : 'items'} in this
            folder or its subfolders will not be shared.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          {resultUrl ? (
            <Button onClick={() => { reset(); onClose(); }}>Done</Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin mr-1.5" />
              ) : tab === 'email' ? (
                <Mail className="size-3.5 mr-1.5" />
              ) : (
                <Link2 className="size-3.5 mr-1.5" />
              )}
              {submitting ? (tab === 'email' ? 'Sending...' : 'Creating...') : (tab === 'email' ? 'Send' : 'Generate link')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
