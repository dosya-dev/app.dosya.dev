import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

const THUMB_WIDTH = 120;

interface PdfThumbnailsProps {
  doc: PDFDocumentProxy;
  numPages: number;
  current: number;
  baseSize: { width: number; height: number } | null;
  onSelect: (page: number) => void;
}

export function PdfThumbnails({ doc, numPages, current, baseSize, onSelect }: PdfThumbnailsProps) {
  return (
    <div data-testid="pdf-thumbs" className="w-40 shrink-0 border-r bg-background overflow-y-auto p-3 flex flex-col gap-3">
      {Array.from({ length: numPages }, (_, i) => (
        <Thumb key={i + 1} doc={doc} page={i + 1} active={current === i + 1} baseSize={baseSize} onSelect={onSelect} />
      ))}
    </div>
  );
}

function Thumb({ doc, page, active, baseSize, onSelect }: {
  doc: PDFDocumentProxy;
  page: number;
  active: boolean;
  baseSize: { width: number; height: number } | null;
  onSelect: (page: number) => void;
}) {
  // Render lazily as thumbs scroll into view; environments without
  // IntersectionObserver (jsdom) just render immediately.
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const btnRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (visible) return;
    const el = btnRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    doc.getPage(page).then((p) => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const base = p.getViewport({ scale: 1 });
      const scale = (THUMB_WIDTH * (window.devicePixelRatio || 1)) / base.width;
      const viewport = p.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      p.render({ canvas, canvasContext: ctx, viewport }).promise.catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, doc, page]);

  const aspect = baseSize ? `${baseSize.width} / ${baseSize.height}` : '612 / 792';
  return (
    <button
      ref={btnRef}
      data-thumb={page}
      onClick={() => onSelect(page)}
      className={`group flex flex-col items-center gap-1 rounded-md p-1 ${active ? 'bg-muted' : 'hover:bg-muted/60'}`}
      title={`Page ${page}`}
    >
      <canvas
        ref={canvasRef}
        style={{ aspectRatio: aspect }}
        className={`w-full bg-white rounded-sm ring-1 ${active ? 'ring-ring' : 'ring-border'}`}
      />
      <span className={`text-[11px] tabular-nums ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{page}</span>
    </button>
  );
}
