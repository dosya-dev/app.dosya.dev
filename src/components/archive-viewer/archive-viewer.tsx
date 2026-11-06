// apps/web/src/components/archive-viewer/archive-viewer.tsx
//
// Browsing what is inside a stored zip or disk image - nothing is downloaded
// to list an archive, and nothing is downloaded to open one entry from it.
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
import { formatNumber, localDigits } from '@/lib/format-locale';
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { ChevronDown, ChevronRight, Folder, Lock, Ban, Search, Download, Loader2, Save, X } from 'lucide-react';
import { api, API_BASE, ApiError, apiErrorMessage } from '@/api/client';
import { buildArchiveTree, type ArchiveEntry, type TreeNode } from '@/lib/archive-tree';
import { planFolderSave, runFolderSave, MAX_FOLDER_SAVE_FILES, type SavePlan } from '@/lib/archive-save';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { useWorkspace } from '@/stores/workspace';
import { toast } from '@/lib/toast';
import { colorFor, labelFor, humanSize, extOf, isImage, isVideo, isAudio } from '@/lib/helpers';
import { isTextReadable } from '@/lib/text-detect';
import { lazyChunkNamed } from '@/lib/chunk-reload';
import type { FileItem } from '@/lib/file-types';
import { t, useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

/**
 * lib/archive-save.ts is shared verbatim with desktop and mobile and cannot
 * import the translator, so it reports its own English sentences. Known ones
 * are translated here, at display; anything else (the server's own text) is
 * shown as sent.
 */
function localizeSaveMessage(message: string): string {
  switch (message) {
    case 'Request failed': return t('common.error.requestFailed');
    case 'Folder could not be created': return t('common.error.folderCouldNotBeCreated');
    case 'Its folder could not be created': return t('common.error.itsFolderCouldNotBeCreated');
    default: return message;
  }
}

const PdfViewer = lazyChunkNamed(
  () => import('@/components/pdf-viewer/pdf-viewer'),
  (m) => m.PdfViewer,
);

// Not exported by helpers.ts - file-viewer.tsx keeps the same local
// definition rather than growing a shared export for one line.
function isPdf(name: string): boolean {
  return extOf(name) === 'pdf';
}

interface ArchiveIndex {
  /** What the API opened it as. Older cached responses may omit it. */
  kind?: 'zip' | 'iso';
  archiveSize: number;
  totalEntries: number;
  truncated: boolean;
  entries: ArchiveEntry[];
}

const DISK_IMAGE_EXTS = new Set(['iso', 'img']);

/** The noun for the summary line: what the API says it opened, else what the
 *  extension suggests (the API is the authority once it has answered). */
function kindLabel(index: ArchiveIndex | null, name: string): string {
  if (index?.kind === 'iso' || (!index?.kind && DISK_IMAGE_EXTS.has(extOf(name)))) return t('common.label.diskImage');
  return t('common.label.archive');
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
  const tr = useT();
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
          message: apiErrorMessage(err, t('common.error.networkErrorPleaseTryAgain')),
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

  // Saving INTO dosya. The server saves one entry per request (see
  // archive/save.ts); a folder is planned and driven from here, one file at a
  // time, through lib/archive-save.ts. `pending` is what the folder picker is
  // deciding a destination for.
  const workspaceId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [pending, setPending] = useState<{ kind: 'entry'; node: TreeNode } | { kind: 'folder'; plan: SavePlan } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; root: string } | null>(null);
  const cancelRef = useRef(false);

  // `name` is the TREE's cleaned segment (archive-tree.ts neutralises control
  // and bidi characters for display). Sent as the override so the file that
  // lands carries the name the user clicked, not a spoofed raw entry name.
  const saveEntry = useCallback((entryIndex: number, folderId: string | null, name: string) =>
    api<{ ok: boolean; file_id: string; name: string; size_bytes: number }>(`/api/files/${file.id}/archive/save`, {
      method: 'POST', body: JSON.stringify({ i: entryIndex, folder_id: folderId, name }),
    }), [file.id]);

  // POST /api/folders/batch answers `folders` (apps/api/src/pages/api/folders/
  // batch.ts), one row per requested folder, existing or new, with its id.
  const createFolders = useCallback(async (parentId: string | null, names: string[]) => {
    const res = await api<{ ok: boolean; folders: { name: string; parent_id: string | null; id: string }[] }>('/api/folders/batch', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId, folders: names.map((name) => ({ name, parent_id: parentId })) }),
    });
    return new Map(res.folders.map((r) => [r.name, r.id]));
  }, [workspaceId]);

  const startFolderSave = (nodes: TreeNode[], rootName: string) => {
    const plan = planFolderSave(nodes, rootName);
    if ('tooMany' in plan) {
      toast.error(
        t('common.error.tooManyFilesToSaveAtOnce'),
        t('common.error.thisFolderHasToomanytolocalestringFilesSaveSmallerFoldersUpToMaxFolderSaveFiles', {
          tooMany: formatNumber(plan.tooMany), maxFolderSaveFiles: MAX_FOLDER_SAVE_FILES,
        }),
      );
      return;
    }
    setPending({ kind: 'folder', plan });
  };

  const onPicked = async (folderId: string | null) => {
    const job = pending;
    setPending(null);
    if (!job) return;
    if (job.kind === 'entry') {
      if (job.node.index === null) return;
      try {
        const out = await saveEntry(job.node.index, folderId, job.node.name);
        toast.success(t('common.feedback.savedToDosya'), out.name);
      } catch (err) {
        toast.error(t('common.error.couldNotSaveThisFile'), apiErrorMessage(err));
      }
      return;
    }
    cancelRef.current = false;
    setProgress({ done: 0, total: job.plan.files.length, root: job.plan.rootName });
    const out = await runFolderSave(job.plan, folderId, {
      createFolders,
      saveEntry,
      onProgress: (done, total) => setProgress({ done, total, root: job.plan.rootName }),
      isCancelled: () => cancelRef.current,
    });
    setProgress(null);
    const parts = [t('common.description.savedOutsavedPluralOneFileOtherFiles', { outSaved: out.saved })];
    if (out.skipped) parts.push(t('common.label.outskippedSkipped', { count: out.skipped }));
    if (out.failed.length) parts.push(t('common.error.failedcountFailed', { count: out.failed.length }));
    if (out.cancelled) parts.push(t('common.label.cancelled'));
    const summary = parts.join(', ');
    if (out.failed.length) toast.error(summary, `${out.failed[0]!.name}: ${localizeSaveMessage(out.failed[0]!.message)}`);
    else toast.success(summary, job.plan.rootName);
  };

  if (error) {
    // 422 is the one shape that means "this file itself is not a valid zip";
    // 413 means the opposite - a perfectly valid archive the server declined to
    // index because its directory is over the cap. Every other status
    // (404/403/a network failure) is a request problem, not a claim about the
    // archive, so it keeps a heading that cannot contradict a body like
    // "Network error. Please try again."
    const noun = DISK_IMAGE_EXTS.has(extOf(file.name)) ? tr('common.label.diskImage') : 'zip';
    const heading = error.status === 422 ? tr('common.label.thisFileIsnTAValidNoun', { noun })
      : error.status === 413 ? tr('common.error.thisArchiveIsTooLargeToList')
      : tr('common.error.thisArchiveCouldNotBeOpened');
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="bg-background border rounded-xl p-8 text-center max-w-80">
          <p className="text-[13px] font-semibold">{heading}</p>
          <p dir="auto" className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{error.message}</p>
          <a href={`${API_BASE}/api/files/${file.id}/download`} download
             className="inline-flex items-center gap-1.5 mt-4 h-8 px-3.5 rounded-lg border text-xs font-medium hover:bg-muted">
            <Download className="size-3.5 text-muted-foreground" /> {tr('common.action.downloadTheFile')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      <div className="w-[340px] shrink-0 border-e flex flex-col min-h-0 bg-background">
        <div className="px-3 py-2.5 border-b flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Folder className="size-3.5" aria-hidden="true" />
            {index ? (
              <>
                <span className="font-mono">{tr('common.label.totalentriesEntries', { totalEntries: formatNumber(index.totalEntries) })}</span>
                <span aria-hidden="true">&middot;</span>
                <span className="font-mono">{humanSize(index.archiveSize)}</span>
                <span aria-hidden="true">&middot;</span>
                <span data-testid="archive-kind">{kindLabel(index, file.name)}</span>
              </>
            ) : <span className="font-mono">{tr('common.label.openingHellip')}</span>}
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
              placeholder={tr('common.placeholder.filterEntries')}
              aria-label={tr('common.placeholder.filterEntries')}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </label>
          <button
            type="button"
            data-testid="archive-save-all"
            disabled={!index || !!progress || tree.length === 0}
            onClick={() => startFolderSave(tree, file.name.replace(/\.[^.]+$/, '') || file.name)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11px] font-medium hover:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed disabled:hover:bg-transparent self-start"
          >
            <Save className="size-3.5 text-muted-foreground" aria-hidden="true" /> {tr('common.action.saveAllToDosya')}
          </button>
        </div>

        {progress && (
          <div role="status" className="px-3 py-2 border-b text-[11px] flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">
              {tr('common.label.savingDoneOfTotalIntoRootName', { done: progress.done, total: progress.total, rootName: progress.root })}
            </span>
            <button
              type="button"
              onClick={() => { cancelRef.current = true; }}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="size-3" aria-hidden="true" /> {tr('common.cancel')}
            </button>
          </div>
        )}

        {/* Not role="tree": nothing below carries role="treeitem"/"group" or
            the aria-level/setsize/posinset the tree pattern requires, which
            would announce a tree with zero items. These rows are plain
            buttons in a plain list - let them be buttons. */}
        {/* role="group" so the aria-label is actually exposed: a label on a
            role-less div is dropped by every AT, which left this region
            unnamed. Not role="tree" - see above. */}
        <div role="group" className="flex-1 overflow-y-auto p-1.5" aria-label={tr('common.accessibility.archiveContents')}>
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
              {tr('common.description.thereIsNothingInsideThisArchive')}
            </p>
          )}

          {index && tree.map((node) => (
            <Row key={node.index ?? node.name} node={node} path={node.name} depth={0} filter={filter}
                 openDirs={openDirs} onToggle={toggleDir} selected={selected} onSelect={setSelected}
                 onSaveDir={(n) => startFolderSave(n.children, n.name)} saving={!!progress} />
          ))}

          {index?.truncated && (
            <div className="mt-2 border-t pt-2.5 px-2">
              <p className="text-xs font-semibold">
                {richText(tr('common.description.showingTheFirstEntryCountOfTotalEntriesEntries'), {
                  entryCount: formatNumber(index.entries.length),
                  totalEntries: <span className="font-mono">{formatNumber(index.totalEntries)}</span>,
                })}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                {tr('common.description.useTheFilterToFindWhatYouNeedOr')}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 bg-[oklch(0.135_0.018_238.9)] relative flex flex-col">
        <EntryPreview file={file} node={selected} version={version} onSave={(n) => setPending({ kind: 'entry', node: n })} />
      </div>

      <FolderPickerDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        workspaceId={workspaceId}
        onSelect={(id) => { void onPicked(id); }}
        title={tr('common.tooltip.saveToFolder')}
        confirmLabel={tr('common.action.saveHere')}
      />
    </div>
  );
}

