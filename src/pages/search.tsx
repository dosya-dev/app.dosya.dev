import { useState, useEffect, useCallback } from 'react';
import { localDigits } from '@/lib/format-locale';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Badge } from '@/components/ui/badge';
import { useLocale, useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Search, Share2, FileInput, Grid3X3, List,
} from 'lucide-react';
import { FilePreviewImage } from '@/components/file-preview-image';
import {
  humanSize, timeAgo, fileIconSrc, folderIconSrc, isImage,
} from '@/lib/helpers';
import { searchContentWithRetry, type ContentHit } from '@/lib/ai-search';


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
  id: string; title: string; message: string;
  expires_at: number | null; upload_count: number; is_revoked: number;
  created_at: number; created_by_name: string | null;
}

type Tab = 'all' | 'files' | 'folders' | 'shared' | 'file_requests';

/** AI search results: hidden = not available here (no plan, off, error). */
type ContentState = { state: 'hidden' } | { state: 'loading' } | { state: 'busy' } | { state: 'ok'; files: ContentHit[] };

/** How file results are laid out: rows, or square tiles led by the preview. */
type ViewMode = 'list' | 'grid';
const VIEW_STORAGE_KEY = 'dosya_search_view';
function loadSavedView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'grid' ? 'grid' : 'list';
  } catch { return 'list'; }
}

// ── Page ──────────────────────────────────────────────────

/**
 * /search: the name search with content results beside it. (People are found
 * on the device and opened on their persona page; an old `person=` link is a
 * plain search for its words.)
 */
export default function SearchPage() {
  return <NameSearch />;
}

