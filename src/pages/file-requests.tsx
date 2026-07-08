import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { FilesSidebar } from '@/components/files-sidebar';
import { useWorkspace } from '@/stores/workspace';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Plus, ArrowLeft, Mail, Copy, Check, Send, Trash2, Loader2,
  ChevronDown, FolderOpen, Home, Download, X, Search,
} from 'lucide-react';
import { humanSize, timeAgo, fileIconSrc } from '@/lib/helpers';
import { toast } from '@/lib/toast';


// ── Types ─────────────────────────────────────────────────

interface FileRequest {
  id: string;
  title: string | null;
  url: string;
  is_revoked: number;
  is_password_protected: number;
  expires_at: number | null;
  created_at: number;
  created_by_name: string | null;
  upload_count: number;
}

interface Recipient {
  id: string;
  email: string;
  sent_at: number | null;
  uploaded_at: number | null;
}

interface Upload {
  id: string;
  file_id: string;
  uploader_email: string | null;
  uploader_name: string | null;
  created_at: number;
  file_name: string;
  size_bytes: number;
  mime_type: string;
  extension: string | null;
}

interface PickerFolder {
  id: string;
  name: string;
  parent_id: string | null;
  file_count: number;
}

// ── Page ──────────────────────────────────────────────────

export default function FileRequestsPage() {
  const workspaceId = useWorkspace((s: { activeId: string }) => s.activeId);
  const navigate = useNavigate();
  const [requests, setRequests] = useState<FileRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [recipientModal, setRecipientModal] = useState<string | null>(null);
  const [uploadsModal, setUploadsModal] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const data = await api<{ ok: boolean; requests: FileRequest[] }>(
        `/api/file-requests?workspace_id=${workspaceId}`,
      );
      if (data.ok) setRequests(data.requests);
    } catch {}
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const filtered = search
    ? requests.filter((r) => (r.title ?? '').toLowerCase().includes(search.toLowerCase()))
    : requests;

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Files sidebar (kept visible on the file-requests page) */}
      <FilesSidebar
        onFilterChange={(filter) => navigate(filter ? `/files?filter=${filter}` : '/files')}
        onFavouriteClick={() => navigate('/files')}
        onGroupClick={(groupId) => navigate(`/files?group=${groupId}`)}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl font-bold">File requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading ? 'Loading...' : `${requests.length} request${requests.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-44">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search requests..."
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              className="h-8 text-xs pl-8"
            />
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New request
          </Button>
          <Link to="/files">
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowLeft className="size-4" /> Files
            </Button>
          </Link>
        </div>
      </div>

      {/* List */}
      <Card className="gap-0 py-0 overflow-hidden">
        {loading ? (
          <div className="space-y-0">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-4 border-b last:border-b-0">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-2.5 w-60" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            {search ? 'No requests match your search' : 'No file requests yet. Click "New request" to create one.'}
          </div>
        ) : (
          filtered.map((r) => {
            const revoked = r.is_revoked === 1;
            const expired = !revoked && r.expires_at != null && r.expires_at < now;
            const isActive = !revoked && !expired;
            return (
              <RequestRow key={r.id} request={r} revoked={revoked} expired={expired} isActive={isActive}
                onRevoke={loadRequests}
                onOpenRecipients={() => setRecipientModal(r.id)}
                onOpenUploads={() => setUploadsModal(r.id)}
              />
            );
          })
        )}
      </Card>

      {/* Create modal */}
      {createOpen && (
        <CreateRequestDialog
          workspaceId={workspaceId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); loadRequests(); }}
        />
      )}

      {/* Recipients modal */}
      {recipientModal && (
        <RecipientsDialog requestId={recipientModal} onClose={() => setRecipientModal(null)} />
      )}

      {/* Uploads modal */}
      {uploadsModal && (
        <UploadsDialog requestId={uploadsModal} onClose={() => setUploadsModal(null)} />
      )}
        </div>
      </div>
    </div>
  );
}

