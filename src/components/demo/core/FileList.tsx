import { humanSize, fileIconSrc, folderIconSrc, extOf, type DemoFile } from '../engine/demoData';
import { useDemo, visibleItems, type SortKey } from '../engine/demoState';
import { IconDown, IconShare, IconUp } from './icons';

const COLUMNS: { key: SortKey; label: string; width: string }[] = [
  { key: 'name', label: 'Name', width: 'flex-1 min-w-32' },
  { key: 'size', label: 'Size', width: 'w-20' },
  { key: 'modified', label: 'Modified', width: 'w-20' },
  { key: 'region', label: 'Region', width: 'w-16' },
];

export function FileList() {
  const { state } = useDemo();
  return state.view === 'list' ? <ListView /> : <FileGrid />;
}

function useHasChildren() {
  const { state } = useDemo();
  return (fid: string) =>
    state.files.some((x) => x.folderId === fid) || state.folders.some((x) => x.parentId === fid);
}

// Small row thumbnail: photo tile if the file is an image with a thumb,
// otherwise the real file-type icon (mirrors apps/web RowThumbnail).
function RowThumb({ file }: { file: DemoFile }) {
  if (file.kind === 'image' && file.thumb) {
    return <span className="size-5 shrink-0 rounded ring-1 ring-black/10" style={{ background: file.thumb }} />;
  }
  return <img src={fileIconSrc(file.name)} alt="" className="size-5 shrink-0" width={20} height={20} />;
}

function ListView() {
  const { state, dispatch } = useDemo();
  const { folders, files } = visibleItems(state);
  const hasChildren = useHasChildren();
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-3 border-b border-(--demo-border) px-2 py-1.5">
        {COLUMNS.map((col) => (
          <button key={col.key} onClick={() => dispatch({ type: 'TOGGLE_SORT', key: col.key })}
            title={`Sort by ${col.label.toLowerCase()}`}
            className={`flex items-center gap-1 text-left text-[10px] font-semibold uppercase tracking-wider ${col.width} ${
              state.sort.key === col.key ? 'text-(--demo-fg)' : 'text-(--demo-muted-fg) hover:text-(--demo-fg)'
            }`}>
            <span className="truncate">{col.label}</span>
            {state.sort.key === col.key &&
              (state.sort.dir === 'asc' ? <IconUp className="size-2.5 shrink-0" /> : <IconDown className="size-2.5 shrink-0" />)}
          </button>
        ))}
        <span className="w-6 shrink-0" />
      </div>
      {folders.map((f) => (
        <div key={f.id} data-demo-folder role="button" tabIndex={0}
          className="group flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-(--demo-muted)"
          onClick={() => dispatch({ type: 'NAVIGATE', folderId: f.id })}
          onKeyDown={(e) => e.key === 'Enter' && dispatch({ type: 'NAVIGATE', folderId: f.id })}>
          <span className="flex min-w-32 flex-1 items-center gap-2 text-[13px] font-medium">
            <img src={folderIconSrc(hasChildren(f.id))} alt="" className="size-5 shrink-0" width={20} height={20} />
            <span className="truncate">{f.name}</span>
          </span>
          <span className="w-20 text-xs text-(--demo-muted-fg)">-</span>
          <span className="w-20 text-xs text-(--demo-muted-fg)">-</span>
          <span className="w-16 text-xs text-(--demo-muted-fg)">-</span>
          <span className="w-6 shrink-0" />
        </div>
      ))}
      {files.map((f) => <FileRow key={f.id} file={f} />)}
    </div>
  );
}

