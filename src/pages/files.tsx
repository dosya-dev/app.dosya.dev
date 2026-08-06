import { useState, useEffect, useCallback, useMemo, useRef, memo, type MouseEvent as ReactMouseEvent } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, API_BASE, ApiError, apiErrorMessage, responseErrorMessage } from '@/api/client';
import { useDocumentTitle } from '@/lib/page-title';
import { folderNavParams, filterNavParams, groupNavParams } from '@/lib/files-params';
import { enqueue } from '@/lib/upload-runner';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useFilesListing, fetchFilesListing } from '@/hooks/use-files-listing';
import { runBulk } from '@/lib/bulk-run';
import type { FileItem, FolderItem } from '@/lib/file-types';
import { filesQueryKey, filesRequestPath, type FilesView } from '@/lib/files-request';
import { useWorkspace } from '@/stores/workspace';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
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
  ArrowUp, ArrowDown, AlertCircle, SquarePen,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card } from '@/components/ui/card';
import { SelectCheckbox } from '@/components/select-checkbox';
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
import { OriginBadge } from '@/components/origin-badge';
import { humanSize, timeAgo, extOf, fileIconSrc, folderIconSrc, colorFor, originLabel, isOfficeFile } from '@/lib/helpers';
import { serializeSort, parseSort, toggleSort, DEFAULT_SORT, type SortKey, type SortSpec } from '@/lib/list-sort';
import { toast } from '@/lib/toast';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { ImportProgressCard } from '@/components/cloud-import/import-progress-card';

// ── Types ──────────────────────────────────────────────────
// Listing row shapes live in lib/file-types so this page and the file viewer
// cannot drift apart - see the note there.

type ViewMode = 'grid' | 'list';

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name_asc', label: 'Name A-Z' },
  { value: 'name_desc', label: 'Name Z-A' },
  { value: 'largest', label: 'Largest' },
  { value: 'smallest', label: 'Smallest' },
];


// ── Table columns ─────────────────────────────────────────

// Every table column doubles as a sort key (the API whitelists them all).
type ColumnKey = SortKey;

