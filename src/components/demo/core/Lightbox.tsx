import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, Share2, X } from 'lucide-react';
import { humanSize } from '../engine/demoData';
import { useDemo, visibleItems } from '../engine/demoState';

// Full-screen photo viewer (within the demo), mirroring apps/web FileViewer:
// dark backdrop, filename + actions header, the image centered, and prev/next
// arrows cycling through the images in the current folder. Only images open
// here; other files use the side PreviewPane.
export function Lightbox() {
  const { state, dispatch } = useDemo();
  const file = state.files.find((f) => f.id === state.previewFileId);
  const open = !!file && file.kind === 'image' && !!file.thumb;

  // Images in the current folder, in display order, for prev/next.
  const gallery = visibleItems(state).files.filter((f) => f.kind === 'image' && f.thumb);
  const idx = file ? gallery.findIndex((f) => f.id === file.id) : -1;
  const go = (delta: number) => {
    if (idx < 0) return;
    const next = gallery[(idx + delta + gallery.length) % gallery.length];
    if (next) dispatch({ type: 'PREVIEW', fileId: next.id });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch({ type: 'PREVIEW', fileId: null });
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, idx, gallery.length]);

  if (!file || !open) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-black/90" onClick={() => dispatch({ type: 'PREVIEW', fileId: null })}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-[11px] text-white/60">{humanSize(file.sizeBytes)} · {file.region} · {file.modified}</p>
        </div>
        <button aria-label="Share" onClick={() => { dispatch({ type: 'PREVIEW', fileId: null }); dispatch({ type: 'OPEN_SHARE', fileId: file.id }); }}
          className="grid size-8 place-items-center rounded-md text-white/80 hover:bg-white/10"><Share2 className="size-4" /></button>
        <button aria-label="Download" onClick={() => dispatch({ type: 'TOAST', toast: { text: 'This is a demo - sign up to download for real.', cta: true } })}
          className="grid size-8 place-items-center rounded-md text-white/80 hover:bg-white/10"><Download className="size-4" /></button>
        <button aria-label="Close preview" onClick={() => dispatch({ type: 'PREVIEW', fileId: null })}
          className="grid size-8 place-items-center rounded-md text-white/80 hover:bg-white/10"><X className="size-4" /></button>
      </div>

      {/* Image stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12 pb-8" onClick={(e) => e.stopPropagation()}>
        {gallery.length > 1 && (
          <button aria-label="Previous" onClick={() => go(-1)}
            className="absolute left-3 grid size-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><ChevronLeft className="size-5" /></button>
        )}
        <div className="max-h-full w-full max-w-3xl overflow-hidden rounded-lg shadow-2xl" style={{ aspectRatio: '3 / 2', background: file.thumb }} />
        {gallery.length > 1 && (
          <button aria-label="Next" onClick={() => go(1)}
            className="absolute right-3 grid size-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><ChevronRight className="size-5" /></button>
        )}
      </div>
    </div>
  );
}