function FileRow({ file }: { file: DemoFile }) {
  const { dispatch } = useDemo();
  return (
    <div data-demo-file role="button" tabIndex={0}
      className="group flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-(--demo-muted)"
      onClick={() => dispatch({ type: 'PREVIEW', fileId: file.id })}
      onKeyDown={(e) => e.key === 'Enter' && dispatch({ type: 'PREVIEW', fileId: file.id })}>
      <span className="flex min-w-32 flex-1 items-center gap-2 text-[13px] font-medium">
        <RowThumb file={file} />
        <span className="truncate">{file.name}</span>
        {file.shared && <IconShare className="size-3 shrink-0 text-(--demo-muted-fg)" />}
      </span>
      <span className="w-20 text-xs text-(--demo-muted-fg)">{humanSize(file.sizeBytes)}</span>
      <span className="w-20 truncate text-xs text-(--demo-muted-fg)">{file.modified}</span>
      <span className="w-16">
        <span className="rounded-full bg-(--demo-primary)/10 px-1.5 py-0.5 text-[10px] font-semibold text-(--demo-primary)">
          {file.region}
        </span>
      </span>
      <button aria-label={`Share ${file.name}`}
        onClick={(e) => { e.stopPropagation(); dispatch({ type: 'OPEN_SHARE', fileId: file.id }); }}
        className="w-6 shrink-0 rounded p-1 text-(--demo-muted-fg) opacity-0 hover:text-(--demo-fg) group-hover:opacity-100 focus-visible:opacity-100">
        <IconShare className="size-3.5" />
      </button>
    </div>
  );
}

export function FileGrid() {
  const { state, dispatch } = useDemo();
  const { folders, files } = visibleItems(state);
  const hasChildren = useHasChildren();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {folders.map((f) => (
        <button key={f.id} data-demo-tile onClick={() => dispatch({ type: 'NAVIGATE', folderId: f.id })}
          className="flex aspect-[3/2] flex-col items-center justify-center gap-2 rounded-xl border border-(--demo-border) bg-(--demo-card) hover:bg-(--demo-muted)">
          <img src={folderIconSrc(hasChildren(f.id))} alt="" className="size-10" width={40} height={40} />
          <span className="max-w-full truncate px-2 text-xs font-medium">{f.name}</span>
        </button>
      ))}
      {files.map((f) => <FileTile key={f.id} file={f} />)}
    </div>
  );
}

function FileTile({ file }: { file: DemoFile }) {
  const { dispatch } = useDemo();
  const ext = extOf(file.name).toUpperCase();
  const isPhoto = file.kind === 'image' && !!file.thumb;
  const isVideo = file.kind === 'video';
  return (
    <button data-demo-tile onClick={() => dispatch({ type: 'PREVIEW', fileId: file.id })}
      className="group relative aspect-[3/2] overflow-hidden rounded-xl border border-(--demo-border) text-left ring-1 ring-black/5 transition-transform hover:-translate-y-px hover:shadow-lg">
      {isPhoto || isVideo ? (
        <>
          <span className="absolute inset-0" style={{ background: file.thumb ?? 'linear-gradient(160deg,#334155,#0f172a)' }} />
          {isVideo && (
            <span className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 backdrop-blur-sm">
              <span className="ml-0.5 border-y-[6px] border-l-[10px] border-y-transparent border-l-white" />
            </span>
          )}
          <span className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/45 to-transparent" />
          <span className="absolute right-1.5 top-1.5 rounded-full bg-black/45 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">{ext}</span>
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent p-2 pt-6">
            <span className="block truncate text-[11px] font-medium text-white drop-shadow">{file.name}</span>
            <span className="block font-mono text-[10px] text-white/75">{humanSize(file.sizeBytes)} · {file.modified}</span>
          </span>
        </>
      ) : (
        <div className="flex h-full flex-col bg-(--demo-card)">
          <div className="grid flex-1 place-items-center bg-(--demo-muted)/40">
            <img src={fileIconSrc(file.name)} alt="" className="size-11" width={44} height={44} />
          </div>
          <div className="border-t border-(--demo-border) p-2">
            <p className="truncate text-[11px] font-medium">{file.name}</p>
            <p className="font-mono text-[10px] text-(--demo-muted-fg)">{humanSize(file.sizeBytes)} · {file.modified}</p>
          </div>
        </div>
      )}
    </button>
  );
}