// ── Request Row ───────────────────────────────────────────

function RequestRow({ request: r, revoked, expired, isActive, onRevoke, onOpenRecipients, onOpenUploads }: {
  request: FileRequest; revoked: boolean; expired: boolean; isActive: boolean;
  onRevoke: () => void; onOpenRecipients: () => void; onOpenUploads: () => void;
}) {
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleRevoke = async () => {
    setRevoking(true);
    try {
      await api(`/api/file-requests/${r.id}`, { method: 'DELETE' });
      onRevoke();
    } catch {}
    setRevoking(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(r.url);
    setCopied(true);
    toast.success('Link copied', 'The request link is on your clipboard.');
    setTimeout(() => setCopied(false), 2000);
  };

  const expiryText = r.expires_at
    ? expired
      ? `Expired ${timeAgo(r.expires_at)}`
      : `Expires ${new Date(r.expires_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : 'No expiry';

  return (
    <div className={`flex items-center gap-3 px-5 py-3.5 border-b last:border-b-0 hover:bg-muted/50 transition-colors ${revoked ? 'opacity-50' : ''}`}>
      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
        <Mail className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${revoked ? 'line-through' : ''}`}>
          {r.title || 'Untitled request'}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {revoked ? (
            <Badge variant="secondary" className="text-[10px]">Revoked</Badge>
          ) : expired ? (
            <Badge variant="destructive" className="text-[10px]">Expired</Badge>
          ) : (
            <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]">Active</Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">{r.upload_count} file{r.upload_count === 1 ? '' : 's'}</Badge>
          {r.is_password_protected ? <Badge variant="secondary" className="text-[10px]">Password</Badge> : null}
          <span className="text-[11px] text-muted-foreground">{expiryText}</span>
          <span className="text-[11px] text-muted-foreground">
            Created {timeAgo(r.created_at)} {r.created_by_name ? `by ${r.created_by_name}` : ''}
          </span>
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onOpenRecipients}>Recipients</Button>
        {r.upload_count > 0 && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onOpenUploads}>
            Uploads ({r.upload_count})
          </Button>
        )}
        {!revoked && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleCopy}>
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? 'Copied!' : 'Copy link'}
          </Button>
        )}
        {isActive && (
          <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleRevoke} disabled={revoking}>
            {revoking ? <Loader2 className="size-3 animate-spin" /> : 'Revoke'}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Create Request Dialog ─────────────────────────────────

const EXPIRY_OPTIONS = [
  { value: '0', label: 'Never' },
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

function CreateRequestDialog({ workspaceId, onClose, onCreated }: {
  workspaceId: string; onClose: () => void; onCreated: () => void;
}) {
  const [tab, setTab] = useState<'email' | 'link'>('email');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [password, setPassword] = useState('');
  const [expiry, setExpiry] = useState('7');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [allowedExts, setAllowedExts] = useState('');
  const [maxSizeMb, setMaxSizeMb] = useState('');
  const [maxFiles, setMaxFiles] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');

  // Folder picker
  const [folders, setFolders] = useState<PickerFolder[]>([]);

  useEffect(() => {
    api<{ ok: boolean; folders?: PickerFolder[] }>(`/api/folders/tree?workspace_id=${workspaceId}`)
      .then((d) => { if (d.ok && d.folders) setFolders(d.folders); })
      .catch(() => {});
  }, [workspaceId]);

  const addEmail = (raw: string) => {
    const e = raw.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || emails.includes(e)) return;
    setEmails((prev) => [...prev, e]);
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

  const handleSubmit = async () => {
    setError('');
    if (tab === 'email' && emails.length === 0) {
      setError('Add at least one email address.');
      return;
    }
    const pw = password.trim();
    if (pw && pw.length < 8) { setError('Password must be at least 8 characters.'); return; }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { workspace_id: workspaceId };
      if (title.trim()) body.title = title.trim();
      if (message.trim()) body.message = message.trim();
      if (tab === 'email' && emails.length > 0) body.emails = emails;
      if (pw) body.password = pw;
      if (folderId) body.folder_id = folderId;
      const days = Number(expiry);
      if (days > 0) body.expires_in_days = days;
      if (allowedExts.trim()) body.allowed_extensions = allowedExts.trim();
      if (maxSizeMb.trim()) body.max_file_size_mb = Number(maxSizeMb);
      if (maxFiles.trim()) body.max_files = Number(maxFiles);

      const res = await api<{ ok: boolean; request?: { url: string }; url?: string; error?: string }>('/api/file-requests/create', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const url = res.url ?? res.request?.url ?? '';
        if (tab === 'email') {
          toast.success('Request sent', `Request sent to ${emails.length} recipient${emails.length === 1 ? '' : 's'}`);
          onCreated();
        } else {
          // Link mode: show the URL inline
          setResultUrl(url);
          setSubmitting(false);
          try { await navigator.clipboard.writeText(url); toast.success('Link copied', 'The request link is on your clipboard.'); } catch {}
        }
      } else {
        setError(res.error ?? 'Failed to create');
        setSubmitting(false);
      }
    } catch {
      setError('Network error');
      setSubmitting(false);
    }
  };

  const handleCopyResult = async () => {
    try { await navigator.clipboard.writeText(resultUrl); toast.success('Link copied', 'The link is on your clipboard.'); } catch {}
  };

  const selectedFolder = folders.find((f) => f.id === folderId);

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Request files</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <Tabs
          value={tab}
          onValueChange={(v) => { setTab(v as 'email' | 'link'); setResultUrl(''); setError(''); }}
          className="-mx-4"
        >
          <TabsList variant="line" className="w-full gap-0 border-b p-0 group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="email" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Mail className="size-3.5" /> By email
            </TabsTrigger>
            <TabsTrigger value="link" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Copy className="size-3.5" /> By link
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1 overflow-y-auto space-y-4 -mx-4 px-4">
          {/* Email tab: recipients */}
          {tab === 'email' && (
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1 block">Email addresses</Label>
              <div className="flex flex-wrap gap-1 min-h-9 border rounded-md px-2 py-1.5 cursor-text focus-within:ring-1 focus-within:ring-ring">
                {emails.map((e, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-muted rounded px-1.5 py-0.5 text-[11px] font-medium">
                    {e}
                    <button onClick={() => setEmails((prev) => prev.filter((_, j) => j !== i))}><X className="size-2.5" /></button>
                  </span>
                ))}
                <input
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={handleEmailKeyDown}
                  onBlur={() => { if (emailInput.trim()) { addEmail(emailInput); setEmailInput(''); } }}
                  placeholder={emails.length === 0 ? 'name@example.com (press Enter to add)' : ''}
                  className="flex-1 min-w-24 bg-transparent outline-none text-xs"
                />
              </div>
            </div>
          )}

          {/* Link tab: info */}
          {tab === 'link' && !resultUrl && (
            <p className="text-xs text-muted-foreground">Generate a link anyone can use to upload files to your workspace.</p>
          )}

          {/* Shared fields (hidden after link result) */}
          {!resultUrl && (
            <>
              {/* Title */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">Title <span className="font-normal">(optional)</span></Label>
                <Input value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} placeholder="e.g. Q1 invoices" className="h-8 text-xs" />
              </div>

              {/* Message */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">Message <span className="font-normal">(optional)</span></Label>
                <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please send the signed contracts..." className="h-14 min-h-0 px-3 text-xs md:text-xs resize-y" />
              </div>

              {/* Password + Expiry row */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">Password <span className="font-normal">(opt)</span></Label>
                  <Input type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} placeholder="Min 8 chars" className="h-8 text-xs" autoComplete="off" />
                </div>
                <div className="flex-1">
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">Expires</Label>
                  <Select value={expiry} onValueChange={(v) => setExpiry(v as string)} items={EXPIRY_OPTIONS}>
                    <SelectTrigger className="w-full h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Upload destination */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">Upload destination</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full h-8 border rounded-md px-2.5 text-xs bg-background flex items-center gap-2 hover:bg-muted/50 text-left">
                    {selectedFolder ? <><FolderOpen className="size-3 text-muted-foreground shrink-0" /> {selectedFolder.name}</> : <><Home className="size-3 text-muted-foreground shrink-0" /> Root (workspace top level)</>}
                    <ChevronDown className="size-3 text-muted-foreground ml-auto" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-40">
                    <DropdownMenuItem className={`text-xs ${!folderId ? 'font-medium' : ''}`} onClick={() => setFolderId(null)}>
                      <Home className="size-3 text-muted-foreground" /> Root
                    </DropdownMenuItem>
                    {folders.map((f) => (
                      <DropdownMenuItem key={f.id} className={`text-xs ${folderId === f.id ? 'font-medium' : ''}`} onClick={() => setFolderId(f.id)}>
                        <FolderOpen className="size-3 text-muted-foreground" /> {f.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Advanced options */}
              <div>
                <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setShowAdvanced(!showAdvanced)}>
                  <ChevronDown className={`size-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} /> Advanced options
                </button>
                {showAdvanced && (
                  <div className="mt-2 space-y-3">
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground mb-1 block">Allowed extensions</Label>
                      <Input value={allowedExts} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAllowedExts(e.target.value)} placeholder=".pdf, .docx, .jpg" className="h-8 text-xs" />
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <Label className="text-xs font-medium text-muted-foreground mb-1 block">Max file size (MB)</Label>
                        <Input type="number" value={maxSizeMb} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxSizeMb(e.target.value)} placeholder="No limit" className="h-8 text-xs" />
                      </div>
                      <div className="flex-1">
                        <Label className="text-xs font-medium text-muted-foreground mb-1 block">Max files</Label>
                        <Input type="number" value={maxFiles} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxFiles(e.target.value)} placeholder="Unlimited" className="h-8 text-xs" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Result URL (link mode) */}
          {resultUrl && (
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Request link</Label>
              <div className="flex gap-2">
                <Input value={resultUrl} readOnly className="h-8 text-xs font-mono flex-1" />
                <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={handleCopyResult}>Copy</Button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { if (resultUrl) { onCreated(); } else { onClose(); } }}>
            {resultUrl ? 'Done' : 'Cancel'}
          </Button>
          {!resultUrl && (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin mr-1.5" /> : tab === 'email' ? <Send className="size-3.5 mr-1.5" /> : <Copy className="size-3.5 mr-1.5" />}
              {submitting ? (tab === 'email' ? 'Sending...' : 'Creating...') : (tab === 'email' ? 'Send request' : 'Generate link')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Recipients Dialog ─────────────────────────────────────

function RecipientsDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [title, setTitle] = useState('Recipients');
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [resendingAll, setResendingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ ok: boolean; recipients: Recipient[]; title: string | null }>(
        `/api/file-requests/${requestId}/recipients`,
      );
      if (data.ok) {
        setRecipients(data.recipients);
        if (data.title) setTitle(`Recipients: ${data.title}`);
      }
    } catch {}
    setLoading(false);
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  const addRecipient = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email address'); return;
    }
    setError('');
    setAdding(true);
    try {
      const data = await api<{ ok: boolean; error?: string }>(`/api/file-requests/${requestId}/recipients`, {
        method: 'POST', body: JSON.stringify({ email: trimmed }),
      });
      if (data.ok) { setEmail(''); load(); } else setError(data.error ?? 'Failed');
    } catch { setError('Network error'); }
    setAdding(false);
  };

  const resendAll = async () => {
    const pending = recipients.filter((r) => !r.uploaded_at);
    if (pending.length === 0) return;
    setResendingAll(true);
    for (const r of pending) {
      try {
        await api(`/api/file-requests/${requestId}/resend`, {
          method: 'POST', body: JSON.stringify({ recipient_id: r.id }),
        });
      } catch {}
    }
    toast.success('Invites resent', `Resent to ${pending.length} recipient${pending.length === 1 ? '' : 's'}`);
    load();
    setResendingAll(false);
  };

  const pendingCount = recipients.filter((r) => !r.uploaded_at).length;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Add recipient */}
        <div className="flex gap-2">
          <Input type="email" placeholder="Add email address..." value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && addRecipient()}
            className="h-8 text-xs flex-1"
          />
          <Button size="sm" className="h-8 text-xs gap-1" onClick={addRecipient} disabled={adding}>
            {adding ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />} Add & send
          </Button>
          {pendingCount > 0 && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={resendAll} disabled={resendingAll}>
              {resendingAll ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
              Resend all
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* List */}
        <div className="max-h-64 overflow-y-auto -mx-4 px-4">
          {loading ? (
            <div className="space-y-2 py-4">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : recipients.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No recipients yet. Add one above.</p>
          ) : (
            recipients.map((r) => (
              <RecipientRow key={r.id} recipient={r} requestId={requestId} onUpdate={load} />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecipientRow({ recipient: r, requestId, onUpdate }: {
  recipient: Recipient; requestId: string; onUpdate: () => void;
}) {
  const [resending, setResending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const uploaded = r.uploaded_at !== null;

  const resend = async () => {
    setResending(true);
    try {
      await api(`/api/file-requests/${requestId}/resend`, {
        method: 'POST', body: JSON.stringify({ recipient_id: r.id }),
      });
      toast.success('Invite resent', `Resent to ${r.email}`);
      onUpdate();
    } catch {}
    setResending(false);
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await api(`/api/file-requests/${requestId}/recipients?recipient_id=${r.id}`, { method: 'DELETE' });
      onUpdate();
    } catch { setRemoving(false); }
  };

  return (
    <div className="flex items-center gap-2.5 py-2.5 border-b last:border-b-0">
      <div className={`w-2 h-2 rounded-full shrink-0 ${uploaded ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{r.email}</p>
        <p className="text-[10px] text-muted-foreground">
          {uploaded ? 'Uploaded' : 'Pending'} · {r.sent_at ? `Sent ${timeAgo(r.sent_at)}` : 'Not sent'}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        {!uploaded && (
          <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={resend} disabled={resending}>
            {resending ? <Loader2 className="size-3 animate-spin" /> : 'Resend'}
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] text-destructive border-destructive/30 hover:bg-destructive/10" onClick={remove} disabled={removing}>
          {removing ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
        </Button>
      </div>
    </div>
  );
}

// ── Uploads Dialog ────────────────────────────────────────

function UploadsDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [title, setTitle] = useState('Uploads');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ ok: boolean; uploads: Upload[]; title: string | null }>(
      `/api/file-requests/${requestId}/uploads`,
    ).then((data) => {
      if (data.ok) {
        setUploads(data.uploads);
        if (data.title) setTitle(`Uploads: ${data.title}`);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [requestId]);

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto -mx-4 px-4">
          {loading ? (
            <div className="space-y-2 py-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : uploads.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No uploads yet.</p>
          ) : (
            uploads.map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-2.5 border-b last:border-b-0">
                <div className="size-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                  <img src={fileIconSrc(u.file_name)} alt="" className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{u.file_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {humanSize(u.size_bytes)} · {u.uploader_name || u.uploader_email || 'Anonymous'} · {timeAgo(u.created_at)}
                  </p>
                </div>
                <a href={`${API_BASE}/api/files/${u.file_id}/download`} download className="size-7 rounded-md flex items-center justify-center hover:bg-muted shrink-0" title="Download">
                  <Download className="size-3.5 text-muted-foreground" />
                </a>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
