import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
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
  Loader2,
} from 'lucide-react';
import { toast } from '@/lib/toast';

interface FavFile { file_id: string; file_name: string }
interface GroupFolder { folder_id: string; folder_name: string }
interface GroupFile { file_id: string; file_name: string; folder_id: string | null }
interface Group { id: string; name: string; color: string; folders: GroupFolder[]; files: GroupFile[] }

type Filter = 'all' | 'documents' | 'videos' | 'images' | 'shared' | 'deleted' | 'hidden';

const NAV_ITEMS: { value: Filter; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All', icon: <Files className="size-4" /> },
  { value: 'documents', label: 'Documents', icon: <FileText className="size-4" /> },
  { value: 'videos', label: 'Videos', icon: <Video className="size-4" /> },
  { value: 'images', label: 'Images', icon: <Image className="size-4" /> },
  { value: 'shared', label: 'Shared', icon: <Share2 className="size-4" /> },
  { value: 'deleted', label: 'Deleted', icon: <Trash2 className="size-4" /> },
  { value: 'hidden', label: 'Hidden', icon: <EyeOff className="size-4" /> },
];

const GROUP_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#6366f1',
];

interface FilesSidebarProps {
  onFilterChange: (filter: string) => void;
  onFavouriteClick: (fileId: string) => void;
  onGroupClick: (groupId: string) => void;
}

