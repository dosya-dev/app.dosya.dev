/**
 * The Markdown and plain-text editor: a full-page route for .md, .markdown
 * and .txt files (design option B, "Split with live preview"), ported from
 * the desktop app's TextEditorPage.
 *
 * Its own route, /text-editor/:fileId, beside the ONLYOFFICE editor at
 * /editor/:fileId, which stays as it is for Office documents. Like that page
 * it sits outside the dashboard layout: no sidebar, no app-wide shortcuts.
 * The router lazy-loads it, so CodeMirror, marked and DOMPurify stay out of
 * the main bundle.
 *
 * Saving is explicit (Cmd+S / Ctrl+S or the Save button) because every save
 * is a new version of the file; between saves the text is kept as a local
 * draft (lib/text-drafts.ts) so a closed tab loses nothing. Before saving, the
 * file is asked whether it moved on since it was opened, and if it did the
 * user picks Save as copy or Overwrite.
 *
 * Leaving with unsaved changes asks first: React Router's useBlocker (the app
 * uses a data router) catches every in-app way out, Back included, and a
 * beforeunload prompt covers closing or reloading the tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Bold, Code, Heading, Italic, Link2, List, ListOrdered, ListTodo, Quote, X,
} from 'lucide-react';
import { api, apiErrorMessage, ApiError, API_BASE } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { fileRawUrl } from '@/lib/file-url';
import { formatRelative } from '@/lib/format-locale';
import { t as tNow, useT } from '@/lib/i18n';
import { useDocumentTitle } from '@/lib/page-title';
import { looksBinary } from '@/lib/text-detect';
import { toast } from '@/lib/toast';
import { folderHasName } from '@/lib/new-file';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import type { MdFormat } from '@/lib/md-format';
import {
  TEXT_EDIT_MAX_BYTES, changedSince, countWords, pickCopyName, textEditorHref, textEditorKind,
  type FileStamp, type TextEditorState,
} from '@/lib/text-edit';
import { clearDrafts, draftToOffer, saveDraft, type Draft, type DraftStorage } from '@/lib/text-drafts';
import { CodeEditor, type EditorHandle } from '@/components/md-editor/code-editor';
import { MarkdownPreview } from '@/components/md-editor/markdown-preview';
import type { MessageKey } from '@/i18n/keys';

interface EditorFile {
  id: string;
  name: string;
  size_bytes: number;
  mime_type: string;
  lock_mode: string;
  current_version?: number;
  updated_at: number;
  workspace_id: string;
  folder_id: string | null;
}

type ViewMode = 'split' | 'edit' | 'preview';

/** Below this the two panes are too narrow to read; Split falls back to Edit/Preview tabs. */
const NARROW_QUERY = '(max-width: 899px)';
const PREVIEW_DEBOUNCE_MS = 150;
const DRAFT_DEBOUNCE_MS = 400;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    onChange();
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function draftStorage(): DraftStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function filesHrefFor(folderId: string | null): string {
  return folderId ? `/files?folder=${encodeURIComponent(folderId)}` : '/files';
}

/**
 * CodeMirror's find bar labels and its screen reader announcements, keyed by
 * the English names it uses. The labels are the desktop editor's keys.
 */
function searchPhrases(t: ReturnType<typeof useT>): Record<string, string> {
  return {
    Find: t('common.placeholder.find'),
    Replace: t('editor.placeholder.replace'),
    next: t('editor.action.findNext'),
    previous: t('editor.action.findPrevious'),
    all: t('editor.action.selectAllMatches'),
    'match case': t('editor.label.matchCase'),
    regexp: t('editor.label.regularExpression'),
    'by word': t('editor.label.wholeWord'),
    replace: t('editor.action.replace'),
    'replace all': t('editor.action.replaceAll'),
    close: t('editor.accessibility.closeFind'),
    'current match': t('editor.status.currentMatch'),
    'on line': t('editor.status.onLine'),
    // CodeMirror puts the number where "$" stands.
    'replaced $ matches': t('editor.status.matchesReplacedCount', { count: '$' }),
    'replaced match on line $': t('editor.status.replacedTheMatchOnLineLine', { line: '$' }),
  };
}