interface ColumnDef {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
  width?: string;
  render: (f: FileItem) => React.ReactNode;
  renderFolder?: (f: FolderItem) => React.ReactNode;
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', defaultVisible: true, width: 'flex-1 min-w-40', render: () => null /* handled separately */ },
  { key: 'size', label: 'Size', defaultVisible: true, width: 'w-20', render: (f) => humanSize(f.size_bytes), renderFolder: (f) => humanSize(f.total_size_bytes) },
  { key: 'created', label: 'Created', defaultVisible: true, width: 'w-24', render: (f) => timeAgo(f.created_at), renderFolder: (f) => timeAgo(f.created_at) },
  { key: 'modified', label: 'Modified', defaultVisible: false, width: 'w-24', render: (f) => timeAgo(f.updated_at), renderFolder: (f) => timeAgo(f.content_updated_at) },
  { key: 'type', label: 'Type', defaultVisible: false, width: 'w-28', render: (f) => f.mime_type, renderFolder: () => 'Folder' },
  { key: 'extension', label: 'Extension', defaultVisible: false, width: 'w-16', render: (f) => (f.extension || extOf(f.name) || '-').toUpperCase() },
  { key: 'version', label: 'Version', defaultVisible: false, width: 'w-16', render: (f) => f.current_version > 1 ? `v${f.current_version}` : '-' },
  { key: 'uploader', label: 'Uploader', defaultVisible: false, width: 'w-28', render: (f) => f.uploader_name ?? '-', renderFolder: (f) => f.uploader_name ?? '-' },
  { key: 'region', label: 'Region', defaultVisible: false, width: 'w-20', render: (f) => f.region || '-', renderFolder: (f) => f.region === 'multi' ? 'Multiple' : (f.region || '-') },
  { key: 'origin', label: 'Origin', defaultVisible: true, width: 'w-20', render: (f) => originLabel(f.origin), renderFolder: (f) => originLabel(f.origin) },
  { key: 'shares', label: 'Shares', defaultVisible: false, width: 'w-14', render: (f) => f.share_count > 0 ? String(f.share_count) : '-', renderFolder: (f) => f.share_count > 0 ? String(f.share_count) : '-' },
  { key: 'comments', label: 'Comments', defaultVisible: false, width: 'w-14', render: (f) => f.comment_count > 0 ? String(f.comment_count) : '-', renderFolder: (f) => f.comment_count > 0 ? String(f.comment_count) : '-' },
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
    if (!saved) return new Set(DEFAULT_VISIBLE);
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_VISIBLE);
    // The cast this used to do was a lie: localStorage is user-writable and
    // outlives any column rename, so an unknown key silently produced a table
    // whose headers and cells disagreed. Keep only keys that still exist, and
    // fall back rather than render an empty table.
    const known = new Set<string>(ALL_COLUMNS.map((c) => c.key));
    const valid = parsed.filter((k): k is ColumnKey => typeof k === 'string' && known.has(k));
    return valid.length > 0 ? new Set(valid) : new Set(DEFAULT_VISIBLE);
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

  // Search lives in the URL (?q=) so it survives a refresh and can be linked
  // to. `searchInput` is the raw typed value that keeps the field responsive;
  // it is committed to the URL - and therefore to the API - only after a pause,
  // instead of firing a request per keystroke.
  const search = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(search);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  // Back/forward and the sidebar can change ?q= without going through the
  // input, so mirror external changes back into the field.
  useEffect(() => {
    setSearchInput((cur) => (cur === search ? cur : search));
  }, [search]);

  useEffect(() => {
    if (debouncedSearch === search) return;
    const p = new URLSearchParams(searchParams);
    if (debouncedSearch) p.set('q', debouncedSearch);
    else p.delete('q');
    // A page number only means something within one result set.
    p.delete('page');
    setSearchParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT);
  const sortParam = serializeSort(sort);
  const changeSort = (next: SortSpec) => {
    setSort(next);
    // A page number only means something within one ordering - restart at 1.
    if (searchParams.get('page')) {
      const p = new URLSearchParams(searchParams);
      p.delete('page');
      setSearchParams(p, { replace: true });
    }
  };
  // Named `viewMode` (not `view`) because `view` names the FilesView passed to
  // useFilesListing below - this is grid/list display mode, unrelated to that.
  const [viewMode, setViewMode] = useState<ViewMode>(loadSavedView);
  const changeView = (next: ViewMode) => {
    setViewMode(next);
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
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);

  // Detail panel
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);

  // Share modal
  const [shareTarget, setShareTarget] = useState<{ ids: string[]; name: string } | null>(null);

  // File viewer
  const [viewerFile, setViewerFile] = useState<FileItem | null>(null);

  // Favourites
  const [favourites, setFavourites] = useState<Set<string>>(new Set());

  // Lock modal
  const [lockTarget, setLockTarget] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);

  // Get-info dialog
  const [infoTarget, setInfoTarget] = useState<InfoTarget | null>(null);

  // Unlock gate - tracks unlocked file IDs and pending unlock prompts
  const [unlockedFiles] = useState(() => new Map<string, string>()); // fileId → unlock_token
  const [unlockPrompt, setUnlockPrompt] = useState<{ file: FileItem; action: 'detail' | 'view' } | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const openFileWithLockCheck = (file: FileItem, action: 'detail' | 'view') => {
    if (isDeletedView && action === 'detail') {
      // Trash view is read-only for row activation: no detail panel means no
      // reachable "Delete file" button and no live Delete/Backspace shortcut
      // (both gated on `selectedFile`, which now never gets set here). A
      // plain click just selects the row; Restore/Delete permanently only
      // happen through the trash dropdown/context menu built for this view.
      // This is the single funnel every "open the detail panel" call site
      // goes through (grid card click, list row click, and the ?panel=
      // deep-link restore), so gating here covers all of them at once.
      toggleSelect(file.id);
      return;
    }
    if (file.lock_mode === 'full_lock' && !unlockedFiles.has(file.id)) {
      setUnlockPrompt({ file, action });
      setUnlockPassword('');
      setUnlockError('');
      return;
    }
    if (action === 'detail') setSelectedFile(file);
    else setViewerFile(file);
  };

  /**
   * Dismiss the unlock prompt and clear what was typed. Closing used to leave
   * `unlockPassword` set, so reopening the dialog - for the same file or a
   * different one - showed the previous attempt still in the field.
   */
  const closeUnlockPrompt = () => {
    setUnlockPrompt(null);
    setUnlockPassword('');
    setUnlockError('');
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
        closeUnlockPrompt();
        if (action === 'detail') setSelectedFile(file);
        else setViewerFile(file);
      } else {
        setUnlockError(res.error ?? 'Incorrect password');
        setUnlockPassword('');
      }
    } catch (err) {
      // api() throws on non-2xx, so a rejected password lands here - surface
      // the server's message and reset the field like the else-branch does.
      setUnlockError(apiErrorMessage(err, "Can't reach the server. Check your connection and try again."));
      if (err instanceof ApiError) setUnlockPassword('');
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
  /** `permanent`/`fileCount` are only set for the Deleted view's row-level purge, which reuses this same dialog. */
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; type: 'file' | 'folder'; permanent?: boolean; fileCount?: number } | null>(null);
  /** True while the single-item delete confirm's request is in flight. Keeps
   * the confirm button (and the rest of the dialog) locked so a second click
   * can't send a follow-up DELETE that lands on the now-trashed item and
   * silently purges it - see `handleDelete`. */
  const [deleting, setDeleting] = useState(false);
  /** Pending bulk delete awaiting confirmation - `permanent` distinguishes the Deleted view's irreversible purge. */
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<{ permanent: boolean } | null>(null);
  /** A bulk action is in flight - disables the bulk bar so a second click
   *  can't fire the same requests against a selection already being mutated. */
  const [bulkBusy, setBulkBusy] = useState(false);
  /** File/folder ids with a restore request in flight - guards row-level
   * Restore (context menu / dropdown) against the same double-click race,
   * which has previously double-credited storage at the API layer. */
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);
  const [renameName, setRenameName] = useState('');
  const [moveOpen, setMoveOpen] = useState<{ id: string; type: 'file' | 'folder' } | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);
  // Guards the one-shot restore of an open file/viewer from the URL on first load,
  // so the state→URL mirror effect doesn't wipe the param before it's been read.
  const openRestored = useRef(false);

  const currentFolderId = searchParams.get('folder') || null;
  const deepLinkFileId = searchParams.get('file');
  const currentPage = parseInt(searchParams.get('page') || '1');

  // ── Load files ─────────────────────────────────────────────

  const currentFilter = searchParams.get('filter') || '';
  const currentGroup = searchParams.get('group') || '';
  const isDeletedView = currentFilter === 'deleted';

  const view: FilesView | null = useMemo(
    () => (wsId ? {
      workspaceId: wsId,
      folderId: currentFolderId,
      filter: currentFilter,
      group: currentGroup,
      sort: sortParam,
      search,
      page: currentPage,
    } : null),
    [wsId, currentFolderId, currentFilter, currentGroup, sortParam, search, currentPage],
  );

  const {
    folders, files, breadcrumbs, pagination,
    isLoading: loading, isPlaceholder, error: loadError, refresh: loadFiles,
  } = useFilesListing(view);

  const queryClient = useQueryClient();

  /**
   * Warm a folder's first page while the pointer is still travelling to it.
   * By the time the click lands the payload is usually already cached, so the
   * folder opens with no network wait at all.
   */
  const prefetchFolder = useCallback((folderId: string) => {
    if (!view || isDeletedView) return; // trashed folders are not browsable this way
    // Mirror folderNavParams: a group is a flat, folder-spanning view, so
    // entering a folder (even one shown as a group member) always exits the
    // group. Keeping view.group here would prefetch a group_id-qualified key
    // that the click's actual navigation never requests.
    const next: FilesView = { ...view, folderId, group: '', page: 1 };
    queryClient.prefetchQuery({
      queryKey: filesQueryKey(next),
      // Shares useFilesListing's validation (see fetchFilesListing) so an
      // ok:false body can never be cached under this key as if it were data.
      queryFn: () => fetchFilesListing(filesRequestPath(next)),
    });
  }, [queryClient, view, isDeletedView]);

  // Hover-intent delay for the prefetch above. The folders query has no LIMIT,
  // so a busy directory renders every subfolder - firing prefetchFolder
  // straight off onMouseEnter meant one diagonal mouse sweep toward a target
  // crossed every intervening row and fired a full /api/files request (several
  // D1 round trips plus a recursive CTE) for each. A single ref is enough: at
  // most one row is "the current hover target" at a time, so entering a new
  // row before the timer fires is exactly the "was never actually the intent"
  // case this is supposed to skip.
  const HOVER_PREFETCH_DELAY_MS = 120;
  const prefetchTimer = useRef<number | null>(null);
  const scheduleFolderPrefetch = useCallback((folderId: string) => {
    if (prefetchTimer.current != null) window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = window.setTimeout(() => {
      prefetchTimer.current = null;
      prefetchFolder(folderId);
    }, HOVER_PREFETCH_DELAY_MS);
  }, [prefetchFolder]);
  const cancelFolderPrefetch = useCallback(() => {
    if (prefetchTimer.current != null) {
      window.clearTimeout(prefetchTimer.current);
      prefetchTimer.current = null;
    }
  }, []);
  useEffect(() => () => {
    if (prefetchTimer.current != null) window.clearTimeout(prefetchTimer.current);
  }, []);

  // Reflect the current folder in the browser tab title. Moved below the hook
  // because `breadcrumbs` now comes from it instead of local state.
  useDocumentTitle(breadcrumbs.length > 0 ? `${breadcrumbs[breadcrumbs.length - 1].name} · Files` : 'Files');

  // A filtered view stays applied while you browse into folders, so an empty
  // result usually means "nothing of this type here" rather than an empty folder.
  const filterEmptyLabel = isDeletedView ? '' : FILTER_EMPTY_LABELS[currentFilter] ?? '';

  // How many items the last load returned - sizes the skeleton so switching
  // filters doesn't flash 8 placeholder rows when the view only has 1 item.
  const lastItemCount = useRef<number | null>(null);

  // Selection is per-view: ids from the previous folder must not survive into the
  // next one. Keyed on the view rather than the fetched rows, so a background
  // revalidation that happens to return changed data does not wipe an in-progress
  // multi-select.
  useEffect(() => { clearSelection(); }, [view]);

  useEffect(() => {
    if (!isPlaceholder) lastItemCount.current = folders.length + files.length;
  }, [folders, files, isPlaceholder]);

  // Cloud-import completion invalidates the files cache app-wide via a
  // module-scope store subscription (see lib/query-client.ts) rather than a
  // page-scoped effect here - a page-scoped listener only reacts while this
  // page happens to be mounted, and cloud imports are long-running
  // background jobs that routinely finish while the user is elsewhere.

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
      } catch { /* stale/deleted file - the mirror effect will drop the param */ }
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
  // versa - both components keep their own favourites state).
  useEffect(() => {
    const onChanged = () => loadFavourites();
    window.addEventListener('dosya:favourites-changed', onChanged);
    return () => window.removeEventListener('dosya:favourites-changed', onChanged);
  }, [loadFavourites]);

  // Upload-complete invalidation lives at module scope in lib/query-client.ts
  // now, not here - see its docstring for why a page-scoped effect isn't
  // enough. This page still repaints from the cache like any other query
  // subscriber once that invalidation lands.

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

  // Version uploads go through the shared upload runner rather than a bare
  // fetch: it sends session cookies, splits files over the multipart
  // threshold, reports progress in the upload dock, and can be canceled or
  // resumed. A single unauthenticated PUT did none of that and a large
  // version silently stalled until the browser timed it out.
  const handleVersionUpload = (fileId: string, file: File) => {
    if (!wsId) return;
    enqueue([file], { workspace_id: wsId, folder_id: null, file_id: fileId });
    toast.info('Uploading version', `${file.name} is uploading - track it in the upload dock.`);
  };

  // Trigger hidden file input when version upload target is set
  useEffect(() => {
    if (versionUploadTarget) {
      document.getElementById('version-upload-input')?.click();
    }
  }, [versionUploadTarget]);

  // ── Actions ────────────────────────────────────────────────

  const navigateToFolder = (folderId: string | null) => {
    clearSelection();
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
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const ep = deleteTarget.type === 'file' ? `/api/files/${deleteTarget.id}` : `/api/folders/${deleteTarget.id}`;
      await api(ep, { method: 'DELETE' });
      toast.success('Deleted', deleteTarget.permanent ? `${deleteTarget.name} was permanently deleted.` : `${deleteTarget.name} was deleted.`);
      // The deleted row can be part of the current bulk selection even though
      // this is the single-item delete path - clear explicitly so a stale id
      // for a now-gone row doesn't linger in `selected`/`selectedFolders`.
      setDeleteTarget(null); clearSelection(); loadFiles();
    } catch (err) {
      // A row-level permanent delete on a folder that isn't a trash root
      // 404/400s with an explanatory message ("...restore or delete that
      // one instead") - surface it instead of a generic failure.
      toast.error('Delete failed', apiErrorMessage(err, 'The item could not be deleted.'));
    }
    setDeleting(false);
  };

  // Row-level restore for a single trashed folder. Bulk restore (below)
  // covers multi-select; this is the context-menu/dropdown "Restore" action.
  // Guarded by `restoringIds` so a rapid double-click (or reopening the menu
  // before the first request lands) can't fire two overlapping restores of
  // the same folder.
  const handleRestoreFolder = async (f: FolderItem) => {
    if (restoringIds.has(f.id)) return;
    setRestoringIds((prev) => new Set(prev).add(f.id));
    try {
      const res = await api<{ ok: boolean; name?: string; restored_to_root?: boolean }>(`/api/folders/${f.id}`, { method: 'PUT' });
      // `res.name` is the conflict-resolved name the server actually used
      // (e.g. "Photos (1)" if "Photos" already exists at the destination) -
      // prefer it over the row's cached name.
      const restoredName = res.name ?? f.name;
      if (res.restored_to_root) {
        toast.info('Restored', `"${restoredName}" restored to the workspace root - its original folder is also in the trash.`);
      } else {
        toast.success('Restored', `"${restoredName}" restored.`);
      }
      // Restoring drops this row out of the Deleted view - clear explicitly so
      // a stale id for it can't linger in the bulk selection.
      clearSelection(); loadFiles();
    } catch (err) {
      // Surfaces the 409 storage-cap message and the 400 "not a trash root"
      // message from PUT /api/folders/:id rather than a generic failure.
      toast.error('Restore failed', apiErrorMessage(err, 'The folder could not be restored.'));
    }
    setRestoringIds((prev) => { const next = new Set(prev); next.delete(f.id); return next; });
  };

  // Row-level restore for a single trashed file - the file-side equivalent of
  // handleRestoreFolder above (same double-click guard).
  const handleRestoreFile = async (f: FileItem) => {
    if (restoringIds.has(f.id)) return;
    setRestoringIds((prev) => new Set(prev).add(f.id));
    try {
      await api(`/api/files/${f.id}`, { method: 'PUT' });
      toast.success('Restored', `"${f.name}" restored.`);
      // Restoring drops this row out of the Deleted view - clear explicitly so
      // a stale id for it can't linger in the bulk selection.
      clearSelection(); loadFiles();
    } catch (err) {
      toast.error('Restore failed', apiErrorMessage(err, 'The file could not be restored.'));
    }
    setRestoringIds((prev) => { const next = new Set(prev); next.delete(f.id); return next; });
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

  const handleDownloadFolder = async (folderId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/files/download-archive`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_ids: [folderId] }),
      });
      if (!res.ok) { toast.error('Download failed', await responseErrorMessage(res, 'The folder could not be prepared.')); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'dosya-download.zip'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Download failed', 'The folder could not be prepared.'); }
  };

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
      toast.success('Moved', 'The file has been moved.');
      // The moved row leaves the current folder - clear explicitly so a stale
      // id for it can't linger in the bulk selection.
      setMoveOpen(null); clearSelection(); loadFiles();
    } catch { toast.error('Move failed', 'The file could not be moved.'); }
  };

  const openShare = (fileId: string, fileName: string) => {
    setShareTarget({ ids: [fileId], name: fileName });
  };

  /** Share every selected file behind one bundle link. */
  const openBulkShare = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const name = ids.length === 1
      ? files.find((f) => f.id === ids[0])?.name ?? '1 file'
      : `${ids.length} files`;
    setShareTarget({ ids, name });
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

  const toggleSelectFolder = (id: string) => {
    setSelectedFolders((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const selectAll = useCallback(() => {
    setSelected(new Set(files.filter((f) => f.lock_mode !== 'full_lock' || unlockedFiles.has(f.id)).map((f) => f.id)));
    setSelectedFolders(new Set(folders.map((f) => f.id)));
  }, [files, folders, unlockedFiles]);

  const clearSelection = () => { setSelected(new Set()); setSelectedFolders(new Set()); };
  const totalSelected = selected.size + selectedFolders.size;

  // Bulk delete is confirmation-gated (see the bulk-delete dialog near the
  // single-item one below). Deleting a folder takes everything inside it, and
  // the bulk bar's Delete button sits one click away from Download/Move, so
  // firing the request straight from the toolbar was too easy to do by
  // accident. `bulkDeleteConfirm` holds the pending mode; these two runners
  // are only ever reached from the dialog's confirm button.
  const runBulkDelete = async () => {
    setBulkDeleteConfirm(null);
    try {
      await api('/api/files/batch-delete', { method: 'POST', body: JSON.stringify({
        workspace_id: wsId,
        file_ids: Array.from(selected),
        folder_ids: Array.from(selectedFolders),
      }) });
      toast.success('Deleted', `${totalSelected} item${totalSelected === 1 ? '' : 's'} deleted.`);
      clearSelection(); loadFiles();
    } catch { toast.error('Delete failed', 'The selected items could not be deleted.'); }
  };

  const bulkDownloadZip = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/files/download-archive`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: Array.from(selected), folder_ids: Array.from(selectedFolders) }),
      });
      if (!res.ok) { toast.error('Download failed', await responseErrorMessage(res, 'The download could not be prepared.')); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'dosya-download.zip'; a.click();
      URL.revokeObjectURL(url);
      toast.success('Downloaded', 'Download started');
    } catch { toast.error('Download failed', 'The download could not be prepared.'); }
  };

  const bulkMove = () => { if (totalSelected > 0) setBulkMoveOpen(true); };

  // The bulk runners below use runBulk rather than an awaited for-loop: a
  // 50-item selection used to cost 50 sequential round trips, which is what
  // made these actions feel hung.
  const applyBulkMove = async (destFolderId: string | null) => {
    setBulkBusy(true);
    const fileRes = await runBulk(Array.from(selected), (id) =>
      api(`/api/files/${id}/move`, { method: 'PUT', body: JSON.stringify({ folder_id: destFolderId }) }));
    // circular-move / already-here errors land in `fail`
    const folderRes = await runBulk(Array.from(selectedFolders), (id) =>
      api(`/api/folders/${id}/move`, { method: 'PUT', body: JSON.stringify({ parent_id: destFolderId }) }));
    const ok = fileRes.ok + folderRes.ok;
    const fail = fileRes.fail + folderRes.fail;
    setBulkBusy(false);
    setBulkMoveOpen(false); clearSelection(); loadFiles();
    if (fail === 0) toast.success('Moved', `${ok} item${ok === 1 ? '' : 's'} moved.`);
    else toast.info('Move finished', `${ok} moved, ${fail} skipped (e.g. can't move a folder into itself).`);
  };

  const bulkRestore = async () => {
    setBulkBusy(true);
    const fileRes = await runBulk(Array.from(selected), (id) =>
      api(`/api/files/${id}`, { method: 'PUT' }));
    const folderRes = await runBulk(Array.from(selectedFolders), (id) =>
      api<{ ok: boolean; restored_to_root?: boolean }>(`/api/folders/${id}`, { method: 'PUT' }));
    const ok = fileRes.ok + folderRes.ok;
    const fail = fileRes.fail + folderRes.fail;
    const toRoot = folderRes.results.filter((r) => r?.restored_to_root).length;
    setBulkBusy(false);
    clearSelection(); loadFiles();
    if (fail > 0) toast.error('Some items could not be restored', `${ok} restored, ${fail} failed.`);
    else if (toRoot > 0) toast.info('Restored', `${ok} item${ok === 1 ? '' : 's'} restored. ${toRoot} went to the workspace root because the original folder is also in the trash.`);
    else toast.success('Restored', `${ok} item${ok === 1 ? '' : 's'} restored.`);
  };

  const runBulkPermanentDelete = async () => {
    setBulkDeleteConfirm(null);
    setBulkBusy(true);
    // Permanent delete is a SECOND DELETE on the item itself - there is no
    // /permanent sub-route, and the one this used to call 404'd silently
    // while still reporting success.
    const fileRes = await runBulk(Array.from(selected), (id) =>
      api(`/api/files/${id}`, { method: 'DELETE' }));
    const folderRes = await runBulk(Array.from(selectedFolders), (id) =>
      api(`/api/folders/${id}`, { method: 'DELETE' }));
    const ok = fileRes.ok + folderRes.ok;
    const fail = fileRes.fail + folderRes.fail;
    setBulkBusy(false);
    clearSelection(); loadFiles();
    if (fail === 0) toast.success('Deleted', `${ok} item${ok === 1 ? '' : 's'} permanently deleted.`);
    else toast.error('Some items could not be deleted', `${ok} deleted, ${fail} failed.`);
  };


  // ── Drag and drop ─────────────────────────────────────────

  // The trash is read-only - a drop there would try to upload into a
  // trashed folder (or the root while merely browsing trash), so uploading
  // is disabled outright rather than left to fail server-side. preventDefault
  // /stopPropagation must still run unconditionally though - skipping them
  // (as this used to) leaves the browser's native drop behaviour unguarded,
  // so a stray file drop navigates the whole tab away from the app.
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!isDeletedView) setDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setDragging(false); };
  // Dropped files are handed to the shared upload runner, same as the Uploads
  // page. It sends credentials, uses multipart above the size threshold, and
  // surfaces per-file progress/retry in the dock. The previous inline loop
  // uploaded sequentially with a single credential-less PUT and swallowed
  // every failure, so a rejected upload looked identical to a successful one.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    if (isDeletedView) return;
    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles.length || !wsId) return;
    enqueue(droppedFiles, { workspace_id: wsId, folder_id: currentFolderId });
    toast.info(
      `Uploading ${droppedFiles.length} file${droppedFiles.length > 1 ? 's' : ''}`,
      'Progress is shown in the upload dock.',
    );
  };

  // ── Keyboard shortcuts ────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Multi-select wins over the detail panel. This used to look at
        // `selectedFile` only, so Ctrl+A followed by Delete silently deleted
        // one file and left the other 99 selected rows untouched.
        if (selected.size > 0 || selectedFolders.size > 0) {
          e.preventDefault();
          setBulkDeleteConfirm({ permanent: isDeletedView });
        } else if (selectedFile) {
          // `selectedFile` can no longer be set while isDeletedView is true -
          // openFileWithLockCheck gates every "open the detail panel" call
          // site - so this branch is already inert in the trash view.
          setDeleteTarget({ id: selectedFile.id, name: selectedFile.name, type: 'file' });
        }
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
  }, [selectedFile, files, selected, selectedFolders, isDeletedView]);

  // ── Context menu ───────────────────────────────────────────

  const onContextMenu = (e: ReactMouseEvent, type: 'file' | 'folder' | 'blank', item?: FileItem | FolderItem) => {
    e.preventDefault(); e.stopPropagation();
    setCtxPos({ x: e.clientX, y: e.clientY });
    setCtxTarget({ type, item });
  };

  const fileCtxItems = (f: FileItem) => {
    if (isDeletedView) {
      // Read-only in the trash, mirroring folderCtxItems below: a second
      // DELETE on an already-trashed file is a permanent purge (rows + R2
      // object), so this view offers only Restore and an unmistakably
      // irreversible Delete permanently - not the routine "Delete" above,
      // and none of Rename/Copy/Move/Share/Download/Lock/Hide, which 404
      // against the is_deleted=0 predicate those routes filter on anyway.
      return [
        { label: 'Restore', icon: <RotateCcw />, onClick: () => handleRestoreFile(f), disabled: restoringIds.has(f.id) },
        { label: '', separator: true, onClick: () => {}, icon: null },
        { label: 'Delete permanently', icon: <Trash2 />, onClick: () => setDeleteTarget({ id: f.id, name: f.name, type: 'file', permanent: true }), danger: true },
      ];
    }
    return [
      { label: 'View', icon: <Eye />, onClick: () => openFileWithLockCheck(f, 'view') },
      { label: 'Open in editor', icon: <SquarePen />, hidden: !isOfficeFile(f.name), onClick: () => window.open(`/editor/${f.id}`, '_blank') },
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
  };

  const folderCtxItems = (f: FolderItem) => {
    if (isDeletedView) {
      // Read-only in the trash: browsing (Open) and inspecting (Get info)
      // stay, but nothing that mutates a live folder makes sense here.
      // Restore/Delete permanently only apply to a trash root - a
      // descendant surfaced by browsing into one 400s on both endpoints.
      const items: { label: string; icon: React.ReactNode; onClick: () => void; separator?: boolean; danger?: boolean; disabled?: boolean }[] = [
        { label: 'Open', icon: <FolderOpen />, onClick: () => navigateToFolder(f.id) },
        { label: 'Get info', icon: <Info />, onClick: () => setInfoTarget({ type: 'folder', item: f }) },
      ];
      if (f.is_trash_root) {
        items.push(
          { label: '', separator: true, onClick: () => {}, icon: null },
          { label: 'Restore', icon: <RotateCcw />, onClick: () => handleRestoreFolder(f), disabled: restoringIds.has(f.id) },
          { label: 'Delete permanently', icon: <Trash2 />, onClick: () => setDeleteTarget({ id: f.id, name: f.name, type: 'folder', permanent: true, fileCount: f.file_count }), danger: true },
        );
      }
      return items;
    }
    return [
      { label: 'Open', icon: <FolderOpen />, onClick: () => navigateToFolder(f.id) },
      { label: 'Download', icon: <Download />, onClick: () => handleDownloadFolder(f.id) },
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
  };

  const blankCtxItems = isDeletedView
    ? [{ label: 'Refresh', icon: <RefreshCw />, onClick: () => loadFiles() }]
    : [
        { label: 'Refresh', icon: <RefreshCw />, onClick: () => loadFiles() },
        { label: '', separator: true, onClick: () => {}, icon: null },
        { label: 'New folder', icon: <FolderPlus />, onClick: () => setCreateFolderOpen(true) },
        { label: 'Upload files', icon: <Upload />, onClick: () => navigate(uploadHref) },
      ];

  const uploadHref = `/uploads${currentFolderId ? `?folder=${currentFolderId}&folder_name=${encodeURIComponent(breadcrumbs.at(-1)?.name ?? '')}` : ''}`;

  // Column-header sorts (e.g. Uploader ↑) aren't among the six dropdown
  // presets - append a synthetic entry so the trigger still shows a label.
  const sortSelectItems = SORT_OPTIONS.some((o) => o.value === sortParam)
    ? SORT_OPTIONS
    : [...SORT_OPTIONS, {
        value: sortParam,
        label: `${ALL_COLUMNS.find((c) => c.key === sort.key)?.label ?? sort.key} ${sort.dir === 'asc' ? '↑' : '↓'}`,
      }];

  // In the trash, "Modified" doubles as "Deleted" (its only meaningful
  // reading there) and is forced visible - like the always-on Name column -
  // so a first-time visitor sees when something was removed without having
  // to dig into the column picker.
  const displayColumns: ColumnDef[] = useMemo(() => (isDeletedView
    ? ALL_COLUMNS.map((c) => c.key === 'modified'
        ? {
            ...c,
            label: 'Deleted',
            render: (f: FileItem) => f.deleted_at ? timeAgo(f.deleted_at) : '-',
            renderFolder: (f: FolderItem) => f.deleted_at ? timeAgo(f.deleted_at) : '-',
          }
        : c)
    : ALL_COLUMNS), [isDeletedView]);
  const effectiveVisibleColumns = useMemo(
    () => (isDeletedView ? new Set(visibleColumns).add('modified') : visibleColumns),
    [isDeletedView, visibleColumns],
  );
  // Hoisted out of the row loops: this used to be recomputed per row, so a
  // 100-file listing allocated 100 identical filtered arrays on every render.
  const activeColumns = useMemo(
    () => displayColumns.filter((c) => effectiveVisibleColumns.has(c.key)),
    [displayColumns, effectiveVisibleColumns],
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Files sidebar */}
      <FilesSidebar
        onFilterChange={(filter) => setSearchParams(filterNavParams(searchParams, filter))}
        onFavouriteClick={async (fileId) => {
          const f = files.find((x) => x.id === fileId);
          if (f) { openFileWithLockCheck(f, 'view'); return; }
          // File not in the current list (e.g. clicked from a group in another
          // folder) - fetch it directly, then open.
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
          <Input value={searchInput} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value)} placeholder="Search files..." className="h-8 text-xs pl-8" />
        </div>
        <Select value={sortParam} onValueChange={(v) => changeSort(parseSort(v ?? ''))} items={sortSelectItems}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {sortSelectItems.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex border rounded-md overflow-hidden">
          <button onClick={() => changeView('grid')} className={`p-1.5 ${viewMode === 'grid' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'}`}><Grid3X3 className="size-3.5" /></button>
          <button onClick={() => changeView('list')} className={`p-1.5 ${viewMode === 'list' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'}`}><List className="size-3.5" /></button>
        </div>
        {viewMode === 'list' && (
          <DropdownMenu open={columnPickerOpen} onOpenChange={setColumnPickerOpen}>
            <DropdownMenuTrigger
              className={`h-8 px-2 text-xs border rounded-md flex items-center gap-1.5 hover:bg-muted/50 ${columnPickerOpen ? 'bg-muted' : ''}`}
              title="Table columns"
            >
              <SlidersHorizontal className="size-3.5" /> Columns
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {displayColumns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={effectiveVisibleColumns.has(col.key)}
                  onCheckedChange={() => toggleColumn(col.key)}
                  closeOnClick={false}
                  disabled={col.key === 'name' || (isDeletedView && col.key === 'modified')}
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

      {/* Trash notice - items here still count against storage; only a
          permanent delete reclaims it. Static text, not a dismissible
          banner. */}
      {isDeletedView && (
        <div className="px-5 py-2 border-b shrink-0 text-xs text-muted-foreground bg-muted/30">
          Items in the trash still count against your storage. Delete them permanently to free up space.
        </div>
      )}

      {/* Bulk bar */}
      {totalSelected > 0 && (
        <div className="flex items-center gap-2 px-5 py-2 bg-primary/10 border-b shrink-0 flex-wrap">
          <Badge variant="secondary">{totalSelected} selected</Badge>
          {bulkBusy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {isDeletedView ? (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={bulkBusy} onClick={bulkRestore}><RotateCcw className="size-3 mr-1" /> Restore</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30" disabled={bulkBusy} onClick={() => setBulkDeleteConfirm({ permanent: true })}><Trash2 className="size-3 mr-1" /> Delete permanently</Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={bulkBusy} onClick={bulkDownloadZip}><Download className="size-3 mr-1" /> Download ZIP</Button>
              {selected.size > 0 && (
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={bulkBusy} onClick={openBulkShare}><Share2 className="size-3 mr-1" /> Share</Button>
              )}
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={bulkBusy} onClick={bulkMove}><Move className="size-3 mr-1" /> Move</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30" disabled={bulkBusy} onClick={() => setBulkDeleteConfirm({ permanent: false })}><Trash2 className="size-3 mr-1" /> Delete</Button>
            </>
          )}
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={selectAll}>Select all</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={clearSelection}>Clear</Button>
          </div>
        </div>
      )}

      {/* Content + Detail Panel */}
      <div className="flex-1 flex min-h-0">
        {/* File list */}
        <div className="flex-1 overflow-y-auto p-5" onClick={() => setSelectedFile(null)}>
          {/* Cloud import progress - collapses to nothing (empty:hidden) when no job is active */}
          <div className="mb-4 empty:hidden"><ImportProgressCard /></div>
          {loading ? <FileSkeleton view={viewMode} count={lastItemCount.current ?? undefined} /> : loadError ? (
            /* Distinct from the empty state on purpose - "this folder is
               empty" is a lie when the request failed, and without a retry
               the only way out was a full page reload. */
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <AlertCircle className="size-12 text-destructive/40 mb-4" />
              <p className="text-sm font-medium text-foreground mb-1">Could not load this folder</p>
              <p className="text-xs text-muted-foreground max-w-80 mb-3">{loadError}</p>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={loadFiles}>
                <RefreshCw className="size-3 mr-1" /> Try again
              </Button>
            </div>
          ) : folders.length === 0 && files.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={
                isDeletedView ? 'Trash is empty'
                  : search ? 'No files match your search'
                  : currentGroup ? 'This group is empty'
                  : filterEmptyLabel ? filterEmptyLabel
                  : 'This folder is empty'
              }
              description={
                currentGroup && !search
                  ? 'Right-click any file or folder and choose "Add to group" to collect items here.'
                  : (!isDeletedView && !search && !currentGroup && !filterEmptyLabel)
                    ? 'Drop files anywhere on this page to upload them.'
                    : undefined
              }
              actions={
                filterEmptyLabel && !search && !currentGroup ? (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSearchParams(filterNavParams(searchParams, ''))}>
                    Show all files
                  </Button>
                ) : (!isDeletedView && !search && !currentGroup && !filterEmptyLabel) ? (
                  <>
                    <Link to={uploadHref}>
                      <Button size="sm" className="h-7 text-xs"><Upload className="size-3 mr-1" /> Upload files</Button>
                    </Link>
                    <Link to="/integrations/google">
                      <Button variant="outline" size="sm" className="h-7 text-xs">Import from Drive</Button>
                    </Link>
                  </>
                ) : undefined
              }
            />
          ) : (
            <>
              {folders.length > 0 && viewMode === 'grid' && (
                <div className="mb-5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Folders</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {folders.map((f) => (
                      <FolderCard key={f.id} folder={f}
                        selected={selectedFolders.has(f.id)}
                        anySelected={totalSelected > 0}
                        onClick={(e) => { if (e.ctrlKey || e.metaKey) { e.stopPropagation(); toggleSelectFolder(f.id); } else navigateToFolder(f.id); }}
                        onSelect={() => toggleSelectFolder(f.id)}
                        onContextMenu={(e) => onContextMenu(e, 'folder', f)}
                        onPrefetch={() => scheduleFolderPrefetch(f.id)}
                        onPrefetchCancel={cancelFolderPrefetch} />
                    ))}
                  </div>
                </div>
              )}
              {files.length > 0 && viewMode === 'grid' && (
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
                        trashed={isDeletedView}
                        onClick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) toggleSelect(f.id); else openFileWithLockCheck(f, 'detail'); }}
                        onSelect={() => toggleSelect(f.id)}
                        onNameClick={() => openFileWithLockCheck(f, 'view')}
                        onContextMenu={(e) => onContextMenu(e, 'file', f)}
                        onDownload={() => handleDownload(f.id)}
                        onShare={() => openShare(f.id, f.name)}
                        onRename={() => { setRenameTarget({ id: f.id, name: f.name, type: 'file' }); setRenameName(f.name); }}
                        onDelete={() => setDeleteTarget({ id: f.id, name: f.name, type: 'file', permanent: isDeletedView })}
                        onCopy={() => handleCopy(f.id)}
                        onMove={() => openMoveModal(f.id, 'file')}
                        onFavourite={() => toggleFavourite(f.id)}
                        onComments={() => navigate(`/comments?file_id=${f.id}&workspace_id=${wsId}&name=${encodeURIComponent(f.name)}`)}
                        onRestore={() => handleRestoreFile(f)}
                        restoreDisabled={restoringIds.has(f.id)} />
                    ))}
                  </div>
                </div>
              )}
              {viewMode === 'list' && (files.length > 0 || folders.length > 0) && (
                <div>
                  {/* Table header - click a column to sort by it, click again to flip */}
                  <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b mb-0.5">
                    <div className="w-7 shrink-0" />
                    {activeColumns.map((col) => (
                      <button
                        key={col.key}
                        onClick={() => changeSort(toggleSort(sort, col.key))}
                        title={`Sort by ${col.label.toLowerCase()}`}
                        className={`flex items-center gap-1 text-left uppercase tracking-wider hover:text-foreground transition-colors ${col.key === 'name' ? 'flex-1 min-w-40' : col.width} ${sort.key === col.key ? 'text-foreground' : ''}`}
                      >
                        <span className="truncate">{col.label}</span>
                        {sort.key === col.key && (sort.dir === 'asc'
                          ? <ArrowUp className="size-2.5 shrink-0" />
                          : <ArrowDown className="size-2.5 shrink-0" />)}
                      </button>
                    ))}
                    <div className="w-8 shrink-0" />
                  </div>
                  {/* Folder rows - pinned above files, same columns */}
                  {folders.map((f) => (
                      <div
                        key={f.id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer group ${selectedFolders.has(f.id) ? 'bg-primary/10' : ''}`}
                        onClick={(e) => { if (e.ctrlKey || e.metaKey) { e.stopPropagation(); toggleSelectFolder(f.id); } else navigateToFolder(f.id); }}
                        onContextMenu={(e) => onContextMenu(e, 'folder', f)}
                        onMouseEnter={() => scheduleFolderPrefetch(f.id)}
                        onMouseLeave={cancelFolderPrefetch}
                      >
                        <SelectCheckbox
                          checked={selectedFolders.has(f.id)}
                          onCheckedChange={() => toggleSelectFolder(f.id)}
                          className={`size-4 shrink-0 transition-all ${selectedFolders.has(f.id) ? '' : 'opacity-0 group-hover:opacity-100'} ${totalSelected > 0 ? 'opacity-100!' : ''}`}
                        />
                        <span className="relative shrink-0">
                          <img src={folderIconSrc(f.file_count, !!f.is_synced)} alt="" className="w-7 h-7 object-contain" />
                          <OriginBadge origin={f.origin} />
                        </span>
                        {activeColumns.map((col) => {
                          if (col.key === 'name') {
                            return (
                              <div key="name" className="flex-1 min-w-40 flex items-center gap-2">
                                <span className="text-sm font-medium truncate">{f.name}</span>
                                <span className="text-xs text-muted-foreground shrink-0">{f.file_count} files</span>
                                {f.lock_mode !== 'none' && <Lock className="size-3 text-muted-foreground shrink-0" />}
                              </div>
                            );
                          }
                          return <div key={col.key} className={`text-xs text-muted-foreground truncate ${col.width}`}>{col.renderFolder ? col.renderFolder(f) : '-'}</div>;
                        })}
                        <div className="w-8 shrink-0">
                          {isDeletedView ? (
                            f.is_trash_root && (
                              <FileDropdown
                                onRestore={() => handleRestoreFolder(f)}
                                restoreDisabled={restoringIds.has(f.id)}
                                onDelete={() => setDeleteTarget({ id: f.id, name: f.name, type: 'folder', permanent: true, fileCount: f.file_count })}
                                deleteLabel="Delete permanently"
                              />
                            )
                          ) : (
                            <FileDropdown
                              onDownload={() => handleDownloadFolder(f.id)}
                              onRename={() => { setRenameTarget({ id: f.id, name: f.name, type: 'folder' }); setRenameName(f.name); }}
                              onMove={() => openMoveModal(f.id, 'folder')}
                              onDelete={() => setDeleteTarget({ id: f.id, name: f.name, type: 'folder' })}
                              onAddToGroup={() => openAddToGroup(f.id, f.name, 'folder')}
                            />
                          )}
                        </div>
                      </div>
                  ))}
                  {/* Table rows */}
                  {files.map((f) => {
                    const isActive = selectedFile?.id === f.id || highlightId === f.id;
                    const isSel = selected.has(f.id);
                    return (
                      <div
                        key={f.id}
                        id={`file-${f.id}`}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer group ${highlightId === f.id ? 'animate-upload-flash ' : ''}${isActive ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900' : isSel ? 'bg-primary/10' : ''}`}
                        onClick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) toggleSelect(f.id); else openFileWithLockCheck(f, 'detail'); }}
                        onContextMenu={(e) => onContextMenu(e, 'file', f)}
                      >
                        <SelectCheckbox
                          checked={isSel}
                          onCheckedChange={() => toggleSelect(f.id)}
                          className={`size-4 shrink-0 transition-all ${isSel ? '' : 'opacity-0 group-hover:opacity-100'} ${selected.size > 0 ? 'opacity-100!' : ''}`}
                        />
                        <RowThumbnail fileId={f.id} fileName={f.name} />
                        {activeColumns.map((col) => {
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
                          {isDeletedView ? (
                            <FileDropdown
                              onRestore={() => handleRestoreFile(f)}
                              restoreDisabled={restoringIds.has(f.id)}
                              onDelete={() => setDeleteTarget({ id: f.id, name: f.name, type: 'file', permanent: true })}
                              deleteLabel="Delete permanently"
                            />
                          ) : (
                            <FileDropdown
                              onDownload={() => handleDownload(f.id)}
                              onShare={() => openShare(f.id, f.name)}
                              onRename={() => { setRenameTarget({ id: f.id, name: f.name, type: 'file' }); setRenameName(f.name); }}
                              onDelete={() => setDeleteTarget({ id: f.id, name: f.name, type: 'file' })}
                              onCopy={() => handleCopy(f.id)}
                              onMove={() => openMoveModal(f.id, 'file')}
                              onAddToGroup={() => openAddToGroup(f.id, f.name, 'file')}
                            />
                          )}
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

      {/* Delete dialog - also drives the Deleted view's row-level "Delete
          permanently" for files and folders (deleteTarget.permanent), since
          it's the same single-item confirm flow with different copy and a
          destructive footer. Locked (Cancel/confirm disabled, close button
          hidden, backdrop/Escape no-op) while `deleting` is true, so a
          second click during the request can't send a follow-up DELETE that
          lands on the now-trashed item and silently purges it. */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm" showCloseButton={!deleting}>
          <DialogHeader><DialogTitle>{deleteTarget?.permanent ? 'Delete permanently?' : `Delete ${deleteTarget?.type}?`}</DialogTitle></DialogHeader>
          <p className={`text-sm ${deleteTarget?.permanent ? 'text-destructive' : 'text-muted-foreground'}`}>
            {deleteTarget?.permanent ? (
              <>
                Permanently delete <span className="font-semibold text-foreground break-all">{deleteTarget?.name}</span>
                {deleteTarget?.type === 'folder' && !!deleteTarget?.fileCount && ` and its ${deleteTarget.fileCount} file${deleteTarget.fileCount === 1 ? '' : 's'}`}
                ? This cannot be undone.
              </>
            ) : (
              <>Are you sure you want to delete <span className="font-semibold text-foreground break-all">{deleteTarget?.name}</span>?</>
            )}
          </p>
          {!deleteTarget?.permanent && (
            <p className="text-xs text-muted-foreground">It moves to the trash and keeps using storage until it's permanently deleted.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin mr-1.5" />}
              {deleteTarget?.permanent ? 'Delete permanently' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete dialog - covers both the normal bulk Delete and the
          Deleted view's irreversible "Delete permanently". Counts are read
          live from the selection rather than captured into
          `bulkDeleteConfirm`, so the numbers can never drift from what the
          confirm button actually deletes. */}
      <Dialog open={!!bulkDeleteConfirm} onOpenChange={() => setBulkDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {bulkDeleteConfirm?.permanent ? 'Delete permanently?' : 'Delete selected items?'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              {bulkDeleteConfirm?.permanent ? (
                <>
                  Permanently delete{' '}
                  <span className="font-semibold text-foreground">
                    {selected.size > 0 && `${selected.size} file${selected.size === 1 ? '' : 's'}`}
                    {selected.size > 0 && selectedFolders.size > 0 && ' and '}
                    {selectedFolders.size > 0 && `${selectedFolders.size} folder${selectedFolders.size === 1 ? '' : 's'}`}
                  </span>?
                </>
              ) : (
                <>
                  Delete{' '}
                  <span className="font-semibold text-foreground">
                    {selected.size > 0 && `${selected.size} file${selected.size === 1 ? '' : 's'}`}
                    {selected.size > 0 && selectedFolders.size > 0 && ' and '}
                    {selectedFolders.size > 0 && `${selectedFolders.size} folder${selectedFolders.size === 1 ? '' : 's'}`}
                  </span>?
                </>
              )}
            </p>
            {selectedFolders.size > 0 && (
              <p>
                {bulkDeleteConfirm?.permanent
                  ? `Everything inside the selected folder${selectedFolders.size === 1 ? '' : 's'} is permanently deleted too.`
                  : `Everything inside the selected folder${selectedFolders.size === 1 ? '' : 's'} is deleted too.`}
              </p>
            )}
            <p className={bulkDeleteConfirm?.permanent ? 'text-destructive' : undefined}>
              {bulkDeleteConfirm?.permanent
                ? 'This cannot be undone.'
                : 'You can restore these from the Deleted view. They keep using storage until permanently deleted.'}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={bulkDeleteConfirm?.permanent ? runBulkPermanentDelete : runBulkDelete}
            >
              {bulkDeleteConfirm?.permanent ? 'Delete permanently' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={() => setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename</DialogTitle></DialogHeader>
          {/* autoFocus alone put the caret at the end of the existing name, so
              renaming meant selecting or deleting the old one by hand first.
              Selecting the basename (not the extension) means typing replaces
              the name and keeps ".pdf" - the usual file-manager behaviour. */}
          <Input
            value={renameName}
            autoFocus
            ref={(el: HTMLInputElement | null) => {
              if (!el || el.dataset.selected === renameName) return;
              el.dataset.selected = renameName;
              const dot = renameName.lastIndexOf('.');
              el.setSelectionRange(0, dot > 0 ? dot : renameName.length);
            }}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
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
          selectedId={null}
          onSelect={(id) => handleMove(id)}
          title="Move to folder"
          confirmLabel="Move"
          excludeId={moveOpen.type === 'folder' ? moveOpen.id : null}
        />
      )}

      {/* Bulk move dialog */}
      {bulkMoveOpen && (
        <FolderPickerDialog
          open
          onClose={() => setBulkMoveOpen(false)}
          workspaceId={wsId}
          selectedId={null}
          onSelect={(id) => applyBulkMove(id)}
          title="Move to folder"
          confirmLabel="Move"
          excludeId={null}
        />
      )}

      {/* Share modal */}
      <ShareModal
        open={!!shareTarget}
        fileIds={shareTarget?.ids ?? []}
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
        // Hiding/unhiding can drop the row out of the current view (the
        // default listing excludes hidden items; the Hidden filter shows only
        // them) - clear explicitly so a stale id can't linger in the selection.
        onDone={() => { clearSelection(); loadFiles(); }}
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
                    // Adding goes through POST /api/groups/:id with a body -
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
      <Dialog open={!!unlockPrompt} onOpenChange={() => closeUnlockPrompt()}>
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
            <Button variant="outline" onClick={closeUnlockPrompt}>Cancel</Button>
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
          onNavigate={(f) => {
            // Arrow-key / prev-next navigation has to clear the same lock gate
            // as opening a file directly. This used to assign the file
            // straight into the viewer, so stepping onto a full-locked file
            // displayed it without ever asking for the password.
            const next = f as FileItem;
            if (next.lock_mode === 'full_lock' && !unlockedFiles.has(next.id)) {
              setViewerFile(null);
              setUnlockPrompt({ file: next, action: 'view' });
              setUnlockPassword('');
              setUnlockError('');
              return;
            }
            setViewerFile(next);
          }}
          onRefresh={loadFiles}
        />
      )}
      </div>{/* end main content */}
    </div>
  );
}

// ── Folder Card ────────────────────────────────────────────

function FolderCard({ folder, selected, anySelected, onClick, onSelect, onContextMenu, onPrefetch, onPrefetchCancel }: {
  folder: FolderItem; selected?: boolean; anySelected?: boolean;
  onClick: (e: ReactMouseEvent) => void; onSelect: () => void; onContextMenu: (e: ReactMouseEvent) => void;
  onPrefetch: () => void; onPrefetchCancel: () => void;
}) {
  const iconSrc = folderIconSrc(folder.file_count, !!folder.is_synced);

  return (
    <Card className={`gap-0 py-0 p-3 hover:shadow-md hover:-translate-y-px transition-all cursor-pointer group relative ${selected ? 'ring-2 ring-primary' : ''}`} onClick={onClick} onContextMenu={onContextMenu} onMouseEnter={onPrefetch} onMouseLeave={onPrefetchCancel}>
      <SelectCheckbox
        checked={!!selected}
        onCheckedChange={() => onSelect()}
        className={`absolute top-2 right-2 z-20 size-4 transition-all ${selected ? '' : 'opacity-0 group-hover:opacity-100'} ${anySelected ? 'opacity-100!' : ''}`}
      />
      <div className="flex items-center gap-2 mb-2">
        <span className="relative">
          <img src={iconSrc} alt="" className="size-6" />
          <OriginBadge origin={folder.origin} />
        </span>
        {folder.lock_mode !== 'none' && <Lock className="size-3 text-muted-foreground ml-auto" />}
      </div>
      <p className="text-xs font-medium truncate">{folder.name}</p>
      <p className="text-[10px] text-muted-foreground">{folder.file_count} files</p>
    </Card>
  );
}

// ── File Card ──────────────────────────────────────────────

function FileCard({ file, view, selected, anySelected, active, highlight, domId, isFavourite, trashed, onClick, onSelect, onNameClick, onContextMenu, onDownload, onShare, onRename, onDelete, onCopy, onMove, onFavourite, onComments, onRestore, restoreDisabled }: {
  file: FileItem; view: ViewMode; selected: boolean; anySelected?: boolean; active?: boolean; highlight?: boolean; domId?: string; isFavourite?: boolean;
  /** Trash view - the card offers only Restore/Delete permanently (see the
   * dropdown below); Download/Share/Rename/Copy/Move/favourite are hidden. */
  trashed?: boolean;
  onClick: (e: ReactMouseEvent) => void; onSelect: () => void; onNameClick: () => void; onContextMenu: (e: ReactMouseEvent) => void;
  onDownload?: () => void; onShare?: () => void; onRename?: () => void; onDelete: () => void; onCopy?: () => void; onMove?: () => void; onFavourite?: () => void; onComments?: () => void;
  onRestore?: () => void; restoreDisabled?: boolean;
}) {
  const ext = extOf(file.name).toUpperCase() || 'FILE';

  if (view === 'list') {
    return (
      <div id={domId} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 cursor-pointer group ${highlight ? 'animate-upload-flash ' : ''}${active ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900' : selected ? 'bg-primary/10' : ''}`} onClick={onClick} onContextMenu={onContextMenu}>
        <SelectCheckbox
          checked={selected}
          onCheckedChange={() => onSelect()}
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
        {trashed ? (
          <FileDropdown onRestore={onRestore} restoreDisabled={restoreDisabled} onDelete={onDelete} deleteLabel="Delete permanently" />
        ) : (
          <FileDropdown onDownload={onDownload} onShare={onShare} onRename={onRename} onDelete={onDelete} onCopy={onCopy} onMove={onMove} />
        )}
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
        <SelectCheckbox
          checked={selected}
          onCheckedChange={() => onSelect()}
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

      {/* Right vertical action rail: trashed → just the Restore/Delete
          permanently dropdown; live → favourite · (comments) · share · settings */}
      <div className="absolute right-2 bottom-2 z-20 flex flex-col gap-2 opacity-90 group-hover:opacity-100 transition-opacity">
        {!trashed && (
          <>
            {/* Favourite (single star - the app's favourite flag) */}
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
                title={`${file.comment_count} comment${file.comment_count === 1 ? '' : 's'} - open`}
                onClick={(e) => { e.stopPropagation(); onComments?.(); }}
              >
                <MessageSquare className="size-4 text-white" />
                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-blue-500 text-[9px] font-mono text-white flex items-center justify-center">{file.comment_count}</span>
              </button>
            )}
            {/* Share */}
            <button
              className="flex items-center justify-center size-8 rounded-full bg-black/35 hover:bg-black/55 backdrop-blur-sm transition-colors"
              title={file.share_count > 0 ? `Shared (${file.share_count}) - manage` : 'Share'}
              onClick={(e) => { e.stopPropagation(); onShare?.(); }}
            >
              <Share2 className={`size-4 ${file.share_count > 0 ? 'text-green-400' : 'text-white'}`} />
            </button>
          </>
        )}
        {/* Settings / more */}
        <div onClick={(e) => e.stopPropagation()}>
          {trashed ? (
            <FileDropdown overlay onRestore={onRestore} restoreDisabled={restoreDisabled} onDelete={onDelete} deleteLabel="Delete permanently" />
          ) : (
            <FileDropdown overlay onDownload={onDownload} onShare={onShare} onRename={onRename} onDelete={onDelete} onCopy={onCopy} onMove={onMove} />
          )}
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

// memo'd on purpose: this is the per-row image, and the page re-renders on
// every one of its many state changes (typing, opening a dialog, selecting).
// Its props are primitives, so the comparison is free and always correct.
const RowThumbnail = memo(function RowThumbnail({ fileId, fileName }: { fileId: string; fileName: string }) {
  return (
    <FilePreviewImage
      fileId={fileId}
      fileName={fileName}
      size={128}
      className="w-7 h-7 shrink-0 rounded object-cover bg-muted"
      fallback={<img src={fileIconSrc(fileName)} alt="" className="w-7 h-7 shrink-0" />}
    />
  );
});

// ── File thumbnail with error fallback ─────────────────────

const FileThumbnail = memo(function FileThumbnail({ fileId, fileName, ext }: { fileId: string; fileName: string; ext: string }) {
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
});

// ── Dropdown menu (three dots) ─────────────────────────────

function FileDropdown({ onDownload, onShare, onRename, onDelete, onCopy, onMove, onAddToGroup, onRestore, restoreDisabled, deleteLabel = 'Delete', overlay }: {
  onDownload?: () => void; onShare?: () => void; onRename?: () => void; onDelete: () => void; onCopy?: () => void; onMove?: () => void; onAddToGroup?: () => void;
  /** Trashed rows (file or folder) pass this instead of onRename/onMove/etc - see deleteLabel for the matching "Delete permanently" copy. */
  onRestore?: () => void; restoreDisabled?: boolean; deleteLabel?: string; overlay?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        {overlay
          ? <button className="flex items-center justify-center size-7 rounded-full bg-white/10 hover:bg-white/25 backdrop-blur-sm transition-colors" title="More" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="size-4 text-white" /></button>
          : <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="size-3.5" /></button>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onRestore && <DropdownMenuItem disabled={restoreDisabled} onClick={onRestore}><RotateCcw className="size-3 mr-2" /> Restore</DropdownMenuItem>}
        {onDownload && <DropdownMenuItem onClick={onDownload}><Download className="size-3 mr-2" /> Download</DropdownMenuItem>}
        {onShare && <DropdownMenuItem onClick={onShare}><Share2 className="size-3 mr-2" /> Share</DropdownMenuItem>}
        {onCopy && <DropdownMenuItem onClick={onCopy}><Copy className="size-3 mr-2" /> Copy</DropdownMenuItem>}
        {onMove && <DropdownMenuItem onClick={onMove}><Move className="size-3 mr-2" /> Move to...</DropdownMenuItem>}
        {onAddToGroup && <DropdownMenuItem onClick={onAddToGroup}><FolderPlus className="size-3 mr-2" /> Add to group</DropdownMenuItem>}
        {onRename && <DropdownMenuItem onClick={onRename}><Pencil className="size-3 mr-2" /> Rename</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="size-3 mr-2" /> {deleteLabel}</DropdownMenuItem>
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
