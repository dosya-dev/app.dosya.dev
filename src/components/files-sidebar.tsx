import { Fragment, useState, useEffect, useCallback } from 'react';
import { localDigits } from '@/lib/format-locale';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '@/api/client';
import { fileIconSrc } from '@/lib/helpers';
import { FilePreviewImage } from '@/components/file-preview-image';
import { useWorkspace } from '@/stores/workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Files, FileText, Video, Image, Share2, Trash2, EyeOff,
  FileInput, Star, FolderOpen, ChevronLeft, ChevronRight, Plus, X,
  Loader2, MapPin, ScanFace,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { SwatchPicker } from '@/components/brand/swatch-picker';
import { SWATCHES } from '@/lib/palette';
import { usePermissions } from '@/hooks/use-permissions';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import { usePersonasVisible } from '@/hooks/use-personas-access';

interface FavFile { file_id: string; file_name: string }
interface GroupFolder { folder_id: string; folder_name: string }
interface GroupFile { file_id: string; file_name: string; folder_id: string | null }
interface Group { id: string; name: string; color: string; folders: GroupFolder[]; files: GroupFile[] }

type Filter = 'all' | 'documents' | 'videos' | 'images' | 'shared' | 'deleted' | 'hidden';

// Holds message KEYS; the sidebar translates them at render.
const NAV_ITEMS: { value: Filter; labelKey: 'common.label.all' | 'common.label.documents.documents' | 'common.label.videos' | 'common.label.images' | 'common.label.shared' | 'common.label.deleted' | 'common.label.hidden'; icon: React.ReactNode }[] = [
  { value: 'all', labelKey: 'common.label.all', icon: <Files className="size-4" /> },
  { value: 'documents', labelKey: 'common.label.documents.documents', icon: <FileText className="size-4" /> },
  { value: 'videos', labelKey: 'common.label.videos', icon: <Video className="size-4" /> },
  { value: 'images', labelKey: 'common.label.images', icon: <Image className="size-4" /> },
  { value: 'shared', labelKey: 'common.label.shared', icon: <Share2 className="size-4" /> },
  { value: 'deleted', labelKey: 'common.label.deleted', icon: <Trash2 className="size-4" /> },
  { value: 'hidden', labelKey: 'common.label.hidden', icon: <EyeOff className="size-4" /> },
];

interface FilesSidebarProps {
  onFilterChange: (filter: string) => void;
  onFavouriteClick: (fileId: string) => void;
  onGroupClick: (groupId: string) => void;
  /**
   * Drag-to-move: a group's folder rows accept items dragged from the files
   * page. The page owns the drag and decides which rows are valid.
   */
  folderDrop?: {
    targetProps: (target: { id: string; name: string }) => React.HTMLAttributes<HTMLElement>;
    isOver: (folderId: string) => boolean;
  };
}

