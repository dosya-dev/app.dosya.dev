import { useState, useRef, useCallback } from 'react';
import { api } from '@/api/client';
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
import { Mail, Link2, X, Loader2, Copy, ChevronDown } from 'lucide-react';
import { toast } from '@/lib/toast';

interface ShareModalProps {
  open: boolean;
  fileId: string | null;
  fileName: string;
  onClose: () => void;
}

type Tab = 'email' | 'link';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EXPIRY_OPTIONS = [
  { value: '0', label: 'Never' },
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

export function ShareModal({ open, fileId, fileName, onClose }: ShareModalProps) {
  const [tab, setTab] = useState<Tab>('email');
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [expiry, setExpiry] = useState('7');
  const [password, setPassword] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setTab('email');
    setEmails([]);
    setEmailInput('');
    setExpiry('7');
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
    if (!fileId) return;
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

    setSubmitting(true);
    const expiryDays = Number(expiry);

    try {
      if (tab === 'email') {
        const body: Record<string, unknown> = {
          email: emails[0],
          message: message.trim(),
        };
        if (pw) body.password = pw;
        if (expiryDays > 0) body.expires_in_days = expiryDays;

        const res = await api<{ ok: boolean; error?: string }>(`/api/files/${fileId}/share-email`, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        // Send to remaining emails
        for (let i = 1; i < emails.length; i++) {
          await api(`/api/files/${fileId}/share-email`, {
            method: 'POST',
            body: JSON.stringify({ ...body, email: emails[i] }),
          }).catch(() => {});
        }

        if (res.ok) {
          toast.success('Share sent', `Shared with ${emails.length} recipient${emails.length === 1 ? '' : 's'}.`);
          reset();
          onClose();
        } else {
          setError(res.error ?? 'Could not send.');
          setSubmitting(false);
        }
      } else {
        const linkBody: Record<string, unknown> = {};
        if (expiryDays > 0) linkBody.expires_in_days = expiryDays;
        if (pw) linkBody.password = pw;

        const data = await api<{ ok: boolean; link?: { url: string }; error?: string }>(`/api/files/${fileId}/share`, {
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
    } catch {
      setError('Network error. Please try again.');
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
        <div className="flex border-b -mx-6 px-6">
          <button
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${tab === 'email' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTab('email')}
          >
            <Mail className="size-3" /> By email
          </button>
          <button
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${tab === 'link' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTab('link')}
          >
            <Link2 className="size-3" /> By link
          </button>
        </div>

        {/* File info */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <svg viewBox="0 0 14 14" fill="none" width="15" height="15" className="shrink-0">
            <path d="M3.5 1h5l3.5 3.5V12a1 1 0 01-1 1H3.5a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.1" />
            <path d="M8.5 1v3.5h3.5" stroke="currentColor" strokeWidth="1.1" />
          </svg>
          <span className="truncate font-medium text-foreground">{fileName}</span>
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
          </div>
        )}

        {/* Link tab */}
        {tab === 'link' && !resultUrl && (
          <p className="text-xs text-muted-foreground">Anyone with the link can access this file.</p>
        )}

        {/* Expiry */}
        {!resultUrl && (
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Expires in</Label>
            <Select value={expiry} onValueChange={(value) => setExpiry(value ?? '0')} items={EXPIRY_OPTIONS}>
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

        {/* Result */}
        {resultUrl && (
          <div>
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
