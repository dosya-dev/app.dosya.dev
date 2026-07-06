import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Search, Share2, FileInput,
} from 'lucide-react';
import {
  humanSize, timeAgo, isImage, fileIconSrc, folderIconSrc,
} from '@/lib/helpers';


// ── Types ─────────────────────────────────────────────────

interface FileResult {
  id: string; name: string; size_bytes: number; mime_type: string;
  extension: string; region: string; folder_id: string | null;
  uploaded_by: string; created_at: number; uploader_name: string | null;
}
interface FolderResult {
  id: string; name: string; parent_id: string | null;
  created_at: number; file_count: number;
}
interface SharedResult {
  link_id: string; token: string; expires_at: number | null;
  view_count: number; download_count: number; is_revoked: number;
  shared_at: number; file_id: string; file_name: string;
  size_bytes: number; extension: string | null; region: string;
  sharer_name: string | null; folder_id: string | null;
  folder_name: string | null; status: string;
}
interface RequestResult {
  id: string; token: string; title: string; message: string;
  expires_at: number | null; upload_count: number; is_revoked: number;
  created_at: number; created_by_name: string | null;
}

type Tab = 'all' | 'files' | 'folders' | 'shared' | 'file_requests';

// ── Page ──────────────────────────────────────────────────

export default function SearchPage() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';

  const [tab, setTab] = useState<Tab>('all');
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<FileResult[]>([]);
  const [folders, setFolders] = useState<FolderResult[]>([]);
  const [shared, setShared] = useState<SharedResult[]>([]);
  const [requests, setRequests] = useState<RequestResult[]>([]);
  const [counts, setCounts] = useState({ files: 0, folders: 0, shared: 0, requests: 0 });

  const doSearch = useCallback(async () => {
    if (!wsId || !query) return;
    setLoading(true);
    try {
      const data = await api<{
        ok: boolean;
        files: FileResult[];
        folders: FolderResult[];
        shared: SharedResult[];
        file_requests: RequestResult[];
        pagination: { total_files: number; total_folders: number; total_shares: number; total_requests: number };
      }>(`/api/search?workspace_id=${wsId}&q=${encodeURIComponent(query)}&per_page=50`);
      if (data.ok) {
        setFiles(data.files);
        setFolders(data.folders);
        setShared(data.shared);
        setRequests(data.file_requests);
        setCounts({
          files: data.pagination.total_files,
          folders: data.pagination.total_folders,
          shared: data.pagination.total_shares,
          requests: data.pagination.total_requests,
        });
      }
    } catch {}
    setLoading(false);
  }, [wsId, query]);

  useEffect(() => { doSearch(); }, [doSearch]);

  const totalCount = counts.files + counts.folders + counts.shared + counts.requests;

  const TABS: { value: Tab; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: totalCount },
    { value: 'files', label: 'Files', count: counts.files },
    { value: 'folders', label: 'Folders', count: counts.folders },
    { value: 'shared', label: 'Shared', count: counts.shared },
    { value: 'file_requests', label: 'File requests', count: counts.requests },
  ];

  const showFiles = tab === 'all' || tab === 'files';
  const showFolders = tab === 'all' || tab === 'folders';
  const showShared = tab === 'all' || tab === 'shared';
  const showRequests = tab === 'all' || tab === 'file_requests';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-7 pt-6 shrink-0">
        <h1 className="text-lg font-bold mb-4">
          {query ? <>Results for "<span className="text-muted-foreground">{query}</span>"</> : 'Search'}
        </h1>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList variant="line" className="w-full justify-start gap-0.5 border-b p-0 group-data-horizontal/tabs:h-auto">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="flex-none gap-0 rounded-none px-4 py-2 text-sm group-data-horizontal/tabs:after:-bottom-px"
              >
                {t.label}
                <span className={`ml-1.5 text-[10px] font-semibold rounded-full px-1.5 py-px ${
                  tab === t.value ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                }`}>
                  {t.count}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-7 pb-6">
        {!query ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <Search className="size-12 text-muted-foreground/20" />
            <p className="text-sm font-medium">Search your workspace</p>
            <p className="text-xs text-muted-foreground">Find files, folders, shared links, and file requests</p>
          </div>
        ) : loading ? (
          <div className="space-y-3 pt-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <Search className="size-12 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">No results found</p>
            <p className="text-xs text-muted-foreground">Try a different search term</p>
          </div>
        ) : (
          <>
            {/* Files */}
            {showFiles && files.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-5 mb-2">Files</p>
                {files.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => navigate(`/files?folder=${f.folder_id || ''}`)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 text-left"
                  >
                    <div className="size-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 overflow-hidden">
                      {isImage(f.name) ? (
                        <img src={`${API_BASE}/api/files/${f.id}/raw`} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <img src={fileIconSrc(f.name)} alt="" className="size-5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {humanSize(f.size_bytes)} &middot; {f.uploader_name ?? 'Unknown'} &middot; {timeAgo(f.created_at)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Folders */}
            {showFolders && folders.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-5 mb-2">Folders</p>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => navigate(`/files?folder=${f.id}`)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 text-left"
                  >
                    <div className="size-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                      <img src={folderIconSrc(f.file_count)} alt="" className="size-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-[11px] text-muted-foreground">{f.file_count} files &middot; {timeAgo(f.created_at)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Shared */}
            {showShared && shared.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-5 mb-2">Shared links</p>
                {shared.map((s) => (
                  <div key={s.link_id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50">
                    <div className="size-9 rounded-lg bg-green-50 dark:bg-green-950/30 flex items-center justify-center shrink-0">
                      <Share2 className="size-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.file_name || s.folder_name || 'Shared link'}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.view_count} views &middot; {s.sharer_name ?? 'Unknown'} &middot; {timeAgo(s.shared_at)}
                      </p>
                    </div>
                    <Badge
                      variant={s.status === 'active' ? 'secondary' : 'outline'}
                      className={`text-[9px] ${s.status === 'revoked' || s.status === 'expired' ? 'text-destructive' : s.status === 'expiring' ? 'text-orange-600' : ''}`}
                    >
                      {s.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {/* File requests */}
            {showRequests && requests.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-5 mb-2">File requests</p>
                {requests.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50">
                    <div className="size-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center shrink-0">
                      <FileInput className="size-4 text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.title || 'Untitled request'}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {r.upload_count} uploads &middot; {r.created_by_name ?? 'Unknown'} &middot; {timeAgo(r.created_at)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${r.is_revoked ? 'text-destructive' : ''}`}
                    >
                      {r.is_revoked ? 'revoked' : 'active'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
