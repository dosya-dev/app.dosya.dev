import { formatDateWith } from '@/lib/format-locale';
import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiErrorMessage } from '@/api/client';
import { FilesSidebar } from '@/components/files-sidebar';
import { useWorkspace } from '@/stores/workspace';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Plus, ArrowLeft, Mail, Copy, Check, Send, Trash2, Loader2,
  ChevronDown, FolderOpen, Home, X, Search, Inbox,
} from 'lucide-react';
import { timeAgo } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import type { MessageKey } from '@/i18n/keys';
import { toast } from '@/lib/toast';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { FileRequestEditDialog } from '@/components/file-request-edit-dialog';


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
  message: string | null;
  folder_id: string | null;
  folder_name: string | null;
  allowed_extensions: string | null;
  max_file_size_bytes: number | null;
  max_files: number | null;
}

interface Recipient {
  id: string;
  email: string;
  sent_at: number | null;
  uploaded_at: number | null;
}


// ── Page ──────────────────────────────────────────────────

export default function FileRequestsPage() {
  const t = useT();
  const workspaceId = useWorkspace((s: { activeId: string }) => s.activeId);
  const navigate = useNavigate();
  const [requests, setRequests] = useState<FileRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [recipientModal, setRecipientModal] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState<FileRequest | null>(null);
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
          <h1 className="text-xl font-bold">{t('common.heading.fileRequests')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading ? t('common.label.loading') : t('file-requests.description.requestscountPluralOneRequestOtherRequests', { requestsCount: requests.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-44">
            <Search className="size-3.5 absolute inset-s-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('file-requests.placeholder.searchRequests')}
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              className="h-8 text-xs ps-8"
            />
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> {t('file-requests.action.newRequest')}
          </Button>
          <Link to="/files">
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t('common.label.files.files')}
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
          search ? (
            <div className="py-12 text-center text-muted-foreground text-sm">{t('file-requests.label.noRequestsMatchYourSearch')}</div>
          ) : (
            <EmptyState
              icon={Inbox}
              title={t('file-requests.tooltip.noFileRequestsYet')}
              description={t('file-requests.description.aFileRequestCollectsFilesFromPeopleWhoDoNotHave')}
              actions={<Button size="sm" className="h-7 text-xs" onClick={() => setCreateOpen(true)}>{t('file-requests.action.createARequest')}</Button>}
            />
          )
        ) : (
          <div className="animate-content-in">
          {filtered.map((r) => {
            const revoked = r.is_revoked === 1;
            const expired = !revoked && r.expires_at != null && r.expires_at < now;
            const isActive = !revoked && !expired;
            return (
              <RequestRow key={r.id} request={r} revoked={revoked} expired={expired} isActive={isActive}
                onRevoke={loadRequests}
                onOpenRecipients={() => setRecipientModal(r.id)}
                onEdit={() => setEditRequest(r)}
              />
            );
          })}
          </div>
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

      {/* Edit modal */}
      {editRequest && (
        <FileRequestEditDialog
          request={editRequest}
          workspaceId={workspaceId}
          onClose={() => setEditRequest(null)}
          onSaved={() => { setEditRequest(null); loadRequests(); }}
        />
      )}
        </div>
      </div>
    </div>
  );
}

// ── Request Row ───────────────────────────────────────────

function RequestRow({ request: r, revoked, expired, isActive, onRevoke, onOpenRecipients, onEdit }: {
  request: FileRequest; revoked: boolean; expired: boolean; isActive: boolean;
  onRevoke: () => void; onOpenRecipients: () => void; onEdit: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
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
    toast.success(t('common.feedback.linkCopied'), t('common.feedback.theRequestLinkIsOnYourClipboard'));
    setTimeout(() => setCopied(false), 2000);
  };

  const expiryText = r.expires_at
    ? expired
      ? t('file-requests.label.expiredRexpiresAt', { rExpires_at: timeAgo(r.expires_at) })
      : t('common.label.expiresDate', { date: formatDateWith(r.expires_at, { month: 'short', day: 'numeric' }) })
    : t('common.label.noExpiry');

  // Template-only tidy: some languages leave a doubled or trailing space when the creator part is empty.
  const createdText = t('file-requests.description.createdRcreatedAtHascreator', {
    rCreated_at: timeAgo(r.created_at),
    hasCreator: r.created_by_name ? 'true' : 'other',
    rCreated_by_name: r.created_by_name ?? '',
  }).replace(/ {2,}/g, ' ').trim();

  return (
    <div className={`flex items-center gap-3 px-5 py-3.5 border-b last:border-b-0 hover:bg-muted/50 transition-colors ${revoked ? 'opacity-50' : ''}`}>
      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
        <Mail className="size-4" />
      </div>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/file-requests/${r.id}`)}>
        <p className={`text-sm font-medium truncate ${revoked ? 'line-through' : ''}`}>
          {r.title || t('common.label.untitledRequest')}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {revoked ? (
            <Badge variant="secondary" className="text-[10px]">{t('common.status.revoked')}</Badge>
          ) : expired ? (
            <Badge variant="destructive" className="text-[10px]">{t('common.status.expired')}</Badge>
          ) : (
            <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]">{t('common.status.active')}</Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">{t('file-requests.status.ruploadCountPluralOneFileOtherFiles', { rUpload_count: r.upload_count })}</Badge>
          {r.is_password_protected ? <Badge variant="secondary" className="text-[10px]">{t('common.status.password')}</Badge> : null}
          <span className="text-[11px] text-muted-foreground">{expiryText}</span>
          <span className="text-[11px] text-muted-foreground">
            {createdText}
          </span>
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onOpenRecipients}>{t('file-requests.action.recipients')}</Button>
        {r.upload_count > 0 && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate(`/file-requests/${r.id}`)}>
            {t('file-requests.action.uploadsRuploadCount', { uploadCount: String(r.upload_count) })}
          </Button>
        )}
        {!revoked && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onEdit}>{t('common.edit')}</Button>
        )}
        {!revoked && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleCopy}>
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? t('common.action.copied.copied') : t('common.action.copyLink')}
          </Button>
        )}
        {isActive && (
          <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleRevoke} disabled={revoking}>
            {revoking ? <Loader2 className="size-3 animate-spin" /> : t('common.action.revoke')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Create Request Dialog ─────────────────────────────────

const EXPIRY_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: '0', labelKey: 'common.label.never' },
  { value: '1', labelKey: 'common.label.oneDay' },
  { value: '7', labelKey: 'common.label.sevenDays' },
  { value: '30', labelKey: 'common.label.thirtyDays' },
  { value: '90', labelKey: 'common.label.ninetyDays' },
];

function CreateRequestDialog({ workspaceId, onClose, onCreated }: {
  workspaceId: string; onClose: () => void; onCreated: () => void;
}) {
  const t = useT();
  const expiryItems = EXPIRY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));
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
  // On by default for new requests: a class or a team sending files almost
  // always wants them kept apart per person.
  const [uploaderFolders, setUploaderFolders] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');

  // Folder picker
  const [folderName, setFolderName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

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
      setError(t('common.error.addAtLeastOneEmailAddress'));
      return;
    }
    const pw = password.trim();
    if (pw && pw.length < 8) { setError(t('file-requests.error.passwordMustBeAtLeastMinCharactersFullStop', { min: '8' })); return; }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { workspace_id: workspaceId };
      if (title.trim()) body.title = title.trim();
      if (message.trim()) body.message = message.trim();
      if (tab === 'email' && emails.length > 0) body.emails = emails;
      if (pw) body.password = pw;
      if (folderId) body.folder_id = folderId;
      body.uploader_folders = uploaderFolders;
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
          toast.success(t('file-requests.feedback.requestSent'), t('file-requests.feedback.requestSentToEmailscountPluralOneRecipientOtherRecipients', { emailsCount: emails.length }));
          onCreated();
        } else {
          // Link mode: show the URL inline
          setResultUrl(url);
          setSubmitting(false);
          try { await navigator.clipboard.writeText(url); toast.success(t('common.feedback.linkCopied'), t('common.feedback.theRequestLinkIsOnYourClipboard')); } catch {}
        }
      } else {
        setError(res.error ?? t('file-requests.error.failedToCreate'));
        setSubmitting(false);
      }
    } catch (err) {
      setError(apiErrorMessage(err));
      setSubmitting(false);
    }
  };

  const handleCopyResult = async () => {
    try { await navigator.clipboard.writeText(resultUrl); toast.success(t('common.feedback.linkCopied'), t('file-requests.feedback.theLinkIsOnYourClipboard')); } catch {}
  };

  return (
    <>
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('file-requests.heading.requestFiles')}</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <Tabs
          value={tab}
          onValueChange={(v) => { setTab(v as 'email' | 'link'); setResultUrl(''); setError(''); }}
          className="-mx-4"
        >
          <TabsList variant="line" className="w-full gap-0 border-b p-0 group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="email" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Mail className="size-3.5" /> {t('common.action.byEmail')}
            </TabsTrigger>
            <TabsTrigger value="link" className="flex-1 rounded-none py-2.5 text-xs group-data-horizontal/tabs:after:-bottom-px">
              <Copy className="size-3.5" /> {t('common.action.byLink')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1 overflow-y-auto space-y-4 -mx-4 px-4">
          {/* Email tab: recipients */}
          {tab === 'email' && (
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.label.emailAddresses')}</Label>
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
                  placeholder={emails.length === 0 ? t('file-requests.placeholder.nameExampleComPressEnterToAdd') : ''}
                  className="flex-1 min-w-24 bg-transparent outline-none text-xs"
                />
              </div>
            </div>
          )}

          {/* Link tab: info */}
          {tab === 'link' && !resultUrl && (
            <p className="text-xs text-muted-foreground">{t('file-requests.description.generateALinkAnyoneCanUseToUploadFilesToYour')}</p>
          )}

          {/* Shared fields (hidden after link result) */}
          {!resultUrl && (
            <>
              {/* Title */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.label.titleOptional')}</Label>
                <Input value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} placeholder={t('common.placeholder.eGQ1Invoices')} className="h-8 text-xs" />
              </div>

              {/* Message */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.label.messageOptional')}</Label>
                <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('common.placeholder.pleaseSendTheSignedContracts')} className="h-14 min-h-0 px-3 text-xs md:text-xs resize-y" />
              </div>

              {/* Password + Expiry row */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('file-requests.label.passwordOpt')}</Label>
                  <Input type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} placeholder={t('file-requests.placeholder.min8Chars')} className="h-8 text-xs" autoComplete="off" />
                </div>
                <div className="flex-1">
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.label.expires')}</Label>
                  <Select value={expiry} onValueChange={(v) => setExpiry(v as string)} items={expiryItems}>
                    <SelectTrigger className="w-full h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {expiryItems.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Upload destination */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.label.uploadDestination')}</Label>
                <button
                  type="button"
                  className="w-full h-8 border rounded-md px-2.5 text-xs bg-background flex items-center gap-2 hover:bg-muted/50 text-start"
                  onClick={() => setPickerOpen(true)}
                >
                  {folderId ? (
                    <>
                      <FolderOpen className="size-3 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{folderName || t('common.action.selectedFolder')}</span>
                    </>
                  ) : (
                    <>
                      <Home className="size-3 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{t('common.action.rootWorkspaceTopLevel')}</span>
                    </>
                  )}
                  <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                </button>
                <label className="mt-2 flex items-start gap-2 text-xs cursor-pointer">
                  <Checkbox
                    checked={uploaderFolders}
                    onCheckedChange={(v) => setUploaderFolders(v === true)}
                    className="mt-0.5"
                    data-testid="uploader-folders"
                  />
                  <span>
                    <span className="font-medium">{t('file-requests.description.putEachUploaderInTheirOwnFolder')}</span>
                    <span className="block text-muted-foreground">
                      {title.trim()
                        ? richText(
                            t('file-requests.description.filesGoToTitletrimWithAFolderPerPersonNamedAfter'),
                            { titleTrim: <span className="font-medium text-foreground">{title.trim()}</span> },
                          )
                        : t('file-requests.description.filesGoIntoAFolderPerPersonNamedAfterThem')}
                    </span>
                  </span>
                </label>
              </div>

              {/* Advanced options */}
              <div>
                <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setShowAdvanced(!showAdvanced)}>
                  <ChevronDown className={`size-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} /> {t('common.action.advancedOptions')}
                </button>
                {showAdvanced && (
                  <div className="mt-2 space-y-3">
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.label.allowedExtensions')}</Label>
                      <Input value={allowedExts} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAllowedExts(e.target.value)} placeholder={t('common.placeholder.pdfDocxJpg')} className="h-8 text-xs" />
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.label.maxFileSizeMb')}</Label>
                        <Input type="number" value={maxSizeMb} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxSizeMb(e.target.value)} placeholder={t('common.placeholder.noLimit')} className="h-8 text-xs" />
                      </div>
                      <div className="flex-1">
                        <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.label.maxFiles')}</Label>
                        <Input type="number" value={maxFiles} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxFiles(e.target.value)} placeholder={t('common.placeholder.unlimited')} className="h-8 text-xs" />
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
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('file-requests.label.requestLink')}</Label>
              <div className="flex gap-2">
                <Input value={resultUrl} readOnly dir="ltr" className="h-8 text-xs font-mono flex-1" />
                <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={handleCopyResult}>{t('common.copy')}</Button>
              </div>
            </div>
          )}

          {error && <p dir="auto" className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { if (resultUrl) { onCreated(); } else { onClose(); } }}>
            {resultUrl ? t('common.done') : t('common.cancel')}
          </Button>
          {!resultUrl && (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin me-1.5" /> : tab === 'email' ? <Send className="size-3.5 me-1.5 rtl:-scale-x-100" /> : <Copy className="size-3.5 me-1.5" />}
              {submitting ? (tab === 'email' ? t('common.action.sending') : t('common.action.creating')) : (tab === 'email' ? t('file-requests.action.sendRequest') : t('common.action.generateLink'))}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {pickerOpen && (
      <FolderPickerDialog
        open
        onClose={() => setPickerOpen(false)}
        workspaceId={workspaceId}
        selectedId={folderId}
        selectedName={folderName}
        onSelect={(id, name) => { setFolderId(id); setFolderName(id ? name : ''); setPickerOpen(false); }}
      />
    )}
    </>
  );
}

