import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, API_BASE } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import {
  X, Download, ChevronLeft, ChevronRight, Pencil, Clock,

} from 'lucide-react';
import { humanSize, extOf, isImage, isVideo, isAudio, fileIconSrc } from '@/lib/helpers';
import { FilePreviewImage } from '@/components/file-preview-image';
import { toast } from '@/lib/toast';
import { isTextReadable, langFromExtension, looksBinary } from '@/lib/text-detect';
import { highlightToHtml } from '@/lib/text-highlight';
import { useInFileFind } from '@/lib/use-in-file-find';
import { TextFindBar } from '@/components/text-find-bar';
import { TextEditorOverlay } from '@/components/text-editor';
import { VCardView } from '@/components/vcard-viewer';


// ── Types ─────────────────────────────────────────────────

interface FileItem {
  id: string; name: string; size_bytes: number; mime_type: string; extension: string;
  region: string; created_at: number; updated_at: number; current_version: number;
  lock_mode: string; is_hidden: number; uploaded_by: string; uploader_name: string;
  share_count: number; comment_count: number; is_synced: number;
}

interface Version {
  version_number: number;
  size_bytes: number;
  created_at: number;
  uploader_name: string | null;
}

interface FileViewerProps {
  file: FileItem;
  files: FileItem[];
  workspaceId: string;
  onClose: () => void;
  onNavigate: (file: FileItem) => void;
  onRefresh: () => void;
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
// Pintura's RGB channels — so resolve them to concrete sRGB here and set them inline on
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

export function FileViewer({ file, files, workspaceId, onClose, onNavigate, onRefresh }: FileViewerProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [activeVersion, setActiveVersion] = useState(-1);
  const [closing, setClosing] = useState(false);
  const [editingOpen, setEditingOpen] = useState(false);
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

  // Build raw URL for active version
  const rawUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (activeVersion > 0 && versions.length > 0 && activeVersion !== versions[0].version_number) {
      params.set('version', String(activeVersion));
    }
    params.set('_t', String(Date.now()));
    return `${API_BASE}/api/files/${file.id}/raw?${params}`;
  }, [file.id, activeVersion, versions]);

  // Stable raw URL for the text editor overlay: identity only changes when the
  // file/version actually changes, so it doesn't tear down the live EditorView
  // on unrelated FileViewer re-renders (e.g. keystrokes bubbling from CodeMirror).
  // Cache-bust with a deterministic value derived from state (latest version's
  // created_at, falling back to the file's updated_at) instead of Date.now() —
  // calling Date.now() during a useMemo body is flagged as impure by
  // react-hooks/purity (unlike the rawUrl useCallback above, whose body only
  // runs when invoked, not synchronously during render).
  const editorRawUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (activeVersion > 0 && versions.length > 0 && activeVersion !== versions[0].version_number) {
      params.set('version', String(activeVersion));
    }
    const cacheBust = versions.length > 0 ? versions[0].created_at : file.updated_at;
    params.set('_t', String(cacheBust));
    return `${API_BASE}/api/files/${file.id}/raw?${params}`;
  }, [file.id, file.updated_at, activeVersion, versions]);

  const downloadUrl = `${API_BASE}/api/files/${file.id}/download`;

  // The version actually being shown — mirrors the logic inside rawUrl() above.
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
      if (e.key === 'Escape') { handleClose(); return; }
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate(files[idx - 1]);
      if (e.key === 'ArrowRight' && hasNext) onNavigate(files[idx + 1]);
      if (e.key === 'ArrowUp') { e.preventDefault(); navigateVersion(-1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); navigateVersion(1); }
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
          // app's own credentialed request works) and hand Pintura a local File —
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
        // Surface the real reason instead of swallowing it — e.g. a failed dynamic
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
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <svg viewBox="0 0 14 14" fill="none" width="14" height="14" className="shrink-0 text-muted-foreground">
              <path d="M1 7s2.5-4.5 6-4.5S13 7 13 7s-2.5 4.5-6 4.5S1 7 1 7z" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.1" />
            </svg>
            <span className="text-sm font-semibold truncate">{file.name}</span>
            <span className="text-xs text-muted-foreground shrink-0">{counter}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {hasPrev && (
              <button className="size-8 rounded-md flex items-center justify-center hover:bg-muted" onClick={() => onNavigate(files[idx - 1])} title="Previous (←)">
                <ChevronLeft className="size-4 text-muted-foreground" />
              </button>
            )}
            {hasNext && (
              <button className="size-8 rounded-md flex items-center justify-center hover:bg-muted" onClick={() => onNavigate(files[idx + 1])} title="Next (→)">
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            )}
            {(isEditable(file.name) || canTextEdit) && (
              <button className="h-7 px-2.5 rounded-md border flex items-center gap-1.5 text-xs font-medium hover:bg-muted"
                onClick={() => (canTextEdit ? setTextEditOpen(true) : openEditor())}>
                <Pencil className="size-3 text-muted-foreground" /> Edit
              </button>
            )}
            <a href={downloadUrl} download className="size-8 rounded-md flex items-center justify-center hover:bg-muted" title="Download">
              <Download className="size-4 text-muted-foreground" />
            </a>
            <button className="size-8 rounded-md flex items-center justify-center hover:bg-muted ml-1" onClick={handleClose} title="Close (Esc)">
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Body + version sidebar */}
        <div className="flex-1 flex min-h-0">
          {/* File content */}
          <div className="flex-1 min-h-0 min-w-0 flex items-center justify-center bg-muted/30 overflow-auto p-6">
            <FileContent file={file} rawUrl={rawUrl()} downloadUrl={downloadUrl} version={previewVersion} workspaceId={workspaceId} onSaved={() => { onRefresh(); loadVersions(); }} />
          </div>

          {/* Version sidebar */}
          <aside className="w-52 shrink-0 border-l bg-background flex-col hidden md:flex">
            <div className="flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b shrink-0">
              <Clock className="size-3 text-muted-foreground" />
              Versions
              <div className="flex items-center gap-0.5 ml-auto">
                <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 border rounded text-[10px] text-muted-foreground bg-muted/50">↑</kbd>
                <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 border rounded text-[10px] text-muted-foreground bg-muted/50">↓</kbd>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-5">No version history</p>
              ) : (
                versions.map((v) => {
                  const isActive = v.version_number === activeVersion;
                  const isLatest = v.version_number === versions[0].version_number;
                  const d = new Date(v.created_at * 1000);
                  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <button
                      key={v.version_number}
                      className={`block w-full text-left px-2.5 py-2 rounded-md mb-0.5 transition-colors ${isActive ? 'bg-muted shadow-[inset_2px_0_0_hsl(var(--foreground))]' : 'hover:bg-muted/50'}`}
                      onClick={() => setActiveVersion(v.version_number)}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        v{v.version_number}
                        {isLatest && (
                          <Badge variant="secondary" className="h-auto rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-white bg-green-500">Latest</Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {humanSize(v.size_bytes)} &middot; {dateStr} {timeStr}
                      </div>
                      {v.uploader_name && (
                        <div className="text-[11px] text-muted-foreground">{v.uploader_name}</div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        </div>

        {/* Thumbnail strip footer */}
        <div className="flex items-center justify-center gap-2 px-3 py-2 border-t shrink-0">
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
          rawUrl={editorRawUrl}
          workspaceId={workspaceId}
          onClose={closeTextEdit}
          onSaved={() => { onRefresh(); loadVersions(); }}
        />
      )}
    </>
  );
}

// ── File content renderer ─────────────────────────────────

function FileContent({ file, rawUrl, downloadUrl, version, workspaceId, onSaved }: { file: FileItem; rawUrl: string; downloadUrl: string; version?: number; workspaceId: string; onSaved: () => void }) {
  const ext = extOf(file.name);

  if (isVcard(file.name)) {
    return <VCardView file={file} rawUrl={rawUrl} workspaceId={workspaceId} onSaved={onSaved} />;
  }

  if (isImage(file.name)) {
    return (
      <FilePreviewImage
        fileId={file.id}
        fileName={file.name}
        version={version}
        size={1600}
        className="max-w-full max-h-full object-contain rounded-md"
        alt={file.name}
        fallback={<img src={fileIconSrc(file.name)} alt={file.name} className="size-24" />}
      />
    );
  }

  if (isVideo(file.name)) {
    return <video src={rawUrl} controls autoPlay className="max-w-full max-h-full rounded-md bg-black" />;
  }

  if (isAudio(file.name)) {
    return (
      <div className="flex flex-col items-center gap-4 p-10 bg-background rounded-xl border">
        <svg viewBox="0 0 24 24" fill="none" width="48" height="48" className="text-muted-foreground">
          <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <p className="text-sm font-medium break-all text-center">{file.name}</p>
        <audio src={rawUrl} controls autoPlay className="w-90 max-w-[90vw]" />
      </div>
    );
  }

  if (isPdf(file.name)) {
    return (
      <iframe src={`${rawUrl}#toolbar=1`} className="w-full h-full border-none rounded-md bg-white" title={`PDF: ${file.name}`} />
    );
  }

  if (isTextReadable(file.name, file.mime_type)) {
    return <TextViewer file={file} rawUrl={rawUrl} downloadUrl={downloadUrl} />;
  }

  // Fallback
  return (
    <div className="bg-background border rounded-xl p-10 text-center min-w-70">
      <p className="text-4xl font-bold text-muted-foreground/30 tracking-wider mb-3">{ext.toUpperCase() || 'FILE'}</p>
      <p className="text-sm text-muted-foreground mb-5 break-all">{file.name}</p>
      <a
        href={downloadUrl}
        download
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90"
      >
        <Download className="size-4" /> Download
      </a>
    </div>
  );
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
    fetch(rawUrl)
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
