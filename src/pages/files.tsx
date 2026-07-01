import { useState, useEffect, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { useDocumentTitle } from '@/lib/page-title';
import { useWorkspace } from '@/stores/workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Upload, FolderPlus, Search, ChevronRight, Home,
  Download, Share2, Trash2, MoreHorizontal,
  FolderOpen, Grid3X3, List, Loader2,
  Lock, Pencil, Copy, Move, Eye, EyeOff, History,
  MessageSquare, Star, SlidersHorizontal, Check, RotateCcw,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ContextMenu } from '@/components/context-menu';
import { FileDetailPanel } from '@/components/file-detail-panel';
import { ShareModal } from '@/components/share-modal';
import { FileViewer } from '@/components/file-viewer';
import { LockModal } from '@/components/lock-modal';
import { HideModal } from '@/components/hide-modal';
import { FilesSidebar } from '@/components/files-sidebar';
import { humanSize, timeAgo, isImage, extOf, fileIconSrc, folderIconSrc, colorFor } from '@/lib/helpers';
import { toast } from '@/lib/toast';

// ── Types ──────────────────────────────────────────────────

interface FileItem {
  id: string; name: string; size_bytes: number; mime_type: string; extension: string;
  region: string; created_at: number; updated_at: number; current_version: number;
  lock_mode: string; is_hidden: number; uploaded_by: string; uploader_name: string;
  share_count: number; comment_count: number; is_synced: number;
}
interface FolderItem {
  id: string; name: string; created_at: number; file_count: number;
  lock_mode: string; is_hidden: number; is_synced: number;
}
interface Breadcrumb { id: string; name: string }
interface Pagination { page: number; per_page: number; total_files: number; total_pages: number }
interface PickerFolder { id: string; name: string; parent_id: string | null; file_count: number }

type ViewMode = 'grid' | 'list';
type SortMode = 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'largest' | 'smallest';


// ── Table columns ─────────────────────────────────────────

type ColumnKey = 'name' | 'size' | 'created' | 'modified' | 'type' | 'extension' | 'version' | 'uploader' | 'region' | 'shares' | 'comments';

interface ColumnDef {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
  width?: string;
  render: (f: FileItem) => React.ReactNode;
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', defaultVisible: true, width: 'flex-1 min-w-40', render: () => null /* handled separately */ },
  { key: 'size', label: 'Size', defaultVisible: true, width: 'w-20', render: (f) => humanSize(f.size_bytes) },
  { key: 'created', label: 'Created', defaultVisible: true, width: 'w-24', render: (f) => timeAgo(f.created_at) },
  { key: 'modified', label: 'Modified', defaultVisible: false, width: 'w-24', render: (f) => timeAgo(f.updated_at) },
  { key: 'type', label: 'Type', defaultVisible: false, width: 'w-28', render: (f) => f.mime_type },
  { key: 'extension', label: 'Extension', defaultVisible: false, width: 'w-16', render: (f) => (f.extension || extOf(f.name) || '—').toUpperCase() },
  { key: 'version', label: 'Version', defaultVisible: false, width: 'w-16', render: (f) => f.current_version > 1 ? `v${f.current_version}` : '—' },
  { key: 'uploader', label: 'Uploader', defaultVisible: false, width: 'w-28', render: (f) => f.uploader_name ?? '—' },
  { key: 'region', label: 'Region', defaultVisible: false, width: 'w-20', render: (f) => f.region || '—' },
  { key: 'shares', label: 'Shares', defaultVisible: false, width: 'w-14', render: (f) => f.share_count > 0 ? String(f.share_count) : '—' },
  { key: 'comments', label: 'Comments', defaultVisible: false, width: 'w-14', render: (f) => f.comment_count > 0 ? String(f.comment_count) : '—' },
];

const DEFAULT_VISIBLE: Set<ColumnKey> = new Set(ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key));

function loadSavedColumns(): Set<ColumnKey> {
  try {
    const saved = localStorage.getItem('dosya_table_columns');
    if (saved) return new Set(JSON.parse(saved) as ColumnKey[]);
  } catch {}
  return new Set(DEFAULT_VISIBLE);
}

// ── Page ───────────────────────────────────────────────────

