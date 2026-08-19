import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense, type ReactNode } from 'react';
import { api, API_BASE } from '@/api/client';
import {
  X, Download, ChevronLeft, ChevronRight, ChevronDown, Pencil, Clock, SquarePen, Loader2,
  Star, Share2, MoreHorizontal, PanelRight, Trash2, Move, Lock, LockOpen,
  Minus, Plus, Maximize, Check, Link2, MessageSquare,
} from 'lucide-react';
import { humanSize, extOf, isImage, isVideo, isAudio, fileIconSrc, isOfficeFile, isBook, colorFor, regionLabel, originLabel, timeAgo } from '@/lib/helpers';
import { FilePreviewImage } from '@/components/file-preview-image';
import { toast } from '@/lib/toast';
import { isTextReadable, langFromExtension, looksBinary } from '@/lib/text-detect';
import { BookViewer } from '@/components/book-viewer';
import { highlightToHtml } from '@/lib/text-highlight';
import { useInFileFind } from '@/lib/use-in-file-find';
import { TextFindBar } from '@/components/text-find-bar';
import { TextEditorOverlay } from '@/components/text-editor';
import { VCardView } from '@/components/vcard-viewer';
import { AudioPlayer } from '@/components/audio/audio-player';
import { OfficePreview } from '@/components/office-preview';
import type { FileItem } from '@/lib/file-types';

// pdf.js is ~350KB gzipped plus a worker - loaded only when a PDF is opened.
const PdfViewer = lazy(() => import('@/components/pdf-viewer/pdf-viewer'));


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
}

// ── Helpers ───────────────────────────────────────────────

function isPdf(name: string) { return extOf(name) === 'pdf'; }
function isVcard(name: string) { const e = extOf(name); return e === 'vcf' || e === 'vcard'; }
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