export function FilesSidebar({ onFilterChange, onFavouriteClick, onGroupClick }: FilesSidebarProps) {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentFilter = (searchParams.get('filter') || 'all') as Filter;

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('dosya_fs_sidebar_collapsed') === '1');
  const [favourites, setFavourites] = useState<FavFile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [fileRequestCount, setFileRequestCount] = useState(0);

  // Group modal
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);
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
      toast.success('Group created', 'Your new group is ready to use.');
      loadGroups();
      setGroupModalOpen(false);
      setNewGroupName('');
      setNewGroupColor(GROUP_COLORS[0]);
    } catch { toast.error('Group failed', 'Failed to create group.'); }
    setCreatingGroup(false);
  };

  const handleDeleteGroup = async () => {
    if (!deleteGroupTarget) return;
    setDeletingGroup(true);
    try {
      await api(`/api/groups/${deleteGroupTarget.id}`, { method: 'DELETE' });
      toast.success('Group deleted', 'The group has been removed.');
      loadGroups();
      setDeleteGroupTarget(null);
    } catch { toast.error('Delete failed', 'The group could not be deleted.'); }
    setDeletingGroup(false);
  };

  const handleRemoveFavourite = async (fileId: string) => {
    try {
      await api(`/api/favourites?workspace_id=${wsId}&file_id=${fileId}`, { method: 'DELETE' });
      loadFavourites();
      // Sync the files page's star icons (it keeps its own favourites state)
      window.dispatchEvent(new Event('dosya:favourites-changed'));
    } catch { toast.error('Remove failed', 'Could not remove from favourites.'); }
  };

  return (
    <>
      <div className={`${collapsed ? 'w-12' : 'w-48'} shrink-0 border-r md:flex flex-col overflow-hidden transition-all duration-200 hidden`}>
        {/* Collapse toggle */}
        <div className="flex items-center justify-end px-2 py-2 shrink-0">
          <button onClick={toggleCollapse} className="size-6 rounded flex items-center justify-center hover:bg-muted" title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronLeft className="size-3.5 text-muted-foreground" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="px-1.5 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.value}
              onClick={() => onFilterChange(item.value === 'all' ? '' : item.value)}
              className={`w-full flex items-center rounded-md text-xs transition-colors ${collapsed ? 'justify-center py-2' : 'gap-2.5 px-2.5 py-1.5'} ${
                currentFilter === item.value ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <span className={collapsed ? '[&>svg]:size-4.5' : ''}>{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          ))}

          <button
            onClick={() => navigate('/file-requests')}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            title={collapsed ? 'File requests' : undefined}
          >
            <FileInput className="size-4" />
            {!collapsed && (
              <>
                <span className="truncate flex-1 text-left">File requests</span>
                {fileRequestCount > 0 && (
                  <span className="text-[9px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-px">{fileRequestCount}</span>
                )}
              </>
            )}
          </button>
        </nav>

        {!collapsed && (
          <div className="flex-1 overflow-y-auto mt-3">
            <div className="mx-3 border-t mb-3" />

            {/* Favourites */}
            <div className="px-3 mb-4">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Star className="size-3 text-muted-foreground" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Favourites</span>
              </div>
              {favourites.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/60 pl-4.5">No favourites yet</p>
              ) : (
                <div className="space-y-0.5">
                  {favourites.map((f) => (
                    <div key={f.file_id} className="group/fav flex items-center gap-1 rounded hover:bg-muted/50">
                      <button
                        onClick={() => onFavouriteClick(f.file_id)}
                        className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground flex-1 min-w-0 text-left"
                      >
                        <Star className="size-2.5 text-orange-400 fill-orange-400 shrink-0" />
                        <span className="truncate">{f.file_name}</span>
                      </button>
                      <button
                        onClick={() => handleRemoveFavourite(f.file_id)}
                        className="opacity-0 group-hover/fav:opacity-100 shrink-0 px-1"
                        title="Remove favourite"
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
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">Groups</span>
                <button
                  onClick={() => setGroupModalOpen(true)}
                  className="size-4 rounded flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="New group"
                >
                  <Plus className="size-3" />
                </button>
              </div>
              {groups.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/60 pl-4.5">No groups yet</p>
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
                            className={`shrink-0 pl-1.5 py-1 ${itemCount === 0 ? 'cursor-default' : 'text-muted-foreground hover:text-foreground'}`}
                            title={itemCount === 0 ? 'Empty group' : isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {itemCount > 0 ? (
                              <ChevronRight className={`size-2.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            ) : (
                              <span className="block size-2.5" />
                            )}
                          </button>
                          <button
                            onClick={() => onGroupClick(g.id)}
                            className="flex items-center gap-1.5 pr-2 py-1 flex-1 min-w-0 text-left text-[11px] text-muted-foreground hover:text-foreground"
                            title="Open group"
                          >
                            <div className="size-2.5 rounded-full shrink-0" style={{ background: g.color || '#a0a0a0' }} />
                            <span className="truncate flex-1">{g.name}</span>
                            <span className="text-[9px] text-muted-foreground/60">{itemCount}</span>
                          </button>
                          <button
                            className="opacity-0 group-hover/grp:opacity-100 shrink-0 px-1"
                            onClick={() => setDeleteGroupTarget(g)}
                            title="Delete group"
                          >
                            <X className="size-3 text-muted-foreground hover:text-destructive" />
                          </button>
                        </div>
                        {/* Expanded contents: folders then files */}
                        {isExpanded && (
                          <div className="ml-4 border-l pl-1.5 space-y-0.5 py-0.5">
                            {g.folders.map((f) => (
                              <button
                                key={f.folder_id}
                                onClick={() => navigate(`/files?folder=${f.folder_id}`)}
                                className="w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 text-left"
                              >
                                <FolderOpen className="size-2.5 shrink-0" />
                                <span className="truncate">{f.folder_name}</span>
                              </button>
                            ))}
                            {g.files.map((f) => (
                              <button
                                key={f.file_id}
                                onClick={() => onFavouriteClick(f.file_id)}
                                className="w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 text-left"
                                title="Open file"
                              >
                                <FilePreviewImage
                                  fileId={f.file_id}
                                  fileName={f.file_name}
                                  maxDim={128}
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
            <DialogTitle>New group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Name</Label>
              <Input
                value={newGroupName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                placeholder="e.g. Brand Assets"
                className="h-9 text-sm"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Color</Label>
              <div className="flex flex-wrap gap-2">
                {GROUP_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewGroupColor(c)}
                    className={`size-7 rounded-full transition-all ${newGroupColor === c ? 'ring-2 ring-offset-2 ring-foreground scale-110' : 'hover:scale-110'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateGroup} disabled={creatingGroup || !newGroupName.trim()}>
              {creatingGroup && <Loader2 className="size-4 animate-spin mr-1.5" />}
              Create group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete group confirmation */}
      <Dialog open={!!deleteGroupTarget} onOpenChange={(v) => { if (!v) setDeleteGroupTarget(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Delete group</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Delete <span className="font-semibold text-foreground">{deleteGroupTarget?.name}</span>?
            {' '}Files and folders in it are not deleted — only the group itself.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteGroupTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteGroup} disabled={deletingGroup}>
              {deletingGroup && <Loader2 className="size-4 animate-spin mr-1.5" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
