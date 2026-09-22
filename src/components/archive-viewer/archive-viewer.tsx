// apps/web/src/components/archive-viewer/archive-viewer.tsx
//
// Browsing what is inside a stored zip - nothing is downloaded to list an
// archive, and nothing is downloaded to open one entry from it.
//
// The pane is two columns: the entry tree on the app's own surface, and the
// preview on the dark stage every other media type uses. The tree is chrome,
// not media - the same reasoning that keeps the audio player on the theme
// background - so it does not go dark with the stage.
//
// An entry is addressed by its central-directory INDEX, never by its path.
// That is the server's contract and the reason traversal is unreachable here;
// do not "helpfully" switch to names.
//
// Deviation from the approved artboard (flagged at handover): the artboard
// showed the selected entry's facts in FileViewer's 316px facts rail. That
// rail belongs to FileViewer and already shows the .zip's own details, so the
// entry's facts go in the caption strip under the preview instead - which the
// artboard also shows.
import { useCallback, useEffect, useMemo, useState, Suspense, lazy } from 'react';
import { ChevronDown, ChevronRight, Folder, Lock, Ban, Search, Download, Loader2 } from 'lucide-react';
import { api, API_BASE, ApiError, apiErrorMessage } from '@/api/client';
import { buildArchiveTree, type ArchiveEntry, type TreeNode } from '@/lib/archive-tree';
import { colorFor, labelFor, humanSize, extOf, isImage, isVideo, isAudio } from '@/lib/helpers';
import { isTextReadable } from '@/lib/text-detect';
import type { FileItem } from '@/lib/file-types';

const PdfViewer = lazy(() => import('@/components/pdf-viewer/pdf-viewer').then((m) => ({ default: m.PdfViewer })));

// Not exported by helpers.ts - file-viewer.tsx keeps the same local
// definition rather than growing a shared export for one line.
function isPdf(name: string): boolean {
  return extOf(name) === 'pdf';
}

interface ArchiveIndex {
  archiveSize: number;
  totalEntries: number;
  truncated: boolean;
  entries: ArchiveEntry[];
}

/** Compression methods the server will actually stream (store and deflate). */
const OPENABLE_METHODS = new Set([0, 8]);

// Matches TextViewer's threshold in file-viewer.tsx (2 MB). The server bills
// egress on the entry's UNCOMPRESSED size for every byte it streams - gating
// on `node.size` BEFORE fetching means an oversized entry is never fetched
// just to be thrown away.
const TEXT_PREVIEW_MAX = 2 * 1024 * 1024;

// The full entry text is kept as-is up to this many characters; past it the
// preview cuts and says so, rather than fetching a smaller amount (the server
// still bills the whole entry once it is asked for, so this is a render cap,
// not a fetch cap).
const TEXT_RENDER_MAX = 200_000;

// `version` is not optional detail: both archive routes accept `?version=N`
// (see resolve-viewable.ts) and both answer `Cache-Control: private,
// max-age=3600` with no cache-buster. Leaving it off meant selecting v1 of a
// zip listed and downloaded v3's entries with no signal, and a re-uploaded zip
// kept showing yesterday's contents for up to an hour. The version in the URL
// fixes both - the server's cache key is version-specific already.
function entryUrl(fileId: string, index: number, download = false, version?: number): string {
  const v = version ? `&version=${version}` : '';
  return `${API_BASE}/api/files/${fileId}/archive/entry?i=${index}${download ? '&dl=1' : ''}${v}`;
}

