/**
 * The Library view: month-grouped tiles or table rows with a Load more
 * button. Serves photos, videos and documents - one component, kind and
 * layout picked at the call site.
 *
 * Two layouts, every kind: `grid` draws the kind's tile (square photos,
 * 16:9 video cards, square document plates), `list` draws one row per item
 * from the shared column definitions, under a single table header. The
 * columns come from the caller (`libraryColumnsFor(kind)`) so the library
 * table and the folder listing's table never drift apart.
 *
 * Presentational. Selection, favourites, the viewer, the context menu and
 * every mutation belong to the files page - this component only reports
 * intent through callbacks, so the bulk bar and modals the folder listing
 * already has keep working unchanged in library mode.
 *
 * Layout notes: the month header is `sticky` inside the page's scroll
 * container (`.overflow-y-auto` with `p-5`), and bleeds across that padding
 * with -mx-5/px-5 so the blur backdrop covers the tiles edge to edge.
 */
import { Link } from 'react-router-dom';
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Image as ImageIcon, Lock, Search, Star, Upload, AlertCircle, RefreshCw, Loader2, Play, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SelectCheckbox } from '@/components/select-checkbox';
import { FilePreviewImage } from '@/components/file-preview-image';
import { extOf, colorFor, humanSize, fileIconSrc } from '@/lib/helpers';
import type { ColumnDef } from '@/lib/file-columns';
import { formatItemDate, takenIsWallClockOf, LIBRARY_PAGE_SIZE, KIND_COPY, plural, type MonthGroup, type LibraryItem, type LibraryKind, type LibraryLayout } from '@/lib/library-request';

export type TileSize = 'small' | 'large';

export interface LibraryViewProps {
  kind: LibraryKind;
  months: MonthGroup[];
  total: number;
  loaded: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  /** The committed search text, for the "no matches" copy. */
  search: string;
  selected: Set<string>;
  favourites: Set<string>;
  /** fileId → unlock token, for full_lock items the user has unlocked this session. */
  unlockedFiles: Map<string, string>;
  /** The item open in the detail panel, if any - drawn with the green ring the file cards use. */
  activeId: string | null;
  tileSize: TileSize;
  /** Tiles or a table. */
  layout: LibraryLayout;
  /** The active table columns for the list layout, name first, `taken` included - from `libraryColumnsFor(kind)`. */
  columns: ColumnDef[];
  uploadHref: string;
  onLoadMore: () => void;
  onRetry: () => void;
  onOpen: (file: LibraryItem) => void;
  onToggleSelect: (id: string) => void;
  onSelectMany: (ids: string[]) => void;
  onFavourite: (id: string) => void;
  onContextMenu: (e: ReactMouseEvent, file: LibraryItem) => void;
}

const GRID = {
  photos: { small: 'grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(148px,1fr))]', large: 'grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(228px,1fr))]' },
  videos: { small: 'grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]', large: 'grid gap-2 grid-cols-[repeat(auto-fill,minmax(320px,1fr))]' },
  documents: { small: 'grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(148px,1fr))]', large: 'grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(228px,1fr))]' },
} as const;

/** Every kind stacks the same way in the table layout. */
const LIST = 'flex flex-col gap-0.5';

/** The kind's mark - the empty state's icon here, and the files page's stand-in for the breadcrumb. */
export const KIND_ICON = { photos: ImageIcon, videos: Play, documents: FileText } as const;

// The placeholder has to match the shape it stands in for, or the grid jumps
// when the real items land: square tiles for photos and documents, 16:9 cards
// for videos, and a uniform row for every kind in the table layout.
const SKELETON = { photos: 'aspect-square rounded-lg', videos: 'aspect-video rounded-lg', documents: 'aspect-square rounded-lg' } as const;
const LIST_SKELETON = 'h-10 rounded-lg';

