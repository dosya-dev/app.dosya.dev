import { useState, useEffect, useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { useDocumentTitle } from '@/lib/page-title';
import { folderNavParams, filterNavParams, groupNavParams } from '@/lib/files-params';
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
  MessageSquare, Star, SlidersHorizontal, RotateCcw, RefreshCw, Info,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ContextMenu } from '@/components/context-menu';
import { FileInfoDialog, type InfoTarget } from '@/components/file-info-dialog';
import { FileDetailPanel } from '@/components/file-detail-panel';
import { ShareModal } from '@/components/share-modal';
import { FileViewer } from '@/components/file-viewer';
import { LockModal } from '@/components/lock-modal';
import { HideModal } from '@/components/hide-modal';
import { FilesSidebar } from '@/components/files-sidebar';
import { FilePreviewImage } from '@/components/file-preview-image';
import { humanSize, timeAgo, extOf, fileIconSrc, folderIconSrc, colorFor } from '@/lib/helpers';
import { toast } from '@/lib/toast';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { useFolderTree } from '@/lib/folders';

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

type ViewMode = 'grid' | 'list';
type SortMode = 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'largest' | 'smallest';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name_asc', label: 'Name A-Z' },
  { value: 'name_desc', label: 'Name Z-A' },
  { value: 'largest', label: 'Largest' },
  { value: 'smallest', label: 'Smallest' },
];


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

// Only the filters the API actually narrows by. `shared` is a no-op server-side,
// so an empty view under it means the folder is empty, not that nothing is shared.
const FILTER_EMPTY_LABELS: Record<string, string> = {
  documents: 'No documents here',
  videos: 'No videos here',
  images: 'No images here',
  hidden: 'No hidden files here',
};

function loadSavedColumns(): Set<ColumnKey> {
  try {
    const saved = localStorage.getItem('dosya_table_columns');
    if (saved) return new Set(JSON.parse(saved) as ColumnKey[]);
  } catch {}
  return new Set(DEFAULT_VISIBLE);
}

const VIEW_STORAGE_KEY = 'dosya_files_view';