// The preview stage is a closed dark scale in both app themes (matching
// FileViewer's own stage), so its text cannot ride theme tokens - a light
// theme's `text-muted-foreground` renders near-black on this background.
// These are literal, full-opacity colors instead: the exact dark-foreground
// pairing is reused so dimmer stage text never falls back to opacity, which
// is how contrast quietly drops under the 4.5:1 floor.
const STAGE_TEXT = 'text-[oklch(0.93_0.008_238.5)]';
const STAGE_MUTED_TEXT = 'text-[oklch(0.6499_0.0194_240.1577)]';
// The caption pill's backdrop must be fully OPAQUE, not alpha over whatever
// sits behind it: an alpha scrim over a light `bg-background` card (or,
// worse, PdfViewer's own light chrome) can composite well under the 4.5:1
// floor even though the text color itself is solid. A solid fill makes the
// pair's contrast independent of anything drawn underneath.
const STAGE_CAPTION_BG = 'bg-[oklch(0.135_0.018_238.9)]';

export function ArchiveViewer({ file, version }: { file: FileItem; version?: number }) {
  const [index, setIndex] = useState<ArchiveIndex | null>(null);
  const [error, setError] = useState<{ status: number | null; message: string } | null>(null);
  const [selected, setSelected] = useState<TreeNode | null>(null);
  // Directories start CLOSED: the server's archive index has no per-entry
  // cap on its own and a hostile or merely huge zip can carry tens of
  // thousands of entries (the `truncated` state exists for exactly that
  // case) - mounting every row open by default would defeat it. This set
  // tracks only what the viewer has explicitly opened.
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState('');

  // A new file - or a new VERSION of the same file - starts with a clean
  // index/error/selection. A different version is a different set of entries,
  // so a selection carried over from the old one names an index that may not
  // exist in the new one. State is adjusted during render on that key changing
  // (the same React-documented pattern file-viewer.tsx uses for prevFileId)
  // rather than in the effect below, so the effect is left doing only the fetch.
  const key = `${file.id}:${version ?? ''}`;
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setIndex(null);
    setError(null);
    setSelected(null);
  }

  useEffect(() => {
    let cancelled = false;
    api<ArchiveIndex>(`/api/files/${file.id}/archive${version ? `?version=${version}` : ''}`)
      .then((data) => { if (!cancelled) setIndex(data); })
      .catch((err) => {
        if (cancelled) return;
        setError({
          status: err instanceof ApiError ? err.status : null,
          // Not the heading again: that sentence is already on screen
          // directly above this line. A failure with no API message to show
          // is a transport failure, and saying so is more use than an echo.
          message: apiErrorMessage(err, 'Network error. Please try again.'),
        });
      });
    return () => { cancelled = true; };
  }, [file.id, version]);

  const tree = useMemo(() => (index ? buildArchiveTree(index.entries) : []), [index]);

  const toggleDir = useCallback((path: string) => {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  if (error) {
    // 422 is the one shape that means "this file itself is not a valid zip";
    // 413 means the opposite - a perfectly valid archive the server declined to
    // index because its directory is over the cap. Every other status
    // (404/403/a network failure) is a request problem, not a claim about the
    // archive, so it keeps a heading that cannot contradict a body like
    // "Network error. Please try again."
    const heading = error.status === 422 ? "This file isn't a valid zip"
      : error.status === 413 ? 'This archive is too large to list'
      : 'This archive could not be opened';
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="bg-background border rounded-xl p-8 text-center max-w-80">
          <p className="text-[13px] font-semibold">{heading}</p>
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{error.message}</p>
          <a href={`${API_BASE}/api/files/${file.id}/download`} download
             className="inline-flex items-center gap-1.5 mt-4 h-8 px-3.5 rounded-lg border text-xs font-medium hover:bg-muted">
            <Download className="size-3.5 text-muted-foreground" /> Download the file
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      <div className="w-[340px] shrink-0 border-r flex flex-col min-h-0 bg-background">
        <div className="px-3 py-2.5 border-b flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Folder className="size-3.5" aria-hidden="true" />
            {index ? (
              <>
                <span className="font-mono">{index.totalEntries.toLocaleString()} entries</span>
                <span aria-hidden="true">&middot;</span>
                <span className="font-mono">{humanSize(index.archiveSize)}</span>
              </>
            ) : <span className="font-mono">Opening&hellip;</span>}
          </div>
          {/* The ring is on the LABEL, not the input: `outline-none` on the
              input removes the only indicator the field had, and the visible
              control here is the bordered wrapper. Same pair ui/input.tsx
              uses, so a focused filter looks like every other focused field
              in the app rather than like nothing at all. */}
          <label className="flex items-center gap-2 h-[30px] px-2.5 border rounded-lg bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <Search className="size-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
            <input
              type="search" value={filter} onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter entries"
              aria-label="Filter entries"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>

        {/* Not role="tree": nothing below carries role="treeitem"/"group" or
            the aria-level/setsize/posinset the tree pattern requires, which
            would announce a tree with zero items. These rows are plain
            buttons in a plain list - let them be buttons. */}
        {/* role="group" so the aria-label is actually exposed: a label on a
            role-less div is dropped by every AT, which left this region
            unnamed. Not role="tree" - see above. */}
        <div role="group" className="flex-1 overflow-y-auto p-1.5" aria-label="Archive contents">
          {!index && Array.from({ length: 8 }, (_, i) => (
            <div key={i} data-testid="archive-skeleton-row" className="flex items-center gap-2 h-[30px] px-2">
              <span className="size-5 rounded-[5px] bg-muted shrink-0" />
              <span className="h-2.5 rounded bg-muted" style={{ width: `${40 + ((i * 13) % 45)}%` }} />
            </div>
          ))}

          {/* Keyed on the built tree, not totalEntries: an archive whose
              entries all neutralise away (names made only of control or bidi
              characters - see archive-tree.ts) reports a non-zero count and
              still has no row to draw, which used to render a blank list. */}
          {index && tree.length === 0 && (
            <p className="text-[11px] text-muted-foreground px-2 py-6 text-center leading-relaxed">
              There is nothing inside this archive.
            </p>
          )}

          {index && tree.map((node) => (
            <Row key={node.index ?? node.name} node={node} path={node.name} depth={0} filter={filter}
                 openDirs={openDirs} onToggle={toggleDir} selected={selected} onSelect={setSelected} />
          ))}

          {index?.truncated && (
            <div className="mt-2 border-t pt-2.5 px-2">
              <p className="text-xs font-semibold">
                Showing the first {index.entries.length.toLocaleString()} of{' '}
                <span className="font-mono">{index.totalEntries.toLocaleString()}</span> entries
              </p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                Use the filter to find what you need, or download the whole archive to get the rest.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 bg-[oklch(0.135_0.018_238.9)] relative flex flex-col">
        <EntryPreview file={file} node={selected} version={version} />
      </div>
    </div>
  );
}

function Row({ node, path, depth, filter, openDirs, onToggle, selected, onSelect }: {
  node: TreeNode; path: string; depth: number; filter: string;
  openDirs: Set<string>; onToggle: (p: string) => void;
  selected: TreeNode | null; onSelect: (n: TreeNode) => void;
}) {
  const q = filter.trim().toLowerCase();
  const matches = q === '' || node.name.toLowerCase().includes(q);
  // Closed unless explicitly opened - a filter match always forces a
  // directory open so the match underneath it is reachable, even collapsed.
  const open = openDirs.has(path) || (q !== '' && node.kind === 'dir');

  if (node.kind === 'dir') {
    const kids = node.children.map((c) => (
      <Row key={c.index ?? `${path}/${c.name}`} node={c} path={`${path}/${c.name}`} depth={depth + 1}
           filter={filter} openDirs={openDirs} onToggle={onToggle} selected={selected} onSelect={onSelect} />
    ));
    return (
      <>
        <button
          type="button"
          data-testid={`archive-dir-${path}`}
          onClick={() => onToggle(path)}
          aria-expanded={open}
          className="flex items-center gap-2 h-[30px] w-full px-2 rounded-md hover:bg-muted text-left"
          style={{ paddingLeft: `${8 + depth * 22}px` }}
        >
          {open ? <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                : <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />}
          <Folder className="size-[15px] text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="text-[13px] font-medium truncate">{node.name}</span>
          <span className="font-mono text-[11px] text-muted-foreground ml-auto shrink-0">{node.fileCount}</span>
        </button>
        {open && kids}
      </>
    );
  }

  if (!matches) return null;

  const openable = !node.encrypted && OPENABLE_METHODS.has(node.method);
  const isSelected = selected?.index === node.index;
  const reason = node.encrypted
    ? 'This entry is password-protected'
    : `Compressed with a method this viewer cannot open (method ${node.method})`;

  return (
    <button
      type="button"
      data-testid={`archive-entry-${node.index}`}
      // aria-disabled, not disabled: a disabled button drops out of the tab
      // order entirely, so a keyboard or screen-reader user could never even
      // land on the row to learn WHY it is refused. This stays focusable and
      // announced as disabled; the click handler is the no-op that actually
      // enforces it.
      aria-disabled={!openable}
      title={openable ? node.name : reason}
      onClick={() => { if (openable) onSelect(node); }}
      className={`flex items-center gap-2 h-[30px] w-full px-2 rounded-md text-left ${
        isSelected ? 'bg-muted' : 'hover:bg-muted'
      } ${openable ? '' : 'text-muted-foreground cursor-not-allowed'}`}
      style={{ paddingLeft: `${8 + depth * 22}px` }}
    >
      <span
        className="size-5 rounded-[5px] shrink-0 flex items-center justify-center text-[8px] font-bold tracking-[0.04em] text-white"
        style={{ backgroundColor: colorFor(node.name) }}
        aria-hidden="true"
      >
        {labelFor(node.name).slice(0, 4)}
      </span>
      <span className="text-[13px] font-medium truncate">{node.name}</span>
      {openable ? (
        <span className="font-mono text-[11px] text-muted-foreground ml-auto shrink-0">{humanSize(node.size)}</span>
      ) : (
        <>
          {/* Encrypted and method-refused both need a marker that survives
              without color: a lock for one, a distinct "not permitted" glyph
              for the other - muted text alone left the method case with no
              visible marker at all, unlike encrypted's lock glyph. */}
          {node.encrypted
            ? <Lock className="size-3 text-muted-foreground ml-auto shrink-0" aria-hidden="true" />
            : <Ban className="size-3 text-muted-foreground ml-auto shrink-0" aria-hidden="true" />}
          <span className="sr-only">{reason}</span>
        </>
      )}
    </button>
  );
}

function DownloadCard({ fileId, node, note, version }: { fileId: string; node: TreeNode; note?: string; version?: number }) {
  return (
    <div className="bg-background border rounded-xl p-8 text-center">
      <p className="text-4xl font-bold text-muted-foreground tracking-wider mb-3">{labelFor(node.name)}</p>
      <p className="text-xs text-muted-foreground mb-2 break-all">{node.name}</p>
      {note && <p className="text-xs text-muted-foreground mb-5">{note}</p>}
      {/* ?? -1 rather than ?? 0: a directory has no index, and entry 0 is a
          real entry - defaulting to it would hand over a file nobody asked
          for. -1 is rejected by the server's digits-only check, which is the
          honest outcome for a state EntryPreview already refuses to reach.
          Matches the desktop pane's own sentinel. */}
      <a href={entryUrl(fileId, node.index ?? -1, true, version)} download
         className={`inline-flex items-center gap-2 h-8 px-3.5 rounded-lg border text-xs font-medium hover:bg-muted ${note ? '' : 'mt-5'}`}>
        <Download className="size-3.5 text-muted-foreground" /> Download this file
      </a>
    </div>
  );
}

function EntryPreview({ file, node, version }: { file: FileItem; node: TreeNode | null; version?: number }) {
  if (!node || node.index === null) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className={`text-[13px] ${STAGE_MUTED_TEXT}`}>Select a file to preview it.</p>
      </div>
    );
  }

  const url = entryUrl(file.id, node.index, false, version);

  // PDF brings its own toolbar and scroller (see file-viewer.tsx's stage,
  // which drops the same centering for it) - centering it here would just
  // inset a viewer that already manages its own layout. Its toolbar already
  // shows the filename, so there is no separate caption strip for it: one
  // was overlaid on top of PdfViewer's own (often light) background, which
  // composited under the AA floor regardless of the caption text's own
  // color - dropping it removes the overlap and the redundancy together.
  if (isPdf(node.name)) {
    return (
      <div className="absolute inset-0 flex flex-col">
        <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className={`size-6 animate-spin ${STAGE_MUTED_TEXT}`} /></div>}>
          <PdfViewer key={url} fileName={node.name} rawUrl={url} downloadUrl={entryUrl(file.id, node.index, true, version)} />
        </Suspense>
      </div>
    );
  }

  const caption = `${node.name} · ${humanSize(node.size)}`;
  const textReadable = isTextReadable(node.name, '');
  const tooLargeForText = textReadable && node.size > TEXT_PREVIEW_MAX;

  let body: React.ReactNode;
  if (isImage(node.name)) {
    body = <img data-testid="archive-preview-image" src={url} alt={node.name} className="max-w-full max-h-full object-contain rounded-md" />;
  } else if (isVideo(node.name)) {
    body = <video key={url} src={url} controls className="max-w-full max-h-full rounded-md" />;
  } else if (isAudio(node.name)) {
    body = <audio key={url} src={url} controls className="w-96" />;
  } else if (textReadable && tooLargeForText) {
    // Do not fetch an entry only to throw it away: the server bills egress on
    // the UNCOMPRESSED size for every byte it streams, so gating happens
    // BEFORE the request - same threshold and shape as TextViewer's own
    // oversize card in file-viewer.tsx.
    body = <DownloadCard fileId={file.id} node={node} version={version} note={`Too large to preview inline (${humanSize(node.size)}).`} />;
  } else if (textReadable) {
    body = <EntryText url={url} />;
  } else {
    body = <DownloadCard fileId={file.id} node={node} version={version} />;
  }

  return (
    <div className="flex-1 flex items-center justify-center overflow-auto p-6 relative">
      {body}
      <p className={`absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[11px] ${STAGE_TEXT} ${STAGE_CAPTION_BG} rounded px-2 py-0.5`}>
        {caption}
      </p>
    </div>
  );
}

