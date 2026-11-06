import { formatDateWith } from '@/lib/format-locale';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { textEditorHref, type TextEditorState } from '@/lib/text-edit';
import { useQueryClient } from '@tanstack/react-query';
import { api, API_BASE } from '@/api/client';
import { useDocumentTitle } from '@/lib/page-title';
import { FILES_QUERY_ROOT } from '@/lib/files-request';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ChevronLeft, ChevronDown, Download, Copy, Check, Lock,
  FileText, Users, Loader2, Search, Pencil, Trash2, X,
} from 'lucide-react';
import { humanSize, timeAgo, fileIconSrc } from '@/lib/helpers';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import type { MessageKey } from '@/i18n/keys';
import { startArchiveDownload } from '@/lib/archive-download';
import { FileViewer } from '@/components/file-viewer';
import { FileRequestEditDialog } from '@/components/file-request-edit-dialog';

// ── Types ─────────────────────────────────────────────────

interface RequestMeta {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  folder_name: string | null;
  token: string;
  url: string;
  title: string | null;
  message: string | null;
  is_revoked: number;
  is_password_protected: number;
  expires_at: number | null;
  allowed_extensions: string | null;
  max_file_size_bytes: number | null;
  max_files: number | null;
  upload_count: number;
  created_at: number;
  created_by_name: string | null;
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
  updated_at: number;
  current_version: number;
  lock_mode: string;
  is_hidden: number;
  uploaded_by: string | null;
  region: string | null;
  origin: string | null;
}

interface Recipient {
  id: string;
  email: string;
  sent_at: number | null;
  uploaded_at: number | null;
}

// Matches the FileItem shape FileViewer expects (structural typing).
interface ViewerFile {
  id: string; name: string; size_bytes: number; mime_type: string; extension: string;
  region: string; created_at: number; updated_at: number; current_version: number;
  lock_mode: string; is_hidden: number; uploaded_by: string; uploader_name: string;
  share_count: number; comment_count: number; is_synced: number;
}

type SortMode = 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'largest' | 'smallest';

const SORT_OPTIONS: { value: SortMode; labelKey: MessageKey }[] = [
  { value: 'newest', labelKey: 'common.option.newest' },
  { value: 'oldest', labelKey: 'common.option.oldest' },
  { value: 'name_asc', labelKey: 'common.option.nameAZ' },
  { value: 'name_desc', labelKey: 'common.option.nameZA' },
  { value: 'largest', labelKey: 'common.option.largest' },
  { value: 'smallest', labelKey: 'common.option.smallest' },
];

function toViewerFile(u: Upload, anonymous: string): ViewerFile {
  return {
    id: u.file_id, name: u.file_name, size_bytes: u.size_bytes, mime_type: u.mime_type,
    extension: u.extension ?? '', region: u.region ?? '', created_at: u.created_at,
    updated_at: u.updated_at, current_version: u.current_version, lock_mode: u.lock_mode,
    is_hidden: u.is_hidden, uploaded_by: u.uploaded_by ?? '',
    uploader_name: u.uploader_name ?? u.uploader_email ?? anonymous,
    share_count: 0, comment_count: 0, is_synced: 0,
  };
}

// ── Page ──────────────────────────────────────────────────