export function LibraryView(props: LibraryViewProps) {
  const {
    kind, months, total, loaded, hasMore, isLoading, isLoadingMore, error, search,
    selected, favourites, unlockedFiles, activeId, tileSize, layout, columns, uploadHref,
    onLoadMore, onRetry, onOpen, onToggleSelect, onSelectMany, onFavourite, onContextMenu,
  } = props;
  const copy = KIND_COPY[kind];
  const list = layout === 'list';
  const bodyClass = list ? LIST : GRID[kind][tileSize];
  const skeletonClass = list ? LIST_SKELETON : SKELETON[kind];
  const anySelected = selected.size > 0;

  if (error && months.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="size-12 text-destructive/40 mb-4" />
        <p className="text-sm font-medium text-foreground mb-1">Could not load your {copy.nounPlural}</p>
        <p className="text-xs text-muted-foreground max-w-80 mb-3">{error}</p>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRetry}>
          <RefreshCw className="size-3 mr-1" /> Try again
        </Button>
      </div>
    );
  }

  if (isLoading && months.length === 0) {
    return (
      <div className={bodyClass} aria-busy="true">
        {Array.from({ length: 18 }, (_, i) => (
          <Skeleton key={i} className={skeletonClass} />
        ))}
      </div>
    );
  }

  if (months.length === 0) {
    return search ? (
      <EmptyState icon={Search} title={`No ${copy.nounPlural} match "${search}"`} description={`Try a different name, or clear the search to see every ${copy.noun}.`} />
    ) : (
      <EmptyState
        icon={KIND_ICON[kind]}
        title={copy.emptyTitle}
        description={copy.emptyDescription}
        actions={<Link to={uploadHref}><Button size="sm" className="h-7 text-xs"><Upload className="size-3 mr-1" /> Upload {copy.nounPlural}</Button></Link>}
      />
    );
  }

  const remaining = Math.max(0, total - loaded);
  const pct = total > 0 ? Math.max(2, Math.round((loaded / total) * 100)) : 100;

  return (
    <div className="animate-content-in" data-testid="library-view">
      {/* One table header for the whole listing, above the first month. It is
          a plain div, not role="row": there is no table/grid/rowgroup around
          it, and an orphan row role is invalid ARIA. The columns are not sort
          buttons either - the library sorts by the toolbar's sort menu
          (taken/uploaded), not by an arbitrary column. */}
      {list && columns.length > 0 && (
        <div
          data-testid="library-table-header"
          title="Rows follow the sort menu's date order"
          className="flex items-center gap-3 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b mb-0.5"
        >
          {/* The row's two leading slots, to the pixel: the checkbox (size-4)
              and the thumbnail (w-7). A w-7 checkbox slot would push every
              label 12px right of the cell it names. */}
          <div className="w-4 shrink-0" />
          <div className="w-7 shrink-0" />
          {columns.map((col) => (
            <div key={col.key} className={`truncate ${col.key === 'name' ? 'flex-1 min-w-40' : col.width ?? ''}`}>{col.label}</div>
          ))}
        </div>
      )}
      {months.map((m, mi) => {
        const selectable = m.files.filter((f) => f.lock_mode !== 'full_lock' || unlockedFiles.has(f.id)).map((f) => f.id);
        const partial = m.files.length < m.count;
        const isLast = mi === months.length - 1;
        return (
          <section key={m.key} className="group/month" data-month={m.key}>
            <div className="sticky top-0 z-10 -mx-5 px-5 flex items-baseline gap-2.5 pt-4 pb-2.5 bg-background/90 backdrop-blur-md">
              <h3 className="text-[15px] font-semibold tracking-tight">{m.label}</h3>
              <span className="text-xs text-muted-foreground tabular-nums">{plural(kind, m.count)}</span>
              {partial && <span className="text-[11px] text-muted-foreground tabular-nums">· {m.files.length} loaded</span>}
              <button
                type="button"
                className="ml-auto text-[11px] text-muted-foreground rounded px-1.5 py-0.5 opacity-0 group-hover/month:opacity-100 focus-visible:opacity-100 hover:bg-muted hover:text-foreground transition-opacity"
                onClick={() => onSelectMany(selectable)}
              >
                {partial ? `Select ${selectable.length} loaded` : 'Select all'}
              </button>
            </div>
            <div className={bodyClass}>
              {m.files.map((f) => {
                // Every item, tile or row, gets the same wiring - only the
                // shape differs. The row has no favourite button (the star in
                // the name cell is an indicator), so onFavourite is tile-only.
                const item = {
                  file: f,
                  selected: selected.has(f.id),
                  anySelected,
                  active: activeId === f.id,
                  isFavourite: favourites.has(f.id),
                  unlockToken: unlockedFiles.get(f.id) ?? null,
                  onOpen: () => onOpen(f),
                  onToggle: () => onToggleSelect(f.id),
                  onContextMenu: (e: ReactMouseEvent) => onContextMenu(e, f),
                };
                if (list) return <LibraryListRow key={f.id} kind={kind} columns={columns} {...item} />;
                const tile = { ...item, onFavourite: () => onFavourite(f.id) };
                if (kind === 'photos') return <PhotoTile key={f.id} {...tile} />;
                if (kind === 'videos') return <VideoCard key={f.id} {...tile} />;
                return <DocumentTile key={f.id} {...tile} />;
              })}
              {isLast && isLoadingMore && Array.from({ length: Math.min(LIBRARY_PAGE_SIZE, remaining) || 6 }, (_, i) => (
                <Skeleton key={`sk-${i}`} className={skeletonClass} />
              ))}
            </div>
          </section>
        );
      })}

      <div className="flex flex-col items-center gap-2.5 pt-8 pb-2">
        {hasMore ? (
          <>
            <span className="text-xs text-muted-foreground tabular-nums">Showing {loaded.toLocaleString()} of {plural(kind, total)}</span>
            <div className="h-0.75 w-50 rounded-full bg-muted overflow-hidden" aria-hidden="true">
              <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
            <Button variant="outline" size="sm" className="h-8.5 px-4 text-xs" disabled={isLoadingMore} onClick={onLoadMore}>
              {isLoadingMore ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" /> Loading</> : `Load ${Math.min(LIBRARY_PAGE_SIZE, remaining)} more`}
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">That's all {plural(kind, loaded)}.</span>
        )}
      </div>
    </div>
  );
}