// ── Recipients Dialog ─────────────────────────────────────

function RecipientsDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const t = useT();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [dataTitle, setDataTitle] = useState<string | null>(null);
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
        if (data.title) setDataTitle(data.title);
      }
    } catch {}
    setLoading(false);
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  const addRecipient = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t('file-requests.error.enterAValidEmailAddress')); return;
    }
    setError('');
    setAdding(true);
    try {
      const data = await api<{ ok: boolean; error?: string }>(`/api/file-requests/${requestId}/recipients`, {
        method: 'POST', body: JSON.stringify({ email: trimmed }),
      });
      if (data.ok) { setEmail(''); load(); } else setError(data.error ?? t('common.error.failed'));
    } catch (err) { setError(apiErrorMessage(err)); }
    setAdding(false);
  };

  const resendAll = async () => {
    const pending = recipients.filter((r) => !r.uploaded_at);
    if (pending.length === 0) return;
    setResendingAll(true);
    // Reminders are rate limited per recipient, so some of these can be
    // refused; report what actually went out rather than what was asked for.
    let sent = 0;
    let lastError = '';
    for (const r of pending) {
      try {
        await api(`/api/file-requests/${requestId}/resend`, {
          method: 'POST', body: JSON.stringify({ recipient_id: r.id }),
        });
        sent++;
      } catch (err) { lastError = apiErrorMessage(err); }
    }
    if (sent > 0) toast.success(t('file-requests.feedback.remindersSent'), t('file-requests.feedback.sentToSentOfPendingcountPluralOneRecipientOther', { sent: String(sent), pendingCount: pending.length }));
    else toast.error(t('file-requests.error.noRemindersSent'), lastError || t('file-requests.error.tryAgainLater'));
    load();
    setResendingAll(false);
  };

  const pendingCount = recipients.filter((r) => !r.uploaded_at).length;
  const title = dataTitle ? t('file-requests.label.recipientsDatatitle', { dataTitle }) : t('common.label.recipients');

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Add recipient */}
        <div className="flex gap-2">
          <Input type="email" placeholder={t('file-requests.placeholder.addEmailAddress')} value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && addRecipient()}
            className="h-8 text-xs flex-1"
          />
          <Button size="sm" className="h-8 text-xs gap-1" onClick={addRecipient} disabled={adding}>
            {adding ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3 rtl:-scale-x-100" />} {t('file-requests.action.addSend')}
          </Button>
          {pendingCount > 0 && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={resendAll} disabled={resendingAll}>
              {resendingAll ? <Loader2 className="size-3 animate-spin me-1" /> : null}
              {t('file-requests.action.resendAll')}
            </Button>
          )}
        </div>
        {error && <p dir="auto" className="text-xs text-destructive">{error}</p>}

        {/* List */}
        <div className="max-h-64 overflow-y-auto -mx-4 px-4">
          {loading ? (
            <div className="space-y-2 py-4">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : recipients.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">{t('file-requests.description.noRecipientsYetAddOneAbove')}</p>
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
  const t = useT();
  const [resending, setResending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const uploaded = r.uploaded_at !== null;

  const resend = async () => {
    setResending(true);
    try {
      await api(`/api/file-requests/${requestId}/resend`, {
        method: 'POST', body: JSON.stringify({ recipient_id: r.id }),
      });
      toast.success(t('file-requests.feedback.reminderSent'), t('file-requests.feedback.sentToRemail', { rEmail: r.email }));
      onUpdate();
    } catch (err) { toast.error(t('file-requests.error.reminderNotSent'), apiErrorMessage(err)); }
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
          {uploaded ? t('common.status.uploaded') : t('common.label.pending')} · {r.sent_at ? t('file-requests.label.sentRsentAt', { rSent_at: timeAgo(r.sent_at) }) : t('file-requests.label.notSent')}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        {!uploaded && (
          <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={resend} disabled={resending}>
            {resending ? <Loader2 className="size-3 animate-spin" /> : t('common.action.resend')}
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] text-destructive border-destructive/30 hover:bg-destructive/10" onClick={remove} disabled={removing}>
          {removing ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
        </Button>
      </div>
    </div>
  );
}