export default function FilesPage() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');
  const [view, setView] = useState<ViewMode>('grid');
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(loadSavedColumns);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);

  const toggleColumn = (key: ColumnKey) => {
    if (key === 'name') return; // name is always visible
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem('dosya_table_columns', JSON.stringify([...next]));
      return next;
    });
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);

  // Detail panel
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);

  // Share modal
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string } | null>(null);

  // File viewer
  const [viewerFile, setViewerFile] = useState<FileItem | null>(null);

  // Favourites
  const [favourites, setFavourites] = useState<Set<string>>(new Set());

  // Lock modal
  const [lockTarget, setLockTarget] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);

  // Unlock gate — tracks unlocked file IDs and pending unlock prompts
  const [unlockedFiles] = useState(() => new Map<string, string>()); // fileId → unlock_token
  const [unlockPrompt, setUnlockPrompt] = useState<{ file: FileItem; action: 'detail' | 'view' } | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const openFileWithLockCheck = (file: FileItem, action: 'detail' | 'view') => {
    if (file.lock_mode === 'full_lock' && !unlockedFiles.has(file.id)) {
      setUnlockPrompt({ file, action });
      setUnlockPassword('');
      setUnlockError('');
      return;
    }
    if (action === 'detail') setSelectedFile(file);
    else setViewerFile(file);
  };

  const handleUnlockSubmit = async () => {
    if (!unlockPrompt || !unlockPassword.trim()) return;
    setUnlocking(true);
    setUnlockError('');
    try {
      const res = await api<{ ok: boolean; unlock_token?: string; error?: string }>(`/api/files/${unlockPrompt.file.id}/unlock`, {
        method: 'POST', body: JSON.stringify({ password: unlockPassword }),
      });
      if (res.ok && res.unlock_token) {
        unlockedFiles.set(unlockPrompt.file.id, res.unlock_token);
        const { file, action } = unlockPrompt;
        setUnlockPrompt(null);
        if (action === 'detail') setSelectedFile(file);
        else setViewerFile(file);
      } else {
        setUnlockError(res.error ?? 'Incorrect password');
        setUnlockPassword('');
      }
    } catch {
      setUnlockError('Network error');
    }
    setUnlocking(false);
  };

  // Hide modal
  const [hideTarget, setHideTarget] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);

  // Upload new version (hidden file input)
  const [versionUploadTarget, setVersionUploadTarget] = useState<string | null>(null);

  // Add to group
  const [addToGroupTarget, setAddToGroupTarget] = useState<{ fileId: string; fileName: string } | null>(null);
  const [availableGroups, setAvailableGroups] = useState<{ id: string; name: string; color: string }[]>([]);
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);

  // Context menu
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const [ctxTarget, setCtxTarget] = useState<{ type: 'file' | 'folder' | 'blank'; item?: FileItem | FolderItem } | null>(null);

  // Modals
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);
  const [renameName, setRenameName] = useState('');
  const [moveOpen, setMoveOpen] = useState<{ id: string; type: 'file' | 'folder' } | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [moveFolders, setMoveFolders] = useState<PickerFolder[]>([]);

  const currentFolderId = searchParams.get('folder') || null;
  const currentPage = parseInt(searchParams.get('page') || '1');

  // Reflect the current folder in the browser tab title
  useDocumentTitle(breadcrumbs.length > 0 ? `${breadcrumbs[breadcrumbs.length - 1].name} · Files` : 'Files');

  // ── Load files ─────────────────────────────────────────────

  const currentFilter = searchParams.get('filter') || '';
  const currentGroup = searchParams.get('group') || '';
  const isDeletedView = currentFilter === 'deleted';

  const loadFiles = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    const params = new URLSearchParams({ workspace_id: wsId, sort, page: String(currentPage), per_page: '100' });
    if (search) params.set('q', search);
    if (currentFolderId) params.set('folder_id', currentFolderId);
    if (isDeletedView) params.set('deleted', '1');
    if (currentFilter && currentFilter !== 'deleted') params.set('filter', currentFilter);
    if (currentGroup) params.set('group_id', currentGroup);

    try {
      const data = await api<{
        ok: boolean; folders: FolderItem[]; files: FileItem[];
        breadcrumbs: Breadcrumb[]; pagination?: Pagination;
      }>(`/api/files?${params}`);
      if (data.ok) {
        setFolders(data.folders); setFiles(data.files);
        setBreadcrumbs(data.breadcrumbs);
        if (data.pagination) setPagination(data.pagination);
        setSelected(new Set());
      }
    } catch { /* */ }
    setLoading(false);
  }, [wsId, sort, currentPage, search, currentFolderId, isDeletedView, currentFilter, currentGroup]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // Load favourites
  const loadFavourites = useCallback(async () => {
    if (!wsId) return;
    try {
      const data = await api<{ ok: boolean; file_ids?: string[] }>(`/api/favourites?workspace_id=${wsId}`);
      if (data.ok && data.file_ids) setFavourites(new Set(data.file_ids));
    } catch { /* optional feature */ }
  }, [wsId]);
  useEffect(() => { loadFavourites(); }, [loadFavourites]);

  const toggleFavourite = async (fileId: string) => {
    const isFav = favourites.has(fileId);
    try {
      if (isFav) {
        await api(`/api/favourites/${fileId}`, { method: 'DELETE', body: JSON.stringify({ workspace_id: wsId }) });
        setFavourites((prev) => { const next = new Set(prev); next.delete(fileId); return next; });
      } else {
        await api('/api/favourites', { method: 'POST', body: JSON.stringify({ file_id: fileId, workspace_id: wsId }) });
        setFavourites((prev) => new Set(prev).add(fileId));
      }
    } catch { toast.error('Something went wrong', 'Could not update favourites.'); }
  };

  const handleVersionUpload = async (fileId: string, file: File) => {
    try {
      const initRes = await api<{ ok: boolean; session_id?: string; error?: string }>('/api/upload/init', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: wsId,
          file_id: fileId,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || 'application/octet-stream',
        }),
      });
      if (!initRes.ok || !initRes.session_id) {
        toast.error('Upload failed', initRes.error ?? 'The new version could not be uploaded.');
        return;
      }
      await fetch(`${API_BASE}/api/upload/${initRes.session_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      toast.success('Version uploaded', 'The file now points to your new version.');
      loadFiles();
    } catch {
      toast.error('Upload failed', 'The new version could not be uploaded.');
    }
  };

  // Trigger hidden file input when version upload target is set
  useEffect(() => {
    if (versionUploadTarget) {
      document.getElementById('version-upload-input')?.click();
    }
  }, [versionUploadTarget]);

  // ── Actions ────────────────────────────────────────────────

  const navigateToFolder = (folderId: string | null) => {
    const p = new URLSearchParams();
    if (folderId) p.set('folder', folderId);
    setSearchParams(p);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const res = await api<{ ok: boolean; error?: string }>('/api/folders', {
        method: 'POST', body: JSON.stringify({ workspace_id: wsId, parent_id: currentFolderId, name: newFolderName.trim() }),
      });
      if (res.ok) { toast.success('Folder created', 'Your new folder is ready to use.'); setCreateFolderOpen(false); setNewFolderName(''); loadFiles(); }
      else toast.error('Folder failed', res.error ?? 'The folder could not be created.');
    } catch { toast.error('Folder failed', 'The folder could not be created.'); }
    setCreatingFolder(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const ep = deleteTarget.type === 'file' ? `/api/files/${deleteTarget.id}` : `/api/folders/${deleteTarget.id}`;
      await api(ep, { method: 'DELETE' });
      toast.success('Deleted', `${deleteTarget.name} was deleted.`);
      setDeleteTarget(null); loadFiles();
    } catch { toast.error('Delete failed', 'The item could not be deleted.'); }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    try {
      const ep = renameTarget.type === 'file' ? `/api/files/${renameTarget.id}/rename` : `/api/folders/${renameTarget.id}/rename`;
      await api(ep, { method: 'PUT', body: JSON.stringify({ name: renameName.trim() }) });
      toast.success('Renamed', 'The file has been renamed.'); setRenameTarget(null); loadFiles();
    } catch { toast.error('Rename failed', 'The file could not be renamed.'); }
  };

  const handleDownload = (fileId: string) => { window.open(`${API_BASE}/api/files/${fileId}/download`, '_blank'); };

  const handleCopy = async (fileId: string) => {
    try {
      await api(`/api/files/${fileId}/copy`, { method: 'POST', body: JSON.stringify({ folder_id: currentFolderId }) });
      toast.success('Copied', 'A copy has been added to this folder.'); loadFiles();
    } catch { toast.error('Copy failed', 'The file could not be copied.'); }
  };

  const handleMove = async () => {
    if (!moveOpen) return;
    try {
      const ep = moveOpen.type === 'file' ? `/api/files/${moveOpen.id}/move` : `/api/folders/${moveOpen.id}/move`;
      const body = moveOpen.type === 'file' ? { folder_id: moveTarget } : { parent_id: moveTarget };
      await api(ep, { method: 'PUT', body: JSON.stringify(body) });
      toast.success('Moved', 'The file has been moved.'); setMoveOpen(null); loadFiles();
    } catch { toast.error('Move failed', 'The file could not be moved.'); }
  };

  const openShare = (fileId: string, fileName: string) => {
    setShareTarget({ id: fileId, name: fileName });
  };

  const openMoveModal = async (id: string, type: 'file' | 'folder') => {
    setMoveOpen({ id, type }); setMoveTarget(null);
    try {
      const res = await api<{ ok: boolean; folders?: PickerFolder[] }>(`/api/folders/tree?workspace_id=${wsId}`);
      if (res.ok && res.folders) setMoveFolders(res.folders);
    } catch { /* */ }
  };

  const toggleSelect = (id: string) => {
    const file = files.find((f) => f.id === id);
    if (file?.lock_mode === 'full_lock' && !unlockedFiles.has(id)) return;
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const selectAll = useCallback(() => {
    setSelected(new Set(files.filter((f) => f.lock_mode !== 'full_lock' || unlockedFiles.has(f.id)).map((f) => f.id)));
  }, [files, unlockedFiles]);

  const bulkDelete = async () => {
    try {
      await api('/api/files/batch-delete', { method: 'POST', body: JSON.stringify({ file_ids: Array.from(selected), workspace_id: wsId }) });
      toast.success('Deleted', `${selected.size} files were deleted.`); setSelected(new Set()); loadFiles();
    } catch { toast.error('Delete failed', 'The selected files could not be deleted.'); }
  };

  const bulkDownloadZip = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/files/download-zip`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: Array.from(selected) }),
      });
      if (!res.ok) { toast.error('Download failed', 'The download could not be prepared.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'files.zip'; a.click();
      URL.revokeObjectURL(url);
      toast.success('Downloaded', 'Download started');
    } catch { toast.error('Download failed', 'The download could not be prepared.'); }
  };

  const bulkMove = async () => {
    if (selected.size === 0) return;
    // Use the first selected file to open move modal
    setMoveOpen({ id: Array.from(selected)[0], type: 'file' });
    try {
      const res = await api<{ ok: boolean; folders?: PickerFolder[] }>(`/api/folders/tree?workspace_id=${wsId}`);
      if (res.ok && res.folders) setMoveFolders(res.folders);
    } catch {}
  };

  const bulkRestore = async () => {
    for (const id of selected) {
      try { await api(`/api/files/${id}`, { method: 'PUT' }); } catch {}
    }
    toast.success('Restored', `${selected.size} files restored`); setSelected(new Set()); loadFiles();
  };

  const bulkPermanentDelete = async () => {
    for (const id of selected) {
      try { await api(`/api/files/${id}/permanent`, { method: 'DELETE' }); } catch {}
    }
    toast.success('Deleted', `${selected.size} files permanently deleted`); setSelected(new Set()); loadFiles();
  };


  // ── Drag and drop ─────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setDragging(false); };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles.length || !wsId) return;
    let uploaded = 0;
    for (let i = 0; i < droppedFiles.length; i++) {
      const file = droppedFiles[i];
      try {
        const initRes = await api<{ ok: boolean; session_id?: string; error?: string }>('/api/upload/init', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: wsId, file_name: file.name, file_size: file.size, mime_type: file.type || 'application/octet-stream', folder_id: currentFolderId }),
        });
        if (!initRes.ok || !initRes.session_id) continue;
        await fetch(`${API_BASE}/api/upload/${initRes.session_id}`, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        uploaded++;
      } catch {}
    }
    if (uploaded > 0) { toast.success('Uploaded', `${uploaded} file${uploaded > 1 ? 's' : ''} uploaded`); loadFiles(); }
  };

  // ── Keyboard shortcuts ────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedFile) { setDeleteTarget({ id: selectedFile.id, name: selectedFile.name, type: 'file' }); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault(); selectAll();
      }
      if (e.key === 'F2' && selectedFile) {
        e.preventDefault();
        setRenameTarget({ id: selectedFile.id, name: selectedFile.name, type: 'file' });
        setRenameName(selectedFile.name);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedFile, files]);

  // ── Context menu ───────────────────────────────────────────

  const onContextMenu = (e: ReactMouseEvent, type: 'file' | 'folder' | 'blank', item?: FileItem | FolderItem) => {
    e.preventDefault(); e.stopPropagation();
    setCtxPos({ x: e.clientX, y: e.clientY });
    setCtxTarget({ type, item });
  };

  const fileCtxItems = (f: FileItem) => [
    { label: 'View', icon: <Eye />, onClick: () => openFileWithLockCheck(f, 'view') },
    { label: 'Download', icon: <Download />, onClick: () => handleDownload(f.id) },
    { label: 'Share', icon: <Share2 />, onClick: () => openShare(f.id, f.name) },
    { label: 'Comments', icon: <MessageSquare />, onClick: () => navigate(`/comments?file_id=${f.id}&workspace_id=${wsId}&name=${encodeURIComponent(f.name)}`) },
    { label: favourites.has(f.id) ? 'Remove favourite' : 'Add to favourites', icon: <Star />, onClick: () => toggleFavourite(f.id) },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: 'Rename', icon: <Pencil />, onClick: () => { setRenameTarget({ id: f.id, name: f.name, type: 'file' }); setRenameName(f.name); } },
    { label: 'Copy', icon: <Copy />, onClick: () => handleCopy(f.id) },
    { label: 'Move to...', icon: <Move />, onClick: () => openMoveModal(f.id, 'file') },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: 'Add to group', icon: <FolderPlus />, onClick: async () => {
      try {
        const data = await api<{ ok: boolean; groups?: { id: string; name: string; color: string }[] }>(`/api/groups?workspace_id=${wsId}`);
        if (data.ok && data.groups && data.groups.length > 0) {
          setAvailableGroups(data.groups);
          setAddToGroupTarget({ fileId: f.id, fileName: f.name });
        } else toast.info('No groups', 'No groups yet. Create one in the sidebar.');
      } catch { toast.error('Something went wrong', 'Could not load your groups.'); }
    }},
    { label: 'Upload new version', icon: <Upload />, onClick: () => setVersionUploadTarget(f.id) },
    { label: 'Version history', icon: <History />, onClick: () => openFileWithLockCheck(f, 'view') },
    { label: f.lock_mode !== 'none' ? 'Unlock' : 'Lock', icon: <Lock />, onClick: () => setLockTarget({ id: f.id, name: f.name, type: 'file' }) },
    { label: f.is_hidden ? 'Unhide' : 'Hide', icon: f.is_hidden ? <Eye /> : <EyeOff />, onClick: () => setHideTarget({ id: f.id, name: f.name, type: 'file' }) },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: 'Delete', icon: <Trash2 />, onClick: () => setDeleteTarget({ id: f.id, name: f.name, type: 'file' }), danger: true },
  ];

  const folderCtxItems = (f: FolderItem) => [
    { label: 'Open', icon: <FolderOpen />, onClick: () => navigateToFolder(f.id) },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: 'Rename', icon: <Pencil />, onClick: () => { setRenameTarget({ id: f.id, name: f.name, type: 'folder' }); setRenameName(f.name); } },
    { label: 'Move to...', icon: <Move />, onClick: () => openMoveModal(f.id, 'folder') },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: f.lock_mode !== 'none' ? 'Unlock' : 'Lock', icon: <Lock />, onClick: () => setLockTarget({ id: f.id, name: f.name, type: 'folder' }) },
    { label: f.is_hidden ? 'Unhide' : 'Hide', icon: f.is_hidden ? <Eye /> : <EyeOff />, onClick: () => setHideTarget({ id: f.id, name: f.name, type: 'folder' }) },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: 'Delete', icon: <Trash2 />, onClick: () => setDeleteTarget({ id: f.id, name: f.name, type: 'folder' }), danger: true },
  ];

  const blankCtxItems = [
    { label: 'New folder', icon: <FolderPlus />, onClick: () => setCreateFolderOpen(true) },
    { label: 'Upload files', icon: <Upload />, onClick: () => navigate(uploadHref) },
  ];

  const uploadHref = `/uploads${currentFolderId ? `?folder=${currentFolderId}&folder_name=${encodeURIComponent(breadcrumbs.at(-1)?.name ?? '')}` : ''}`;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Files sidebar */}
      <FilesSidebar
        onFilterChange={(filter) => {
          const p = new URLSearchParams(searchParams);
          if (filter) p.set('filter', filter); else p.delete('filter');
          p.delete('page');
          setSearchParams(p);
        }}
        onFavouriteClick={(fileId) => {
          const f = files.find((x) => x.id === fileId);
          if (f) openFileWithLockCheck(f, 'view');
        }}
        onGroupClick={(groupId) => {
          const p = new URLSearchParams(searchParams);
          p.set('group', groupId);
          p.delete('page');
          setSearchParams(p);
        }}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative" onContextMenu={(e) => onContextMenu(e, 'blank')} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {/* Drop overlay */}
        {dragging && (
          <div className="absolute inset-0 z-30 bg-primary/5 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-primary">
              <Upload className="size-10" />
              <p className="text-sm font-semibold">Drop files to upload</p>
              <p className="text-xs opacity-70">{currentFolderId ? `to ${breadcrumbs.at(-1)?.name ?? 'folder'}` : 'to root folder'}</p>
            </div>
          </div>
        )}
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b shrink-0">
        <div className="flex items-center gap-1 text-sm flex-1 min-w-0">
          <button onClick={() => navigateToFolder(null)} className="text-muted-foreground hover:text-foreground"><Home className="size-4" /></button>
          {breadcrumbs.map((b) => (
            <span key={b.id} className="flex items-center gap-1">
              <ChevronRight className="size-3 text-muted-foreground" />
              <button onClick={() => navigateToFolder(b.id)} className="text-xs font-medium hover:text-foreground text-muted-foreground truncate max-w-30">{b.name}</button>
            </span>
          ))}
        </div>
        <div className="relative w-48">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} placeholder="Search files..." className="h-8 text-xs pl-8" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="h-8 text-xs border rounded-md px-2 bg-background">
          <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name_asc">Name A-Z</option><option value="name_desc">Name Z-A</option><option value="largest">Largest</option><option value="smallest">Smallest</option>
        </select>
        <div className="flex border rounded-md overflow-hidden">
          <button onClick={() => setView('grid')} className={`p-1.5 ${view === 'grid' ? 'bg-accent' : 'hover:bg-muted/50'}`}><Grid3X3 className="size-3.5" /></button>
          <button onClick={() => setView('list')} className={`p-1.5 ${view === 'list' ? 'bg-accent' : 'hover:bg-muted/50'}`}><List className="size-3.5" /></button>
        </div>
        {view === 'list' && (
          <div className="relative">
            <button
              onClick={() => setColumnPickerOpen(!columnPickerOpen)}
              className={`h-8 px-2 text-xs border rounded-md flex items-center gap-1.5 hover:bg-muted/50 ${columnPickerOpen ? 'bg-accent' : ''}`}
              title="Table columns"
            >
              <SlidersHorizontal className="size-3.5" /> Columns
            </button>
            {columnPickerOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColumnPickerOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-popover border rounded-lg shadow-lg py-1 min-w-44">
                  {ALL_COLUMNS.map((col) => (
                    <button
                      key={col.key}
                      onClick={() => toggleColumn(col.key)}
                      disabled={col.key === 'name'}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/50 text-left ${col.key === 'name' ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className={`size-4 rounded border flex items-center justify-center shrink-0 ${visibleColumns.has(col.key) ? 'bg-primary border-primary' : ''}`}>
                        {visibleColumns.has(col.key) && <Check className="size-3 text-primary-foreground" />}
                      </div>
                      {col.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {!isDeletedView && (
          <>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateFolderOpen(true)}><FolderPlus className="size-3.5" /> New folder</Button>
            <Link to={uploadHref}><Button size="sm" className="h-8 text-xs gap-1.5"><Upload className="size-3.5" /> Upload</Button></Link>
          </>
        )}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-5 py-2 bg-accent border-b shrink-0 flex-wrap">
          <Badge variant="secondary">{selected.size} selected</Badge>
          {isDeletedView ? (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={bulkRestore}><RotateCcw className="size-3 mr-1" /> Restore</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30" onClick={bulkPermanentDelete}><Trash2 className="size-3 mr-1" /> Delete permanently</Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={bulkDownloadZip}><Download className="size-3 mr-1" /> Download ZIP</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { if (selected.size > 0) openShare(Array.from(selected)[0], `${selected.size} files`); }}><Share2 className="size-3 mr-1" /> Share</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={bulkMove}><Move className="size-3 mr-1" /> Move</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30" onClick={bulkDelete}><Trash2 className="size-3 mr-1" /> Delete</Button>
            </>
          )}
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={selectAll}>Select all</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {/* Content + Detail Panel */}
      <div className="flex-1 flex min-h-0">
        {/* File list */}
        <div className="flex-1 overflow-y-auto p-5" onClick={() => setSelectedFile(null)}>
          {loading ? <FileSkeleton view={view} /> : folders.length === 0 && files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FolderOpen className="size-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm font-medium text-muted-foreground mb-1">{isDeletedView ? 'Trash is empty' : search ? 'No files match your search' : 'This folder is empty'}</p>
              {!isDeletedView && !search && <p className="text-xs text-muted-foreground">Upload files or create a folder to get started</p>}
            </div>
          ) : (
            <>
              {folders.length > 0 && (
                <div className="mb-5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Folders</p>
                  <div className={view === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2' : 'space-y-0.5'}>
                    {folders.map((f) => (
                      <FolderCard key={f.id} folder={f} view={view}
                        onClick={() => navigateToFolder(f.id)}
                        onContextMenu={(e) => onContextMenu(e, 'folder', f)}
                        onRename={() => { setRenameTarget({ id: f.id, name: f.name, type: 'folder' }); setRenameName(f.name); }}
                        onDelete={() => setDeleteTarget({ id: f.id, name: f.name, type: 'folder' })} />
                    ))}
                  </div>
                </div>
              )}
              {files.length > 0 && view === 'grid' && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Files</p>
                  <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 ${selectedFile ? 'lg:grid-cols-4' : 'lg:grid-cols-6'} gap-2`}>
                    {files.map((f) => (
                      <FileCard key={f.id} file={f} view="grid"
                        selected={selected.has(f.id)}
                        anySelected={selected.size > 0}
                        active={selectedFile?.id === f.id}
                        isFavourite={favourites.has(f.id)}
                        onClick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) toggleSelect(f.id); else openFileWithLockCheck(f, 'detail'); }}
                        onSelect={() => toggleSelect(f.id)}
                        onNameClick={() => openFileWithLockCheck(f, 'view')}
                        onContextMenu={(e) => onContextMenu(e, 'file', f)}
                        onDownload={() => handleDownload(f.id)}
                        onShare={() => openShare(f.id, f.name)}
                        onRename={() => { setRenameTarget({ id: f.id, name: f.name, type: 'file' }); setRenameName(f.name); }}
                        onDelete={() => setDeleteTarget({ id: f.id, name: f.name, type: 'file' })}
                        onCopy={() => handleCopy(f.id)}
                        onMove={() => openMoveModal(f.id, 'file')}
                        onFavourite={() => toggleFavourite(f.id)} />
                    ))}
                  </div>
                </div>
              )}
              {files.length > 0 && view === 'list' && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Files</p>
                  {/* Table header */}
                  <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b mb-0.5">
                    <div className="w-7 shrink-0" />
                    {ALL_COLUMNS.filter((c) => visibleColumns.has(c.key)).map((col) => (
                      <div key={col.key} className={col.key === 'name' ? 'flex-1 min-w-40' : col.width}>{col.label}</div>
                    ))}
                    <div className="w-8 shrink-0" />
                  </div>
                  {/* Table rows */}
                  {files.map((f) => {
                    const isActive = selectedFile?.id === f.id;
                    const isSel = selected.has(f.id);
                    const cols = ALL_COLUMNS.filter((c) => visibleColumns.has(c.key));
                    return (
                      <div
                        key={f.id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer group ${isActive ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900' : isSel ? 'bg-accent' : ''}`}
                        onClick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) toggleSelect(f.id); else openFileWithLockCheck(f, 'detail'); }}
                        onContextMenu={(e) => onContextMenu(e, 'file', f)}
                      >
                        <button
                          className={`size-4 rounded border flex items-center justify-center shrink-0 transition-all ${isSel ? 'bg-primary border-primary' : 'opacity-0 group-hover:opacity-100'} ${selected.size > 0 ? 'opacity-100!' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleSelect(f.id); }}
                        >
                          {isSel && <Check className="size-3 text-primary-foreground" />}
                        </button>
                        <img src={fileIconSrc(f.name)} alt="" className="w-7 h-7 shrink-0" />
                        {cols.map((col) => {
                          if (col.key === 'name') {
                            return (
                              <div key="name" className="flex-1 min-w-40 flex items-center gap-2">
                                <button className="text-sm font-medium truncate hover:underline text-left" onClick={(e) => { e.stopPropagation(); openFileWithLockCheck(f, 'view'); }}>{f.name}</button>
                                {favourites.has(f.id) && <Star className="size-3 text-orange-400 fill-orange-400 shrink-0" />}
                              </div>
                            );
                          }
                          return <div key={col.key} className={`text-xs text-muted-foreground truncate ${col.width}`}>{col.render(f)}</div>;
                        })}
                        <div className="w-8 shrink-0">
                          <FileDropdown
                            onDownload={() => handleDownload(f.id)}
                            onShare={() => openShare(f.id, f.name)}
                            onRename={() => { setRenameTarget({ id: f.id, name: f.name, type: 'file' }); setRenameName(f.name); }}
                            onDelete={() => setDeleteTarget({ id: f.id, name: f.name, type: 'file' })}
                            onCopy={() => handleCopy(f.id)}
                            onMove={() => openMoveModal(f.id, 'file')}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {pagination && pagination.total_pages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => { const p = new URLSearchParams(searchParams); p.set('page', String(currentPage - 1)); setSearchParams(p); }}>Previous</Button>
                  <span className="text-xs text-muted-foreground">Page {currentPage} of {pagination.total_pages}</span>
                  <Button variant="outline" size="sm" disabled={currentPage >= pagination.total_pages} onClick={() => { const p = new URLSearchParams(searchParams); p.set('page', String(currentPage + 1)); setSearchParams(p); }}>Next</Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail panel */}
        {selectedFile && (
          <FileDetailPanel
            file={selectedFile}
            onClose={() => setSelectedFile(null)}
            onDownload={handleDownload}
            onCopy={handleCopy}
            onDelete={(id, name) => setDeleteTarget({ id, name, type: 'file' })}
            onShare={(id, name) => openShare(id, name)}
            onView={(id) => { const f = files.find((x) => x.id === id); if (f) openFileWithLockCheck(f, 'view'); }}
            onRefresh={loadFiles}
          />
        )}
      </div>

      {/* Right-click context menu */}
      <ContextMenu
        position={ctxPos}
        onClose={() => { setCtxPos(null); setCtxTarget(null); }}
        items={
          ctxTarget?.type === 'file' ? fileCtxItems(ctxTarget.item as FileItem) :
          ctxTarget?.type === 'folder' ? folderCtxItems(ctxTarget.item as FolderItem) :
          blankCtxItems
        }
      />

      {/* Create folder dialog */}
      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create new folder</DialogTitle></DialogHeader>
          <Input placeholder="e.g. Brand Assets or Projects/Q2/Designs" value={newFolderName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()} />
          <p className="text-xs text-muted-foreground">Use <strong>/</strong> to create nested folders. e.g. <code className="bg-muted px-1 rounded text-[11px]">Projects/Q2/Designs</code> creates 3 levels.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateFolder} disabled={creatingFolder}>{creatingFolder ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null} Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete {deleteTarget?.type}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={() => setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename</DialogTitle></DialogHeader>
          <Input value={renameName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleRename()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button onClick={handleRename}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move dialog */}
      <Dialog open={!!moveOpen} onOpenChange={() => setMoveOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Move to folder</DialogTitle></DialogHeader>
          <div className="max-h-64 overflow-y-auto border rounded-lg">
            <button className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs border-b hover:bg-muted/50 text-left ${moveTarget === null ? 'bg-green-50 dark:bg-green-950/30' : ''}`} onClick={() => setMoveTarget(null)}>
              <Home className="size-3.5 text-muted-foreground" /> <span className="flex-1">Root</span>
            </button>
            {moveFolders.map((f) => (
              <button key={f.id} className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs border-b last:border-b-0 hover:bg-muted/50 text-left ${moveTarget === f.id ? 'bg-green-50 dark:bg-green-950/30' : ''}`} onClick={() => setMoveTarget(f.id)}>
                <FolderOpen className="size-3.5 text-muted-foreground" /> <span className="flex-1 truncate">{f.name}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(null)}>Cancel</Button>
            <Button onClick={handleMove}>Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share modal */}
      <ShareModal
        open={!!shareTarget}
        fileId={shareTarget?.id ?? null}
        fileName={shareTarget?.name ?? ''}
        onClose={() => { setShareTarget(null); loadFiles(); }}
      />

      {/* Lock modal */}
      <LockModal
        open={!!lockTarget}
        target={lockTarget}
        onClose={() => setLockTarget(null)}
        onDone={loadFiles}
      />

      {/* Hide modal */}
      <HideModal
        open={!!hideTarget}
        target={hideTarget}
        onClose={() => setHideTarget(null)}
        onDone={loadFiles}
      />

      {/* Add to group dialog */}
      <Dialog open={!!addToGroupTarget} onOpenChange={() => setAddToGroupTarget(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Add to group</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground mb-2">
            Select a group for <span className="font-semibold text-foreground">{addToGroupTarget?.fileName}</span>
          </p>
          <div className="max-h-48 overflow-y-auto border rounded-lg">
            {availableGroups.map((g) => (
              <button
                key={g.id}
                disabled={addingToGroup === g.id}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs border-b last:border-b-0 hover:bg-muted/50 text-left disabled:opacity-50"
                onClick={async () => {
                  if (!addToGroupTarget) return;
                  setAddingToGroup(g.id);
                  try {
                    await api(`/api/groups/${g.id}/files/${addToGroupTarget.fileId}`, { method: 'POST' });
                    toast.success('Added to group', `The file was added to ${g.name}.`);
                    setAddToGroupTarget(null);
                  } catch { toast.error('Something went wrong', 'The file could not be added to the group.'); }
                  setAddingToGroup(null);
                }}
              >
                <div className="size-3 rounded-full shrink-0" style={{ background: g.color || '#a0a0a0' }} />
                <span className="flex-1 truncate">{g.name}</span>
                {addingToGroup === g.id && <Loader2 className="size-3 animate-spin shrink-0" />}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddToGroupTarget(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock password dialog */}
      <Dialog open={!!unlockPrompt} onOpenChange={() => setUnlockPrompt(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Lock className="size-4" /> File is locked</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Enter the password to access <span className="font-semibold text-foreground">{unlockPrompt?.file.name}</span></p>
          {unlockError && <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">{unlockError}</p>}
          <Input
            type="password"
            value={unlockPassword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUnlockPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlockSubmit()}
            placeholder="Enter password"
            className="h-9"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlockPrompt(null)}>Cancel</Button>
            <Button onClick={handleUnlockSubmit} disabled={unlocking}>
              {unlocking && <Loader2 className="size-4 animate-spin mr-1.5" />} Unlock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden file input for version upload */}
      <input
        type="file"
        id="version-upload-input"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && versionUploadTarget) {
            handleVersionUpload(versionUploadTarget, file);
            setVersionUploadTarget(null);
          }
          e.target.value = '';
        }}
      />

      {/* File viewer */}
      {viewerFile && (
        <FileViewer
          file={viewerFile}
          files={files}
          workspaceId={wsId}
          onClose={() => setViewerFile(null)}
          onNavigate={(f) => setViewerFile(f)}
          onRefresh={loadFiles}
        />
      )}
      </div>{/* end main content */}
    </div>
  );
}

// ── Folder Card ────────────────────────────────────────────

function FolderCard({ folder, view, onClick, onContextMenu, onRename, onDelete }: {
  folder: FolderItem; view: ViewMode; onClick: () => void; onContextMenu: (e: ReactMouseEvent) => void; onRename: () => void; onDelete: () => void;
}) {
  const iconSrc = folderIconSrc(folder.file_count, !!folder.is_synced);

  if (view === 'list') {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 cursor-pointer group" onClick={onClick} onContextMenu={onContextMenu}>
        <img src={iconSrc} alt="" className="size-5 shrink-0" />
        <span className="text-sm font-medium flex-1 truncate">{folder.name}</span>
        <span className="text-xs text-muted-foreground">{folder.file_count} files</span>
        {folder.lock_mode !== 'none' && <Lock className="size-3 text-muted-foreground" />}
        <FileDropdown onRename={onRename} onDelete={onDelete} />
      </div>
    );
  }
  return (
    <div className="rounded-xl border bg-card p-3 hover:shadow-md hover:-translate-y-px transition-all cursor-pointer group" onClick={onClick} onContextMenu={onContextMenu}>
      <div className="flex items-center gap-2 mb-2">
        <img src={iconSrc} alt="" className="size-6" />
        {folder.lock_mode !== 'none' && <Lock className="size-3 text-muted-foreground ml-auto" />}
      </div>
      <p className="text-xs font-medium truncate">{folder.name}</p>
      <p className="text-[10px] text-muted-foreground">{folder.file_count} files</p>
    </div>
  );
}

// ── File Card ──────────────────────────────────────────────

function FileCard({ file, view, selected, anySelected, active, isFavourite, onClick, onSelect, onNameClick, onContextMenu, onDownload, onShare, onRename, onDelete, onCopy, onMove, onFavourite }: {
  file: FileItem; view: ViewMode; selected: boolean; anySelected?: boolean; active?: boolean; isFavourite?: boolean;
  onClick: (e: ReactMouseEvent) => void; onSelect: () => void; onNameClick: () => void; onContextMenu: (e: ReactMouseEvent) => void;
  onDownload: () => void; onShare: () => void; onRename: () => void; onDelete: () => void; onCopy: () => void; onMove: () => void; onFavourite?: () => void;
}) {
  const ext = extOf(file.name).toUpperCase() || 'FILE';

  if (view === 'list') {
    return (
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 cursor-pointer group ${active ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900' : selected ? 'bg-accent' : ''}`} onClick={onClick} onContextMenu={onContextMenu}>
        <button
          className={`size-4 rounded border flex items-center justify-center shrink-0 transition-all ${selected ? 'bg-primary border-primary' : 'opacity-0 group-hover:opacity-100'} ${anySelected ? 'opacity-100!' : ''}`}
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
        >
          {selected && <Check className="size-3 text-primary-foreground" />}
        </button>
        <img src={fileIconSrc(file.name)} alt={ext} className="w-7 h-7 shrink-0" />
        <button className="text-sm font-medium flex-1 truncate text-left hover:underline" onClick={(e) => { e.stopPropagation(); onNameClick(); }}>{file.name}</button>
        {file.current_version > 1 && <Badge variant="secondary" className="text-[9px]">v{file.current_version}</Badge>}
        {file.comment_count > 0 && <Badge variant="secondary" className="text-[9px]"><MessageSquare className="size-2.5 mr-1" />{file.comment_count}</Badge>}
        <span className="text-xs text-muted-foreground">{humanSize(file.size_bytes)}</span>
        <span className="text-xs text-muted-foreground">{timeAgo(file.updated_at)}</span>
        {file.share_count > 0 && <Badge variant="secondary" className="text-[9px]"><Share2 className="size-2.5 mr-1" />{file.share_count}</Badge>}
        {isFavourite && <Star className="size-3 text-orange-400 fill-orange-400 shrink-0" />}
        <FileDropdown onDownload={onDownload} onShare={onShare} onRename={onRename} onDelete={onDelete} onCopy={onCopy} onMove={onMove} />
      </div>
    );
  }

  return (
    <div className={`rounded-xl border bg-card p-3 hover:shadow-md hover:-translate-y-px transition-all cursor-pointer group relative ${active ? 'ring-2 ring-green-500 border-green-200 dark:border-green-900' : selected ? 'ring-2 ring-primary' : ''}`} onClick={onClick} onContextMenu={onContextMenu}>
      {/* Checkbox (hidden for locked files) */}
      {file.lock_mode !== 'full_lock' && (
        <button
          className={`absolute top-2 left-2 z-10 size-5 rounded border flex items-center justify-center transition-all ${selected ? 'bg-primary border-primary' : 'bg-background/80 opacity-0 group-hover:opacity-100'} ${anySelected ? 'opacity-100!' : ''}`}
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
        >
          {selected && <Check className="size-3 text-primary-foreground" />}
        </button>
      )}
      <FileThumbnail fileId={file.id} fileName={file.name} ext={ext} />
      <div className="flex items-center gap-1">
        <button className="text-xs font-medium truncate flex-1 text-left hover:underline" onClick={(e) => { e.stopPropagation(); onNameClick(); }}>{file.name}</button>
        {file.current_version > 1 && <Badge variant="secondary" className="text-[8px] px-1 shrink-0">v{file.current_version}</Badge>}
      </div>
      <p className="text-[10px] text-muted-foreground">{humanSize(file.size_bytes)} · {timeAgo(file.updated_at)}</p>
      {/* Badges */}
      <div className="absolute top-2 right-2 flex gap-1">
        {file.share_count > 0 && (
          <div className="w-5 h-5 rounded bg-green-100 dark:bg-green-950 flex items-center justify-center">
            <Share2 className="size-2.5 text-green-600" />
          </div>
        )}
        {isFavourite && (
          <button
            className="w-5 h-5 rounded bg-orange-100 dark:bg-orange-950 flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); onFavourite?.(); }}
          >
            <Star className="size-2.5 text-orange-500 fill-orange-500" />
          </button>
        )}
        {file.comment_count > 0 && (
          <div className="w-5 h-5 rounded bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
            <MessageSquare className="size-2.5 text-blue-600" />
          </div>
        )}
      </div>
      {file.lock_mode !== 'none' && (
        <div className="absolute top-2 left-2 w-5 h-5 rounded bg-violet-100 dark:bg-violet-950 flex items-center justify-center">
          <Lock className="size-2.5 text-violet-600" />
        </div>
      )}
    </div>
  );
}

// ── File thumbnail with error fallback ─────────────────────

function FileThumbnail({ fileId, fileName, ext }: { fileId: string; fileName: string; ext: string }) {
  const [failed, setFailed] = useState(false);

  if (!isImage(fileName) || failed) {
    return (
      <div className="w-full h-14 rounded-lg mb-2 flex items-center justify-center" style={{ background: colorFor(fileName) + '18' }}>
        <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: colorFor(fileName) }}>{ext || 'FILE'}</span>
      </div>
    );
  }

  return (
    <div className="w-full h-14 rounded-lg mb-2 flex items-center justify-center bg-muted/50 overflow-hidden">
      <img
        src={`${API_BASE}/api/files/${fileId}/raw`}
        alt=""
        className="w-full h-full object-contain rounded-lg"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// ── Dropdown menu (three dots) ─────────────────────────────

function FileDropdown({ onDownload, onShare, onRename, onDelete, onCopy, onMove }: {
  onDownload?: () => void; onShare?: () => void; onRename: () => void; onDelete: () => void; onCopy?: () => void; onMove?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger><button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="size-3.5" /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onDownload && <DropdownMenuItem onClick={onDownload}><Download className="size-3 mr-2" /> Download</DropdownMenuItem>}
        {onShare && <DropdownMenuItem onClick={onShare}><Share2 className="size-3 mr-2" /> Share</DropdownMenuItem>}
        {onCopy && <DropdownMenuItem onClick={onCopy}><Copy className="size-3 mr-2" /> Copy</DropdownMenuItem>}
        {onMove && <DropdownMenuItem onClick={onMove}><Move className="size-3 mr-2" /> Move to...</DropdownMenuItem>}
        <DropdownMenuItem onClick={onRename}><Pencil className="size-3 mr-2" /> Rename</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="size-3 mr-2" /> Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Skeleton ───────────────────────────────────────────────

function FileSkeleton({ view }: { view: ViewMode }) {
  if (view === 'list') {
    return <div className="space-y-1">{[1,2,3,4,5,6].map((i) => <div key={i} className="flex items-center gap-3 px-3 py-2.5"><Skeleton className="w-8 h-8 rounded-md" /><Skeleton className="h-3.5 w-40" /><Skeleton className="h-3 w-16 ml-auto" /></div>)}</div>;
  }
  return <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">{[1,2,3,4,5,6,7,8].map((i) => <div key={i} className="rounded-xl border p-3 space-y-2"><Skeleton className="w-full h-14 rounded-lg" /><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></div>)}</div>;
}
