import { formatDateWith, localDigits } from '@/lib/format-locale';
import { currentDir, t as tNow, useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import { useState, useEffect, useCallback, useMemo, useRef, Suspense, type ReactNode } from 'react';
import { api, API_BASE } from '@/api/client';
import {
  X, Download, ChevronLeft, ChevronRight, ChevronDown, Pencil, Clock, SquarePen, Loader2,
  Star, Share2, MoreHorizontal, PanelRight, Trash2, Move, Lock, LockOpen,
  Minus, Plus, Maximize, Check, Link2, MessageSquare, FileText,
} from 'lucide-react';
import { PeopleChips } from '@/components/personas/people-chips';
import { humanSize, extOf, isImage, isVideo, isAudio, fileIconSrc, isOfficeFile, isArchive, colorFor, regionLabel, originLabel, timeAgo } from '@/lib/helpers';
import { FilePreviewImage } from '@/components/file-preview-image';
import { DecodedPreview } from '@/components/decoded-preview';
import { ArchiveViewer } from '@/components/archive-viewer/archive-viewer';
import { toast } from '@/lib/toast';
import { openReport } from '@/stores/report-problem';
import { lazyChunk } from '@/lib/chunk-reload';
import { decodeTextBytes, isTextReadable, langFromExtension, looksBinary } from '@/lib/text-detect';
import { previewKindFor } from '@/lib/preview-formats.generated';
import { parseCsvTable } from '@/lib/csv-table';
import { parseMarkdown, type InlineToken, type MdBlock } from '@/lib/markdown';
import { BookViewer } from '@/components/book-viewer';
import { highlightToHtml } from '@/lib/text-highlight';
import { useInFileFind } from '@/lib/use-in-file-find';
import { TextFindBar } from '@/components/text-find-bar';
import { TextEditorOverlay } from '@/components/text-editor';
import { TEXT_EDIT_MAX_BYTES, canEditText as canEditInTextEditor } from '@/lib/text-edit';
import { VCardView } from '@/components/vcard-viewer';
import { CalendarView } from '@/components/calendar-viewer';
import { AudioPlayer } from '@/components/audio/audio-player';
import { VideoPlayer } from '@/components/video/video-player';
import { OfficePreview } from '@/components/office-preview';
import { collapseLiveTwins, isLiveStill, isLiveTwin, liveTwinOf } from '@/lib/live-photos';
import { LivePhotoStage } from './live-photo-stage';
import { LiveBadge } from './live-badge';
import type { FileItem } from '@/lib/file-types';
import { AnchorProvider, type PendingAnchor } from '@/components/comments/anchor-context';
import { CommentsPanel } from '@/components/comments/comments-panel';
import { useFileComments, markersFrom } from '@/components/comments/use-file-comments';
import { olderVersionNote } from '@/components/comments/format';

// pdf.js is ~350KB gzipped plus a worker - loaded only when a PDF is opened.
const PdfViewer = lazyChunk(() => import('@/components/pdf-viewer/pdf-viewer'));


// ── Types ─────────────────────────────────────────────────

// FileItem is imported at the top - it was declared here locally without
// `origin`, describing the same API row differently from the files page.

interface Version {
  version_number: number;
  size_bytes: number;
  created_at: number;
  uploader_name: string | null;
}

/**
 * Optional per-file actions supplied by the hosting page. The files page wires
 * these to its existing dialogs and permission checks (a callback is passed
 * only when the role can perform it); hosts that feed the viewer their own
 * rows (map pins, file-request uploads) pass nothing and the controls hide.
 */
export interface FileViewerActions {
  isFavourite?: boolean;
  onToggleFavourite?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
  onRename?: (file: FileItem) => void;
  onMove?: (file: FileItem) => void;
  onLock?: (file: FileItem) => void;
  onDelete?: (file: FileItem) => void;
}

interface FileViewerProps {
  file: FileItem;
  files: FileItem[];
  workspaceId: string;
  onClose: () => void;
  onNavigate: (file: FileItem) => void;
  onRefresh: () => void;
  actions?: FileViewerActions;
  /** Deep links open straight onto a tab: Comments (a mention notification) or Versions (the text editor's Version history). */
  initialTab?: 'details' | 'versions' | 'comments';
  initialAnchor?: { ms: number } | { page: number } | null;
  initialCommentId?: string | null;
  /**
   * Opens a Markdown or plain-text file in the full-page editor
   * (/text-editor/:id). Hosts pass it with their router's navigate; without
   * it, Edit on such a file falls back to the in-viewer text editor.
   */
  onEditText?: (file: FileItem) => void;
}

// ── Helpers ───────────────────────────────────────────────

function isPdf(name: string) { return extOf(name) === 'pdf'; }
function isEditable(name: string) { return isImage(name) || isVideo(name); }

const THUMB_WINDOW = 6;
function getThumbWindow(activeIdx: number, total: number) {
  if (total <= THUMB_WINDOW) return { start: 0, end: total };
  let start = activeIdx - Math.floor(THUMB_WINDOW / 2);
  if (start < 0) start = 0;
  let end = start + THUMB_WINDOW;
  if (end > total) { end = total; start = end - THUMB_WINDOW; }
  return { start, end };
}

// ── Pintura theme bridge ──────────────────────────────────
// Pintura derives its whole palette from --color-background / --color-foreground,
// supplied as "R, G, B" channels (it wraps them as rgba(var(--color-background), α)).
// Its default is black-on-white, so on a dark app theme the editor renders light and
// clashes. The app's theme lives in oklch() CSS vars, which pure CSS can't convert into
// Pintura's RGB channels - so resolve them to concrete sRGB here and set them inline on
// the editor root (an inline style beats Pintura's own stylesheet rule), matching any of
// the app's themes and light/dark modes.

/** Paint a CSS color onto a 1×1 canvas and read back its sRGB triple. Handles oklch()
 *  (and every other CSS color form); returns null if the browser can't parse it. */
function resolveRgb(cssColor: string): [number, number, number] | null {
  const value = cssColor.trim();
  if (!value) return null;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  const sentinel = '#010203';
  ctx.fillStyle = sentinel;
  ctx.fillStyle = value;
  // An unparseable value leaves fillStyle unchanged (e.g. no oklch canvas support).
  if (ctx.fillStyle === sentinel && value.toLowerCase() !== sentinel) return null;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function themeVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Recolor a freshly-created Pintura editor to match the active app theme + mode. The
 *  editor root is class-tagged by Svelte a tick after appendEditor(), so retry briefly. */
function applyEditorTheme(container: HTMLElement, attempt = 0): void {
  const root = container.querySelector<HTMLElement>('.pintura-editor, pintura-editor');
  if (!root) {
    if (attempt < 5) requestAnimationFrame(() => applyEditorTheme(container, attempt + 1));
    return;
  }
  const channels = (name: string) => { const rgb = resolveRgb(themeVar(name)); return rgb && rgb.join(', '); };
  const color = (name: string) => { const rgb = resolveRgb(themeVar(name)); return rgb && `rgb(${rgb.join(', ')})`; };

  const bg = channels('--background');
  const fg = channels('--foreground');
  const primary = color('--primary');
  const primaryText = color('--primary-foreground');

  if (bg) root.style.setProperty('--color-background', bg);
  if (fg) root.style.setProperty('--color-foreground', fg);
  if (primary) {
    root.style.setProperty('--color-primary', primary);
    root.style.setProperty('--color-primary-dark', primary);
  }
  if (primaryText) root.style.setProperty('--color-primary-text', primaryText);
}

// ── Component ─────────────────────────────────────────────

export function FileViewer({ file, files, workspaceId, onClose, onNavigate, onRefresh, actions, initialTab, initialAnchor, initialCommentId, onEditText }: FileViewerProps) {
  const t = useT();
  const [versions, setVersions] = useState<Version[]>([]);
  const [activeVersion, setActiveVersion] = useState(-1);
  const [closing, setClosing] = useState(false);
  const [editingOpen, setEditingOpen] = useState(false);
  // Rail on desktop, bottom sheet on mobile - one state, CSS decides which.
  // Starts open on desktop, closed on small screens (jsdom has no matchMedia).
  const [inspectorOpen, setInspectorOpen] = useState(
    () => initialTab === 'comments' || initialTab === 'versions' || typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 768px)').matches,
  );
  const [inspectorTab, setInspectorTab] = useState<'details' | 'versions' | 'comments'>(initialTab ?? 'details');
  const [menuOpen, setMenuOpen] = useState(false);
  const [stripCollapsed, setStripCollapsed] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [restoringVer, setRestoringVer] = useState<number | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<any>(null);
  const [textEditOpen, setTextEditOpen] = useState(false);
  const closeTextEdit = useCallback(() => setTextEditOpen(false), []);
  const canTextEdit = isTextReadable(file.name, file.mime_type)
    && file.size_bytes <= TEXT_EDIT_MAX_BYTES
    && file.lock_mode !== 'full_lock';
  // Markdown and .txt get the full-page editor (split preview, find and
  // replace, drafts); other text (JSON, code, ...) keeps the in-viewer one.
  const editText = () => {
    if (onEditText && canEditInTextEditor(file)) onEditText(file);
    else setTextEditOpen(true);
  };

  // A Live Photo is one stop: its twin leaves the prev/next order and the
  // filmstrip. Opened directly (from list view or search) the twin is still an
  // ordinary video slide, so the list is collapsed only around stills.
  const navFiles = useMemo(() => {
    const collapsed = collapseLiveTwins(files);
    return collapsed.some((f) => f.id === file.id) ? collapsed : files;
  }, [files, file.id]);
  // The twin's ROW is only present in folder listings; its ID is on the still
  // everywhere the API computes pairs, so playback keys off the id and the
  // Details row falls back to a generic name when the row is absent.
  const twinId = isLiveStill(file) ? file.live_video_id! : null;
  const twinRow = liveTwinOf(files, file);
  const twinName = twinRow?.name ?? null;
  const twinSize = twinRow ? humanSize(twinRow.size_bytes) : null;

  const idx = navFiles.findIndex((f) => f.id === file.id);
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < navFiles.length - 1;
  const counter = idx >= 0 ? `${localDigits(idx + 1)} / ${localDigits(navFiles.length)}` : '';

  // Header slot elements the PDF viewer portals its controls into. Callback
  // refs are stable and identity-guarded so header re-renders don't loop state.
  const [pdfSlots, setPdfSlots] = useState<{ left: HTMLDivElement | null; center: HTMLDivElement | null }>({ left: null, center: null });
  // rtl-ok: code, a slot name in state (not a CSS property)
  const setPdfSlotLeft = useCallback((el: HTMLDivElement | null) => setPdfSlots((s) => (s.left === el ? s : { ...s, left: el })), []);
  const setPdfSlotCenter = useCallback((el: HTMLDivElement | null) => setPdfSlots((s) => (s.center === el ? s : { ...s, center: el })), []);

  // Load versions
  const currentFileIdRef = useRef(file.id);
  currentFileIdRef.current = file.id;
  const loadVersions = useCallback(async () => {
    const forId = file.id;
    try {
      const data = await api<{ ok: boolean; current_version: number; versions: Version[] }>(
        `/api/files/${file.id}/versions`
      );
      // A slow response for the previous file must not repaint this one.
      if (currentFileIdRef.current !== forId) return;
      if (data.ok && data.versions?.length) {
        setVersions(data.versions);
        setActiveVersion(data.versions[0].version_number);
      } else {
        setVersions([]);
        setActiveVersion(-1);
      }
    } catch {
      if (currentFileIdRef.current === forId) setVersions([]);
    }
  }, [file.id]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  // A new file starts at fit zoom with the more-menu closed. State is
  // adjusted during render on the prop change (the React-documented pattern)
  // rather than in an effect, so there is no extra commit.
  const [prevFileId, setPrevFileId] = useState(file.id);
  if (prevFileId !== file.id) {
    setPrevFileId(file.id);
    setZoom(100);
    setMenuOpen(false);
  }

  // Close the more-menu on any outside click while it is open.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = () => setMenuOpen(false);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuOpen]);

  const restoreVersion = useCallback(async (versionNumber: number) => {
    setRestoringVer(versionNumber);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/files/${file.id}/versions/restore`, {
        method: 'POST',
        body: JSON.stringify({ version_number: versionNumber }),
      });
      if (res.ok) {
        toast.success(tNow('common.feedback.restored'), tNow('common.feedback.restoredToVVersionnumber', { versionNumber }));
        loadVersions();
        onRefresh();
      } else {
        toast.error(tNow('common.error.restoreFailed'), res.error ?? tNow('common.error.restoreFailed'));
      }
    } catch {
      toast.error(tNow('common.error.restoreFailed'), tNow('common.error.restoreFailed.restoreFailed'));
    } finally {
      setRestoringVer(null);
    }
  }, [file.id, loadVersions, onRefresh]);

  // Build raw URL for active version
  const rawUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (activeVersion > 0 && versions.length > 0 && activeVersion !== versions[0].version_number) {
      params.set('version', String(activeVersion));
    }
    params.set('_t', String(Date.now()));
    return `${API_BASE}/api/files/${file.id}/raw?${params}`;
  }, [file.id, activeVersion, versions]);

  // Stable raw URL for consumers that hold live state off the source: the text
  // editor's EditorView, and the audio player's <audio> element plus its tag
  // read and waveform decode. Identity only changes when the file/version
  // actually changes, so an unrelated FileViewer re-render doesn't tear the
  // editor down or restart playback and re-download the track.
  // Cache-bust with a deterministic value derived from state (latest version's
  // created_at, falling back to the file's current_version) instead of
  // Date.now() - calling Date.now() during a useMemo body is flagged as impure
  // by react-hooks/purity (unlike the rawUrl useCallback above, whose body only
  // runs when invoked, not synchronously during render).
  //
  // The fallback is current_version, NOT updated_at: since migration 0105 the
  // API returns the SOURCE modified date in updated_at for an untouched cloud
  // import, which is a date from the provider rather than a marker of when
  // these bytes appeared here. The version counter is the direct expression of
  // "different bytes" that this token actually wants.
  const stableRawUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (activeVersion > 0 && versions.length > 0 && activeVersion !== versions[0].version_number) {
      params.set('version', String(activeVersion));
    }
    const cacheBust = versions.length > 0 ? versions[0].created_at : file.current_version;
    params.set('_t', String(cacheBust));
    return `${API_BASE}/api/files/${file.id}/raw?${params}`;
  }, [file.id, file.current_version, activeVersion, versions]);

  const downloadUrl = `${API_BASE}/api/files/${file.id}/download`;

  // The version actually being shown - mirrors the logic inside rawUrl() above.
  const previewVersion =
    activeVersion > 0 && versions.length > 0 && activeVersion !== versions[0].version_number
      ? activeVersion
      : undefined;

  // Comments live at viewer level so players can draw markers (and a deep link
  // can seek) even while the Comments tab is closed.
  const thread = useFileComments(file.id, workspaceId);
  const currentVersion = versions[0]?.version_number ?? file.current_version ?? null;
  const markers = useMemo(() => markersFrom(thread.comments, currentVersion), [thread.comments, currentVersion]);
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor>(initialAnchor ?? null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(initialCommentId ?? null);
  // Stable: the provider's effects depend on these.
  // Navigating with the viewer mounted: drop everything that belonged to the
  // previous file so a deep-link anchor, a highlighted comment or the old
  // version list can never leak onto the next one (adjusted during render).
  const [commentsFileId, setCommentsFileId] = useState(file.id);
  if (commentsFileId !== file.id) {
    setCommentsFileId(file.id);
    setPendingAnchor(null);
    setActiveCommentId(null);
    setVersions([]);
  }
  const onPendingApplied = useCallback(() => setPendingAnchor(null), []);
  // Read through a ref so onSelectComment stays stable while the thread loads.
  const selectFacts = useRef({ comments: thread.comments, currentVersion });
  selectFacts.current = { comments: thread.comments, currentVersion };
  const onSelectComment = useCallback((id: string) => {
    setActiveCommentId(id);
    setInspectorOpen(true);
    setInspectorTab('comments');
    // Every way of selecting an anchored comment (panel chip, waveform, video
    // strip, page marker) lands here, so "left on vN" is said once, here.
    const c = selectFacts.current.comments.find((x) => x.id === id);
    const note = c ? olderVersionNote(c, selectFacts.current.currentVersion) : null;
    if (note) toast.info(note);
  }, []);

  // Navigate version
  const navigateVersion = useCallback((dir: number) => {
    if (versions.length <= 1) return;
    const curIdx = versions.findIndex((v) => v.version_number === activeVersion);
    const newIdx = curIdx + dir;
    if (newIdx >= 0 && newIdx < versions.length) {
      setActiveVersion(versions[newIdx].version_number);
    }
  }, [versions, activeVersion]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingOpen || textEditOpen) return;
      // The PDF toolbar portals a page-number input into the header; typing
      // there (or in any future field) must not drive the viewer.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') { handleClose(); return; }
      // Arrow keys follow the reading direction: the arrow on the inline-end side opens the next file.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const forward = (e.key === 'ArrowRight') === (currentDir() === 'ltr');
        if (forward && hasNext) onNavigate(navFiles[idx + 1]);
        if (!forward && hasPrev) onNavigate(navFiles[idx - 1]);
      }
      if (e.key === 'ArrowUp') { e.preventDefault(); navigateVersion(-1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); navigateVersion(1); }
      if (e.key === 'i' || e.key === 'I') setInspectorOpen((o) => !o);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [hasPrev, hasNext, idx, navFiles, onNavigate, navigateVersion, editingOpen, textEditOpen]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => onClose(), 250);
  };

  // ── Pintura editor ──────────────────────────────────────

  // Step 1: clicking Edit just opens the overlay (renders the container div)
  const openEditor = useCallback(() => {
    setEditingOpen(true);
  }, []);

  // Step 2: once the overlay has rendered and the ref is populated, initialize Pintura
  useEffect(() => {
    if (!editingOpen || !editorContainerRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        const pintura = await import('@pqina/pintura');
        await import('@pqina/pintura/pintura.css');

        if (cancelled || !editorContainerRef.current) return;

        const src = `${API_BASE}/api/files/${file.id}/raw`;
        const defaults = pintura.getEditorDefaults();

        if (isVideo(file.name)) {
          const pinturaVideo = await import('@pqina/pintura-video');
          await import('@pqina/pintura-video/pinturavideo.css');
          pintura.setPlugins(pinturaVideo.plugin_trim);
          defaults.imageWriter = pintura.createDefaultMediaWriter(
            undefined,
            [
              pintura.createDefaultImageWriter(),
              pinturaVideo.createDefaultVideoWriter({
                encoder: pinturaVideo.createMediaStreamEncoder({ imageStateToCanvas: pintura.imageStateToCanvas }),
              }),
            ],
          );
          defaults.locale = { ...defaults.locale, ...pinturaVideo.plugin_trim_locale_en_gb };

          const res = await fetch(src, { credentials: 'include' });
          if (!res.ok) throw new Error(tNow('common.error.failedToLoadVideoHttpResstatus', { resStatus: res.status }));
          const blob = await res.blob();
          const ext = extOf(file.name);
          const mimeMap: Record<string, string> = {
            mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
            mkv: 'video/x-matroska', webm: 'video/webm', ogg: 'video/ogg',
          };
          const videoFile = new File([blob], file.name, { type: mimeMap[ext] || blob.type });
          if (cancelled || !editorContainerRef.current) return;
          editorInstanceRef.current = pintura.appendEditor(editorContainerRef.current, {
            ...defaults, src: videoFile, imageCropAspectRatio: undefined,
          } as any);
        } else {
          // Pintura fetches `src` itself. A cross-origin URL to api.dosya.dev fails
          // the browser CORS check on Pintura's XHR, so fetch the image here (the
          // app's own credentialed request works) and hand Pintura a local File -
          // same approach as the video branch above.
          const res = await fetch(src, { credentials: 'include' });
          if (!res.ok) throw new Error(tNow('common.error.failedToLoadImageHttpResstatus', { resStatus: res.status }));
          const blob = await res.blob();
          if (cancelled || !editorContainerRef.current) return;
          const imageFile = new File([blob], file.name, { type: blob.type || file.mime_type });
          editorInstanceRef.current = pintura.appendEditor(editorContainerRef.current, {
            ...defaults, src: imageFile, imageCropAspectRatio: undefined,
          } as any);
        }

        // Recolor the editor chrome to match the active app theme + light/dark mode.
        if (editorContainerRef.current) applyEditorTheme(editorContainerRef.current);

        editorInstanceRef.current.on('process', async (res: any) => {
          const blob = res.dest as Blob;
          try {
            const initRes = await api<{ ok: boolean; session_id?: string; error?: string }>('/api/upload/init', {
              method: 'POST',
              body: JSON.stringify({
                workspace_id: workspaceId,
                file_id: file.id,
                file_name: file.name,
                file_size: blob.size,
                mime_type: blob.type || 'application/octet-stream',
              }),
            });
            if (!initRes.ok || !initRes.session_id) {
              toast.error(tNow('common.error.uploadFailed'), initRes.error ?? tNow('common.error.couldNotStartUpload'), {
                action: { label: tNow('common.error.report'), onClick: () => openReport({ errorMessage: initRes.error ?? tNow('common.error.couldNotStartUpload') }) },
              });
              return;
            }
            const uploadRes = await fetch(`${API_BASE}/api/upload/${initRes.session_id}`, {
              method: 'PUT',
              credentials: 'include',
              headers: { 'Content-Type': blob.type || 'application/octet-stream' },
              body: blob,
            });
            const uploadData = await uploadRes.json() as { ok: boolean; error?: string };
            if (!uploadRes.ok || !uploadData.ok) {
              toast.error(tNow('common.error.saveFailed'), uploadData.error ?? tNow('common.error.failedToSave'));
              return;
            }
            toast.success(tNow('common.feedback.saved'), isVideo(file.name) ? tNow('common.feedback.videoSavedAsNewVersion') : tNow('common.feedback.imageSavedAsNewVersion'));
            closeEditor();
            onRefresh();
            loadVersions();
          } catch {
            toast.error(tNow('common.error.saveFailed'), tNow('common.error.failedToSaveEditedFile'));
          }
        });
      } catch (err) {
        // Surface the real reason instead of swallowing it - e.g. a failed dynamic
        // import means the Pintura chunk didn't load (commonly the private-registry
        // package installed as the public stub because NPM_TOKEN was missing at build).
        console.error('[pintura] failed to load/init editor', err);
        toast.error(tNow('common.error.editorUnavailable'), err instanceof Error ? err.message : tNow('common.error.imageEditorNotAvailable'));
        setEditingOpen(false);
      }
    })();

    return () => { cancelled = true; };
  }, [editingOpen, file.id, file.name, workspaceId, onRefresh, loadVersions]);

  const closeEditor = useCallback(() => {
    if (editorInstanceRef.current?.destroy) {
      editorInstanceRef.current.destroy();
    }
    editorInstanceRef.current = null;
    if (editorContainerRef.current) editorContainerRef.current.innerHTML = '';
    setEditingOpen(false);
  }, []);

  // ── Thumb strip ─────────────────────────────────────────

  const { start: thumbStart, end: thumbEnd } = getThumbWindow(idx, navFiles.length);
  const thumbFiles = navFiles.slice(thumbStart, thumbEnd);

  return (
    <>
      {/* Main viewer overlay */}
      <div
        className={`fixed inset-0 z-[300] bg-background flex flex-col ${closing ? 'animate-slide-down' : 'animate-slide-up'}`}
        style={{ fontFamily: 'inherit' }}
      >
        {/* Header: identity left, type-specific controls dead center (the PDF
            toolbar portals into the center slot; images get the zoom cluster),
            actions right. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 ps-3 pe-2 py-2 border-b shrink-0 relative z-30 bg-background">
          <div className="flex items-center gap-2 min-w-0">
            {isPdf(file.name) && <div data-pdf-slot="left" ref={setPdfSlotLeft} className="hidden sm:flex items-center shrink-0 -ms-1" />}
            <span
              className="size-[22px] rounded-md shrink-0 flex items-center justify-center text-[8px] font-bold tracking-wide text-white"
              style={{ backgroundColor: colorFor(file.name) }}
              aria-hidden="true"
            >
              {(extOf(file.name) || t('common.label.fileBadge')).toUpperCase().slice(0, 4)}
            </span>
            <span className="text-sm font-semibold truncate" dir="auto">{file.name}</span>
            <span className="text-xs text-muted-foreground shrink-0 font-mono" dir="ltr">{counter}</span>
          </div>
          <div className="flex items-center justify-center">
            {isPdf(file.name) && <div data-pdf-slot="center" ref={setPdfSlotCenter} className="hidden sm:flex items-center gap-1 shrink-0" />}
            {(isImage(file.name) || previewKindFor(file.name, file.mime_type) === 'decode') && (
              <div className="hidden sm:flex items-center gap-0.5 p-0.5 border rounded-lg bg-muted/40" role="group" aria-label={t('common.accessibility.zoom')}>
                <button className="size-6.5 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground" aria-label={t('common.action.zoomOut')} onClick={() => setZoom((z) => Math.max(25, z - 25))}>
                  <Minus className="size-3.5" />
                </button>
                <span className="text-[11px] font-mono text-muted-foreground min-w-11 text-center">{zoom}%</span>
                <button className="size-6.5 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground" aria-label={t('common.action.zoomIn')} onClick={() => setZoom((z) => Math.min(300, z + 25))}>
                  <Plus className="size-3.5" />
                </button>
                <button className="size-6.5 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground" aria-label={t('common.action.fitToScreen')} onClick={() => setZoom(100)}>
                  <Maximize className="size-3.5" />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-0.5 justify-end">
            {actions?.onToggleFavourite && (
              <button
                className="size-8 rounded-md flex items-center justify-center hover:bg-muted"
                aria-label={actions.isFavourite ? t('common.action.removeFromFavourites') : t('common.label.addToFavourites')}
                aria-pressed={!!actions.isFavourite}
                onClick={() => actions.onToggleFavourite!(file)}
              >
                <Star className={`size-4 ${actions.isFavourite ? 'text-orange-400 fill-orange-400' : 'text-muted-foreground'}`} />
              </button>
            )}
            {actions?.onShare && (
              <button className="size-8 rounded-md flex items-center justify-center hover:bg-muted" aria-label={t('common.action.share')} onClick={() => actions.onShare!(file)}>
                <Share2 className="size-4 text-muted-foreground" />
              </button>
            )}
            {/* One labeled Edit in one place for every editable type: office
                opens the ONLYOFFICE editor, text the in-viewer editor, and
                image/video the media editor. The old layout only surfaced
                office editing through a chip floating on the preview itself. */}
            {isOfficeFile(file.name) ? (
              <a href={`/editor/${file.id}`} target="_blank" rel="noreferrer"
                className="h-7 px-2.5 rounded-md border flex items-center gap-1.5 text-xs font-medium hover:bg-muted whitespace-nowrap">
                <SquarePen className="size-3 text-muted-foreground" /> {t('common.edit')}
              </a>
            ) : (isEditable(file.name) || canTextEdit) && (
              <button className="h-7 px-2.5 rounded-md border flex items-center gap-1.5 text-xs font-medium hover:bg-muted"
                onClick={() => (canTextEdit ? editText() : openEditor())}>
                <Pencil className="size-3 text-muted-foreground" /> {t('common.edit')}
              </button>
            )}
            <a href={downloadUrl} download className="size-8 rounded-md flex items-center justify-center hover:bg-muted" title={t('common.action.download')}>
              <Download className="size-4 text-muted-foreground" />
            </a>
            {actions && (actions.onRename || actions.onMove || actions.onLock || actions.onDelete) && (
              <div className="relative">
                <button
                  className="size-8 rounded-md flex items-center justify-center hover:bg-muted"
                  aria-label={t('common.accessibility.moreActions')}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
                >
                  <MoreHorizontal className="size-4 text-muted-foreground" />
                </button>
                {menuOpen && (
                  <div role="menu" aria-label={t('common.action.moreActions')} className="absolute inset-e-0 top-full mt-1.5 w-48 rounded-xl border bg-popover text-popover-foreground shadow-lg p-1 z-50">
                    {actions.onRename && (
                      <button role="menuitem" className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] font-medium hover:bg-muted text-start" onClick={() => { setMenuOpen(false); actions.onRename!(file); }}>
                        <Pencil className="size-3.5 text-muted-foreground" /> {t('common.action.rename')}
                      </button>
                    )}
                    {actions.onMove && (
                      <button role="menuitem" className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] font-medium hover:bg-muted text-start" onClick={() => { setMenuOpen(false); actions.onMove!(file); }}>
                        <Move className="size-3.5 text-muted-foreground" /> {t('common.action.moveToFolder')}
                      </button>
                    )}
                    {actions.onLock && (
                      <button role="menuitem" className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] font-medium hover:bg-muted text-start" onClick={() => { setMenuOpen(false); actions.onLock!(file); }}>
                        {file.lock_mode !== 'none' ? <LockOpen className="size-3.5 text-muted-foreground" /> : <Lock className="size-3.5 text-muted-foreground" />}
                        {file.lock_mode !== 'none' ? t('common.action.unlock') : t('common.action.lock')}
                      </button>
                    )}
                    {actions.onDelete && (
                      <>
                        <div className="h-px bg-border my-1" role="separator" />
                        <button role="menuitem" className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] font-medium hover:bg-muted text-start text-destructive" onClick={() => { setMenuOpen(false); actions.onDelete!(file); }}>
                          <Trash2 className="size-3.5" /> {t('common.action.moveToTrash')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="w-px h-5 bg-border mx-1" aria-hidden="true" />
            <button
              className={`size-8 rounded-md flex items-center justify-center hover:bg-muted ${inspectorOpen ? 'bg-muted' : ''}`}
              aria-label={t('common.action.toggleInspector')}
              aria-pressed={inspectorOpen}
              title={t('common.action.inspectorI')}
              onClick={() => setInspectorOpen((o) => !o)}
            >
              <PanelRight className="size-4 text-muted-foreground rtl:-scale-x-100" />
            </button>
            <button className="size-8 rounded-md flex items-center justify-center hover:bg-muted" onClick={handleClose} title={t('common.tooltip.closeEsc')}>
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Body: stage + inspector */}
        <AnchorProvider markers={markers} pending={pendingAnchor} onPendingApplied={onPendingApplied} onSelectComment={onSelectComment}>
        <div className="flex-1 flex min-h-0">
          {/* Stage. Its own closed dark scale in both themes - a media stage
              stays dark in a light OS theme the way every other media viewer
              does (the share viewer records the same decision in share.css).
              Audio is the exception: its player is a theme-token surface
              (title, waveform, chips all read theme colors), so it keeps the
              theme background - dark-on-dark otherwise in light themes. */}
          <div data-testid="viewer-stage" className={`flex-1 min-h-0 min-w-0 relative ${isAudio(file.name) ? 'bg-background' : 'bg-[oklch(0.135_0.018_238.9)]'}`}>
            {/* Audio owns the whole area - it is a surface, not an object sitting
                on one - so it drops the centring and padding every other type wants. */}
            {/* PDF joins audio here: its viewer brings its own toolbar, scroller,
                and background, so the centring and padding would just inset it. */}
            {/* Archive joins them too, for the same reason: it is a surface, not
                an object sitting on one. */}
            <div className={`absolute inset-0 flex ${isAudio(file.name) || isPdf(file.name) || isArchive(file.name) ? 'overflow-hidden' : 'items-center justify-center overflow-auto p-6'}`}>
              <FileContent file={file} files={files} rawUrl={rawUrl()} stableRawUrl={stableRawUrl} downloadUrl={downloadUrl} version={previewVersion} workspaceId={workspaceId} pdfToolbarSlots={pdfSlots} zoom={zoom} onSaved={() => { onRefresh(); loadVersions(); }} onNavigate={onNavigate} />
            </div>
            <button
              className={`absolute inset-s-4 top-1/2 -translate-y-1/2 size-10 rounded-full backdrop-blur-sm flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none transition-colors z-10 ${isAudio(file.name) ? 'bg-foreground/10 text-foreground hover:bg-foreground/15' : 'bg-white/10 text-[oklch(0.93_0.008_238.5)] hover:bg-white/20'}`}
              aria-label={t('common.action.previousFile')}
              title={t('common.tooltip.previous')}
              disabled={!hasPrev}
              onClick={() => onNavigate(navFiles[idx - 1])}
            >
              <ChevronLeft className="size-4 rtl:-scale-x-100" />
            </button>
            <button
              className={`absolute inset-e-4 top-1/2 -translate-y-1/2 size-10 rounded-full backdrop-blur-sm flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none transition-colors z-10 ${isAudio(file.name) ? 'bg-foreground/10 text-foreground hover:bg-foreground/15' : 'bg-white/10 text-[oklch(0.93_0.008_238.5)] hover:bg-white/20'}`}
              aria-label={t('common.action.nextFile')}
              title={t('common.tooltip.next')}
              disabled={!hasNext}
              onClick={() => onNavigate(navFiles[idx + 1])}
            >
              <ChevronRight className="size-4 rtl:-scale-x-100" />
            </button>
          </div>

          {/* Inspector: 316px rail on desktop, bottom sheet on small screens. */}
          {inspectorOpen && (
            <>
              <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setInspectorOpen(false)} aria-hidden="true" />
              <aside
                data-testid="viewer-inspector"
                aria-label={t('common.accessibility.fileInspector')}
                className="flex flex-col min-h-0 bg-background md:w-[316px] md:shrink-0 md:border-s max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-50 max-md:max-h-[72dvh] max-md:rounded-t-2xl max-md:border-t max-md:shadow-2xl"
              >
                <div className="px-4 pt-4 shrink-0 max-md:pt-2">
                  <div className="md:hidden w-9 h-1 rounded-full bg-border mx-auto mb-3" aria-hidden="true" />
                  <div className="flex items-start gap-3">
                    <span
                      className="size-9 rounded-[10px] shrink-0 flex items-center justify-center text-[10px] font-bold tracking-wide text-white"
                      style={{ backgroundColor: colorFor(file.name) }}
                      aria-hidden="true"
                    >
                      {(extOf(file.name) || t('common.label.fileBadge')).toUpperCase().slice(0, 4)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold leading-snug break-all"><bdi>{file.name}</bdi></p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {richText(t('common.label.filesizeBytesMiddotFilemimeTypeMiddotVVersionsversionNumberfile'), {
                          fileSize_bytes: <span className="font-mono"><bdi>{humanSize(file.size_bytes)}</bdi></span>,
                          fileMime_type: <bdi>{file.mime_type}</bdi>,
                          versionsVersion_numberFile: <bdi>{versions[0]?.version_number ?? file.current_version}</bdi>,
                        })}
                      </p>
                    </div>
                  </div>
                  <div role="tablist" aria-label={t('common.accessibility.inspectorSections')} className="flex gap-0.5 mt-4 p-0.5 bg-muted rounded-lg">
                    <button
                      role="tab"
                      aria-selected={inspectorTab === 'details'}
                      className={`flex-1 h-7 rounded-md text-xs font-medium transition-colors ${inspectorTab === 'details' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      onClick={() => setInspectorTab('details')}
                    >
                      {t('common.action.details')}
                    </button>
                    <button
                      role="tab"
                      aria-selected={inspectorTab === 'versions'}
                      className={`flex-1 h-7 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${inspectorTab === 'versions' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      onClick={() => setInspectorTab('versions')}
                    >
                      {richText(t('common.action.versionsVersionscount'), {
                        versionsCount: <span className="font-mono text-[10px] text-muted-foreground">{localDigits(versions.length)}</span>,
                      })}
                    </button>
                    <button
                      role="tab"
                      aria-selected={inspectorTab === 'comments'}
                      className={`flex-1 h-7 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${inspectorTab === 'comments' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      onClick={() => setInspectorTab('comments')}
                    >
                      {richText(t('common.action.commentsCommentscount'), {
                        commentsCount: <span className="font-mono text-[10px] text-muted-foreground">{localDigits(thread.comments.length)}</span>,
                      })}
                    </button>
                  </div>
                </div>

                {/* Comments owns its own scroll (list) and pins the composer, so the
                    scroller becomes a flex column that the panel fills. */}
                <div className={`flex-1 min-h-0 px-4 py-4 ${inspectorTab === 'comments' ? 'flex flex-col' : 'overflow-y-auto'}`}>
                  {inspectorTab === 'details' ? (
                    <>
                      <dl>
                        <PropRow label={t('common.label.size')}><span className="font-mono font-normal"><bdi>{humanSize(file.size_bytes)}</bdi></span></PropRow>
                        <PropRow label={t('common.label.type')}><bdi>{file.mime_type}</bdi></PropRow>
                        <PropRow label={t('common.label.region')}>{regionLabel(file.region)}</PropRow>
                        <PropRow label={t('common.label.uploadedBy')}>{file.uploader_name ?? t('common.label.unknown')}</PropRow>
                        <PropRow label={t('common.label.created')}>{timeAgo(file.created_at)}</PropRow>
                        <PropRow label={t('common.label.modified')}>{timeAgo(file.updated_at)}</PropRow>
                        {twinId && (
                          <PropRow label={t('common.label.livePhotoVideo')}>
                            <span className="inline-flex items-center gap-2">
                              {twinName && <span className="font-mono">{twinName}</span>}
                              {/* The spec's Details row names the twin AND says
                                  how big it is - the Download link beside it is
                                  an ask to spend that many bytes. */}
                              {twinSize && <span className="font-mono text-muted-foreground">{twinSize}</span>}
                              <a href={`${API_BASE}/api/files/${twinId}/download`} className="text-xs underline">{t('common.action.download')}</a>
                            </span>
                          </PropRow>
                        )}
                        {file.origin && (
                          <PropRow label={t('common.label.origin')}>
                            <span className="whitespace-nowrap inline-flex items-center text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground border rounded-full px-2 py-px">
                              {originLabel(file.origin)}
                            </span>
                          </PropRow>
                        )}
                        {file.is_synced === 1 && (
                          <PropRow label={t('common.status.synced')}>
                            <span className="inline-flex items-center gap-1 text-primary font-semibold">
                              <Check className="size-3.5" /> {t('common.label.yes')}
                            </span>
                          </PropRow>
                        )}
                      </dl>
                      {isImage(file.name) && <PeopleChips wsId={workspaceId} fileId={file.id} />}
                      <div className="mt-5 border rounded-xl p-3.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{t('common.label.sharing')}</p>
                        <div className="flex items-center gap-2 text-xs mt-2.5">
                          <Link2 className="size-3.5 text-muted-foreground" />
                          <span>{t('common.label.shareLinks')}</span>
                          <span className="font-mono text-muted-foreground ms-auto">{file.share_count > 0 ? t('common.label.fileshareCountActive', { fileShare_count: file.share_count }) : t('common.label.none')}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs mt-2.5">
                          <MessageSquare className="size-3.5 text-muted-foreground" />
                          <span>{t('common.label.comments')}</span>
                          <span className="font-mono text-muted-foreground ms-auto">{localDigits(file.comment_count)}</span>
                        </div>
                        {actions?.onShare && (
                          <button
                            className="mt-3.5 w-full h-8 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity whitespace-nowrap"
                            onClick={() => actions.onShare!(file)}
                          >
                            <Share2 className="size-3.5" /> {t('common.action.share')}
                          </button>
                        )}
                      </div>
                    </>
                  ) : inspectorTab === 'comments' ? (
                    <CommentsPanel key={file.id} fileId={file.id} workspaceId={workspaceId} currentVersion={currentVersion}
                      viewingVersion={previewVersion ?? currentVersion} thread={thread} activeCommentId={activeCommentId} />
                  ) : versions.length === 0 ? (
                    <div className="text-center py-7">
                      <Clock className="size-5 text-muted-foreground/60 mx-auto mb-2.5" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {t('common.description.noVersionHistoryYet')}<br />{t('common.description.newUploadsWithTheSameNameWillAppearHere')}
                      </p>
                    </div>
                  ) : (
                    <>
                      {versions.length > 1 && (
                        <div className="flex items-center justify-end gap-1 mb-2">
                          <span className="text-[11px] text-muted-foreground me-0.5">{t('common.label.switch')}</span>
                          <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 border rounded text-[10px] text-muted-foreground bg-muted/50">↑</kbd>
                          <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 border rounded text-[10px] text-muted-foreground bg-muted/50">↓</kbd>
                        </div>
                      )}
                      {versions.map((v) => {
                        const isActive = v.version_number === activeVersion;
                        const isLatest = v.version_number === versions[0].version_number;
                        const dateStr = formatDateWith(v.created_at, { month: 'short', day: 'numeric', year: 'numeric' }, 'en-US');
                        const timeStr = formatDateWith(v.created_at, { hour: '2-digit', minute: '2-digit' }, 'en-US');
                        return (
                          <div
                            key={v.version_number}
                            role="button"
                            tabIndex={0}
                            className={`w-full text-start px-2.5 py-2 rounded-lg mb-0.5 border transition-colors cursor-pointer ${isActive ? 'bg-muted border-border' : 'border-transparent hover:bg-muted/50'}`}
                            onClick={() => setActiveVersion(v.version_number)}
                            onKeyDown={(e) => { if (e.key === 'Enter') setActiveVersion(v.version_number); }}
                          >
                            <div className="flex items-center gap-1.5 text-xs font-semibold">
                              v{v.version_number}
                              {isLatest ? (
                                <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-primary border border-primary/45 rounded-full px-1.5 py-px">{t('common.status.latest')}</span>
                              ) : (
                                <button
                                  className="whitespace-nowrap ms-auto text-[11px] font-medium text-muted-foreground hover:text-foreground border rounded-md px-2 py-0.5 disabled:opacity-40"
                                  disabled={restoringVer !== null}
                                  onClick={(e) => { e.stopPropagation(); restoreVersion(v.version_number); }}
                                >
                                  {t('common.action.restore')}
                                </button>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {richText(t('common.label.vsizeBytesMiddotDatestrTimestr'), {
                                vSize_bytes: <span className="font-mono">{humanSize(v.size_bytes)}</span>, dateStr, timeStr,
                              })}
                            </div>
                            {v.uploader_name && (
                              <div className="text-[11px] text-muted-foreground">{v.uploader_name}</div>
                            )}
                          </div>
                        );
                      })}
                      <p className="text-[11px] text-muted-foreground leading-relaxed mt-3 pt-3 border-t">
                        {t('common.description.uploadingAFileWithTheSameNameCreatesANewVersion')}
                      </p>
                    </>
                  )}
                </div>
              </aside>
            </>
          )}
        </div>
        </AnchorProvider>

        {/* Thumbnail strip footer */}
        <div className={`flex items-center gap-2 px-3 border-t shrink-0 ${stripCollapsed ? 'py-0.5 justify-end' : 'py-2 justify-center'}`}>
          {!stripCollapsed && (
          <>
          <div className="flex items-center gap-0.5">
            <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 border rounded text-[10px] text-muted-foreground bg-muted/50">←</kbd>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto flex-1 justify-center">
            {thumbFiles.map((f, i) => {
              const realIdx = thumbStart + i;
              const isActive = realIdx === idx;
              return (
                <button
                  key={f.id}
                  // `relative` is load-bearing, not decoration: the LIVE glyph
                  // and the video pip below are absolutely positioned, and
                  // without a positioned ancestor here they anchored to the
                  // viewer's own `fixed inset-0` root - one glyph in the
                  // screen's top-left corner instead of one per thumb.
                  className={`relative w-13 h-13 rounded-md shrink-0 overflow-hidden flex items-center justify-center bg-muted/50 border-2 transition-colors ${isActive ? 'border-foreground' : 'border-transparent hover:border-muted-foreground/30'}`}
                  onClick={() => onNavigate(navFiles[realIdx])}
                  title={f.name}
                >
                  <FilePreviewImage
                    fileId={f.id}
                    fileName={f.name}
                    size={128}
                    className="w-full h-full object-cover"
                    fallback={<img src={fileIconSrc(f.name)} alt="" className="size-6" />}
                  />
                  {isLiveStill(f) && <LiveBadge size="glyph" className="absolute top-0.5 inset-s-0.5" />}
                  {isVideo(f.name) && (
                    <div className="absolute bottom-0.5 inset-e-0.5 w-3.5 h-3.5 rounded bg-black/50 flex items-center justify-center">
                      <svg viewBox="0 0 8 8" fill="none" width="8" height="8"><path d="M2 1.5l4.5 2.5L2 6.5z" fill="#fff" /></svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-0.5">
            <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 border rounded text-[10px] text-muted-foreground bg-muted/50">→</kbd>
          </div>
          </>
          )}
          <button
            className="size-6.5 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground shrink-0"
            aria-label={stripCollapsed ? t('common.action.expandFilmstrip') : t('common.action.collapseFilmstrip')}
            onClick={() => setStripCollapsed((c) => !c)}
          >
            <ChevronDown className={`size-3.5 transition-transform ${stripCollapsed ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Pintura editor overlay */}
      {editingOpen && (
        <div className="fixed inset-0 z-[1000] bg-background flex flex-col animate-slide-up">
          <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Pencil className="size-3.5 text-muted-foreground" />
              <bdi>{file.name}</bdi>
            </div>
            <button className="size-8 rounded-md flex items-center justify-center hover:bg-muted" onClick={closeEditor}>
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
          <div ref={editorContainerRef} dir="ltr" className="flex-1 min-h-0" />
        </div>
      )}

      {textEditOpen && (
        <TextEditorOverlay
          file={file}
          rawUrl={stableRawUrl}
          workspaceId={workspaceId}
          onClose={closeTextEdit}
          onSaved={() => { onRefresh(); loadVersions(); }}
        />
      )}
    </>
  );
}

// ── File content renderer ─────────────────────────────────

/** Label/value row for the inspector's Details tab. */
function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b last:border-b-0">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-xs font-medium text-end truncate">{children}</dd>
    </div>
  );
}

function FileContent({ file, files, rawUrl, stableRawUrl, downloadUrl, version, workspaceId, pdfToolbarSlots, zoom, onSaved, onNavigate }: { file: FileItem; files: FileItem[]; rawUrl: string; stableRawUrl: string; downloadUrl: string; version?: number; workspaceId: string; pdfToolbarSlots: { left: HTMLElement | null; center: HTMLElement | null }; zoom?: number; onSaved: () => void; onNavigate: (f: FileItem) => void }) {
  const t = useT();
  const ext = extOf(file.name);
  // The same question the share page asks (packages/shared/src/files/
  // preview-formats.ts), so a file opens the same way in both places.
  const kind = previewKindFor(file.name, file.mime_type);

  if (kind === 'contact') {
    return <VCardView file={file} rawUrl={rawUrl} workspaceId={workspaceId} onSaved={onSaved} />;
  }

  if (kind === 'calendar') {
    return (
      <CalendarView
        file={file}
        rawUrl={rawUrl}
        source={<TextViewer file={file} rawUrl={rawUrl} downloadUrl={downloadUrl} />}
        oversize={<OversizeFallback file={file} downloadUrl={downloadUrl} />}
      />
    );
  }

  if (kind === 'image') {
    if (isLiveStill(file)) {
      return <LivePhotoStage key={file.live_video_id!} file={file} twinId={file.live_video_id!} version={version} zoom={zoom} />;
    }
    return (
      <div
        className="max-w-full max-h-full flex items-center justify-center transition-transform duration-150"
        style={zoom && zoom !== 100 ? { transform: `scale(${zoom / 100})` } : undefined}
      >
        <FilePreviewImage
          fileId={file.id}
          fileName={file.name}
          version={version}
          size={1600}
          className="max-w-full max-h-full object-contain rounded-md"
          alt={file.name}
          fallback={<img src={fileIconSrc(file.name)} alt={file.name} className="size-24" />}
        />
      </div>
    );
  }

  if (kind === 'video') {
    // A Live Photo's twin opened directly (list view, search) is an ordinary
    // video slide with one addition: a way back to the still it belongs to.
    const still = isLiveTwin(file) ? files.find((f) => f.id === file.live_photo_id) : null;
    // Keyed on the file, not the url: the url's cache token moves when the
    // versions load, and a remount there restarted playback. The player
    // re-mounts itself on a version switch (its identity includes it), and the
    // key still keeps one file's decode failure from following the user to the
    // next one in the strip.
    return (
      <div className="relative h-full w-full max-w-full max-h-full flex items-center justify-center">
        <VideoPlayer key={file.id} file={file} stableRawUrl={stableRawUrl} version={version} downloadUrl={downloadUrl} />
        {still && (
          <button
            type="button"
            className="absolute top-3 inset-s-3 z-10 rounded-full bg-black/45 px-2 py-0.5 font-mono text-[10px] text-white hover:bg-black/60"
            onClick={() => onNavigate(still)}
          >
            {t('common.action.livePhotoVideoOfStillName', { stillName: still.name })}
          </button>
        )}
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <AudioPlayer
        file={file}
        files={files}
        rawUrl={stableRawUrl}
        downloadUrl={downloadUrl}
        version={version}
        onNavigate={onNavigate}
      />
    );
  }

  if (kind === 'pdf') {
    return (
      <Suspense
        fallback={
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        {/* Keyed on the URL: switching file or version remounts the viewer
            with fresh page/zoom/document state. */}
        <PdfViewer key={stableRawUrl} fileName={file.name} rawUrl={stableRawUrl} downloadUrl={downloadUrl} toolbarSlots={pdfToolbarSlots} />
      </Suspense>
    );
  }

  // Before the text check: an .epub is a zip so isTextReadable could not claim
  // it, but a .fb2 is XML and would otherwise render as markup instead of a book.
  if (kind === 'ebook') {
    return <BookViewer file={file} />;
  }

  // An archive is browsed, not rendered: the pane lists its entries and points
  // the existing viewers at one entry at a time. After isBook on purpose -
  // .cbz and .epub are zips too, and they already have a better home.
  if (kind === 'archive') {
    return <ArchiveViewer key={file.id} file={file} version={version} />;
  }

  // Ahead of the text check: these are text with a better shape available
  // (same split the mobile viewer makes). Both fall back to the plain text
  // viewer for degenerate content, so the split costs nothing when wrong.
  if (kind === 'markdown') {
    return <MarkdownViewer file={file} rawUrl={rawUrl} downloadUrl={downloadUrl} />;
  }
  if (kind === 'table') {
    return <CsvViewer file={file} rawUrl={rawUrl} downloadUrl={downloadUrl} />;
  }

  if (kind === 'text') {
    return <TextViewer file={file} rawUrl={rawUrl} downloadUrl={downloadUrl} />;
  }

  // Shared by the office-preview fallback and the plain unsupported-type
  // fallback below - the "Open in editor" button only ever applies to office
  // files, so it's conditional here rather than duplicated in both callers.
  const fallbackCard = (
    <div className="bg-background border rounded-xl p-10 text-center min-w-70">
      <p className="text-4xl font-bold text-muted-foreground/30 tracking-wider mb-3">{ext.toUpperCase() || t('common.label.fileBadge')}</p>
      <p className="text-sm text-muted-foreground mb-5 break-all"><bdi>{file.name}</bdi></p>
      {isOfficeFile(file.name) && (
        <a
          href={`/editor/${file.id}`}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90 me-2"
        >
          <SquarePen className="size-4" /> {t('common.label.openInEditor')}
        </a>
      )}
      <a
        href={downloadUrl}
        download
        className="whitespace-nowrap inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90"
      >
        <Download className="size-4" /> {t('common.action.download')}
      </a>
    </div>
  );

  // TIFF, RAW, PSD and iWork: decoded in this browser, only after Open.
  // Fed the stable URL so a re-render never restarts a download in flight.
  if (kind === 'decode') {
    return <DecodedPreview key={file.id} file={file} rawUrl={stableRawUrl} downloadUrl={downloadUrl} zoom={zoom} />;
  }

  if (kind === 'office') {
    return <OfficePreview file={file} version={version} fallback={fallbackCard} />;
  }

  // Unknown type: same card, plus an opt-in "open it as text anyway". Keyed
  // on the file so navigating the strip resets a previous acceptance. Fed the
  // stable URL because the accepted TextViewer refetches when its URL
  // changes, and the Date.now()-stamped one changes on every parent render.
  return <UnsupportedPreview key={file.id} file={file} rawUrl={stableRawUrl} downloadUrl={downloadUrl} />;
}

/**
 * Fallback for types nothing else claims. Any file is openable as plain
 * text if the user knowingly accepts that binary content will look garbled -
 * the same accept-first gate TextViewer puts in front of binary-looking
 * content, so both paths keep one behavior.
 */
function UnsupportedPreview({ file, rawUrl, downloadUrl }: { file: FileItem; rawUrl: string; downloadUrl: string }) {
  const t = useT();
  const [asText, setAsText] = useState(false);
  const ext = extOf(file.name);

  if (asText) {
    return <TextViewer file={file} rawUrl={rawUrl} downloadUrl={downloadUrl} force />;
  }

  return (
    <div className="bg-background border rounded-xl p-10 text-center min-w-70 max-w-105">
      <p className="text-4xl font-bold text-muted-foreground/30 tracking-wider mb-3">{ext.toUpperCase() || t('common.label.fileBadge')}</p>
      <p className="text-sm text-muted-foreground mb-2 break-all"><bdi>{file.name}</bdi></p>
      <p className="text-xs text-muted-foreground mb-5">
        {t('common.description.previewIsnTAvailableForThisFileTypeYouCanOpenIt')}
      </p>
      <button
        onClick={() => setAsText(true)}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border text-sm font-semibold hover:bg-muted me-2"
      >
        <FileText className="size-4" /> {t('common.action.openAsText')}
      </button>
      <a
        href={downloadUrl}
        download
        className="whitespace-nowrap inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90"
      >
        <Download className="size-4" /> {t('common.action.download')}
      </a>
    </div>
  );
}

const TEXT_PREVIEW_MAX = 2 * 1024 * 1024; // 2 MB
const HIGHLIGHT_MAX = 300 * 1024;         // 300 KB

function TextViewer({ file, rawUrl, downloadUrl, force }: { file: FileItem; rawUrl: string; downloadUrl: string; force?: boolean }) {
  const t = useT();
  const ext = extOf(file.name);
  const [plain, setPlain] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'toobig' | 'binary' | 'error'>('loading');
  // With `force` (the unsupported-type card's "Open as text") the binary
  // warning is pre-accepted; otherwise the user accepts it per file.
  const [accepted, setAccepted] = useState(!!force);
  const [findOpen, setFindOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const find = useInFileFind(contentRef);

  // A new source resets the acceptance - adjusted during render on the prop
  // change (same pattern as prevFileId above) so it never shows file B's
  // bytes under file A's accepted warning.
  const [prevRawUrl, setPrevRawUrl] = useState(rawUrl);
  if (prevRawUrl !== rawUrl) {
    setPrevRawUrl(rawUrl);
    setAccepted(!!force);
  }

  // Fetch + detect
  useEffect(() => {
    setPlain(null); setHtml(null); setFindOpen(false); find.clear();
    if (file.size_bytes > TEXT_PREVIEW_MAX) { setState('toobig'); return; }
    setState('loading');
    let cancelled = false;
    fetch(rawUrl, { credentials: 'include' })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((buf) => {
        if (cancelled) return;
        const text = decodeTextBytes(buf);
        if (looksBinary(text.slice(0, 8192))) {
          // Keep the (NUL-stripped) text around: it is what "Open as text"
          // shows if the user accepts the warning.
          setPlain(text.replace(/\0/g, ''));
          setState('binary');
          return;
        }
        setPlain(text);
        setState('ok');
        if (!force && text.length <= HIGHLIGHT_MAX) {
          highlightToHtml(text, langFromExtension(file.name))
            .then((h) => { if (!cancelled) { setHtml(h); requestAnimationFrame(() => find.refresh()); } })
            .catch(() => { /* keep plain */ });
        }
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [rawUrl, file.name, file.size_bytes, force]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/Cmd+F opens our find bar (intercept native find while a text file is shown)
  useEffect(() => {
    if (state !== 'ok') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state]);

  if (state === 'toobig') {
    return <OversizeFallback file={file} downloadUrl={downloadUrl} />;
  }
  if (state === 'error') {
    return <OversizeFallback file={file} downloadUrl={downloadUrl} note={t('common.error.failedToLoadFileContent')} />;
  }
  if (state === 'binary' && !accepted) {
    return <OversizeFallback file={file} downloadUrl={downloadUrl}
      note={t('common.description.thisFileDoesnTLookLikeTextYouCanStillOpenIt')}
      action={
        <button
          onClick={() => setAccepted(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border text-sm font-semibold hover:bg-muted me-2"
        >
          <FileText className="size-4" /> {t('common.action.openAsText')}
        </button>
      } />;
  }

  return (
    <div className="relative w-full h-full rounded-lg bg-[#1e1e1e] overflow-hidden self-stretch flex flex-col">
      <div className="sticky top-0 px-4 py-2 bg-[#1e1e1e] border-b border-white/10 text-[11px] text-white/40 font-mono z-10">
        {langFromExtension(file.name) === 'text' ? ext.toUpperCase() : langFromExtension(file.name)}
      </div>
      {findOpen && <TextFindBar find={find} onClose={() => { setFindOpen(false); find.clear(); }} />}
      <div ref={contentRef} className="flex-1 overflow-auto text-[13px] leading-relaxed [&_pre]:m-0 [&_pre]:!bg-transparent [&_pre]:px-4 [&_pre]:py-4 [&_pre]:whitespace-pre-wrap [&_pre]:break-words">
        {html
          ? <div dangerouslySetInnerHTML={{ __html: html }} />
          : <pre className="m-0 px-4 py-4 text-[#d4d4d4] font-mono whitespace-pre-wrap break-words">{plain ?? t('common.status.loading')}</pre>}
      </div>
    </div>
  );
}

function OversizeFallback({ file, downloadUrl, note, action }: { file: FileItem; downloadUrl: string; note?: string; action?: ReactNode }) {
  const t = useT();
  const sizeStr = humanSize(file.size_bytes);
  return (
    <div className="bg-background border rounded-xl p-10 text-center min-w-70 max-w-105">
      <p className="text-4xl font-bold text-muted-foreground/30 tracking-wider mb-3">{extOf(file.name).toUpperCase() || t('common.label.fileBadge')}</p>
      <p className="text-sm text-muted-foreground mb-2 break-all">{file.name}</p>
      <p className="text-xs text-muted-foreground mb-5">{note ?? t('common.error.fileTooLargeToPreviewInlineSizeStr', { sizeStr })}</p>
      {action}
      <a href={downloadUrl} download className="whitespace-nowrap inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90">
        <Download className="size-4" /> {t('common.action.download')}
      </a>
    </div>
  );
}

// ── CSV / Markdown ────────────────────────────────────────

/**
 * The fetch half of TextViewer, for the stages that render the body as
 * something other than highlighted source. Same caps, same binary sniff.
 * Results are tagged with the url they came from, so a stale response is
 * simply not-yet-loaded rather than the previous file's body - and no state
 * is written synchronously inside the effect.
 */
function useTextBody(file: FileItem, rawUrl: string): { text: string | null; state: 'loading' | 'ok' | 'toobig' | 'binary' | 'error' } {
  const toobig = file.size_bytes > TEXT_PREVIEW_MAX;
  const [fetched, setFetched] = useState<{ url: string; state: 'ok' | 'binary' | 'error'; text: string | null } | null>(null);

  useEffect(() => {
    if (toobig) return;
    let cancelled = false;
    fetch(rawUrl, { credentials: 'include' })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((buf) => {
        if (cancelled) return;
        const body = decodeTextBytes(buf);
        if (looksBinary(body.slice(0, 8192))) setFetched({ url: rawUrl, state: 'binary', text: null });
        else setFetched({ url: rawUrl, state: 'ok', text: body });
      })
      .catch(() => { if (!cancelled) setFetched({ url: rawUrl, state: 'error', text: null }); });
    return () => { cancelled = true; };
  }, [rawUrl, toobig]);

  if (toobig) return { text: null, state: 'toobig' };
  if (!fetched || fetched.url !== rawUrl) return { text: null, state: 'loading' };
  return { text: fetched.text, state: fetched.state };
}

/**
 * A CSV as the table it is, instead of a wall of commas. Same split the
 * mobile viewer makes; anything the parser deems not-really-a-table falls
 * back to the highlighted text view, which renders degenerate shapes fine.
 */
function CsvViewer({ file, rawUrl, downloadUrl }: { file: FileItem; rawUrl: string; downloadUrl: string }) {
  const t = useT();
  const { text, state } = useTextBody(file, rawUrl);
  const table = useMemo(() => (text == null ? null : parseCsvTable(text)), [text]);

  if (state === 'toobig') return <OversizeFallback file={file} downloadUrl={downloadUrl} />;
  if (state === 'binary' || state === 'error') {
    return <OversizeFallback file={file} downloadUrl={downloadUrl} note={state === 'binary' ? t('common.description.thisFileIsNotTextPreviewable') : t('common.error.failedToLoadFileContent')} />;
  }
  if (state === 'loading') {
    return <div className="w-full h-full flex items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!table) return <TextViewer file={file} rawUrl={rawUrl} downloadUrl={downloadUrl} />;

  const totalRows = table.rows.length + table.truncatedRows;
  return (
    <div className="relative w-full h-full rounded-lg border bg-background overflow-hidden self-stretch flex flex-col">
      <div className="sticky top-0 flex items-baseline gap-3 px-4 py-2 border-b text-xs font-mono text-muted-foreground z-10">
        <span className="uppercase">{extOf(file.name) || 'csv'}</span>
        <span className="ms-auto">{t('common.description.totalrowsPluralOneRowOtherRowsTimesTablecolumnsCols', { totalRows, tableColumns: table.columns })}</span>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-max min-w-full border-collapse font-mono text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {table.header.map((cell, c) => (
                <th key={c} className="text-start font-semibold px-3 py-2 border-b whitespace-nowrap max-w-105 overflow-hidden text-ellipsis">{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="border-b last:border-b-0 hover:bg-muted/50">
                {row.map((cell, c) => (
                  <td key={c} className="px-3 py-1.5 whitespace-nowrap max-w-105 overflow-hidden text-ellipsis">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {table.truncatedRows > 0 && (
          <p className="px-3 py-2.5 text-xs font-mono text-muted-foreground">
            {t('common.description.tabletruncatedrowsMoreTabletruncatedrowsPluralOneRowOtherRowsDownload', { tableTruncatedRows: table.truncatedRows })}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Markdown rendered as the document it is, with the source one click away -
 * on a desktop screen the person reading a README and the person checking
 * its syntax are often the same person a minute apart.
 */
function MarkdownViewer({ file, rawUrl, downloadUrl }: { file: FileItem; rawUrl: string; downloadUrl: string }) {
  const t = useT();
  const { text, state } = useTextBody(file, rawUrl);
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');
  const blocks = useMemo(() => (text == null || mode !== 'rendered' ? null : parseMarkdown(text)), [text, mode]);

  if (state === 'toobig') return <OversizeFallback file={file} downloadUrl={downloadUrl} />;
  if (state === 'binary' || state === 'error') {
    return <OversizeFallback file={file} downloadUrl={downloadUrl} note={state === 'binary' ? t('common.description.thisFileIsNotTextPreviewable') : t('common.error.failedToLoadFileContent')} />;
  }
  if (state === 'loading') {
    return <div className="w-full h-full flex items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="relative w-full h-full rounded-lg border bg-background overflow-hidden self-stretch flex flex-col">
      <div className="sticky top-0 flex items-center gap-3 px-4 py-2 border-b z-10">
        <span className="text-xs font-mono text-muted-foreground uppercase">{t('common.label.markdown')}</span>
        <div role="tablist" aria-label={t('common.accessibility.markdownView')} className="ms-auto flex gap-0.5 p-0.5 bg-muted rounded-lg">
          {(['rendered', 'source'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`h-6 px-2.5 rounded-md text-xs font-medium capitalize transition-colors ${mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setMode(m)}
            >
              {m === 'rendered' ? t('common.label.rendered') : t('common.label.sourceLowercase')}
            </button>
          ))}
        </div>
      </div>
      {mode === 'source' ? (
        <pre className="flex-1 overflow-auto m-0 px-4 py-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{text}</pre>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="max-w-3xl mx-auto px-8 py-6">
            {blocks?.map((block, i) => <MdBlockView key={i} block={block} />)}
          </div>
        </div>
      )}
    </div>
  );
}

const MD_HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'text-2xl font-bold mt-6 first:mt-0',
  2: 'text-xl font-bold mt-5 first:mt-0',
  3: 'text-base font-bold mt-4 first:mt-0',
};

function MdBlockView({ block }: { block: MdBlock }) {
  if (block.kind === 'heading') {
    const H = (`h${block.level}`) as 'h1' | 'h2' | 'h3';
    return <H className={MD_HEADING_CLASS[block.level]}><MdInline tokens={block.inline} /></H>;
  }
  if (block.kind === 'code') {
    return (
      <pre className="mt-3 rounded-lg bg-muted p-3 overflow-x-auto font-mono text-xs leading-relaxed">{block.text}</pre>
    );
  }
  if (block.kind === 'quote') {
    return (
      <blockquote className="mt-3 border-s-2 ps-3 text-sm leading-relaxed text-muted-foreground italic">
        <MdInline tokens={block.inline} />
      </blockquote>
    );
  }
  if (block.kind === 'list') {
    const L = block.ordered ? 'ol' : 'ul';
    return (
      <L className={`mt-3 ps-5 text-sm leading-relaxed space-y-1 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
        {block.items.map((item, i) => <li key={i}><MdInline tokens={item} /></li>)}
      </L>
    );
  }
  if (block.kind === 'hr') return <hr className="mt-4 border-t" />;
  return <p className="mt-3 first:mt-0 text-sm leading-relaxed"><MdInline tokens={block.inline} /></p>;
}

function MdInline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === 'bold') return <strong key={i}>{t.text}</strong>;
        if (t.kind === 'italic') return <em key={i}>{t.text}</em>;
        if (t.kind === 'code') return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{t.text}</code>;
        if (t.kind === 'link') {
          return <a key={i} href={t.url} target="_blank" rel="noreferrer" className="text-primary underline">{t.text}</a>;
        }
        return <span key={i}>{t.text}</span>;
      })}
    </>
  );
}