function Row({ node, path, depth, filter, openDirs, onToggle, selected, onSelect, onSaveDir, saving }: {
  node: TreeNode; path: string; depth: number; filter: string;
  openDirs: Set<string>; onToggle: (p: string) => void;
  selected: TreeNode | null; onSelect: (n: TreeNode) => void;
  onSaveDir: (n: TreeNode) => void;
  /** A folder save is running: one at a time, since they share the progress strip. */
  saving: boolean;
}) {
  const tr = useT();
  const q = filter.trim().toLowerCase();
  const matches = q === '' || node.name.toLowerCase().includes(q);
  // Closed unless explicitly opened - a filter match always forces a
  // directory open so the match underneath it is reachable, even collapsed.
  const open = openDirs.has(path) || (q !== '' && node.kind === 'dir');

  if (node.kind === 'dir') {
    const kids = node.children.map((c) => (
      <Row key={c.index ?? `${path}/${c.name}`} node={c} path={`${path}/${c.name}`} depth={depth + 1}
           filter={filter} openDirs={openDirs} onToggle={onToggle} selected={selected} onSelect={onSelect}
           onSaveDir={onSaveDir} saving={saving} />
    ));
    return (
      <>
        {/* A div with role="button", not a <button>: the row carries its own
            Save control, and a button inside a button is invalid markup that
            browsers split unpredictably. Enter and Space toggle like a button. */}
        <div
          role="button"
          tabIndex={0}
          data-testid={`archive-dir-${path}`}
          onClick={() => onToggle(path)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(path); } }}
          aria-expanded={open}
          className="group flex items-center gap-2 h-[30px] w-full px-2 rounded-md hover:bg-muted text-start cursor-pointer"
          style={{ paddingInlineStart: `${8 + depth * 22}px` }}
        >
          {open ? <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                : <ChevronRight className="size-3.5 text-muted-foreground shrink-0 rtl:-scale-x-100" />}
          <Folder className="size-[15px] text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="text-[13px] font-medium truncate">{node.name}</span>
          <span className="font-mono text-[11px] text-muted-foreground ms-auto shrink-0">{localDigits(node.fileCount)}</span>
          <button
            type="button"
            data-testid={`archive-save-dir-${path}`}
            aria-label={tr('common.accessibility.saveFolderNodeNameToDosya', { nodeName: node.name })}
            title={tr('common.tooltip.saveFolderToDosya')}
            disabled={saving}
            onClick={(e) => { e.stopPropagation(); onSaveDir(node); }}
            className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-background shrink-0 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <Save className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        {open && kids}
      </>
    );
  }

  if (!matches) return null;

  const openable = !node.encrypted && OPENABLE_METHODS.has(node.method);
  const isSelected = selected?.index === node.index;
  const reason = node.encrypted
    ? tr('common.label.thisEntryIsPasswordProtected')
    : tr('common.error.compressedWithAMethodThisViewerCannotOpenMethod', { method: node.method });

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
      className={`flex items-center gap-2 h-[30px] w-full px-2 rounded-md text-start ${
        isSelected ? 'bg-muted' : 'hover:bg-muted'
      } ${openable ? '' : 'text-muted-foreground cursor-not-allowed'}`}
      style={{ paddingInlineStart: `${8 + depth * 22}px` }}
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
        <span className="font-mono text-[11px] text-muted-foreground ms-auto shrink-0">{humanSize(node.size)}</span>
      ) : (
        <>
          {/* Encrypted and method-refused both need a marker that survives
              without color: a lock for one, a distinct "not permitted" glyph
              for the other - muted text alone left the method case with no
              visible marker at all, unlike encrypted's lock glyph. */}
          {node.encrypted
            ? <Lock className="size-3 text-muted-foreground ms-auto shrink-0" aria-hidden="true" />
            : <Ban className="size-3 text-muted-foreground ms-auto shrink-0" aria-hidden="true" />}
          <span className="sr-only">{reason}</span>
        </>
      )}
    </button>
  );
}

