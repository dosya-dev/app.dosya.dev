import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Download, Loader2, X, ChevronUp, ChevronDown } from 'lucide-react';
import { PdfToolbar, type PdfZoom } from './pdf-toolbar';
import { PdfThumbnails } from './pdf-thumbnails';
import { usePdfFind, type PdfFind } from '@/lib/use-pdf-find';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// pdf.js scale 1 is 72dpi; CSS pixels are 96dpi, so this matches the "100%"
// most other viewers show.
const CSS_UNITS = 96 / 72;
const ZOOM_LADDER = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SIDEBAR_KEY = 'dosya:pdf-sidebar';
const PAGE_GUTTER = 24;
// Pages at most this far from the current one keep a live canvas; everything
// else is a fixed-size placeholder so huge documents stay cheap.
const RENDER_DISTANCE = 2;

interface PdfViewerProps {
  fileName: string;
  rawUrl: string;
  downloadUrl: string;
}

export function PdfViewer({ fileName, rawUrl, downloadUrl }: PdfViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<PdfZoom>('fit-width');
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1');
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [printing, setPrinting] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRaf = useRef(0);

  // One PdfViewer instance shows exactly one document: the call site keys
  // this component on the raw URL, so a file or version switch remounts it
  // with fresh state instead of resetting fields here.
  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ url: rawUrl, withCredentials: true });
    task.promise.then(
      (loaded) => { if (!cancelled) setDoc(loaded); },
      () => { if (!cancelled) setError(true); },
    );
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [rawUrl]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    doc.getPage(1).then((p) => {
      if (cancelled) return;
      const viewport = p.getViewport({ scale: 1 });
      setBaseSize({ width: viewport.width, height: viewport.height });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [doc]);

  useEffect(() => {
    const measure = () => {
      const el = scrollerRef.current;
      if (el) setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const numPages = doc?.numPages ?? 0;
  const effectiveScale = resolveScale(zoom, baseSize, containerSize);

  const jumpTo = (target: number) => {
    if (!numPages) return;
    const clamped = Math.min(Math.max(1, Math.round(target)), numPages);
    setPage(clamped);
    pageRefs.current[clamped - 1]?.scrollIntoView?.({ block: 'start' });
  };

  const find = usePdfFind(doc, jumpTo);

  const onScroll = () => {
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      // The page whose top is above the upper third of the viewport wins.
      const line = scroller.scrollTop + scroller.clientHeight / 3;
      let best = 1;
      pageRefs.current.forEach((el, i) => {
        if (el && el.offsetTop <= line) best = i + 1;
      });
      setPage(best);
    });
  };
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);

  const zoomIn = () => setZoom(ZOOM_LADDER.find((z) => z > effectiveScale + 0.001) ?? ZOOM_LADDER[ZOOM_LADDER.length - 1]);
  const zoomOut = () => setZoom([...ZOOM_LADDER].reverse().find((z) => z < effectiveScale - 0.001) ?? ZOOM_LADDER[0]);

  const toggleSidebar = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
  };

  const handlePrint = async () => {
    if (!doc || printing) return;
    setPrinting(true);
    try {
      ensurePrintStyle();
      const holder = document.createElement('div');
      holder.className = 'pdf-print-root';
      document.body.appendChild(holder);
      try {
        for (let n = 1; n <= doc.numPages; n++) {
          const p = await doc.getPage(n);
          const viewport = p.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          if (ctx) await p.render({ canvas, canvasContext: ctx, viewport }).promise;
          const img = document.createElement('img');
          try { img.src = canvas.toDataURL('image/png'); } catch { /* no canvas raster in jsdom */ }
          holder.appendChild(img);
        }
        window.print();
      } finally {
        holder.remove();
      }
    } finally {
      setPrinting(false);
    }
  };

  const base = baseSize ?? { width: 612, height: 792 };
  const pageWidth = Math.round(base.width * CSS_UNITS * effectiveScale);
  const pageHeight = Math.round(base.height * CSS_UNITS * effectiveScale);

  return (
    <div className="w-full h-full flex flex-col bg-background relative">
      <PdfToolbar
        fileName={fileName}
        page={page}
        numPages={numPages}
        zoomLabel={`${Math.round(effectiveScale * 100)}%`}
        downloadUrl={downloadUrl}
        sidebarOpen={sidebarOpen}
        printing={printing}
        onToggleSidebar={toggleSidebar}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoom={setZoom}
        onJump={jumpTo}
        onToggleFind={() => (find.open ? find.hide() : find.show())}
        onPrint={handlePrint}
      />
      <div className="flex-1 flex min-h-0">
        {sidebarOpen && doc && (
          <PdfThumbnails doc={doc} numPages={numPages} current={page} baseSize={baseSize} onSelect={jumpTo} />
        )}
        <div ref={scrollerRef} onScroll={onScroll} className="flex-1 overflow-auto bg-muted/30">
          {error ? (
            <div className="h-full flex items-center justify-center p-6">
              <div className="bg-background border rounded-xl p-10 text-center min-w-70">
                <p className="text-sm font-semibold mb-1">Could not display this PDF</p>
                <p className="text-sm text-muted-foreground mb-5">The file may be corrupted or use unsupported features.</p>
                <a
                  href={downloadUrl}
                  download
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90"
                >
                  <Download className="size-4" /> Download
                </a>
              </div>
            </div>
          ) : !doc ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4" style={{ padding: PAGE_GUTTER }}>
              {Array.from({ length: numPages }, (_, i) => {
                const n = i + 1;
                return (
                  <div
                    key={n}
                    data-page={n}
                    ref={(el) => { pageRefs.current[i] = el; }}
                    style={{ width: pageWidth, height: pageHeight }}
                    className="bg-white shadow-sm shrink-0"
                  >
                    {Math.abs(n - page) <= RENDER_DISTANCE && (
                      <PdfPageCanvas doc={doc} pageNum={n} scale={effectiveScale} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {find.open && <PdfFindBar find={find} onClose={find.hide} />}
    </div>
  );
}

export default PdfViewer;

function resolveScale(
  zoom: PdfZoom,
  baseSize: { width: number; height: number } | null,
  containerSize: { width: number; height: number },
): number {
  if (typeof zoom === 'number') return zoom;
  if (!baseSize || !containerSize.width || !containerSize.height) return 1;
  const widthScale = (containerSize.width - PAGE_GUTTER * 2) / (baseSize.width * CSS_UNITS);
  const scale = zoom === 'fit-width'
    ? widthScale
    : Math.min(widthScale, (containerSize.height - PAGE_GUTTER * 2) / (baseSize.height * CSS_UNITS));
  return Math.min(Math.max(scale, 0.25), 4);
}

function PdfPageCanvas({ doc, pageNum, scale }: { doc: PDFDocumentProxy; pageNum: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    doc.getPage(pageNum).then((p) => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: scale * CSS_UNITS * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      task = p.render({ canvas, canvasContext: ctx, viewport });
      task.promise.catch(() => { /* cancelled mid-render is routine */ });
    }).catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNum, scale]);
  return <canvas ref={canvasRef} className="w-full h-full" />;
}

function PdfFindBar({ find, onClose }: { find: PdfFind; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) find.prev(); else find.next(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div
      role="search"
      className="absolute top-14 right-3 z-20 flex items-center gap-1 rounded-md border bg-background/95 shadow-md px-2 py-1"
      onKeyDown={onKeyDown}
    >
      <input
        ref={inputRef}
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
        placeholder="Find"
        className="w-40 bg-transparent text-sm outline-none px-1"
        aria-label="Find in document"
      />
      <span className="text-[11px] text-muted-foreground tabular-nums min-w-12 text-center">
        {find.total ? `${find.current + 1}/${find.total}` : (find.query ? 'No results' : '')}
      </span>
      <button className="size-6 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40"
        onClick={find.prev} disabled={!find.total} title="Previous (Shift+Enter)">
        <ChevronUp className="size-3.5" />
      </button>
      <button className="size-6 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40"
        onClick={find.next} disabled={!find.total} title="Next (Enter)">
        <ChevronDown className="size-3.5" />
      </button>
      <button className="size-6 rounded flex items-center justify-center hover:bg-muted"
        onClick={onClose} title="Close (Esc)">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

const PRINT_STYLE_ID = 'pdf-print-style';
function ensurePrintStyle() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = [
    '.pdf-print-root { display: none; }',
    '@media print {',
    '  body > *:not(.pdf-print-root) { display: none !important; }',
    '  .pdf-print-root { display: block !important; }',
    '  .pdf-print-root img { width: 100%; break-after: page; }',
    '}',
  ].join('\n');
  document.head.appendChild(style);
}