type TileProps = {
  file: LibraryItem; selected: boolean; anySelected: boolean; active: boolean; isFavourite: boolean; unlockToken: string | null;
  onOpen: () => void; onToggle: () => void; onFavourite: () => void; onContextMenu: (e: ReactMouseEvent) => void;
};

/** A table row shows the favourite as a star in the name cell, so it has no favourite button. */
type RowProps = Omit<TileProps, 'onFavourite'> & { kind: LibraryKind; columns: ColumnDef[] };

function PhotoTile({ file, selected, anySelected, active, isFavourite, unlockToken, onOpen, onToggle, onFavourite, onContextMenu }: TileProps) {
  const locked = file.lock_mode === 'full_lock' && !unlockToken;
  const ext = extOf(file.name).toUpperCase() || 'FILE';
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onOpen(); }
    if (e.key === ' ' && !locked) { e.preventDefault(); onToggle(); }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={file.name}
      data-testid={`photo-${file.id}`}
      className={`group relative aspect-square overflow-hidden rounded-lg bg-muted cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        selected ? 'ring-2 ring-primary ring-inset bg-primary/10' : active ? 'ring-2 ring-green-500' : 'ring-1 ring-black/5 dark:ring-white/10'
      }`}
      onClick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey || (anySelected && !locked)) onToggle(); else onOpen(); }}
      onKeyDown={onKey}
      onContextMenu={onContextMenu}
    >
      <div className={`absolute inset-0 transition-transform duration-200 ease-out motion-reduce:transition-none ${selected ? 'scale-[.88] rounded-md overflow-hidden' : 'group-hover:scale-[1.03]'}`}>
        {locked ? (
          <div className="w-full h-full flex items-center justify-center bg-neutral-900 text-white/70">
            <Lock className="size-5" />
          </div>
        ) : (
          <FilePreviewImage
            fileId={file.id}
            fileName={file.name}
            version={file.current_version}
            query={unlockToken ? `ut=${unlockToken}` : undefined}
            size={256}
            className="w-full h-full object-cover"
            fallback={
              <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${colorFor(file.name)}22, #0a0a0a)` }}>
                <span className="font-mono text-sm font-bold tracking-widest uppercase" style={{ color: colorFor(file.name) }}>{ext}</span>
              </div>
            }
          />
        )}
      </div>

      {!locked && (
        <SelectCheckbox
          checked={selected}
          onCheckedChange={() => onToggle()}
          aria-label={`Select ${file.name}`}
          className={`absolute top-2 left-2 z-20 size-5 rounded-full border-white/70 bg-black/30 backdrop-blur-sm transition-opacity data-[state=checked]:bg-primary data-[state=checked]:border-primary ${selected || anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        />
      )}

      <button
        type="button"
        title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
        className={`absolute top-2 right-2 z-20 flex items-center justify-center size-6 rounded-full bg-black/35 hover:bg-black/55 backdrop-blur-sm transition-opacity ${isFavourite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onClick={(e) => { e.stopPropagation(); onFavourite(); }}
      >
        <Star className={`size-3.5 ${isFavourite ? 'text-orange-400 fill-orange-400' : 'text-white'}`} />
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-2 pb-1.5 pt-5 bg-linear-to-t from-black/75 to-transparent text-white opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-[11px] font-medium leading-tight truncate">{file.name}</p>
        <p className="text-[10px] opacity-80 tabular-nums">{formatItemDate(file.taken_at, { wallClock: takenIsWallClockOf(file, 'photos') })}</p>
      </div>
    </div>
  );
}

function VideoCard({ file, selected, anySelected, active, isFavourite, unlockToken, onOpen, onToggle, onFavourite, onContextMenu }: TileProps) {
  const locked = file.lock_mode === 'full_lock' && !unlockToken;
  const ext = extOf(file.name).toUpperCase() || 'VIDEO';
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onOpen(); }
    if (e.key === ' ' && !locked) { e.preventDefault(); onToggle(); }
  };
  return (
    <div role="button" tabIndex={0} aria-label={file.name} data-testid={`video-${file.id}`} data-kind="video"
      className={`group relative aspect-video overflow-hidden rounded-lg cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary text-white ${selected ? 'ring-2 ring-primary ring-inset' : active ? 'ring-2 ring-green-500' : 'ring-1 ring-black/5 dark:ring-white/10'}`}
      style={{ background: `linear-gradient(135deg, ${colorFor(file.name)}55, #0a0a0a)` }}
      onClick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey || (anySelected && !locked)) onToggle(); else onOpen(); }}
      onKeyDown={onKey} onContextMenu={onContextMenu}>
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center size-10 rounded-full bg-black/45 backdrop-blur-sm" data-testid={locked ? 'lock' : 'play'}>
        {locked ? <Lock className="size-4" /> : <Play className="size-4 fill-white ml-0.5" />}
      </span>
      <span className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full bg-black/45 backdrop-blur-sm text-[10px] font-mono font-semibold uppercase tracking-wider">{ext}</span>
      {!locked && (
        <SelectCheckbox checked={selected} onCheckedChange={() => onToggle()} aria-label={`Select ${file.name}`}
          className={`absolute top-2 left-2 z-20 size-5 rounded-full border-white/70 bg-black/30 backdrop-blur-sm transition-opacity ${selected || anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
      )}
      <button type="button" title={isFavourite ? 'Remove from favourites' : 'Add to favourites'} aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
        className={`absolute top-2 right-14 z-20 flex items-center justify-center size-6 rounded-full bg-black/35 hover:bg-black/55 backdrop-blur-sm transition-opacity ${isFavourite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onClick={(e) => { e.stopPropagation(); onFavourite(); }}>
        <Star className={`size-3.5 ${isFavourite ? 'text-orange-400 fill-orange-400' : 'text-white'}`} />
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-2.5 pb-2 pt-6 bg-linear-to-t from-black/80 to-transparent">
        <p className="text-[12px] font-medium leading-tight truncate">{file.name}</p>
        <p className="text-[10px] opacity-80 tabular-nums">{humanSize(file.size_bytes)} · {formatItemDate(file.taken_at, { wallClock: takenIsWallClockOf(file, 'videos') })}</p>
      </div>
    </div>
  );
}

/**
 * A document in the grid layout: the same square plate as a photo, with the
 * format's icon instead of a thumbnail. Selection, ring states, keyboard and
 * context menu behave exactly as a VideoCard.
 */
function DocumentTile({ file, selected, anySelected, active, isFavourite, unlockToken, onOpen, onToggle, onFavourite, onContextMenu }: TileProps) {
  const locked = file.lock_mode === 'full_lock' && !unlockToken;
  const ext = extOf(file.name).toUpperCase() || 'FILE';
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onOpen(); }
    if (e.key === ' ' && !locked) { e.preventDefault(); onToggle(); }
  };
  return (
    <div role="button" tabIndex={0} aria-label={file.name} data-testid={`document-${file.id}`} data-kind="document"
      className={`group relative aspect-square overflow-hidden rounded-lg bg-muted cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? 'ring-2 ring-inset ring-primary' : active ? 'ring-2 ring-green-500' : 'ring-1 ring-black/5 dark:ring-white/10'}`}
      onClick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey || (anySelected && !locked)) onToggle(); else onOpen(); }}
      onKeyDown={onKey} onContextMenu={onContextMenu}>
      <div className="absolute inset-0 flex items-center justify-center">
        <img src={fileIconSrc(file.name)} alt={ext} className="size-12" />
      </div>
      {!locked && (
        <SelectCheckbox checked={selected} onCheckedChange={() => onToggle()} aria-label={`Select ${file.name}`}
          className={`absolute top-2 left-2 z-20 size-5 rounded-full bg-background/80 backdrop-blur-sm transition-opacity data-[state=checked]:bg-primary data-[state=checked]:border-primary ${selected || anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
      )}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {locked && (
          <span className="flex items-center justify-center size-5 rounded bg-background/80 text-muted-foreground" data-testid="lock">
            <Lock className="size-3" />
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded bg-background/80 text-[10px] font-mono font-semibold uppercase">{ext}</span>
      </div>
      <button type="button" title={isFavourite ? 'Remove from favourites' : 'Add to favourites'} aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
        className={`absolute right-2 bottom-11 z-20 flex items-center justify-center size-6 rounded-full bg-background/80 hover:bg-background backdrop-blur-sm transition-opacity ${isFavourite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onClick={(e) => { e.stopPropagation(); onFavourite(); }}>
        <Star className={`size-3.5 ${isFavourite ? 'text-orange-400 fill-orange-400' : 'text-muted-foreground'}`} />
      </button>
      <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-background/85 backdrop-blur-sm">
        <p className="text-xs font-medium truncate">{file.name}</p>
        <p className="text-[10px] text-muted-foreground tabular-nums">{humanSize(file.size_bytes)} · {formatItemDate(file.taken_at, { wallClock: takenIsWallClockOf(file, 'documents') })}</p>
      </div>
    </div>
  );
}

/**
 * One item in the table layout, for every kind. The cells come from the
 * caller's column defs (`libraryColumnsFor(kind)`), so this row and the
 * folder listing's table always show the same columns in the same widths -
 * only the name cell and the thumbnail are the library's own.
 */
function LibraryListRow({ file, kind, columns, selected, anySelected, active, isFavourite, unlockToken, onOpen, onToggle, onContextMenu }: RowProps) {
  const locked = file.lock_mode === 'full_lock' && !unlockToken;
  const icon = <img src={fileIconSrc(file.name)} alt="" className="w-7 h-7" />;
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onOpen(); }
    if (e.key === ' ' && !locked) { e.preventDefault(); onToggle(); }
  };
  return (
    <div role="button" tabIndex={0} aria-label={file.name} data-testid={`library-row-${file.id}`} data-kind={KIND_COPY[kind].noun}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer group outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? 'bg-primary/10' : active ? 'bg-green-50 dark:bg-green-950/20' : ''}`}
      onClick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey || (anySelected && !locked)) onToggle(); else onOpen(); }}
      onKeyDown={onKey} onContextMenu={onContextMenu}>
      {locked ? <span className="size-4 shrink-0" /> : (
        <SelectCheckbox checked={selected} onCheckedChange={() => onToggle()} aria-label={`Select ${file.name}`}
          className={`size-4 shrink-0 transition-opacity ${selected || anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
      )}
      <div className="w-7 h-7 shrink-0">
        {kind === 'documents' || locked ? icon : (
          <FilePreviewImage
            fileId={file.id}
            fileName={file.name}
            version={file.current_version}
            query={unlockToken ? `ut=${unlockToken}` : undefined}
            size={128}
            className="w-7 h-7 rounded object-cover bg-muted"
            fallback={icon}
          />
        )}
      </div>
      {columns.map((col) => col.key === 'name' ? (
        <div key="name" className="flex-1 min-w-40 flex items-center gap-2">
          <span className="text-sm font-medium truncate">{file.name}</span>
          {locked && <Lock className="size-3 text-muted-foreground" />}
          {isFavourite && <Star className="size-3 text-orange-400 fill-orange-400" />}
        </div>
      ) : (
        <div key={col.key} className={`text-xs text-muted-foreground truncate ${col.width ?? ''}`}>{col.render(file)}</div>
      ))}
    </div>
  );
}