/** One PUT of the whole text: a new version of `fileId`, or a new file in `folderId`. */
async function uploadText(input: {
  workspaceId: string;
  name: string;
  mimeType: string;
  text: string;
  fileId?: string;
  folderId?: string | null;
}): Promise<{ id: string | null; version: number | null }> {
  const blob = new Blob([input.text], { type: input.mimeType });
  const init = await api<{ ok: boolean; session_id?: string; error?: string }>('/api/upload/init', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      ...(input.fileId ? { file_id: input.fileId } : { folder_id: input.folderId ?? null }),
      file_name: input.name,
      file_size: blob.size,
      mime_type: input.mimeType,
    }),
  });
  if (!init.ok || !init.session_id) throw new Error(init.error ?? tNow('common.error.couldNotStartUpload'));
  const put = await fetch(`${API_BASE}/api/upload/${init.session_id}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': input.mimeType },
    body: blob,
  });
  let data: { ok?: boolean; error?: string; file?: { id?: string; current_version?: number } } = {};
  try { data = await put.json(); } catch { /* not JSON: judged by the status below */ }
  if (!put.ok || !data.ok) throw new Error(data.error ?? tNow('common.error.failedToSave'));
  return { id: data.file?.id ?? null, version: typeof data.file?.current_version === 'number' ? data.file.current_version : null };
}

// ── Route ────────────────────────────────────────────────

export default function TextEditorPage() {
  const { fileId = '' } = useParams();
  // Keyed: "Save as copy" moves to the copy's route, and that is a new file.
  return <TextEditorLoader key={fileId} fileId={fileId} />;
}

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string; file?: EditorFile }
  | { state: 'ready'; file: EditorFile; text: string };

function TextEditorLoader({ fileId }: { fileId: string }) {
  const t = useT();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [folderName, setFolderName] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useDocumentTitle(load.state === 'loading' ? null : load.file?.name ?? null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    (async () => {
      let file: EditorFile | undefined;
      try {
        const res = await api<{ ok: boolean; file?: EditorFile; error?: string }>(`/api/files/${encodeURIComponent(fileId)}`);
        if (!res.ok || !res.file) throw new Error(res.error || tNow('common.error.failedToLoadFileContent'));
        file = res.file;
        if (cancelled) return;
        // Same gates as the entry points (canEditText), asked again here
        // because a route can be reached from a stale list or a typed URL.
        if (!textEditorKind(file.name)) throw new Error(tNow('editor.error.thisFileCannotBeEditedHere'));
        if (file.lock_mode === 'full_lock') throw new Error(tNow('files.feedback.lockedWithAPassword'));
        if (file.size_bytes > TEXT_EDIT_MAX_BYTES) throw new Error(tNow('editor.error.filesOver2MBCanBeViewedButNotEdited'));
        // no-cache: /raw may be cached, and editing a stale copy would save
        // it over the newer version. This revalidates (a 304 is cheap).
        const raw = await fetch(fileRawUrl({ fileId: file.id }), { credentials: 'include', cache: 'no-cache' });
        if (!raw.ok) throw new Error(tNow('common.error.failedToLoadFileContent'));
        const text = await raw.text();
        if (looksBinary(text.slice(0, 8192))) throw new Error(tNow('common.description.thisFileIsNotTextPreviewable'));
        if (!cancelled) setLoad({ state: 'ready', file, text });
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error && !(err instanceof ApiError) && err.message
            ? err.message
            : apiErrorMessage(err, tNow('common.error.failedToLoadFileContent'));
          setLoad({ state: 'error', message, file });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [fileId, attempt]);

  // The folder's name for the breadcrumb: the listing answers with its trail.
  const folderId = load.state === 'ready' ? load.file.folder_id : null;
  const workspaceId = load.state === 'ready' ? load.file.workspace_id : null;
  useEffect(() => {
    if (!folderId || !workspaceId) return;
    let cancelled = false;
    const params = new URLSearchParams({ workspace_id: workspaceId, folder_id: folderId, per_page: '1' });
    api<{ breadcrumbs?: { id: string; name: string }[] }>(`/api/files?${params}`)
      .then((res) => {
        const last = res.breadcrumbs?.[res.breadcrumbs.length - 1];
        if (!cancelled && last) setFolderName(last.name);
      })
      .catch(() => { /* the breadcrumb simply stays shorter */ });
    return () => { cancelled = true; };
  }, [folderId, workspaceId]);

  if (load.state === 'ready') {
    return <TextEditor file={load.file} initialText={load.text} folderName={folderName} />;
  }
  return (
    <EditorShell name={load.state === 'error' ? load.file?.name ?? null : null} folderId={load.state === 'error' ? load.file?.folder_id ?? null : null}>
      {load.state === 'loading' ? (
        <p className="text-sm text-muted-foreground">{t('editor.status.loadingEditor')}</p>
      ) : (
        <div role="alert" className="max-w-sm rounded-xl border bg-card p-8 text-center">
          <p className="mb-4 text-sm text-muted-foreground">{load.message}</p>
          <Button onClick={() => setAttempt((a) => a + 1)}>{t('common.action.tryAgain')}</Button>
        </div>
      )}
    </EditorShell>
  );
}

function useClose(folderId: string | null) {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if ((location.state as TextEditorState | null)?.back) navigate(-1);
    else navigate(filesHrefFor(folderId));
  }, [navigate, location.state, folderId]);
}

/** Header and empty body for the loading and error states. */
function EditorShell({ name, folderId, children }: { name: string | null; folderId: string | null; children: React.ReactNode }) {
  const t = useT();
  const close = useClose(folderId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="flex h-dvh flex-col bg-background" data-testid="text-editor-page">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {t('common.label.files')}
          {name && <> / <bdi className="font-mono font-semibold text-foreground">{name}</bdi></>}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={close} aria-label={t('common.close')} title={t('common.tooltip.closeEsc')}>
          <X />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">{children}</div>
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────

type Tool = { kind: MdFormat; icon: typeof Bold; label: MessageKey; key?: string };
const TOOLS: (Tool | 'sep')[] = [
  { kind: 'bold', icon: Bold, label: 'editor.tooltip.bold', key: 'B' },
  { kind: 'italic', icon: Italic, label: 'editor.tooltip.italic', key: 'I' },
  { kind: 'heading', icon: Heading, label: 'editor.tooltip.heading' },
  'sep',
  { kind: 'bullet', icon: List, label: 'editor.tooltip.bulletList' },
  { kind: 'numbered', icon: ListOrdered, label: 'editor.tooltip.numberedList' },
  { kind: 'task', icon: ListTodo, label: 'editor.tooltip.taskList' },
  'sep',
  { kind: 'link', icon: Link2, label: 'editor.tooltip.link', key: 'K' },
  { kind: 'code', icon: Code, label: 'editor.tooltip.code' },
  { kind: 'quote', icon: Quote, label: 'editor.tooltip.quote' },
];

function TextEditor({ file, initialText, folderName }: { file: EditorFile; initialText: string; folderName: string | null }) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const isMarkdown = textEditorKind(file.name) === 'markdown';
  const mimeType = file.mime_type || (isMarkdown ? 'text/markdown' : 'text/plain');
  const close = useClose(file.folder_id);

  const editorRef = useRef<EditorHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const phrases = useMemo(() => searchPhrases(t), [t]);

  const [text, setText] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const dirty = text !== savedText;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Set just before a navigation the editor makes itself (to a saved copy),
  // which must not ask about changes it has just saved.
  const bypassBlockRef = useRef(false);

  // What the open text was based on; the conflict check compares against it.
  const stampRef = useRef<FileStamp>({ current_version: file.current_version, updated_at: file.updated_at });
  const [lastSaved, setLastSaved] = useState({ version: file.current_version ?? null, atSec: file.updated_at });
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [conflict, setConflict] = useState<{ detail: string | null } | null>(null);

  const draftFile = useMemo(() => ({ workspaceId: file.workspace_id, fileId: file.id }), [file.workspace_id, file.id]);
  const draftRef = useCallback(
    () => ({ ...draftFile, version: stampRef.current.current_version ?? 0 }),
    [draftFile],
  );
  const [offeredDraft, setOfferedDraft] = useState<Draft | null>(() => {
    const s = draftStorage();
    return s ? draftToOffer(s, { ...draftFile, version: file.current_version ?? 0 }, { text: initialText, updatedAtSec: file.updated_at }) : null;
  });

  const [view, setView] = useState<ViewMode>('split');
  const narrow = useMediaQuery(NARROW_QUERY);
  const effectiveView: ViewMode = !isMarkdown ? 'edit' : narrow && view === 'split' ? 'edit' : view;

  const debouncedText = useDebouncedValue(text, PREVIEW_DEBOUNCE_MS);
  const words = useMemo(() => countWords(debouncedText), [debouncedText]);

  // "saved 2m ago" has to keep moving while the page stays open.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // ── Drafts ───────────────────────────────────────────

  useEffect(() => {
    if (!dirty) return;
    const id = window.setTimeout(() => {
      const s = draftStorage();
      if (s) saveDraft(s, draftRef(), text, Date.now());
    }, DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [text, dirty, draftRef]);

  const dropDrafts = useCallback(() => {
    const s = draftStorage();
    if (s) clearDrafts(s, draftFile);
  }, [draftFile]);

  // ── Leaving ──────────────────────────────────────────

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirtyRef.current && !bypassBlockRef.current && currentLocation.pathname !== nextLocation.pathname);

  // Closing or reloading the tab: the browser's own prompt (its wording is fixed).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const openVersions = () => {
    const params = new URLSearchParams();
    if (file.folder_id) params.set('folder', file.folder_id);
    params.set('view', file.id);
    params.set('tab', 'versions');
    navigate(`/files?${params}`);
  };

  // ── Saving ───────────────────────────────────────────

  const save = useCallback(async (force = false) => {
    if (savingRef.current) return;
    const content = editorRef.current?.getText() ?? text;
    savingRef.current = true;
    setSaving(true);
    try {
      if (!force) {
        const latest = await api<{ ok: boolean; file?: EditorFile }>(`/api/files/${file.id}`);
        if (latest.ok && latest.file && changedSince(stampRef.current, latest.file)) {
          // Who and when, if the version list answers; the dialog works without it.
          let detail: string | null = null;
          try {
            const v = await api<{ versions?: { version_number: number; uploader_name: string | null; created_at: number }[] }>(`/api/files/${file.id}/versions`);
            const top = v.versions?.[0];
            if (top) {
              detail = tNow('editor.description.nameSavedVersionWhen', {
                hasName: top.uploader_name ? 'yes' : 'no',
                name: top.uploader_name ?? '',
                version: top.version_number,
                when: formatRelative(top.created_at),
              });
            }
          } catch { /* detail stays out */ }
          setConflict({ detail });
          return;
        }
      }
      const out = await uploadText({ workspaceId: file.workspace_id, fileId: file.id, name: file.name, mimeType, text: content });
      const nowSec = Math.floor(Date.now() / 1000);
      stampRef.current = { current_version: out.version ?? undefined, updated_at: nowSec };
      setLastSaved({ version: out.version, atSec: nowSec });
      setSavedText(content);
      dropDrafts();
      setOfferedDraft(null);
      toast.success(tNow('editor.status.savedAsANewVersion'));
    } catch (err) {
      toast.error(tNow('common.error.couldNotSaveThisFile'), apiErrorMessage(err, err instanceof Error ? err.message : undefined));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [file.id, file.name, file.workspace_id, mimeType, text, dropDrafts]);

  const saveAsCopy = useCallback(async () => {
    setConflict(null);
    if (savingRef.current) return;
    const content = editorRef.current?.getText() ?? text;
    savingRef.current = true;
    setSaving(true);
    try {
      // The upload API turns a same-name upload into a new version of that
      // file, so the copy's name is checked against the folder first.
      const name = await pickCopyName(
        file.name,
        (candidate) => folderHasName({ workspaceId: file.workspace_id, folderId: file.folder_id, name: candidate }),
        (base, n) => tNow('editor.label.copyName', { name: base, count: n }),
      );
      const out = await uploadText({ workspaceId: file.workspace_id, folderId: file.folder_id, name, mimeType, text: content });
      // The edit now lives in the copy; this file's draft is done with.
      dropDrafts();
      setSavedText(content);
      toast.success(tNow('files.feedback.createdName', { name }));
      if (out.id) {
        bypassBlockRef.current = true;
        navigate(textEditorHref(out.id), { replace: true, state: location.state });
      }
    } catch (err) {
      toast.error(tNow('common.error.couldNotSaveThisFile'), apiErrorMessage(err, err instanceof Error ? err.message : undefined));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [file.name, file.workspace_id, file.folder_id, mimeType, text, dropDrafts, navigate, location.state]);

  // ── Keys ─────────────────────────────────────────────

  const dialogOpen = conflict !== null || blocker.state === 'blocked';
  const dialogOpenRef = useRef(dialogOpen);
  dialogOpenRef.current = dialogOpen;

  // ── Find ─────────────────────────────────────────────

  // The find bar lives in the source pane; Preview alone hides that pane, so
  // asking for find there brings the source back first, then opens the bar.
  const [findRequest, setFindRequest] = useState<{ replace: boolean } | null>(null);
  const openFind = useCallback((replace = false) => {
    if (dialogOpenRef.current) return;
    setFindRequest({ replace });
    setView((v) => (v === 'preview' ? (narrow ? 'edit' : 'split') : v));
  }, [narrow]);
  useEffect(() => {
    if (!findRequest || effectiveView === 'preview') return;
    editorRef.current?.openSearch({ replace: findRequest.replace });
    setFindRequest(null);
  }, [findRequest, effectiveView]);

  // Cmd+S / Ctrl+S, Cmd+F / Ctrl+F and Escape, heard first (capture) wherever
  // focus is. Save never reaches the browser's "Save page as"; find opens the
  // editor's own bar rather than the browser's, from the toolbar or the
  // preview too. Dialogs own Escape while they are open, and an open find bar
  // takes it before it means "leave".
  const latest = useRef({ save, close, openFind });
  latest.current = { save, close, openFind };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && !e.shiftKey && key === 's') {
        e.preventDefault();
        e.stopPropagation();
        if (!dialogOpenRef.current) void latest.current.save();
        return;
      }
      // Option+F types "ƒ" on a Mac, so the replace chord is matched by code.
      if (mod && !e.shiftKey && (key === 'f' || (e.altKey && e.code === 'KeyF'))) {
        e.preventDefault();
        e.stopPropagation();
        latest.current.openFind(e.altKey);
        return;
      }
      if (e.key === 'Escape' && !dialogOpenRef.current) {
        e.preventDefault();
        if (editorRef.current?.closeSearch()) {
          e.stopPropagation();
          return;
        }
        latest.current.close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Everything typed in here stays here: no document-level shortcut handler
  // (the app's Cmd+K search, select all, delete, ...) may act on a keystroke
  // meant for the text.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    el.addEventListener('keydown', stop);
    return () => el.removeEventListener('keydown', stop);
  }, []);

  // ── Scroll sync (proportional) ───────────────────────

  useEffect(() => {
    if (effectiveView !== 'split') return;
    const ed = editorRef.current?.scroller();
    const pv = previewRef.current;
    if (!ed || !pv) return;
    let driver: 'editor' | 'preview' = 'editor';
    const follow = (from: HTMLElement, to: HTMLElement) => {
      const max = from.scrollHeight - from.clientHeight;
      const ratio = max > 0 ? from.scrollTop / max : 0;
      to.scrollTop = ratio * Math.max(0, to.scrollHeight - to.clientHeight);
    };
    const onEditorScroll = () => { if (driver === 'editor') follow(ed, pv); };
    const onPreviewScroll = () => { if (driver === 'preview') follow(pv, ed); };
    const driveEditor = () => { driver = 'editor'; };
    const drivePreview = () => { driver = 'preview'; };
    ed.addEventListener('scroll', onEditorScroll, { passive: true });
    pv.addEventListener('scroll', onPreviewScroll, { passive: true });
    for (const ev of ['wheel', 'pointerdown', 'keydown'] as const) ed.addEventListener(ev, driveEditor, { passive: true });
    for (const ev of ['wheel', 'pointerdown'] as const) pv.addEventListener(ev, drivePreview, { passive: true });
    return () => {
      ed.removeEventListener('scroll', onEditorScroll);
      pv.removeEventListener('scroll', onPreviewScroll);
      for (const ev of ['wheel', 'pointerdown', 'keydown'] as const) ed.removeEventListener(ev, driveEditor);
      for (const ev of ['wheel', 'pointerdown'] as const) pv.removeEventListener(ev, drivePreview);
    };
  }, [effectiveView]);

  // ── Render ───────────────────────────────────────────

  const viewOptions: ViewMode[] = narrow ? ['edit', 'preview'] : ['split', 'edit', 'preview'];
  const viewLabel = (v: ViewMode) => (v === 'split' ? t('editor.label.split') : v === 'edit' ? t('common.edit') : t('editor.label.preview'));
  const savedInfo = lastSaved.version != null
    ? t('editor.status.versionSavedWhen', { version: lastSaved.version, when: formatRelative(lastSaved.atSec) })
    : null;
  const crumb = 'shrink-0 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

  return (
    <>
      <div ref={rootRef} className="flex h-dvh flex-col bg-background" data-testid="text-editor-page">
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <nav aria-label={t('editor.accessibility.location')} data-testid="editor-breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
            <button type="button" onClick={() => navigate('/files')} className={crumb}>
              {t('common.label.files')}
            </button>
            {folderName && (
              <>
                <span aria-hidden>/</span>
                <button type="button" onClick={() => navigate(filesHrefFor(file.folder_id))} className={`${crumb} min-w-0 truncate`}>
                  <bdi>{folderName}</bdi>
                </button>
              </>
            )}
            <span aria-hidden>/</span>
            <bdi className="min-w-0 truncate font-mono font-semibold text-foreground" aria-current="page">{file.name}</bdi>
            {dirty && (
              <span
                data-testid="unsaved-dot"
                role="img"
                aria-label={t('editor.status.unsavedChanges')}
                title={t('editor.status.unsavedChanges')}
                className="size-[7px] shrink-0 rounded-full bg-warning"
              />
            )}
          </nav>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={openVersions} className="hidden sm:inline-flex">
              {t('files.label.versionHistory')}
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={saving}
              aria-label={saving ? t('common.status.saving') : t('common.save')}
              aria-keyshortcuts={IS_MAC ? 'Meta+S' : 'Control+S'}
            >
              {saving ? t('common.status.saving') : t('common.save')}
              <kbd aria-hidden className="hidden font-mono text-[10px] font-normal opacity-70 sm:inline">{IS_MAC ? '⌘S' : 'Ctrl+S'}</kbd>
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={close} aria-label={t('common.close')} title={t('common.tooltip.closeEsc')}>
              <X />
            </Button>
          </div>
        </header>

        {isMarkdown && (
          <div className="flex h-10 shrink-0 items-center gap-0.5 border-b px-2">
            <div role="toolbar" aria-label={t('editor.accessibility.formatting')} className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
              {TOOLS.map((tool, i) => {
                if (tool === 'sep') return <span key={`sep${i}`} aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-border" />;
                const Icon = tool.icon;
                const label = t(tool.label);
                const name = tool.key ? `${label} (${MOD}${tool.key})` : label;
                return (
                  <Button
                    key={tool.kind}
                    variant="ghost"
                    size="icon-sm"
                    aria-label={name}
                    title={name}
                    aria-keyshortcuts={tool.key ? `${IS_MAC ? 'Meta' : 'Control'}+${tool.key}` : undefined}
                    // Keep the editor's selection: a click must not move focus.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => editorRef.current?.format(tool.kind)}
                    disabled={effectiveView === 'preview'}
                    className="text-muted-foreground"
                  >
                    <Icon />
                  </Button>
                );
              })}
            </div>
            <div className="flex-1" />
            <div role="group" aria-label={t('editor.accessibility.layout')} className="inline-flex shrink-0 overflow-hidden rounded-lg border bg-background">
              {viewOptions.map((v) => {
                const pressed = effectiveView === v;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => setView(v)}
                    className={`px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 ${pressed ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {viewLabel(v)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {offeredDraft && (
          <div role="status" className="flex shrink-0 items-center gap-3 border-b bg-muted/50 px-4 py-2 text-sm">
            <span className="size-[7px] shrink-0 rounded-full bg-warning" aria-hidden />
            <span className="min-w-0 flex-1">{t('editor.status.youHaveUnsavedChangesFromEarlier')}</span>
            <Button
              size="sm"
              onClick={() => { editorRef.current?.setText(offeredDraft.text); setOfferedDraft(null); editorRef.current?.focus(); }}
            >
              {t('common.action.restore')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { dropDrafts(); setOfferedDraft(null); }}>
              {t('editor.action.discard')}
            </Button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* Hidden, never unmounted: CodeMirror holds the text and its undo history. */}
          <div
            data-testid="source-pane"
            className={
              effectiveView === 'preview' ? 'hidden'
                : effectiveView === 'split' ? 'min-w-0 flex-1 basis-1/2 border-e'
                  : 'min-w-0 flex-1'
            }
          >
            <CodeEditor
              ref={editorRef}
              initialText={initialText}
              markdown={isMarkdown}
              label={file.name}
              phrases={phrases}
              onChange={setText}
              onCursor={setCursor}
            />
          </div>
          {isMarkdown && effectiveView !== 'edit' && (
            <div className="min-w-0 flex-1 basis-1/2">
              <MarkdownPreview ref={previewRef} text={debouncedText} label={t('editor.label.preview')} />
            </div>
          )}
        </div>

        <footer className="flex h-7 shrink-0 items-center gap-4 overflow-hidden border-t px-3 font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
          <span>{isMarkdown ? t('common.label.markdown') : t('editor.label.plainText')}</span>
          <span>{t('editor.status.wordCount', { count: words })}</span>
          <span data-testid="cursor-position">{t('editor.status.lineColumn', { line: cursor.line, column: cursor.col })}</span>
          <span className="flex-1" />
          {dirty && <span>{t('editor.status.unsavedChanges')}</span>}
          {savedInfo && <span className="hidden text-foreground sm:inline">{savedInfo}</span>}
        </footer>
      </div>

      <Dialog open={conflict !== null} onOpenChange={(open) => { if (!open) setConflict(null); }}>
        <DialogContent showCloseButton={false} data-testid="conflict-dialog">
          <DialogHeader>
            <DialogTitle>{t('common.heading.areYouSure')}</DialogTitle>
            <DialogDescription>{t('editor.description.thisFileChangedSinceYouOpenedIt')}</DialogDescription>
            {conflict?.detail && <p className="text-xs text-muted-foreground">{conflict.detail}</p>}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflict(null)}>{t('common.cancel')}</Button>
            <Button variant="outline" onClick={() => { setConflict(null); void save(true); }}>{t('editor.action.overwrite')}</Button>
            <Button autoFocus onClick={() => void saveAsCopy()}>{t('editor.action.saveAsCopy')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={blocker.state === 'blocked'} onOpenChange={(open) => { if (!open && blocker.state === 'blocked') blocker.reset(); }}>
        <DialogContent showCloseButton={false} data-testid="leave-dialog">
          <DialogHeader>
            <DialogTitle>{t('common.heading.areYouSure')}</DialogTitle>
            <DialogDescription>{t('editor.description.youHaveUnsavedChangesTheyWillBeLost')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" autoFocus onClick={() => blocker.reset?.()}>{t('editor.action.keepEditing')}</Button>
            <Button
              variant="destructive"
              onClick={() => {
                dropDrafts();
                blocker.proceed?.();
              }}
            >
              {t('editor.action.discardChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