function loadSavedView(): ViewMode {
  const saved = localStorage.getItem(VIEW_STORAGE_KEY);
  return saved === 'list' || saved === 'grid' ? saved : 'grid';
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
  const [view, setView] = useState<ViewMode>(loadSavedView);
  const changeView = (next: ViewMode) => {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  };
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

  // Get-info dialog
  const [infoTarget, setInfoTarget] = useState<InfoTarget | null>(null);

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

  // Add to group (files and folders)
  const [addToGroupTarget, setAddToGroupTarget] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);
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
  const { folders: pickerFolders, setFolders: setPickerFolders } = useFolderTree(wsId);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);
  // Guards the one-shot restore of an open file/viewer from the URL on first load,
  // so the state→URL mirror effect doesn't wipe the param before it's been read.
  const openRestored = useRef(false);

  const currentFolderId = searchParams.get('folder') || null;
  const deepLinkFileId = searchParams.get('file');
  const currentPage = parseInt(searchParams.get('page') || '1');

  // Reflect the current folder in the browser tab title
  useDocumentTitle(breadcrumbs.length > 0 ? `${breadcrumbs[breadcrumbs.length - 1].name} · Files` : 'Files');

  // ── Load files ─────────────────────────────────────────────

  const currentFilter = searchParams.get('filter') || '';
  const currentGroup = searchParams.get('group') || '';
  const isDeletedView = currentFilter === 'deleted';

  // A filtered view stays applied while you browse into folders, so an empty
  // result usually means "nothing of this type here" rather than an empty folder.
  const filterEmptyLabel = isDeletedView ? '' : FILTER_EMPTY_LABELS[currentFilter] ?? '';

  // How many items the last load returned — sizes the skeleton so switching
  // filters doesn't flash 8 placeholder rows when the view only has 1 item.
  const lastItemCount = useRef<number | null>(null);

  const loadFiles = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    const params = new URLSearchParams({ workspace_id: wsId, sort, page: String(currentPage), per_page: '100' });
    if (search) params.set('q', search);
    if (currentFolderId) params.set('folder_id', currentFolderId);
    if (isDeletedView) params.set('deleted', '1');
    if (currentFilter === 'hidden') params.set('hidden', '1');
    else if (currentFilter && currentFilter !== 'deleted') params.set('filter', currentFilter);
    if (currentGroup) params.set('group_id', currentGroup);

    try {
      const data = await api<{
        ok: boolean; folders: FolderItem[]; files: FileItem[];
        breadcrumbs: Breadcrumb[]; pagination?: Pagination;
      }>(`/api/files?${params}`);
      if (data.ok) {
        setFolders(data.folders); setFiles(data.files);
        lastItemCount.current = data.folders.length + data.files.length;
        setBreadcrumbs(data.breadcrumbs);
        if (data.pagination) setPagination(data.pagination);
        setSelected(new Set());
      }
    } catch { /* */ }
    setLoading(false);
  }, [wsId, sort, currentPage, search, currentFolderId, isDeletedView, currentFilter, currentGroup]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // Deep-link from the upload dock (?file=<id>): once that file is in the loaded
  // list, scroll it into view and flash the highlight. Keyed on the param VALUE
  // (so clicking a different file while already here re-triggers) and the loaded
  // files. The param is stripped after so the same file can be re-opened, and the
  // clear timer is ref-held so stripping the param doesn't cancel it.
  useEffect(() => {
    if (!deepLinkFileId || !files.some((f) => f.id === deepLinkFileId)) return;
    const id = deepLinkFileId;
    setHighlightId(id);
    requestAnimationFrame(() => {
      document.getElementById(`file-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2600);
    const next = new URLSearchParams(searchParams);
    next.delete('file');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkFileId, files]);

  // Restore an open file/viewer from the URL after a refresh. `view=<id>` reopens
  // the full viewer, `panel=<id>` reopens the detail panel. Runs once, after the
  // first file load, and falls back to fetching the file directly if it isn't on
  // the current page/folder. Sets `openRestored` so the mirror effect below can
  // take over without racing to clear the param.
  useEffect(() => {
    if (openRestored.current || loading) return;
    const viewId = searchParams.get('view');
    const panelId = searchParams.get('panel');
    const id = viewId || panelId;
    const action: 'view' | 'detail' = viewId ? 'view' : 'detail';
    if (!id) { openRestored.current = true; return; }
    const inList = files.find((f) => f.id === id);
    if (inList) { openFileWithLockCheck(inList, action); openRestored.current = true; return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ ok: boolean; file?: FileItem }>(`/api/files/${id}`);
        if (!cancelled && res.ok && res.file) openFileWithLockCheck(res.file, action);
      } catch { /* stale/deleted file — the mirror effect will drop the param */ }
      finally { if (!cancelled) openRestored.current = true; }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, files]);

  // Mirror the open file/viewer into the URL so it survives a refresh. Viewer wins
  // if both are somehow set. Guarded until the initial restore has run.
  useEffect(() => {
    if (!openRestored.current) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (viewerFile) { next.set('view', viewerFile.id); next.delete('panel'); }
      else if (selectedFile) { next.set('panel', selectedFile.id); next.delete('view'); }
      else { next.delete('view'); next.delete('panel'); }
      return next.toString() === prev.toString() ? prev : next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerFile, selectedFile]);

  // Load favourites
  const loadFavourites = useCallback(async () => {
    if (!wsId) return;
    try {
      const data = await api<{ ok: boolean; files?: { file_id: string }[] }>(`/api/favourites?workspace_id=${wsId}`);
      if (data.ok && data.files) setFavourites(new Set(data.files.map((f) => f.file_id)));
    } catch { /* optional feature */ }
  }, [wsId]);
  useEffect(() => { loadFavourites(); }, [loadFavourites]);

  // Refresh star state when the FilesSidebar removes a favourite (and vice
  // versa — both components keep their own favourites state).
  useEffect(() => {
    const onChanged = () => loadFavourites();
    window.addEventListener('dosya:favourites-changed', onChanged);
    return () => window.removeEventListener('dosya:favourites-changed', onChanged);
  }, [loadFavourites]);

  const toggleFavourite = async (fileId: string) => {
    const isFav = favourites.has(fileId);
    try {
      if (isFav) {
        await api(`/api/favourites?workspace_id=${wsId}&file_id=${fileId}`, { method: 'DELETE' });
        setFavourites((prev) => { const next = new Set(prev); next.delete(fileId); return next; });
      } else {
        await api('/api/favourites', { method: 'POST', body: JSON.stringify({ file_id: fileId, workspace_id: wsId }) });
        setFavourites((prev) => new Set(prev).add(fileId));
      }
      // Tell the FilesSidebar (separate state) to refresh its favourites list
      window.dispatchEvent(new Event('dosya:favourites-changed'));
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
    setSearchParams(folderNavParams(searchParams, folderId));
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

  const handleMove = async (folderId: string | null) => {
    if (!moveOpen) return;
    try {
      const ep = moveOpen.type === 'file' ? `/api/files/${moveOpen.id}/move` : `/api/folders/${moveOpen.id}/move`;
      const body = moveOpen.type === 'file' ? { folder_id: folderId } : { parent_id: folderId };
      await api(ep, { method: 'PUT', body: JSON.stringify(body) });
      toast.success('Moved', 'The file has been moved.'); setMoveOpen(null); loadFiles();
    } catch { toast.error('Move failed', 'The file could not be moved.'); }
  };

  const openShare = (fileId: string, fileName: string) => {
    setShareTarget({ id: fileId, name: fileName });
  };

  const openMoveModal = (id: string, type: 'file' | 'folder') => {
    setMoveOpen({ id, type });
  };

  const openAddToGroup = async (id: string, name: string, type: 'file' | 'folder') => {
    try {
      const data = await api<{ ok: boolean; groups?: { id: string; name: string; color: string }[] }>(`/api/groups?workspace_id=${wsId}`);
      if (data.ok && data.groups && data.groups.length > 0) {
        setAvailableGroups(data.groups);
        setAddToGroupTarget({ id, name, type });
      } else toast.info('No groups', 'No groups yet. Create one in the sidebar.');
    } catch { toast.error('Something went wrong', 'Could not load your groups.'); }
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

  const bulkMove = () => {
    if (selected.size === 0) return;
    // Use the first selected file to open move modal
    setMoveOpen({ id: Array.from(selected)[0], type: 'file' });
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
    { label: 'Get info', icon: <Info />, onClick: () => setInfoTarget({ type: 'file', item: f }) },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: 'Rename', icon: <Pencil />, onClick: () => { setRenameTarget({ id: f.id, name: f.name, type: 'file' }); setRenameName(f.name); } },
    { label: 'Copy', icon: <Copy />, onClick: () => handleCopy(f.id) },
    { label: 'Move to...', icon: <Move />, onClick: () => openMoveModal(f.id, 'file') },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: 'Add to group', icon: <FolderPlus />, onClick: () => openAddToGroup(f.id, f.name, 'file') },
    { label: 'Upload new version', icon: <Upload />, onClick: () => setVersionUploadTarget(f.id) },
    { label: 'Version history', icon: <History />, onClick: () => openFileWithLockCheck(f, 'view') },
    { label: f.lock_mode !== 'none' ? 'Unlock' : 'Lock', icon: <Lock />, onClick: () => setLockTarget({ id: f.id, name: f.name, type: 'file' }) },
    { label: f.is_hidden ? 'Unhide' : 'Hide', icon: f.is_hidden ? <Eye /> : <EyeOff />, onClick: () => setHideTarget({ id: f.id, name: f.name, type: 'file' }) },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: 'Delete', icon: <Trash2 />, onClick: () => setDeleteTarget({ id: f.id, name: f.name, type: 'file' }), danger: true },
  ];

  const folderCtxItems = (f: FolderItem) => [
    { label: 'Open', icon: <FolderOpen />, onClick: () => navigateToFolder(f.id) },
    { label: 'Get info', icon: <Info />, onClick: () => setInfoTarget({ type: 'folder', item: f }) },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: 'Rename', icon: <Pencil />, onClick: () => { setRenameTarget({ id: f.id, name: f.name, type: 'folder' }); setRenameName(f.name); } },
    { label: 'Move to...', icon: <Move />, onClick: () => openMoveModal(f.id, 'folder') },
    { label: 'Add to group', icon: <FolderPlus />, onClick: () => openAddToGroup(f.id, f.name, 'folder') },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: f.lock_mode !== 'none' ? 'Unlock' : 'Lock', icon: <Lock />, onClick: () => setLockTarget({ id: f.id, name: f.name, type: 'folder' }) },
    { label: f.is_hidden ? 'Unhide' : 'Hide', icon: f.is_hidden ? <Eye /> : <EyeOff />, onClick: () => setHideTarget({ id: f.id, name: f.name, type: 'folder' }) },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: 'Delete', icon: <Trash2 />, onClick: () => setDeleteTarget({ id: f.id, name: f.name, type: 'folder' }), danger: true },
  ];

  const blankCtxItems = [
    { label: 'Refresh', icon: <RefreshCw />, onClick: () => loadFiles() },
    { label: '', separator: true, onClick: () => {}, icon: null },
    { label: 'New folder', icon: <FolderPlus />, onClick: () => setCreateFolderOpen(true) },
    { label: 'Upload files', icon: <Upload />, onClick: () => navigate(uploadHref) },
  ];

  const uploadHref = `/uploads${currentFolderId ? `?folder=${currentFolderId}&folder_name=${encodeURIComponent(breadcrumbs.at(-1)?.name ?? '')}` : ''}`;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Files sidebar */}
      <FilesSidebar
        onFilterChange={(filter) => setSearchParams(filterNavParams(searchParams, filter))}
        onFavouriteClick={async (fileId) => {
          const f = files.find((x) => x.id === fileId);
          if (f) { openFileWithLockCheck(f, 'view'); return; }
          // File not in the current list (e.g. clicked from a group in another
          // folder) — fetch it directly, then open.
          try {
            const res = await api<{ ok: boolean; file?: FileItem }>(`/api/files/${fileId}`);
            if (res.ok && res.file) openFileWithLockCheck(res.file, 'view');
          } catch { toast.error('Could not open file', 'The file could not be loaded.'); }
        }}
        onGroupClick={(groupId) => setSearchParams(groupNavParams(searchParams, groupId))}
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
        <Select value={sort} onValueChange={(v) => setSort(v as SortMode)} items={SORT_OPTIONS}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex border rounded-md overflow-hidden">
          <button onClick={() => changeView('grid')} className={`p-1.5 ${view === 'grid' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'}`}><Grid3X3 className="size-3.5" /></button>
          <button onClick={() => changeView('list')} className={`p-1.5 ${view === 'list' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'}`}><List className="size-3.5" /></button>
        </div>
        {view === 'list' && (
          <DropdownMenu open={columnPickerOpen} onOpenChange={setColumnPickerOpen}>
            <DropdownMenuTrigger
              className={`h-8 px-2 text-xs border rounded-md flex items-center gap-1.5 hover:bg-muted/50 ${columnPickerOpen ? 'bg-muted' : ''}`}
              title="Table columns"
            >
              <SlidersHorizontal className="size-3.5" /> Columns
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {ALL_COLUMNS.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visibleColumns.has(col.key)}
                  onCheckedChange={() => toggleColumn(col.key)}
                  closeOnClick={false}
                  disabled={col.key === 'name'}
                  className="text-xs"
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
        <div className="flex items-center gap-2 px-5 py-2 bg-primary/10 border-b shrink-0 flex-wrap">
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
          {loading ? <FileSkeleton view={view} count={lastItemCount.current ?? undefined} /> : folders.length === 0 && files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FolderOpen className="size-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm font-medium text-muted-foreground mb-1">
                {isDeletedView ? 'Trash is empty'
                  : search ? 'No files match your search'
                  : currentGroup ? 'This group is empty'
                  : filterEmptyLabel ? filterEmptyLabel
                  : 'This folder is empty'}
              </p>
              {currentGroup && !search && (
                <p className="text-xs text-muted-foreground max-w-64">
                  Right-click any file or folder and choose "Add to group" to collect items here.
                </p>
              )}
              {filterEmptyLabel && !search && !currentGroup && (
                <Button variant="outline" size="sm" className="h-7 text-xs mt-1" onClick={() => setSearchParams(filterNavParams(searchParams, ''))}>
                  Show all files
                </Button>
              )}
              {!isDeletedView && !search && !currentGroup && !filterEmptyLabel && <p className="text-xs text-muted-foreground">Upload files or create a folder to get started</p>}
            </div>
          ) : (
            <>
              {folders.length > 0 && (
                <div className="mb-5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Folders</p>
                  <div className={view === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3' : 'space-y-0.5'}>
                    {folders.map((f) => (
                      <FolderCard key={f.id} folder={f} view={view}
                        onClick={() => navigateToFolder(f.id)}
                        onContextMenu={(e) => onContextMenu(e, 'folder', f)}
                        onRename={() => { setRenameTarget({ id: f.id, name: f.name, type: 'folder' }); setRenameName(f.name); }}
                        onDelete={() => setDeleteTarget({ id: f.id, name: f.name, type: 'folder' })}
                        onAddToGroup={() => openAddToGroup(f.id, f.name, 'folder')} />
                    ))}
                  </div>
                </div>
              )}
              {files.length > 0 && view === 'grid' && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Files</p>
                  <div className={`grid grid-cols-2 md:grid-cols-3 ${selectedFile ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-3`}>
                    {files.map((f) => (
                      <FileCard key={f.id} file={f} view="grid"
                        domId={`file-${f.id}`}
                        selected={selected.has(f.id)}
                        anySelected={selected.size > 0}
                        active={selectedFile?.id === f.id || highlightId === f.id}
                        highlight={highlightId === f.id}
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
                        onFavourite={() => toggleFavourite(f.id)}
                        onComments={() => navigate(`/comments?file_id=${f.id}&workspace_id=${wsId}&name=${encodeURIComponent(f.name)}`)} />
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
                    const isActive = selectedFile?.id === f.id || highlightId === f.id;
                    const isSel = selected.has(f.id);
                    const cols = ALL_COLUMNS.filter((c) => visibleColumns.has(c.key));
                    return (
                      <div
                        key={f.id}
                        id={`file-${f.id}`}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer group ${highlightId === f.id ? 'animate-upload-flash ' : ''}${isActive ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900' : isSel ? 'bg-primary/10' : ''}`}
                        onClick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) toggleSelect(f.id); else openFileWithLockCheck(f, 'detail'); }}
                        onContextMenu={(e) => onContextMenu(e, 'file', f)}
                      >
                        <Checkbox
                          checked={isSel}
                          onCheckedChange={() => toggleSelect(f.id)}
                          onClick={(e) => e.stopPropagation()}
                          className={`size-4 shrink-0 transition-all ${isSel ? '' : 'opacity-0 group-hover:opacity-100'} ${selected.size > 0 ? 'opacity-100!' : ''}`}
                        />
                        <RowThumbnail fileId={f.id} fileName={f.name} />
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
                            onAddToGroup={() => openAddToGroup(f.id, f.name, 'file')}
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
          <p className="text-sm text-muted-foreground">Are you sure you want to delete <span className="font-semibold text-foreground break-all">{deleteTarget?.name}</span>?</p>
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
      {moveOpen && (
        <FolderPickerDialog
          open
          onClose={() => setMoveOpen(null)}
          workspaceId={wsId}
          folders={pickerFolders}
          onFoldersChange={setPickerFolders}
          selectedId={null}
          onSelect={(id) => handleMove(id)}
          title="Move to folder"
          confirmLabel="Move"
          excludeId={moveOpen.type === 'folder' ? moveOpen.id : null}
        />
      )}

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

      {/* Get-info dialog */}
      <FileInfoDialog
        target={infoTarget}
        location={breadcrumbs.length ? breadcrumbs.map((b) => b.name).join(' / ') : 'Home'}
        onClose={() => setInfoTarget(null)}
      />

      {/* Add to group dialog */}
      <Dialog open={!!addToGroupTarget} onOpenChange={() => setAddToGroupTarget(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Add to group</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground mb-2">
            Select a group for <span className="font-semibold text-foreground break-all">{addToGroupTarget?.name}</span>
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
                    // Adding goes through POST /api/groups/:id with a body —
                    // the /files/:id and /folders/:id subroutes are DELETE-only.
                    const body = addToGroupTarget.type === 'file'
                      ? { file_id: addToGroupTarget.id }
                      : { folder_id: addToGroupTarget.id };
                    await api(`/api/groups/${g.id}`, { method: 'POST', body: JSON.stringify(body) });
                    toast.success('Added to group', `The ${addToGroupTarget.type} was added to ${g.name}.`);
                    setAddToGroupTarget(null);
                    // Refresh the FilesSidebar's group list (item counts)
                    window.dispatchEvent(new Event('dosya:groups-changed'));
                  } catch { toast.error('Something went wrong', `The ${addToGroupTarget.type} could not be added to the group.`); }
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
          <p className="text-xs text-muted-foreground">Enter the password to access <span className="font-semibold text-foreground break-all">{unlockPrompt?.file.name}</span></p>
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

function FolderCard({ folder, view, onClick, onContextMenu, onRename, onDelete, onAddToGroup }: {
  folder: FolderItem; view: ViewMode; onClick: () => void; onContextMenu: (e: ReactMouseEvent) => void; onRename: () => void; onDelete: () => void; onAddToGroup?: () => void;
}) {
  const iconSrc = folderIconSrc(folder.file_count, !!folder.is_synced);

  if (view === 'list') {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 cursor-pointer group" onClick={onClick} onContextMenu={onContextMenu}>
        <img src={iconSrc} alt="" className="size-5 shrink-0" />
        <span className="text-sm font-medium flex-1 truncate">{folder.name}</span>
        <span className="text-xs text-muted-foreground">{folder.file_count} files</span>
        {folder.lock_mode !== 'none' && <Lock className="size-3 text-muted-foreground" />}
        <FileDropdown onRename={onRename} onDelete={onDelete} onAddToGroup={onAddToGroup} />
      </div>
    );
  }
  return (
    <Card className="gap-0 py-0 p-3 hover:shadow-md hover:-translate-y-px transition-all cursor-pointer group" onClick={onClick} onContextMenu={onContextMenu}>
      <div className="flex items-center gap-2 mb-2">
        <img src={iconSrc} alt="" className="size-6" />
        {folder.lock_mode !== 'none' && <Lock className="size-3 text-muted-foreground ml-auto" />}
      </div>
      <p className="text-xs font-medium truncate">{folder.name}</p>
      <p className="text-[10px] text-muted-foreground">{folder.file_count} files</p>
    </Card>
  );
}

// ── File Card ──────────────────────────────────────────────

function FileCard({ file, view, selected, anySelected, active, highlight, domId, isFavourite, onClick, onSelect, onNameClick, onContextMenu, onDownload, onShare, onRename, onDelete, onCopy, onMove, onFavourite, onComments }: {
  file: FileItem; view: ViewMode; selected: boolean; anySelected?: boolean; active?: boolean; highlight?: boolean; domId?: string; isFavourite?: boolean;
  onClick: (e: ReactMouseEvent) => void; onSelect: () => void; onNameClick: () => void; onContextMenu: (e: ReactMouseEvent) => void;
  onDownload: () => void; onShare: () => void; onRename: () => void; onDelete: () => void; onCopy: () => void; onMove: () => void; onFavourite?: () => void; onComments?: () => void;
}) {
  const ext = extOf(file.name).toUpperCase() || 'FILE';

  if (view === 'list') {
    return (
      <div id={domId} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 cursor-pointer group ${highlight ? 'animate-upload-flash ' : ''}${active ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900' : selected ? 'bg-primary/10' : ''}`} onClick={onClick} onContextMenu={onContextMenu}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelect()}
          onClick={(e) => e.stopPropagation()}
          className={`size-4 shrink-0 transition-all ${selected ? '' : 'opacity-0 group-hover:opacity-100'} ${anySelected ? 'opacity-100!' : ''}`}
        />
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
    <Card id={domId} className={`gap-0 py-0 p-0 overflow-hidden rounded-xl aspect-3/2 transition-all cursor-pointer group relative hover:-translate-y-px hover:shadow-lg ${highlight ? 'animate-upload-flash ' : ''}${active ? 'ring-2 ring-green-500' : selected ? 'ring-2 ring-primary' : 'ring-1 ring-black/5 dark:ring-white/10'}`} onClick={onClick} onContextMenu={onContextMenu}>
      {/* Full-bleed image */}
      <FileThumbnail fileId={file.id} fileName={file.name} ext={ext} />

      {/* Legibility scrims: top for the pills, bottom for filename + actions */}
      <div className="absolute inset-x-0 top-0 h-14 bg-linear-to-b from-black/55 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />

      {/* Top-left: multi-select checkbox (hidden for fully-locked files) */}
      {file.lock_mode !== 'full_lock' && (
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelect()}
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-2 left-2 z-20 size-5 rounded-full border-white/70 bg-black/30 backdrop-blur-sm transition-all data-[state=checked]:bg-primary data-[state=checked]:border-primary ${selected ? '' : 'opacity-0 group-hover:opacity-100'} ${anySelected ? 'opacity-100!' : ''}`}
        />
      )}

      {/* Top-right: lock (if any) + file-format pill */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {file.lock_mode !== 'none' && (
          <span className="flex items-center justify-center size-6 rounded-full bg-black/45 backdrop-blur-sm">
            <Lock className="size-3 text-white" />
          </span>
        )}
        <span className="px-2 py-0.5 rounded-full bg-black/45 backdrop-blur-sm text-[10px] font-mono font-semibold uppercase tracking-wider text-white">{ext}</span>
      </div>

      {/* Right vertical action rail: favourite · (comments) · share · settings */}
      <div className="absolute right-2 bottom-2 z-20 flex flex-col gap-2 opacity-90 group-hover:opacity-100 transition-opacity">
        {/* Favourite (single star — the app's favourite flag) */}
        <button
          className="flex items-center justify-center size-8 rounded-full bg-black/35 hover:bg-black/55 backdrop-blur-sm transition-colors"
          title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
          onClick={(e) => { e.stopPropagation(); onFavourite?.(); }}
        >
          <Star className={`size-4 ${isFavourite ? 'text-orange-400 fill-orange-400' : 'text-white'}`} />
        </button>
        {file.comment_count > 0 && (
          <button
            className="relative flex items-center justify-center size-8 rounded-full bg-black/35 hover:bg-black/55 backdrop-blur-sm transition-colors"
            title={`${file.comment_count} comment${file.comment_count === 1 ? '' : 's'} — open`}
            onClick={(e) => { e.stopPropagation(); onComments?.(); }}
          >
            <MessageSquare className="size-4 text-white" />
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-blue-500 text-[9px] font-mono text-white flex items-center justify-center">{file.comment_count}</span>
          </button>
        )}
        {/* Share */}
        <button
          className="flex items-center justify-center size-8 rounded-full bg-black/35 hover:bg-black/55 backdrop-blur-sm transition-colors"
          title={file.share_count > 0 ? `Shared (${file.share_count}) — manage` : 'Share'}
          onClick={(e) => { e.stopPropagation(); onShare(); }}
        >
          <Share2 className={`size-4 ${file.share_count > 0 ? 'text-green-400' : 'text-white'}`} />
        </button>
        {/* Settings / more */}
        <div onClick={(e) => e.stopPropagation()}>
          <FileDropdown overlay onDownload={onDownload} onShare={onShare} onRename={onRename} onDelete={onDelete} onCopy={onCopy} onMove={onMove} />
        </div>
      </div>

      {/* Bottom-left: filename + meta line (padded so it clears the rail) */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-2.5 pr-12">
        <div className="flex items-center gap-1.5 min-w-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <button className="font-mono text-sm font-semibold text-white truncate text-left hover:underline drop-shadow min-w-0" onClick={(e) => { e.stopPropagation(); onNameClick(); }}>{file.name}</button>
              }
            />
            <TooltipContent side="top" align="start" className="font-mono break-all max-w-xs">{file.name}</TooltipContent>
          </Tooltip>
          {file.current_version > 1 && <span className="shrink-0 rounded border border-white/30 px-1 text-[9px] font-mono text-white/80">v{file.current_version}</span>}
        </div>
        <p className="font-mono text-[11px] text-white/70 truncate drop-shadow">{humanSize(file.size_bytes)} · {timeAgo(file.updated_at)}</p>
      </div>
    </Card>
  );
}

// ── Small row thumbnail (table view): preview if image, else icon ──

function RowThumbnail({ fileId, fileName }: { fileId: string; fileName: string }) {
  return (
    <FilePreviewImage
      fileId={fileId}
      fileName={fileName}
      size={128}
      className="w-7 h-7 shrink-0 rounded object-cover bg-muted"
      fallback={<img src={fileIconSrc(fileName)} alt="" className="w-7 h-7 shrink-0" />}
    />
  );
}

// ── File thumbnail with error fallback ─────────────────────

function FileThumbnail({ fileId, fileName, ext }: { fileId: string; fileName: string; ext: string }) {
  const badge = (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: `linear-gradient(135deg, ${colorFor(fileName)}22, #0a0a0a)` }}
    >
      <span
        className="font-mono text-xl font-bold tracking-widest uppercase"
        style={{ color: colorFor(fileName) }}
      >
        {ext || 'FILE'}
      </span>
    </div>
  );

  return (
    <div className="absolute inset-0 bg-neutral-900">
      <FilePreviewImage
        fileId={fileId}
        fileName={fileName}
        size={512}
        className="w-full h-full object-cover"
        fallback={badge}
      />
    </div>
  );
}

// ── Dropdown menu (three dots) ─────────────────────────────

function FileDropdown({ onDownload, onShare, onRename, onDelete, onCopy, onMove, onAddToGroup, overlay }: {
  onDownload?: () => void; onShare?: () => void; onRename: () => void; onDelete: () => void; onCopy?: () => void; onMove?: () => void; onAddToGroup?: () => void; overlay?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        {overlay
          ? <button className="flex items-center justify-center size-7 rounded-full bg-white/10 hover:bg-white/25 backdrop-blur-sm transition-colors" title="More" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="size-4 text-white" /></button>
          : <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="size-3.5" /></button>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onDownload && <DropdownMenuItem onClick={onDownload}><Download className="size-3 mr-2" /> Download</DropdownMenuItem>}
        {onShare && <DropdownMenuItem onClick={onShare}><Share2 className="size-3 mr-2" /> Share</DropdownMenuItem>}
        {onCopy && <DropdownMenuItem onClick={onCopy}><Copy className="size-3 mr-2" /> Copy</DropdownMenuItem>}
        {onMove && <DropdownMenuItem onClick={onMove}><Move className="size-3 mr-2" /> Move to...</DropdownMenuItem>}
        {onAddToGroup && <DropdownMenuItem onClick={onAddToGroup}><FolderPlus className="size-3 mr-2" /> Add to group</DropdownMenuItem>}
        <DropdownMenuItem onClick={onRename}><Pencil className="size-3 mr-2" /> Rename</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="size-3 mr-2" /> Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Skeleton ───────────────────────────────────────────────

function FileSkeleton({ view, count }: { view: ViewMode; count?: number }) {
  // Size the placeholder set to the last known item count (min 1) so a view
  // with a single file doesn't flash a full page of skeleton rows.
  const n = (max: number) => Math.min(Math.max(count ?? max, 1), max);
  const rows = (max: number) => Array.from({ length: n(max) }, (_, i) => i);
  if (view === 'list') {
    return <div className="space-y-1">{rows(6).map((i) => <div key={i} className="flex items-center gap-3 px-3 py-2.5"><Skeleton className="w-8 h-8 rounded-md" /><Skeleton className="h-3.5 w-40" /><Skeleton className="h-3 w-16 ml-auto" /></div>)}</div>;
  }
  return <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">{rows(8).map((i) => <Skeleton key={i} className="w-full aspect-3/2 rounded-xl" />)}</div>;
}