function DownloadCard({ fileId, node, note, version }: { fileId: string; node: TreeNode; note?: string; version?: number }) {
  const tr = useT();
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
        <Download className="size-3.5 text-muted-foreground" /> {tr('common.action.downloadThisFile')}
      </a>
    </div>
  );
}

function EntryPreview({ file, node, version, onSave }: {
  file: FileItem; node: TreeNode | null; version?: number; onSave: (n: TreeNode) => void;
}) {
  const tr = useT();
  if (!node || node.index === null) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className={`text-[13px] ${STAGE_MUTED_TEXT}`}>{tr('common.description.selectAFileToPreviewIt')}</p>
      </div>
    );
  }

  const url = entryUrl(file.id, node.index, false, version);

  // Download and Save for the selected entry, above whatever the stage shows.
  // On the dark stage, so literal stage colors rather than theme tokens (see
  // STAGE_TEXT above).
  const actions = (
    <div className={`h-10 shrink-0 flex items-center justify-between gap-3 px-3 border-b border-white/10 ${STAGE_TEXT}`}>
      <span className="text-[12px] truncate">{node.name}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <a href={entryUrl(file.id, node.index, true, version)} download
           className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-white/15 text-[11px] font-medium hover:bg-white/10">
          <Download className="size-3.5" aria-hidden="true" /> {tr('common.action.download')}
        </a>
        <button type="button" data-testid="archive-save-entry" data-index={node.index} onClick={() => onSave(node)}
           className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-white/15 text-[11px] font-medium hover:bg-white/10">
          <Save className="size-3.5" aria-hidden="true" /> {tr('common.action.saveToDosya')}
        </button>
      </div>
    </div>
  );

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
        {actions}
        <div className="flex-1 min-h-0 flex flex-col">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className={`size-6 animate-spin ${STAGE_MUTED_TEXT}`} /></div>}>
            <PdfViewer key={url} fileName={node.name} rawUrl={url} downloadUrl={entryUrl(file.id, node.index, true, version)} />
          </Suspense>
        </div>
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
    body = <DownloadCard fileId={file.id} node={node} version={version} note={tr('common.error.tooLargeToPreviewInlineSize', { size: humanSize(node.size) })} />;
  } else if (textReadable) {
    body = <EntryText url={url} />;
  } else {
    body = <DownloadCard fileId={file.id} node={node} version={version} />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {actions}
      <div className="flex-1 flex items-center justify-center overflow-auto p-6 relative">
        {body}
        <p className={`absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[11px] ${STAGE_TEXT} ${STAGE_CAPTION_BG} rounded px-2 py-0.5`}>
          {caption}
        </p>
      </div>
    </div>
  );
}

function EntryText({ url }: { url: string }) {
  const tr = useT();
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
      .then((body) => {
        if (cancelled) return;
        setResult({ text: body.slice(0, TEXT_RENDER_MAX), truncated: body.length > TEXT_RENDER_MAX });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  if (failed) return <p className={`text-[13px] ${STAGE_TEXT}`}>{tr('common.error.thisEntryCouldNotBeOpened')}</p>;
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
          {tr('common.description.showingTheFirstTextRenderMaxCharactersDownloadTheFileTo', { textRenderMax: formatNumber(TEXT_RENDER_MAX) })}
        </p>
      )}
    </div>
  );
}