function EntryText({ url }: { url: string }) {
  const [result, setResult] = useState<{ text: string; truncated: boolean } | null>(null);
  const [failed, setFailed] = useState(false);

  // A new entry starts with a clean result. State is adjusted during render
  // on the url change (same pattern as file-viewer.tsx's prevRawUrl) rather
  // than in the effect below, so the effect is left doing only the fetch.
  const [prevUrl, setPrevUrl] = useState(url);
  if (prevUrl !== url) {
    setPrevUrl(url);
    setResult(null);
    setFailed(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (cancelled) return;
        setResult({ text: t.slice(0, TEXT_RENDER_MAX), truncated: t.length > TEXT_RENDER_MAX });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  if (failed) return <p className={`text-[13px] ${STAGE_TEXT}`}>This entry could not be opened.</p>;
  if (result === null) return <Loader2 className={`size-6 animate-spin ${STAGE_MUTED_TEXT}`} />;
  return (
    <div className="max-w-full max-h-full flex flex-col items-center gap-2">
      <pre className="max-w-full max-h-full overflow-auto bg-background rounded-xl p-5 text-[13px] font-mono leading-relaxed whitespace-pre-wrap">
        {result.text}
      </pre>
      {/* This pane's whole argument is that it never shows a silent prefix -
          the entry LIST says so when the server truncated it, so the entry
          PREVIEW has to say so too when the render cap cuts it. */}
      {result.truncated && (
        <p className={`text-[11px] ${STAGE_MUTED_TEXT} shrink-0`}>
          Showing the first {TEXT_RENDER_MAX.toLocaleString()} characters. Download the file to see the rest.
        </p>
      )}
    </div>
  );
}