function NameSearch() {
  const t = useT();
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const { locale } = useLocale();
  // Lowercase status words; the catalog has lowercase entries for two, the
  // others are the capitalised labels lowered in the chosen language.
  const shareStatusText = (status: string) => {
    if (status === 'active') return t('search.label.active');
    if (status === 'revoked') return t('search.label.revoked');
    if (status === 'expired') return t('common.status.expired').toLocaleLowerCase(locale);
    if (status === 'expiring') return t('shared.label.expiring').toLocaleLowerCase(locale);
    return status;
  };

  const [tab, setTab] = useState<Tab>('all');
  const [view, setViewState] = useState<ViewMode>(loadSavedView);
  const setView = (v: ViewMode) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* private mode: the choice lives for this page only */ }
  };
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

  // Content search runs beside the name search and never holds it up. Only a
  // successful, complete answer can say "no content matches": a partial one
  // (keyword-only while paused or degraded) that found nothing proves
  // nothing, so the section is hidden. A 429 shows the busy line and retries
  // once, anything else hides the section.
  const [content, setContent] = useState<ContentState>({ state: 'hidden' });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the section to the new query before its request starts
    if (!wsId || query.trim().length < 2) { setContent({ state: 'hidden' }); return; }
    const ctrl = new AbortController();
    setContent({ state: 'loading' });
    searchContentWithRetry(wsId, query.trim(), {
      signal: ctrl.signal,
      onBusy: () => { if (!ctrl.signal.aborted) setContent({ state: 'busy' }); },
    }).then((r) => {
      if (ctrl.signal.aborted) return;
      setContent(r.kind === 'ok' && !(r.partial && r.files.length === 0) ? { state: 'ok', files: r.files } : { state: 'hidden' });
    }).catch(() => { if (!ctrl.signal.aborted) setContent({ state: 'hidden' }); });
    return () => ctrl.abort();
  }, [wsId, query]);
  const contentHits = content.state === 'ok' ? content.files.length : 0;
  const contentPending = content.state === 'loading' || content.state === 'busy';

  const totalCount = counts.files + counts.folders + counts.shared + counts.requests;

  const TABS: { value: Tab; label: string; count: number }[] = [
    { value: 'all', label: t('common.label.all'), count: totalCount },
    { value: 'files', label: t('common.label.files'), count: counts.files },
    { value: 'folders', label: t('common.label.folders'), count: counts.folders },
    { value: 'shared', label: t('common.label.shared'), count: counts.shared },
    { value: 'file_requests', label: t('common.label.fileRequests'), count: counts.requests },
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
          {query
            ? richText(t('search.heading.resultsForQuery'), { query: <span className="text-muted-foreground">{query}</span> })
            : t('common.heading.search')}
        </h1>

        {/* Tabs + view toggle */}
        <div className="flex items-end gap-3 border-b">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-w-0 flex-1">
            <TabsList variant="line" className="w-full justify-start gap-0.5 p-0 group-data-horizontal/tabs:h-auto">
              {TABS.map((tabItem) => (
                <TabsTrigger
                  key={tabItem.value}
                  value={tabItem.value}
                  className="flex-none gap-0 rounded-none px-4 py-2 text-sm group-data-horizontal/tabs:after:-bottom-px"
                >
                  {tabItem.label}
                  <span className={`ms-1.5 text-[10px] font-semibold rounded-full px-1.5 py-px ${
                    tab === tabItem.value ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                  }`}>
                    {localDigits(tabItem.count)}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {query && (
          <div className="mb-1.5 flex shrink-0 rounded-md border overflow-hidden" role="group">
            <button
              type="button"
              title={t('files.action.list')}
              aria-label={t('files.action.list')}
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
              className={`p-1.5 ${view === 'list' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'}`}
            >
              <List className="size-3.5" />
            </button>
            <button
              type="button"
              title={t('files.action.grid')}
              aria-label={t('files.action.grid')}
              aria-pressed={view === 'grid'}
              onClick={() => setView('grid')}
              className={`p-1.5 ${view === 'grid' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'}`}
            >
              <Grid3X3 className="size-3.5" />
            </button>
          </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-7 pb-6">
        {!query ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <Search className="size-12 text-muted-foreground/20" />
            <p className="text-sm font-medium">{t('search.label.searchYourWorkspace')}</p>
            <p className="text-xs text-muted-foreground">{t('search.description.findFilesFoldersSharedLinksAndFileRequests')}</p>
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
          contentHits > 0 || contentPending ? null : (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <Search className="size-12 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">{t('search.label.noResultsFound')}</p>
            <p className="text-xs text-muted-foreground">{t('search.label.tryADifferentSearchTerm')}</p>
          </div>
          )
        ) : (
          <>
            {/* Files */}
            {showFiles && files.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-5 mb-2">{t('common.label.files')}</p>
                <FileResults view={view}>
                  {files.map((f) => (
                    <FileResultItem
                      key={f.id}
                      view={view}
                      id={f.id}
                      name={f.name}
                      meta={t('search.action.fsizeBytesMiddotFuploaderNameunknownMiddotFcreatedAt', {
                        fSize_bytes: humanSize(f.size_bytes), fUploader_nameUnknown: f.uploader_name ?? t('common.label.unknown'), fCreated_at: timeAgo(f.created_at),
                      })}
                      onOpen={() => navigate(`/files?folder=${f.folder_id || ''}`)}
                    />
                  ))}
                </FileResults>
              </div>
            )}

            {/* Folders */}
            {showFolders && folders.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-5 mb-2">{t('common.label.folders')}</p>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => navigate(`/files?folder=${f.id}`)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 text-start"
                  >
                    <div className="size-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                      <img src={folderIconSrc(f.file_count)} alt="" className="size-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-[11px] text-muted-foreground">{t('search.action.ffileCountFilesMiddotFcreatedAt', { fFile_count: f.file_count, fCreated_at: timeAgo(f.created_at) })}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Shared */}
            {showShared && shared.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-5 mb-2">{t('common.label.sharedLinks')}</p>
                {shared.map((s) => (
                  <div key={s.link_id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50">
                    <div className="size-9 rounded-lg bg-green-50 dark:bg-green-950/30 flex items-center justify-center shrink-0">
                      <Share2 className="size-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.file_name || s.folder_name || t('search.label.sharedLink')}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t('search.label.sviewCountViewsMiddotSsharerNameunknownMiddotSsharedAt', {
                          sView_count: s.view_count, sSharer_nameUnknown: s.sharer_name ?? t('common.label.unknown'), sShared_at: timeAgo(s.shared_at),
                        })}
                      </p>
                    </div>
                    <Badge
                      variant={s.status === 'active' ? 'secondary' : 'outline'}
                      className={`text-[9px] ${s.status === 'revoked' || s.status === 'expired' ? 'text-destructive' : s.status === 'expiring' ? 'text-orange-600' : ''}`}
                    >
                      {shareStatusText(s.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {/* File requests */}
            {showRequests && requests.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-5 mb-2">{t('common.label.fileRequests')}</p>
                {requests.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50">
                    <div className="size-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center shrink-0">
                      <FileInput className="size-4 text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.title || t('common.label.untitledRequest')}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t('search.label.ruploadCountUploadsMiddotRcreatedByNameunknownMiddotRcreatedAt', {
                          rUpload_count: r.upload_count, rCreated_by_nameUnknown: r.created_by_name ?? t('common.label.unknown'), rCreated_at: timeAgo(r.created_at),
                        })}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${r.is_revoked ? 'text-destructive' : ''}`}
                    >
                      {r.is_revoked ? t('search.label.revoked') : t('search.label.active')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {query && showFiles && content.state !== 'hidden' && (
          <ContentResults content={content} view={view} onOpen={(f) => navigate(`/files?folder=${f.folder_id || ''}`)} />
        )}
      </div>
    </div>
  );
}

function ContentResults({ content, view, onOpen }: { content: Exclude<ContentState, { state: 'hidden' }>; view: ViewMode; onOpen: (f: ContentHit) => void }) {
  const t = useT();
  return (
    <div data-content-results>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-5 mb-2">{t('search.label.inFileContents')}</p>
      {content.state === 'loading' ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">{t('search.status.searchingFileContents')}</p>
      ) : content.state === 'busy' ? (
        <p role="status" className="px-3 py-2.5 text-xs text-muted-foreground">{t('search.status.contentSearchIsBusyRetrying')}</p>
      ) : content.files.length === 0 ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">{t('search.label.noContentMatches')}</p>
      ) : (
        <FileResults view={view}>
          {content.files.map((f) => (
            <FileResultItem
              key={f.id}
              view={view}
              id={f.id}
              name={f.name}
              // An image's "text" is the vision model's description or OCR
              // attempt ("No text is present in the image"), which is index
              // material, not something to read under a photo. Documents keep
              // their snippet: it says where the match is.
              snippet={isImageHit(f) ? null : (
                f.snippet ? (
                  <>
                    {f.snippet}
                    {f.page != null && <span className="ms-1 whitespace-nowrap">· {t('search.label.pagePage', { page: localDigits(f.page) })}</span>}
                  </>
                ) : null
              )}
              onOpen={() => onOpen(f)}
            />
          ))}
        </FileResults>
      )}
    </div>
  );
}

/** The indexer decides "image" by MIME type; the name's extension is the fallback. */
function isImageHit(f: ContentHit): boolean {
  return (f.mime_type ?? '').startsWith('image/') || isImage(f.name);
}

/** Rows stack; tiles flow into a responsive square grid. */
function FileResults({ view, children }: { view: ViewMode; children: React.ReactNode }) {
  return view === 'grid'
    ? <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3 px-1" data-view="grid">{children}</div>
    : <div data-view="list">{children}</div>;
}

/**
 * One file result, as a row (preview, name, one line under it) or as a tile
 * (square preview, name, the same line clamped under it). Both forms share the
 * preview so the thumbnail chain (server thumb, retry, raw, HEIC decode) is the
 * same whichever the user picked.
 */
function FileResultItem({ view, id, name, meta, snippet, onOpen }: {
  view: ViewMode; id: string; name: string; meta?: string; snippet?: React.ReactNode; onOpen: () => void;
}) {
  if (view === 'grid') {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid="file-tile"
        className="group flex min-w-0 flex-col gap-1.5 rounded-xl p-1.5 text-start hover:bg-muted/50"
      >
        <div className="aspect-square w-full overflow-hidden rounded-lg bg-muted/50 flex items-center justify-center">
          <FilePreviewImage
            fileId={id}
            fileName={name}
            size={256}
            className="h-full w-full object-cover"
            fallback={<img src={fileIconSrc(name)} alt="" className="size-10" />}
          />
        </div>
        <p className="w-full truncate px-0.5 text-xs font-medium" dir="auto" title={name}>{name}</p>
        {meta && <p className="w-full truncate px-0.5 text-[11px] text-muted-foreground">{meta}</p>}
        {snippet && <p className="w-full px-0.5 text-[11px] text-muted-foreground line-clamp-2" dir="auto">{snippet}</p>}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="file-row"
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 text-start"
    >
      <div className="size-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 overflow-hidden">
        <FilePreviewImage
          fileId={id}
          fileName={name}
          size={128}
          className="w-full h-full object-cover"
          fallback={<img src={fileIconSrc(name)} alt="" className="size-5" />}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" dir="auto">{name}</p>
        {meta && <p className="text-[11px] text-muted-foreground">{meta}</p>}
        {snippet && <p className="text-xs text-muted-foreground line-clamp-2" dir="auto">{snippet}</p>}
      </div>
    </button>
  );
}