export function FileViewer({ file, files, workspaceId, onClose, onNavigate, onRefresh, actions }: FileViewerProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [activeVersion, setActiveVersion] = useState(-1);
  const [closing, setClosing] = useState(false);
  const [editingOpen, setEditingOpen] = useState(false);
  // Rail on desktop, bottom sheet on mobile - one state, CSS decides which.
  // Starts open on desktop, closed on small screens (jsdom has no matchMedia).
  const [inspectorOpen, setInspectorOpen] = useState(
    () => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 768px)').matches,
  );
  const [inspectorTab, setInspectorTab] = useState<'details' | 'versions'>('details');
  const [menuOpen, setMenuOpen] = useState(false);
  const [stripCollapsed, setStripCollapsed] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [restoringVer, setRestoringVer] = useState<number | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<any>(null);
  const [textEditOpen, setTextEditOpen] = useState(false);
  const closeTextEdit = useCallback(() => setTextEditOpen(false), []);
  const canTextEdit = isTextReadable(file.name, file.mime_type)
    && file.size_bytes <= 2 * 1024 * 1024
    && file.lock_mode !== 'full_lock';

  const idx = files.findIndex((f) => f.id === file.id);
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < files.length - 1;
  const counter = idx >= 0 ? `${idx + 1} / ${files.length}` : '';

  // Header slot elements the PDF viewer portals its controls into. Callback
  // refs are stable and identity-guarded so header re-renders don't loop state.
  const [pdfSlots, setPdfSlots] = useState<{ left: HTMLDivElement | null; center: HTMLDivElement | null }>({ left: null, center: null });
  const setPdfSlotLeft = useCallback((el: HTMLDivElement | null) => setPdfSlots((s) => (s.left === el ? s : { ...s, left: el })), []);
  const setPdfSlotCenter = useCallback((el: HTMLDivElement | null) => setPdfSlots((s) => (s.center === el ? s : { ...s, center: el })), []);

  // Load versions
  const loadVersions = useCallback(async () => {
    try {
      const data = await api<{ ok: boolean; current_version: number; versions: Version[] }>(
        `/api/files/${file.id}/versions`
      );
      if (data.ok && data.versions?.length) {
        setVersions(data.versions);
        setActiveVersion(data.versions[0].version_number);
      } else {
        setVersions([]);
        setActiveVersion(-1);
      }
    } catch {
      setVersions([]);
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
        toast.success('Restored', `Restored to v${versionNumber}.`);
        loadVersions();
        onRefresh();
      } else {
        toast.error('Restore failed', res.error ?? 'Restore failed');
      }
    } catch {
      toast.error('Restore failed', 'Restore failed.');
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
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate(files[idx - 1]);
      if (e.key === 'ArrowRight' && hasNext) onNavigate(files[idx + 1]);
      if (e.key === 'ArrowUp') { e.preventDefault(); navigateVersion(-1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); navigateVersion(1); }
      if (e.key === 'i' || e.key === 'I') setInspectorOpen((o) => !o);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [hasPrev, hasNext, idx, files, onNavigate, navigateVersion, editingOpen, textEditOpen]);

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
          if (!res.ok) throw new Error(`Failed to load video (HTTP ${res.status})`);
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
          if (!res.ok) throw new Error(`Failed to load image (HTTP ${res.status})`);
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
              toast.error('Upload failed', initRes.error ?? 'Could not start upload');
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
              toast.error('Save failed', uploadData.error ?? 'Failed to save');
              return;
            }
            toast.success('Saved', isVideo(file.name) ? 'Video saved as new version.' : 'Image saved as new version.');
            closeEditor();
            onRefresh();
            loadVersions();
          } catch {
            toast.error('Save failed', 'Failed to save edited file.');
          }
        });
      } catch (err) {
        // Surface the real reason instead of swallowing it - e.g. a failed dynamic
        // import means the Pintura chunk didn't load (commonly the private-registry
        // package installed as the public stub because NPM_TOKEN was missing at build).
        console.error('[pintura] failed to load/init editor', err);
        toast.error('Editor unavailable', err instanceof Error ? err.message : 'Image editor not available.');
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

  const { start: thumbStart, end: thumbEnd } = getThumbWindow(idx, files.length);
  const thumbFiles = files.slice(thumbStart, thumbEnd);

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
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pl-3 pr-2 py-2 border-b shrink-0 relative z-30 bg-background">
          <div className="flex items-center gap-2 min-w-0">
            {isPdf(file.name) && <div data-pdf-slot="left" ref={setPdfSlotLeft} className="hidden sm:flex items-center shrink-0 -ml-1" />}
            <span
              className="size-[22px] rounded-md shrink-0 flex items-center justify-center text-[8px] font-bold tracking-wide text-white"
              style={{ backgroundColor: colorFor(file.name) }}
              aria-hidden="true"
            >
              {(extOf(file.name) || 'file').toUpperCase().slice(0, 4)}
            </span>
            <span className="text-sm font-semibold truncate">{file.name}</span>
            <span className="text-xs text-muted-foreground shrink-0 font-mono">{counter}</span>
          </div>
          <div className="flex items-center justify-center">
            {isPdf(file.name) && <div data-pdf-slot="center" ref={setPdfSlotCenter} className="hidden sm:flex items-center gap-1 shrink-0" />}
            {isImage(file.name) && (
              <div className="hidden sm:flex items-center gap-0.5 p-0.5 border rounded-lg bg-muted/40" role="group" aria-label="Zoom">
                <button className="size-6.5 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(25, z - 25))}>
                  <Minus className="size-3.5" />
                </button>
                <span className="text-[11px] font-mono text-muted-foreground min-w-11 text-center">{zoom}%</span>
                <button className="size-6.5 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(300, z + 25))}>
                  <Plus className="size-3.5" />
                </button>
                <button className="size-6.5 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground" aria-label="Fit to screen" onClick={() => setZoom(100)}>
                  <Maximize className="size-3.5" />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-0.5 justify-end">
            {actions?.onToggleFavourite && (
              <button
                className="size-8 rounded-md flex items-center justify-center hover:bg-muted"
                aria-label={actions.isFavourite ? 'Remove from favourites' : 'Add to favourites'}
                aria-pressed={!!actions.isFavourite}
                onClick={() => actions.onToggleFavourite!(file)}
              >
                <Star className={`size-4 ${actions.isFavourite ? 'text-orange-400 fill-orange-400' : 'text-muted-foreground'}`} />
              </button>
            )}
            {actions?.onShare && (
              <button className="size-8 rounded-md flex items-center justify-center hover:bg-muted" aria-label="Share" onClick={() => actions.onShare!(file)}>
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
                <SquarePen className="size-3 text-muted-foreground" /> Edit
              </a>
            ) : (isEditable(file.name) || canTextEdit) && (
              <button className="h-7 px-2.5 rounded-md border flex items-center gap-1.5 text-xs font-medium hover:bg-muted"
                onClick={() => (canTextEdit ? setTextEditOpen(true) : openEditor())}>
                <Pencil className="size-3 text-muted-foreground" /> Edit
              </button>
            )}
            <a href={downloadUrl} download className="size-8 rounded-md flex items-center justify-center hover:bg-muted" title="Download">
              <Download className="size-4 text-muted-foreground" />
            </a>
            {actions && (actions.onRename || actions.onMove || actions.onLock || actions.onDelete) && (
              <div className="relative">
                <button
                  className="size-8 rounded-md flex items-center justify-center hover:bg-muted"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
                >
                  <MoreHorizontal className="size-4 text-muted-foreground" />
                </button>
                {menuOpen && (
                  <div role="menu" aria-label="More actions" className="absolute right-0 top-full mt-1.5 w-48 rounded-xl border bg-popover text-popover-foreground shadow-lg p-1 z-50">
                    {actions.onRename && (
                      <button role="menuitem" className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] font-medium hover:bg-muted text-left" onClick={() => { setMenuOpen(false); actions.onRename!(file); }}>
                        <Pencil className="size-3.5 text-muted-foreground" /> Rename
                      </button>
                    )}
                    {actions.onMove && (
                      <button role="menuitem" className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] font-medium hover:bg-muted text-left" onClick={() => { setMenuOpen(false); actions.onMove!(file); }}>
                        <Move className="size-3.5 text-muted-foreground" /> Move to folder
                      </button>
                    )}
                    {actions.onLock && (
                      <button role="menuitem" className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] font-medium hover:bg-muted text-left" onClick={() => { setMenuOpen(false); actions.onLock!(file); }}>
                        {file.lock_mode !== 'none' ? <LockOpen className="size-3.5 text-muted-foreground" /> : <Lock className="size-3.5 text-muted-foreground" />}
                        {file.lock_mode !== 'none' ? 'Unlock' : 'Lock'}
                      </button>
                    )}
                    {actions.onDelete && (
                      <>
                        <div className="h-px bg-border my-1" role="separator" />
                        <button role="menuitem" className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] font-medium hover:bg-muted text-left text-destructive" onClick={() => { setMenuOpen(false); actions.onDelete!(file); }}>
                          <Trash2 className="size-3.5" /> Move to trash
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
              aria-label="Toggle inspector"
              aria-pressed={inspectorOpen}
              title="Inspector (i)"
              onClick={() => setInspectorOpen((o) => !o)}
            >
              <PanelRight className="size-4 text-muted-foreground" />
            </button>
            <button className="size-8 rounded-md flex items-center justify-center hover:bg-muted" onClick={handleClose} title="Close (Esc)">
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Body: stage + inspector */}
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
            <div className={`absolute inset-0 flex ${isAudio(file.name) || isPdf(file.name) ? 'overflow-hidden' : 'items-center justify-center overflow-auto p-6'}`}>
              <FileContent file={file} files={files} rawUrl={rawUrl()} stableRawUrl={stableRawUrl} downloadUrl={downloadUrl} version={previewVersion} workspaceId={workspaceId} pdfToolbarSlots={pdfSlots} zoom={zoom} onSaved={() => { onRefresh(); loadVersions(); }} onNavigate={onNavigate} />
            </div>
            <button
              className={`absolute left-4 top-1/2 -translate-y-1/2 size-10 rounded-full backdrop-blur-sm flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none transition-colors z-10 ${isAudio(file.name) ? 'bg-foreground/10 text-foreground hover:bg-foreground/15' : 'bg-white/10 text-[oklch(0.93_0.008_238.5)] hover:bg-white/20'}`}
              aria-label="Previous file"
              title="Previous (←)"
              disabled={!hasPrev}
              onClick={() => onNavigate(files[idx - 1])}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              className={`absolute right-4 top-1/2 -translate-y-1/2 size-10 rounded-full backdrop-blur-sm flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none transition-colors z-10 ${isAudio(file.name) ? 'bg-foreground/10 text-foreground hover:bg-foreground/15' : 'bg-white/10 text-[oklch(0.93_0.008_238.5)] hover:bg-white/20'}`}
              aria-label="Next file"
              title="Next (→)"
              disabled={!hasNext}
              onClick={() => onNavigate(files[idx + 1])}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* Inspector: 316px rail on desktop, bottom sheet on small screens. */}
          {inspectorOpen && (
            <>
              <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setInspectorOpen(false)} aria-hidden="true" />
              <aside
                data-testid="viewer-inspector"
                aria-label="File inspector"
                className="flex flex-col min-h-0 bg-background md:w-[316px] md:shrink-0 md:border-l max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-50 max-md:max-h-[72dvh] max-md:rounded-t-2xl max-md:border-t max-md:shadow-2xl"
              >
                <div className="px-4 pt-4 shrink-0 max-md:pt-2">
                  <div className="md:hidden w-9 h-1 rounded-full bg-border mx-auto mb-3" aria-hidden="true" />
                  <div className="flex items-start gap-3">
                    <span
                      className="size-9 rounded-[10px] shrink-0 flex items-center justify-center text-[10px] font-bold tracking-wide text-white"
                      style={{ backgroundColor: colorFor(file.name) }}
                      aria-hidden="true"
                    >
                      {(extOf(file.name) || 'file').toUpperCase().slice(0, 4)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold leading-snug break-all">{file.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        <span className="font-mono">{humanSize(file.size_bytes)}</span> &middot; {file.mime_type} &middot; v{versions[0]?.version_number ?? file.current_version}
                      </p>
                    </div>
                  </div>
                  <div role="tablist" aria-label="Inspector sections" className="flex gap-0.5 mt-4 p-0.5 bg-muted rounded-lg">
                    <button
                      role="tab"
                      aria-selected={inspectorTab === 'details'}
                      className={`flex-1 h-7 rounded-md text-xs font-medium transition-colors ${inspectorTab === 'details' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      onClick={() => setInspectorTab('details')}
                    >
                      Details
                    </button>
                    <button
                      role="tab"
                      aria-selected={inspectorTab === 'versions'}
                      className={`flex-1 h-7 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${inspectorTab === 'versions' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      onClick={() => setInspectorTab('versions')}
                    >
                      Versions
                      <span className="font-mono text-[10px] text-muted-foreground">{versions.length}</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
                  {inspectorTab === 'details' ? (
                    <>
                      <dl>
                        <PropRow label="Size"><span className="font-mono font-normal">{humanSize(file.size_bytes)}</span></PropRow>
                        <PropRow label="Type">{file.mime_type}</PropRow>
                        <PropRow label="Region">{regionLabel(file.region)}</PropRow>
                        <PropRow label="Uploaded by">{file.uploader_name ?? 'Unknown'}</PropRow>
                        <PropRow label="Created">{timeAgo(file.created_at)}</PropRow>
                        <PropRow label="Modified">{timeAgo(file.updated_at)}</PropRow>
                        {file.origin && (
                          <PropRow label="Origin">
                            <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground border rounded-full px-2 py-px">
                              {originLabel(file.origin)}
                            </span>
                          </PropRow>
                        )}
                        {file.is_synced === 1 && (
                          <PropRow label="Synced">
                            <span className="inline-flex items-center gap-1 text-primary font-semibold">
                              <Check className="size-3.5" /> Yes
                            </span>
                          </PropRow>
                        )}
                      </dl>
                      <div className="mt-5 border rounded-xl p-3.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Sharing</p>
                        <div className="flex items-center gap-2 text-xs mt-2.5">
                          <Link2 className="size-3.5 text-muted-foreground" />
                          <span>Share links</span>
                          <span className="font-mono text-muted-foreground ml-auto">{file.share_count > 0 ? `${file.share_count} active` : 'None'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs mt-2.5">
                          <MessageSquare className="size-3.5 text-muted-foreground" />
                          <span>Comments</span>
                          <span className="font-mono text-muted-foreground ml-auto">{file.comment_count}</span>
                        </div>
                        {actions?.onShare && (
                          <button
                            className="mt-3.5 w-full h-8 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity whitespace-nowrap"
                            onClick={() => actions.onShare!(file)}
                          >
                            <Share2 className="size-3.5" /> Share
                          </button>
                        )}
                      </div>
                    </>
                  ) : versions.length === 0 ? (
                    <div className="text-center py-7">
                      <Clock className="size-5 text-muted-foreground/60 mx-auto mb-2.5" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        No version history yet.<br />New uploads with the same name will appear here.
                      </p>
                    </div>
                  ) : (
                    <>
                      {versions.length > 1 && (
                        <div className="flex items-center justify-end gap-1 mb-2">
                          <span className="text-[11px] text-muted-foreground mr-0.5">Switch</span>
                          <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 border rounded text-[10px] text-muted-foreground bg-muted/50">↑</kbd>
                          <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 border rounded text-[10px] text-muted-foreground bg-muted/50">↓</kbd>
                        </div>
                      )}
                      {versions.map((v) => {
                        const isActive = v.version_number === activeVersion;
                        const isLatest = v.version_number === versions[0].version_number;
                        const d = new Date(v.created_at * 1000);
                        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <div
                            key={v.version_number}
                            role="button"
                            tabIndex={0}
                            className={`w-full text-left px-2.5 py-2 rounded-lg mb-0.5 border transition-colors cursor-pointer ${isActive ? 'bg-muted border-border' : 'border-transparent hover:bg-muted/50'}`}
                            onClick={() => setActiveVersion(v.version_number)}
                            onKeyDown={(e) => { if (e.key === 'Enter') setActiveVersion(v.version_number); }}
                          >
                            <div className="flex items-center gap-1.5 text-xs font-semibold">
                              v{v.version_number}
                              {isLatest ? (
                                <span className="text-[9px] font-semibold uppercase tracking-wide text-primary border border-primary/45 rounded-full px-1.5 py-px">Latest</span>
                              ) : (
                                <button
                                  className="ml-auto text-[11px] font-medium text-muted-foreground hover:text-foreground border rounded-md px-2 py-0.5 disabled:opacity-40"
                                  disabled={restoringVer !== null}
                                  onClick={(e) => { e.stopPropagation(); restoreVersion(v.version_number); }}
                                >
                                  Restore
                                </button>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              <span className="font-mono">{humanSize(v.size_bytes)}</span> &middot; {dateStr} {timeStr}
                            </div>
                            {v.uploader_name && (
                              <div className="text-[11px] text-muted-foreground">{v.uploader_name}</div>
                            )}
                          </div>
                        );
                      })}
                      <p className="text-[11px] text-muted-foreground leading-relaxed mt-3 pt-3 border-t">
                        Uploading a file with the same name creates a new version.
                      </p>
                    </>
                  )}
                </div>
              </aside>
            </>
          )}
        </div>

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
                  className={`w-13 h-13 rounded-md shrink-0 overflow-hidden flex items-center justify-center bg-muted/50 border-2 transition-colors ${isActive ? 'border-foreground' : 'border-transparent hover:border-muted-foreground/30'}`}
                  onClick={() => onNavigate(files[realIdx])}
                  title={f.name}
                >
                  <FilePreviewImage
                    fileId={f.id}
                    fileName={f.name}
                    size={128}
                    className="w-full h-full object-cover"
                    fallback={<img src={fileIconSrc(f.name)} alt="" className="size-6" />}
                  />
                  {isVideo(f.name) && (
                    <div className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded bg-black/50 flex items-center justify-center">
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
            aria-label={stripCollapsed ? 'Expand filmstrip' : 'Collapse filmstrip'}
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
              {file.name}
            </div>
            <button className="size-8 rounded-md flex items-center justify-center hover:bg-muted" onClick={closeEditor}>
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
          <div ref={editorContainerRef} className="flex-1 min-h-0" />
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
      <dd className="text-xs font-medium text-right truncate">{children}</dd>
    </div>
  );
}

function FileContent({ file, files, rawUrl, stableRawUrl, downloadUrl, version, workspaceId, pdfToolbarSlots, zoom, onSaved, onNavigate }: { file: FileItem; files: FileItem[]; rawUrl: string; stableRawUrl: string; downloadUrl: string; version?: number; workspaceId: string; pdfToolbarSlots: { left: HTMLElement | null; center: HTMLElement | null }; zoom?: number; onSaved: () => void; onNavigate: (f: FileItem) => void }) {
  const ext = extOf(file.name);

  if (isVcard(file.name)) {
    return <VCardView file={file} rawUrl={rawUrl} workspaceId={workspaceId} onSaved={onSaved} />;
  }

  if (isImage(file.name)) {
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

  if (isVideo(file.name)) {
    return <video src={rawUrl} controls autoPlay className="max-w-full max-h-full rounded-md bg-black" />;
  }

  if (isAudio(file.name)) {
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

  if (isPdf(file.name)) {
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
  if (isBook(file.name)) {
    return <BookViewer file={file} />;
  }

  if (isTextReadable(file.name, file.mime_type)) {
    return <TextViewer file={file} rawUrl={rawUrl} downloadUrl={downloadUrl} />;
  }

  // Shared by the office-preview fallback and the plain unsupported-type
  // fallback below - the "Open in editor" button only ever applies to office
  // files, so it's conditional here rather than duplicated in both callers.
  const fallbackCard = (
    <div className="bg-background border rounded-xl p-10 text-center min-w-70">
      <p className="text-4xl font-bold text-muted-foreground/30 tracking-wider mb-3">{ext.toUpperCase() || 'FILE'}</p>
      <p className="text-sm text-muted-foreground mb-5 break-all">{file.name}</p>
      {isOfficeFile(file.name) && (
        <a
          href={`/editor/${file.id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90 mr-2"
        >
          <SquarePen className="size-4" /> Open in editor
        </a>
      )}
      <a
        href={downloadUrl}
        download
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90"
      >
        <Download className="size-4" /> Download
      </a>
    </div>
  );

  if (isOfficeFile(file.name)) {
    return <OfficePreview file={file} version={version} fallback={fallbackCard} />;
  }

  // Fallback
  return fallbackCard;
}

const TEXT_PREVIEW_MAX = 2 * 1024 * 1024; // 2 MB
const HIGHLIGHT_MAX = 300 * 1024;         // 300 KB

function TextViewer({ file, rawUrl, downloadUrl }: { file: FileItem; rawUrl: string; downloadUrl: string }) {
  const ext = extOf(file.name);
  const [plain, setPlain] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'toobig' | 'binary' | 'error'>('loading');
  const [findOpen, setFindOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const find = useInFileFind(contentRef);

  // Fetch + detect
  useEffect(() => {
    setPlain(null); setHtml(null); setFindOpen(false); find.clear();
    if (file.size_bytes > TEXT_PREVIEW_MAX) { setState('toobig'); return; }
    setState('loading');
    let cancelled = false;
    fetch(rawUrl, { credentials: 'include' })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((text) => {
        if (cancelled) return;
        if (looksBinary(text.slice(0, 8192))) { setState('binary'); return; }
        setPlain(text);
        setState('ok');
        if (text.length <= HIGHLIGHT_MAX) {
          highlightToHtml(text, langFromExtension(file.name))
            .then((h) => { if (!cancelled) { setHtml(h); requestAnimationFrame(() => find.refresh()); } })
            .catch(() => { /* keep plain */ });
        }
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [rawUrl, file.name, file.size_bytes]); // eslint-disable-line react-hooks/exhaustive-deps

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
  if (state === 'binary' || state === 'error') {
    return <OversizeFallback file={file} downloadUrl={downloadUrl}
      note={state === 'binary' ? 'This file is not text-previewable.' : 'Failed to load file content.'} />;
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
          : <pre className="m-0 px-4 py-4 text-[#d4d4d4] font-mono whitespace-pre-wrap break-words">{plain ?? 'Loading\u2026'}</pre>}
      </div>
    </div>
  );
}

function OversizeFallback({ file, downloadUrl, note }: { file: FileItem; downloadUrl: string; note?: string }) {
  const sizeStr = humanSize(file.size_bytes);
  return (
    <div className="bg-background border rounded-xl p-10 text-center min-w-70">
      <p className="text-4xl font-bold text-muted-foreground/30 tracking-wider mb-3">{extOf(file.name).toUpperCase() || 'FILE'}</p>
      <p className="text-sm text-muted-foreground mb-2 break-all">{file.name}</p>
      <p className="text-xs text-muted-foreground mb-5">{note ?? `File too large to preview inline (${sizeStr}).`}</p>
      <a href={downloadUrl} download className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90">
        <Download className="size-4" /> Download
      </a>
    </div>
  );
}