export default function FileRequestDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<RequestMeta | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // Table state
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewerFile, setViewerFile] = useState<ViewerFile | null>(null);
  const navigate = useNavigate();
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [zipping, setZipping] = useState(false);

  const queryClient = useQueryClient();
  const sortItems = SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));
  // Rename/delete here mutate the SAME workspace files the main /files page's
  // React Query cache holds - without this, renaming or deleting an upload
  // from this page leaves that cache stale (same shape as the upload-complete
  // fix in lib/query-client.ts) until its own staleTime elapses.
  const invalidateFilesCache = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [FILES_QUERY_ROOT] });
  }, [queryClient]);

  useDocumentTitle(request?.title ? t('file-request-detail.label.requesttitleFileRequest', { requestTitle: request.title }) : t('file-request-detail.label.fileRequest'));

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api<{
        ok: boolean; request: RequestMeta; uploads: Upload[]; recipients: Recipient[];
      }>(`/api/file-requests/${id}/uploads`);
      if (data.ok) {
        setRequest(data.request);
        setUploads(data.uploads);
        setRecipients(data.recipients);
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async () => {
    if (!request) return;
    await navigator.clipboard.writeText(request.url);
    setCopied(true);
    toast.success(t('common.feedback.linkCopied'), t('common.feedback.theRequestLinkIsOnYourClipboard'));
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async () => {
    if (!request) return;
    setRevoking(true);
    try {
      await api(`/api/file-requests/${request.id}`, { method: 'DELETE' });
      toast.success(t('file-request-detail.feedback.requestRevoked'), t('file-request-detail.feedback.theUploadLinkNoLongerWorks'));
      load();
    } catch { toast.error(t('common.error.revokeFailed'), t('file-request-detail.error.theRequestCouldNotBeRevoked')); }
    setRevoking(false);
  };

  const handleDownload = (fileId: string) => {
    window.open(`${API_BASE}/api/files/${fileId}/download`, '_blank');
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    try {
      await api(`/api/files/${renameTarget.id}/rename`, {
        method: 'PUT', body: JSON.stringify({ name: renameName.trim() }),
      });
      toast.success(t('common.feedback.renamed'), t('file-request-detail.feedback.theFileHasBeenRenamed'));
      setRenameTarget(null); load(); invalidateFilesCache();
    } catch { toast.error(t('common.error.renameFailed'), t('file-request-detail.error.theFileCouldNotBeRenamed')); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api(`/api/files/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success(t('common.feedback.deleted'), t('common.feedback.deletetargetnameWasDeleted', { deleteTargetName: deleteTarget.name }));
      setSelected((prev) => { const next = new Set(prev); next.delete(deleteTarget.id); return next; });
      setDeleteTarget(null);
      load(); invalidateFilesCache();
    } catch { toast.error(t('common.error.deleteFailed'), t('file-request-detail.error.theFileCouldNotBeDeleted')); }
  };

  const bulkDelete = async () => {
    if (!request || selected.size === 0) return;
    try {
      await api('/api/files/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: request.workspace_id, file_ids: Array.from(selected), folder_ids: [] }),
      });
      toast.success(t('common.feedback.deleted'), t('file-request-detail.feedback.selectedsizePluralOneFileOtherFilesDeleted', { selectedSize: selected.size }));
      setSelected(new Set()); setBulkDeleteOpen(false); load(); invalidateFilesCache();
    } catch { toast.error(t('common.error.deleteFailed'), t('file-request-detail.error.theSelectedFilesCouldNotBeDeleted')); }
  };

  // Streams through the shared helper rather than buffering the archive into a
  // Blob and an object URL, which pinned the whole ZIP in tab memory and left
  // the downloads shelf empty until the last byte arrived (see
  // lib/archive-download).
  const bulkDownloadZip = async () => {
    if (selected.size === 0) return;
    setZipping(true);
    const { parts } = await startArchiveDownload(
      { fileIds: Array.from(selected) },
      { onError: (message) => toast.error(t('common.error.downloadProblem'), message) },
    );
    if (parts > 1) toast.info(t('common.feedback.downloadStarted'), t('file-request-detail.feedback.tooManyFilesForOneZipArrivingAsPartsDownloads', { parts: String(parts) }));
    setZipping(false);
  };

  const toggleSelect = (fileId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
      return next;
    });
  };

  const visible = useMemo(() => {
    let list = uploads;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((u) =>
        u.file_name.toLowerCase().includes(q) ||
        (u.uploader_name ?? '').toLowerCase().includes(q) ||
        (u.uploader_email ?? '').toLowerCase().includes(q));
    }
    const sorted = [...list];
    switch (sort) {
      case 'newest': sorted.sort((a, b) => b.created_at - a.created_at); break;
      case 'oldest': sorted.sort((a, b) => a.created_at - b.created_at); break;
      case 'name_asc': sorted.sort((a, b) => a.file_name.localeCompare(b.file_name)); break;
      case 'name_desc': sorted.sort((a, b) => b.file_name.localeCompare(a.file_name)); break;
      case 'largest': sorted.sort((a, b) => b.size_bytes - a.size_bytes); break;
      case 'smallest': sorted.sort((a, b) => a.size_bytes - b.size_bytes); break;
    }
    return sorted;
  }, [uploads, search, sort]);

  const anonymous = t('file-request-detail.label.anonymous');
  const viewerFiles = useMemo(() => visible.map((u) => toViewerFile(u, anonymous)), [visible, anonymous]);

  const allVisibleSelected = visible.length > 0 && visible.every((u) => selected.has(u.file_id));
  const toggleSelectAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((u) => u.file_id)));
  };

  const now = Math.floor(Date.now() / 1000);
  const revoked = request?.is_revoked === 1;
  const expired = !revoked && request?.expires_at != null && request.expires_at < now;
  const uploadedCount = recipients.filter((r) => r.uploaded_at).length;
  const pendingCount = recipients.length - uploadedCount;

  const metaLine = request
    ? t('file-request-detail.description.uploadscountPluralHasexpiryHascreator', {
        uploadsCount: uploads.length,
        hasExpiry: request.expires_at ? 'true' : 'other',
        expired: expired ? 'true' : 'other',
        formattedDate: request.expires_at ? formatDateWith(request.expires_at, { month: 'short', day: 'numeric' }) : '',
        requestCreated_at: timeAgo(request.created_at),
        hasCreator: request.created_by_name ? 'true' : 'other',
        requestCreated_by_name: request.created_by_name ?? '',
      }).replace(/ {2,}/g, ' ').trim() // some languages leave a doubled space where the expiry or creator part is empty
    : '';

  if (notFound) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Link to="/file-requests" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ChevronLeft className="size-3.5 rtl:-scale-x-100" /> {t('file-request-detail.action.backToFileRequests')}
        </Link>
        <Card className="gap-0 py-12 text-center text-sm text-muted-foreground">
          {t('file-request-detail.description.thisFileRequestDoesNotExistOrYouDoNotHave')}
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to="/file-requests" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ChevronLeft className="size-3.5 rtl:-scale-x-100" /> {t('file-request-detail.action.backToFileRequests')}
      </Link>

      {loading || !request ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <div className="animate-content-in">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold truncate">{request.title || t('file-request-detail.heading.untitledRequest')}</h1>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {revoked ? (
                  <Badge variant="secondary" className="text-[10px]">{t('common.status.revoked')}</Badge>
                ) : expired ? (
                  <Badge variant="destructive" className="text-[10px]">{t('common.status.expired')}</Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]">{t('common.status.active')}</Badge>
                )}
                {request.is_password_protected ? (
                  <Badge variant="secondary" className="text-[10px] gap-1"><Lock className="size-2.5" /> {t('common.status.password')}</Badge>
                ) : null}
                <span className="text-[11px] text-muted-foreground">
                  {metaLine}
                </span>
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleCopy}>
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? t('common.action.copied.copied') : t('common.action.copyLink')}
              </Button>
              {!revoked && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditOpen(true)}>{t('common.edit')}</Button>
              )}
              {!revoked && !expired && (
                <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleRevoke} disabled={revoking}>
                  {revoking ? <Loader2 className="size-3 animate-spin" /> : t('common.action.revoke')}
                </Button>
              )}
            </div>
          </div>

          {/* Recipients (collapsible) */}
          {recipients.length > 0 && (
            <Card className="gap-0 py-0 mb-4 overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-4 py-2.5 text-start hover:bg-muted/50"
                onClick={() => setRecipientsOpen(!recipientsOpen)}
              >
                <Users className="size-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-semibold flex-1">{t('file-request-detail.action.recipientsRecipientscount', { recipientCount: String(recipients.length) })}</span>
                <span className="text-xs text-muted-foreground">
                  {(() => {
                    const [done, ...more] = t('file-request-detail.action.uploadedcountUploadedPendingcountPending', {
                      uploadedCount: String(uploadedCount), pendingCount: String(pendingCount),
                    }).split(' · ');
                    return more.length
                      ? <><span className="text-green-600 font-medium">{done}</span> · {more.join(' · ')}</>
                      : done;
                  })()}
                </span>
                <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${recipientsOpen ? 'rotate-180' : ''}`} />
              </button>
              {recipientsOpen && (
                <div className="px-4 pb-3 pt-1 space-y-1.5 border-t">
                  {recipients.map((r) => (
                    <div key={r.id} className="flex items-center gap-2.5 text-xs pt-1.5">
                      <div className={`size-2 rounded-full shrink-0 ${r.uploaded_at ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                      <span className="flex-1 truncate">{r.email}</span>
                      <span className="text-muted-foreground">{r.uploaded_at ? t('file-request-detail.label.uploadedRuploadedAt', { rUploaded_at: timeAgo(r.uploaded_at) }) : t('common.label.pending')}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1 max-w-56">
              <Search className="size-3.5 absolute inset-s-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('file-request-detail.placeholder.searchUploads')}
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                className="h-8 text-xs ps-8"
              />
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as SortMode)} items={sortItems}>
              <SelectTrigger className="h-8 text-xs w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortItems.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected.size > 0 && (
              <div className="flex items-center gap-1.5 ms-auto">
                <span className="text-xs text-muted-foreground">{t('common.label.totalselectedSelected', { totalSelected: String(selected.size) })}</span>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={bulkDownloadZip} disabled={zipping}>
                  {zipping ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />} {t('common.action.download')}
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash2 className="size-3" /> {t('common.delete')}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(new Set())}>
                  <X className="size-3" />
                </Button>
              </div>
            )}
          </div>

          {/* Uploads table */}
          <Card className="gap-0 py-0 overflow-hidden">
            {uploads.length === 0 ? (
              <div className="py-14 text-center">
                <FileText className="size-8 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-3">{t('common.label.noFilesUploadedYet')}</p>
                {!revoked && !expired && (
                  <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={handleCopy}>
                    <Copy className="size-3" /> {t('file-request-detail.action.copyRequestLink')}
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* Header row */}
                <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30 text-[11px] font-medium text-muted-foreground">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} className="size-3.5 shrink-0" />
                  <span className="flex-1 min-w-40">{t('common.label.name')}</span>
                  <span className="w-20">{t('common.label.size')}</span>
                  <span className="w-36 hidden sm:block">{t('common.label.uploader')}</span>
                  <span className="w-24">{t('common.status.uploaded')}</span>
                  <span className="w-24" />
                </div>
                {visible.length === 0 ? (
                  <p className="py-10 text-center text-xs text-muted-foreground">{t('file-request-detail.label.noUploadsMatchYourSearch')}</p>
                ) : (
                  visible.map((u, idx) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 hover:bg-muted/50 cursor-pointer group"
                      onClick={() => setViewerFile(viewerFiles[idx])}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(u.file_id)}
                        onChange={() => toggleSelect(u.file_id)}
                        onClick={(e) => e.stopPropagation()}
                        className="size-3.5 shrink-0"
                      />
                      <div className="flex-1 min-w-40 flex items-center gap-2.5">
                        <img src={fileIconSrc(u.file_name)} alt="" className="size-5 shrink-0" />
                        <span className="text-sm font-medium truncate">{u.file_name}</span>
                      </div>
                      <span className="w-20 text-xs text-muted-foreground">{humanSize(u.size_bytes)}</span>
                      <span className="w-36 text-xs text-muted-foreground truncate hidden sm:block">
                        {u.uploader_name || u.uploader_email || anonymous}
                      </span>
                      <span className="w-24 text-xs text-muted-foreground">{timeAgo(u.created_at)}</span>
                      <div className="w-24 flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <button className="size-7 rounded-md flex items-center justify-center hover:bg-muted" title={t('common.action.download')} onClick={() => handleDownload(u.file_id)}>
                          <Download className="size-3.5 text-muted-foreground" />
                        </button>
                        <button className="size-7 rounded-md flex items-center justify-center hover:bg-muted" title={t('common.action.rename')} onClick={() => { setRenameTarget({ id: u.file_id, name: u.file_name }); setRenameName(u.file_name); }}>
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </button>
                        <button className="size-7 rounded-md flex items-center justify-center hover:bg-muted" title={t('common.delete')} onClick={() => setDeleteTarget({ id: u.file_id, name: u.file_name })}>
                          <Trash2 className="size-3.5 text-destructive" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {/* File viewer */}
      {viewerFile && request && (
        <FileViewer
          file={viewerFile}
          files={viewerFiles}
          workspaceId={request.workspace_id}
          onClose={() => setViewerFile(null)}
          onNavigate={(f) => setViewerFile(f as ViewerFile)}
          onRefresh={load}
          onEditText={(f) => { const state: TextEditorState = { back: true }; navigate(textEditorHref(f.id), { state }); }}
        />
      )}

      {/* Edit dialog */}
      {editOpen && request && (
        <FileRequestEditDialog
          request={request}
          workspaceId={request.workspace_id}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load(); }}
        />
      )}

      {/* Rename dialog */}
      {renameTarget && (
        <Dialog open onOpenChange={() => setRenameTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{t('file-request-detail.heading.renameFile')}</DialogTitle></DialogHeader>
            <Input
              value={renameName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameName(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleRename()}
              className="h-8 text-xs"
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameTarget(null)}>{t('common.cancel')}</Button>
              <Button onClick={handleRename}>{t('common.action.rename')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <Dialog open onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{t('file-request-detail.heading.deleteFile')}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              {richText(t('file-request-detail.description.deletetargetnameWillBeMovedToTrash'), {
                deleteTargetName: <span className="font-medium text-foreground">{deleteTarget.name}</span>,
              })}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
              <Button variant="destructive" onClick={handleDelete}>{t('common.delete')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Bulk delete confirm */}
      {bulkDeleteOpen && (
        <Dialog open onOpenChange={() => setBulkDeleteOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{t('file-request-detail.heading.deleteSelectedsizePluralOneFileOtherFiles', { selectedSize: selected.size })}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">{t('file-request-detail.description.theSelectedFilesWillBeMovedToTrash')}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>{t('common.cancel')}</Button>
              <Button variant="destructive" onClick={bulkDelete}>{t('common.delete')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