export function FilesSidebar({ onFilterChange, onFavouriteClick, onGroupClick, folderDrop }: FilesSidebarProps) {
  const t = useT();
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  // The Deleted row opens GET /api/files?deleted=1, which the server refuses
  // to a role holding neither delete permission - nothing such a role could
  // restore or purge in there. Optimistic while the map loads (see the hook).
  const { can, isResolved } = usePermissions();
  const canSeeTrash = can('delete_own_files') || can('delete_any_file');
  // Personas runs on each member's own devices, free on every plan: the row
  // shows for every role that may see files (the /personas route's gate).
  const showPersonas = usePersonasVisible(isResolved && can('access_files'));
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const currentFilter = (searchParams.get('filter') || 'all') as Filter;
  // This sidebar renders on /files, /file-requests, /map and /personas. The filter rows
  // are views of /files, so they only light while standing there - otherwise
  // "All" (the ?filter= default) claims to be where you are from every page.
  const onFilesPage = location.pathname === '/files';
  const onRequestsPage = location.pathname.startsWith('/file-requests');
  const onMapPage = location.pathname === '/map';
  const onPersonasPage = location.pathname === '/personas' || location.pathname.startsWith('/personas/');

  const ROW_ACTIVE = 'bg-muted font-semibold text-foreground';
  const ROW_IDLE = 'text-muted-foreground hover:bg-muted/50 hover:text-foreground';

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('dosya_fs_sidebar_collapsed') === '1');
  const [favourites, setFavourites] = useState<FavFile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [fileRequestCount, setFileRequestCount] = useState(0);

  // Group modal
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(SWATCHES[0].light);
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Delete group (confirmation modal)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<Group | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);

  // Expanded groups (collapse style: clicking a group name shows its contents)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroupExpanded = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const loadFavourites = useCallback(async () => {
    if (!wsId) return;
    try {
      const data = await api<{ ok: boolean; files?: FavFile[] }>(`/api/favourites?workspace_id=${wsId}`);
      if (data.ok && data.files) setFavourites(data.files);
    } catch {}
  }, [wsId]);

  const loadGroups = useCallback(async () => {
    if (!wsId) return;
    try {
      const data = await api<{ ok: boolean; groups?: Group[] }>(`/api/groups?workspace_id=${wsId}`);
      if (data.ok && data.groups) setGroups(data.groups);
    } catch {}
  }, [wsId]);

  const loadFileRequestCount = useCallback(async () => {
    if (!wsId) return;
    try {
      const data = await api<{ ok: boolean; total?: number }>(`/api/file-requests?workspace_id=${wsId}&count_only=1`);
      if (data.ok && data.total) setFileRequestCount(data.total);
    } catch {}
  }, [wsId]);

  useEffect(() => {
    loadFavourites();
    loadGroups();
    loadFileRequestCount();
  }, [loadFavourites, loadGroups, loadFileRequestCount]);

  // Live-refresh when the files page mutates favourites/groups (separate state)
  useEffect(() => {
    const onFavs = () => loadFavourites();
    const onGroups = () => loadGroups();
    window.addEventListener('dosya:favourites-changed', onFavs);
    window.addEventListener('dosya:groups-changed', onGroups);
    return () => {
      window.removeEventListener('dosya:favourites-changed', onFavs);
      window.removeEventListener('dosya:groups-changed', onGroups);
    };
  }, [loadFavourites, loadGroups]);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('dosya_fs_sidebar_collapsed', next ? '1' : '0');
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    try {
      await api('/api/groups', { method: 'POST', body: JSON.stringify({ workspace_id: wsId, name: newGroupName.trim(), color: newGroupColor }) });
      toast.success(t('common.feedback.groupCreated'), t('common.feedback.yourNewGroupIsReadyToUse'));
      loadGroups();
      setGroupModalOpen(false);
      setNewGroupName('');
      setNewGroupColor(SWATCHES[0].light);
    } catch { toast.error(t('common.error.groupFailed'), t('common.error.failedToCreateGroup')); }
    setCreatingGroup(false);
  };

  const handleDeleteGroup = async () => {
    if (!deleteGroupTarget) return;
    setDeletingGroup(true);
    try {
      await api(`/api/groups/${deleteGroupTarget.id}`, { method: 'DELETE' });
      toast.success(t('common.feedback.groupDeleted'), t('common.feedback.theGroupHasBeenRemoved'));
      loadGroups();
      setDeleteGroupTarget(null);
    } catch { toast.error(t('common.error.deleteFailed'), t('common.error.theGroupCouldNotBeDeleted')); }
    setDeletingGroup(false);
  };

  const handleRemoveFavourite = async (fileId: string) => {
    try {
      await api(`/api/favourites?workspace_id=${wsId}&file_id=${fileId}`, { method: 'DELETE' });
      loadFavourites();
      // Sync the files page's star icons (it keeps its own favourites state)
      window.dispatchEvent(new Event('dosya:favourites-changed'));
    } catch { toast.error(t('common.error.removeFailed'), t('common.error.couldNotRemoveFromFavourites')); }
  };

  return (
    <>
      <div className={`${collapsed ? 'w-12' : 'w-48'} shrink-0 border-e md:flex flex-col overflow-hidden transition-all duration-200 hidden`}>
        {/* Collapse toggle */}
        <div className="flex items-center justify-end px-2 py-2 shrink-0">
          <button onClick={toggleCollapse} className="size-6 rounded flex items-center justify-center hover:bg-muted" title={collapsed ? t('common.action.expand') : t('common.action.collapse')}>
            {collapsed ? <ChevronRight className="size-3.5 text-muted-foreground rtl:-scale-x-100" /> : <ChevronLeft className="size-3.5 text-muted-foreground rtl:-scale-x-100" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="px-1.5 space-y-0.5">
          {NAV_ITEMS.filter((item) => item.value !== 'deleted' || canSeeTrash).map((item) => (
            <Fragment key={item.value}>
              <button
                onClick={() => onFilterChange(item.value === 'all' ? '' : item.value)}
                className={`w-full flex items-center rounded-md text-xs transition-colors ${collapsed ? 'justify-center py-2' : 'gap-2.5 px-2.5 py-1.5'} ${
                  onFilesPage && currentFilter === item.value ? ROW_ACTIVE : ROW_IDLE
                }`}
                title={collapsed ? t(item.labelKey) : undefined}
              >
                <span className={collapsed ? '[&>svg]:size-4.5' : ''}>{item.icon}</span>
                {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
              </button>
              {/* Personas: after Images, before Shared (its own page, like File requests and Map). */}
              {item.value === 'images' && showPersonas && (
                <button
                  onClick={() => navigate('/personas')}
                  className={`w-full flex items-center rounded-md text-xs transition-colors ${collapsed ? 'justify-center py-2' : 'gap-2.5 px-2.5 py-1.5'} ${onPersonasPage ? ROW_ACTIVE : ROW_IDLE}`}
                  title={collapsed ? t('common.label.personas') : undefined}
                >
                  <span className={collapsed ? '[&>svg]:size-4.5' : ''}><ScanFace className="size-4" /></span>
                  {!collapsed && <span className="truncate flex-1 text-start">{t('common.label.personas')}</span>}
                </button>
              )}
            </Fragment>
          ))}

          <button
            onClick={() => navigate('/file-requests')}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${onRequestsPage ? ROW_ACTIVE : ROW_IDLE}`}
            title={collapsed ? t('common.label.fileRequests.fileRequests') : undefined}
          >
            <FileInput className="size-4" />
            {!collapsed && (
              <>
                <span className="truncate flex-1 text-start">{t('common.label.fileRequests.fileRequests')}</span>
                {fileRequestCount > 0 && (
                  <span className="text-[9px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-px">{localDigits(fileRequestCount)}</span>
                )}
              </>
            )}
          </button>

          <button
            onClick={() => navigate('/map')}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${onMapPage ? ROW_ACTIVE : ROW_IDLE}`}
            title={collapsed ? t('common.label.map.map') : undefined}
          >
            <MapPin className="size-4" />
            {!collapsed && <span className="truncate flex-1 text-start">{t('common.label.map.map')}</span>}
          </button>
        </nav>

        {!collapsed && (
          <div className="flex-1 overflow-y-auto mt-3">
            <div className="mx-3 border-t mb-3" />

            {/* Favourites */}
            <div className="px-3 mb-4">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Star className="size-3 text-muted-foreground" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('common.label.favourites')}</span>
              </div>
              {favourites.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/60 ps-4.5">{t('common.label.noFavouritesYet')}</p>
              ) : (
                <div className="space-y-0.5">
                  {favourites.map((f) => (
                    <div key={f.file_id} className="group/fav flex items-center gap-1 rounded hover:bg-muted/50">
                      <button
                        onClick={() => onFavouriteClick(f.file_id)}
                        className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground flex-1 min-w-0 text-start"
                      >
                        <Star className="size-2.5 text-orange-400 fill-orange-400 shrink-0" />
                        <span className="truncate">{f.file_name}</span>
                      </button>
                      <button
                        onClick={() => handleRemoveFavourite(f.file_id)}
                        className="opacity-0 group-hover/fav:opacity-100 shrink-0 px-1"
                        title={t('common.label.removeFavourite')}
                      >
                        <X className="size-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Groups */}
            <div className="px-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <FolderOpen className="size-3 text-muted-foreground" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">{t('common.heading.groups')}</span>
                <button
                  onClick={() => setGroupModalOpen(true)}
                  className="size-4 rounded flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground"
                  title={t('common.action.newGroup')}
                >
                  <Plus className="size-3" />
                </button>
              </div>
              {groups.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/60 ps-4.5">{t('common.empty.noGroupsYet')}</p>
              ) : (
                <div className="space-y-0.5">
                  {groups.map((g) => {
                    const itemCount = g.folders.length + g.files.length;
                    const isExpanded = expandedGroups.has(g.id);
                    return (
                      <div key={g.id}>
                        <div className="group/grp flex items-center gap-0.5 rounded hover:bg-muted/50">
                          <button
                            onClick={() => { if (itemCount > 0) toggleGroupExpanded(g.id); }}
                            className={`shrink-0 ps-1.5 py-1 ${itemCount === 0 ? 'cursor-default' : 'text-muted-foreground hover:text-foreground'}`}
                            title={itemCount === 0 ? t('common.action.emptyGroup') : isExpanded ? t('common.action.collapse') : t('common.action.expand')}
                          >
                            {itemCount > 0 ? (
                              <ChevronRight className={`size-2.5 transition-transform ${isExpanded ? 'rotate-90' : 'rtl:rotate-180'}`} />
                            ) : (
                              <span className="block size-2.5" />
                            )}
                          </button>
                          <button
                            onClick={() => onGroupClick(g.id)}
                            className="flex items-center gap-1.5 pe-2 py-1 flex-1 min-w-0 text-start text-[11px] text-muted-foreground hover:text-foreground"
                            title={t('common.action.openGroup')}
                          >
                            <div className="size-2.5 rounded-full shrink-0" style={{ background: g.color || '#a0a0a0' }} />
                            <span className="truncate flex-1">{g.name}</span>
                            <span className="text-[9px] text-muted-foreground/60">{localDigits(itemCount)}</span>
                          </button>
                          <button
                            className="opacity-0 group-hover/grp:opacity-100 shrink-0 px-1"
                            onClick={() => setDeleteGroupTarget(g)}
                            title={t('common.action.deleteGroup')}
                          >
                            <X className="size-3 text-muted-foreground hover:text-destructive" />
                          </button>
                        </div>
                        {/* Expanded contents: folders then files */}
                        {isExpanded && (
                          <div className="ms-4 border-s ps-1.5 space-y-0.5 py-0.5">
                            {g.folders.map((f) => (
                              <button
                                key={f.folder_id}
                                onClick={() => navigate(`/files?folder=${f.folder_id}`)}
                                {...folderDrop?.targetProps({ id: f.folder_id, name: f.folder_name })}
                                className={`w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 text-start ${folderDrop?.isOver(f.folder_id) ? 'text-foreground bg-primary/10 ring-2 ring-inset ring-primary' : ''}`}
                              >
                                <FolderOpen className="size-2.5 shrink-0" />
                                <span className="truncate">{f.folder_name}</span>
                              </button>
                            ))}
                            {g.files.map((f) => (
                              <button
                                key={f.file_id}
                                onClick={() => onFavouriteClick(f.file_id)}
                                className="w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 text-start"
                                title={t('common.action.openFile')}
                              >
                                <FilePreviewImage
                                  fileId={f.file_id}
                                  fileName={f.file_name}
                                  size={128}
                                  className="size-3.5 rounded-sm object-cover shrink-0 bg-muted"
                                  fallback={<img src={fileIconSrc(f.file_name)} alt="" className="size-3.5 shrink-0" />}
                                />
                                <span className="truncate">{f.file_name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create group modal */}
      <Dialog open={groupModalOpen} onOpenChange={setGroupModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('common.heading.newGroup')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('common.label.name')}</Label>
              <Input
                value={newGroupName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                placeholder={t('common.placeholder.eGBrandAssets')}
                className="h-9 text-sm"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('common.label.color')}</Label>
              <SwatchPicker value={newGroupColor} onChange={setNewGroupColor} label={t('common.label.groupColour')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupModalOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleCreateGroup} disabled={creatingGroup || !newGroupName.trim()}>
              {creatingGroup && <Loader2 className="size-4 animate-spin me-1.5" />}
              {t('common.action.createGroup')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete group confirmation */}
      <Dialog open={!!deleteGroupTarget} onOpenChange={(v) => { if (!v) setDeleteGroupTarget(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{t('common.heading.deleteGroup')}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {richText(t('common.description.deleteDeletegrouptargetnameFilesAndFoldersInItAreNotDeleted'), { deleteGroupTargetName: <span className="font-semibold text-foreground">{deleteGroupTarget?.name}</span> })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteGroupTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleDeleteGroup} disabled={deletingGroup}>
              {deletingGroup && <Loader2 className="size-4 animate-spin me-1.5" />}
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
