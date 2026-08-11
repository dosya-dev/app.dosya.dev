import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, API_BASE, responseErrorMessage } from '@/api/client';
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

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name_asc', label: 'Name A-Z' },
  { value: 'name_desc', label: 'Name Z-A' },
  { value: 'largest', label: 'Largest' },
  { value: 'smallest', label: 'Smallest' },
];

function toViewerFile(u: Upload): ViewerFile {
  return {
    id: u.file_id, name: u.file_name, size_bytes: u.size_bytes, mime_type: u.mime_type,
    extension: u.extension ?? '', region: u.region ?? '', created_at: u.created_at,
    updated_at: u.updated_at, current_version: u.current_version, lock_mode: u.lock_mode,
    is_hidden: u.is_hidden, uploaded_by: u.uploaded_by ?? '',
    uploader_name: u.uploader_name ?? u.uploader_email ?? 'Anonymous',
    share_count: 0, comment_count: 0, is_synced: 0,
  };
}

// ── Page ──────────────────────────────────────────────────

export default function FileRequestDetailPage() {
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
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [zipping, setZipping] = useState(false);

  const queryClient = useQueryClient();
  // Rename/delete here mutate the SAME workspace files the main /files page's
  // React Query cache holds - without this, renaming or deleting an upload
  // from this page leaves that cache stale (same shape as the upload-complete
  // fix in lib/query-client.ts) until its own staleTime elapses.
  const invalidateFilesCache = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [FILES_QUERY_ROOT] });
  }, [queryClient]);

  useDocumentTitle(request?.title ? `${request.title} · File request` : 'File request');

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
    toast.success('Link copied', 'The request link is on your clipboard.');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async () => {
    if (!request) return;
    setRevoking(true);
    try {
      await api(`/api/file-requests/${request.id}`, { method: 'DELETE' });
      toast.success('Request revoked', 'The upload link no longer works.');
      load();
    } catch { toast.error('Revoke failed', 'The request could not be revoked.'); }
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
      toast.success('Renamed', 'The file has been renamed.');
      setRenameTarget(null); load(); invalidateFilesCache();
    } catch { toast.error('Rename failed', 'The file could not be renamed.'); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api(`/api/files/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success('Deleted', `${deleteTarget.name} was deleted.`);
      setSelected((prev) => { const next = new Set(prev); next.delete(deleteTarget.id); return next; });
      setDeleteTarget(null);
      load(); invalidateFilesCache();
    } catch { toast.error('Delete failed', 'The file could not be deleted.'); }
  };

  const bulkDelete = async () => {
    if (!request || selected.size === 0) return;
    try {
      await api('/api/files/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: request.workspace_id, file_ids: Array.from(selected), folder_ids: [] }),
      });
      toast.success('Deleted', `${selected.size} file${selected.size === 1 ? '' : 's'} deleted.`);
      setSelected(new Set()); setBulkDeleteOpen(false); load(); invalidateFilesCache();
    } catch { toast.error('Delete failed', 'The selected files could not be deleted.'); }
  };

  const bulkDownloadZip = async () => {
    if (selected.size === 0) return;
    setZipping(true);
    try {
      const res = await fetch(`${API_BASE}/api/files/download-archive`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: Array.from(selected) }),
      });
      if (!res.ok) { toast.error('Download failed', await responseErrorMessage(res, 'The download could not be prepared.')); setZipping(false); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'dosya-download.zip'; a.click();
      URL.revokeObjectURL(url);
      toast.success('Downloaded', 'Download started');
    } catch { toast.error('Download failed', 'The download could not be prepared.'); }
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

  const viewerFiles = useMemo(() => visible.map(toViewerFile), [visible]);

  const allVisibleSelected = visible.length > 0 && visible.every((u) => selected.has(u.file_id));
  const toggleSelectAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((u) => u.file_id)));
  };

  const now = Math.floor(Date.now() / 1000);
  const revoked = request?.is_revoked === 1;
  const expired = !revoked && request?.expires_at != null && request.expires_at < now;
  const uploadedCount = recipients.filter((r) => r.uploaded_at).length;
  const pendingCount = recipients.length - uploadedCount;

  if (notFound) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Link to="/file-requests" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ChevronLeft className="size-3.5" /> Back to file requests
        </Link>
        <Card className="gap-0 py-12 text-center text-sm text-muted-foreground">
          This file request does not exist or you do not have access to it.
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to="/file-requests" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ChevronLeft className="size-3.5" /> Back to file requests
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
              <h1 className="text-xl font-bold truncate">{request.title || 'Untitled request'}</h1>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {revoked ? (
                  <Badge variant="secondary" className="text-[10px]">Revoked</Badge>
                ) : expired ? (
                  <Badge variant="destructive" className="text-[10px]">Expired</Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]">Active</Badge>
                )}
                {request.is_password_protected ? (
                  <Badge variant="secondary" className="text-[10px] gap-1"><Lock className="size-2.5" /> Password</Badge>
                ) : null}
                <span className="text-[11px] text-muted-foreground">
                  {uploads.length} file{uploads.length === 1 ? '' : 's'}
                  {request.expires_at ? ` · ${expired ? 'Expired' : 'Expires'} ${new Date(request.expires_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ' · No expiry'}
                  {` · Created ${timeAgo(request.created_at)}${request.created_by_name ? ` by ${request.created_by_name}` : ''}`}
                </span>
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleCopy}>
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? 'Copied!' : 'Copy link'}
              </Button>
              {!revoked && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditOpen(true)}>Edit</Button>
              )}
              {!revoked && !expired && (
                <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleRevoke} disabled={revoking}>
                  {revoking ? <Loader2 className="size-3 animate-spin" /> : 'Revoke'}
                </Button>
              )}
            </div>
          </div>

          {/* Recipients (collapsible) */}
          {recipients.length > 0 && (
            <Card className="gap-0 py-0 mb-4 overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/50"
                onClick={() => setRecipientsOpen(!recipientsOpen)}
              >
                <Users className="size-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-semibold flex-1">Recipients ({recipients.length})</span>
                <span className="text-xs text-muted-foreground">
                  <span className="text-green-600 font-medium">{uploadedCount} uploaded</span> · {pendingCount} pending
                </span>
                <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${recipientsOpen ? 'rotate-180' : ''}`} />
              </button>
              {recipientsOpen && (
                <div className="px-4 pb-3 pt-1 space-y-1.5 border-t">
                  {recipients.map((r) => (
                    <div key={r.id} className="flex items-center gap-2.5 text-xs pt-1.5">
                      <div className={`size-2 rounded-full shrink-0 ${r.uploaded_at ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                      <span className="flex-1 truncate">{r.email}</span>
                      <span className="text-muted-foreground">{r.uploaded_at ? `Uploaded ${timeAgo(r.uploaded_at)}` : 'Pending'}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1 max-w-56">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search uploads..."
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                className="h-8 text-xs pl-8"
              />
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as SortMode)} items={SORT_OPTIONS}>
              <SelectTrigger className="h-8 text-xs w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected.size > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={bulkDownloadZip} disabled={zipping}>
                  {zipping ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />} Download
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash2 className="size-3" /> Delete
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
                <p className="text-sm text-muted-foreground mb-3">No files uploaded yet</p>
                {!revoked && !expired && (
                  <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={handleCopy}>
                    <Copy className="size-3" /> Copy request link
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* Header row */}
                <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30 text-[11px] font-medium text-muted-foreground">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} className="size-3.5 shrink-0" />
                  <span className="flex-1 min-w-40">Name</span>
                  <span className="w-20">Size</span>
                  <span className="w-36 hidden sm:block">Uploader</span>
                  <span className="w-24">Uploaded</span>
                  <span className="w-24" />
                </div>
                {visible.length === 0 ? (
                  <p className="py-10 text-center text-xs text-muted-foreground">No uploads match your search</p>
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
                        {u.uploader_name || u.uploader_email || 'Anonymous'}
                      </span>
                      <span className="w-24 text-xs text-muted-foreground">{timeAgo(u.created_at)}</span>
                      <div className="w-24 flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <button className="size-7 rounded-md flex items-center justify-center hover:bg-muted" title="Download" onClick={() => handleDownload(u.file_id)}>
                          <Download className="size-3.5 text-muted-foreground" />
                        </button>
                        <button className="size-7 rounded-md flex items-center justify-center hover:bg-muted" title="Rename" onClick={() => { setRenameTarget({ id: u.file_id, name: u.file_name }); setRenameName(u.file_name); }}>
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </button>
                        <button className="size-7 rounded-md flex items-center justify-center hover:bg-muted" title="Delete" onClick={() => setDeleteTarget({ id: u.file_id, name: u.file_name })}>
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
            <DialogHeader><DialogTitle>Rename file</DialogTitle></DialogHeader>
            <Input
              value={renameName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameName(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleRename()}
              className="h-8 text-xs"
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
              <Button onClick={handleRename}>Rename</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <Dialog open onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Delete file?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{deleteTarget.name}</span> will be moved to trash.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Bulk delete confirm */}
      {bulkDeleteOpen && (
        <Dialog open onOpenChange={() => setBulkDeleteOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Delete {selected.size} file{selected.size === 1 ? '' : 's'}?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">The selected files will be moved to trash.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={bulkDelete}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
