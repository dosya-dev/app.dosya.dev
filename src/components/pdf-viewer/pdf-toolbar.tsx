import { useState } from 'react';
import { PanelLeft, Minus, Plus, ChevronDown, Search, Printer, Download } from 'lucide-react';

export type PdfZoom = number | 'fit-width' | 'fit-page';

const iconBtn = 'size-8 rounded-md flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:pointer-events-none';
const menuItem = 'block w-full px-3 py-1.5 text-left text-sm hover:bg-muted whitespace-nowrap';

interface PdfToolbarProps {
  fileName: string;
  page: number;
  numPages: number;
  zoomLabel: string;
  downloadUrl: string;
  sidebarOpen: boolean;
  printing: boolean;
  onToggleSidebar: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoom: (zoom: PdfZoom) => void;
  onJump: (page: number) => void;
  onToggleFind: () => void;
  onPrint: () => void;
}

export function PdfToolbar({
  fileName, page, numPages, zoomLabel, downloadUrl, sidebarOpen, printing,
  onToggleSidebar, onZoomIn, onZoomOut, onZoom, onJump, onToggleFind, onPrint,
}: PdfToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const disabled = numPages === 0;

  // The input is uncontrolled and keyed on `page`: a jump from anywhere
  // (scroll, thumbnail, search) remounts it with the fresh value, while
  // typing needs no state sync at all.
  const commitPage = (input: HTMLInputElement) => {
    const parsed = parseInt(input.value, 10);
    if (Number.isNaN(parsed)) { input.value = String(page); return; }
    const target = Math.min(Math.max(1, parsed), numPages);
    input.value = String(target);
    onJump(target);
  };

  return (
    <div className="flex items-center h-12 px-2 gap-1 border-b bg-background shrink-0">
      <button className={iconBtn} title="Toggle sidebar" aria-pressed={sidebarOpen} disabled={disabled} onClick={onToggleSidebar}>
        <PanelLeft className="size-4 text-muted-foreground" />
      </button>
      <span className="text-sm font-medium truncate max-w-64 px-1">{fileName}</span>

      <div className="flex-1" />

      <button className={iconBtn} title="Zoom out" disabled={disabled} onClick={onZoomOut}>
        <Minus className="size-4 text-muted-foreground" />
      </button>
      <div className="relative">
        <button
          aria-label="Zoom options"
          disabled={disabled}
          onClick={() => setMenuOpen((o) => !o)}
          className="h-8 px-1.5 rounded-md flex items-center gap-0.5 text-sm tabular-nums hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
        >
          <span aria-label="Zoom level">{zoomLabel}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-30 min-w-28 rounded-md border bg-background shadow-md py-1">
              {([['Fit width', 'fit-width'], ['Fit page', 'fit-page']] as const).map(([label, zoom]) => (
                <button key={zoom} className={menuItem} onClick={() => { onZoom(zoom); setMenuOpen(false); }}>{label}</button>
              ))}
              <div className="h-px bg-border my-1" />
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((zoom) => (
                <button key={zoom} className={menuItem} onClick={() => { onZoom(zoom); setMenuOpen(false); }}>{`${zoom * 100}%`}</button>
              ))}
            </div>
          </>
        )}
      </div>
      <button className={iconBtn} title="Zoom in" disabled={disabled} onClick={onZoomIn}>
        <Plus className="size-4 text-muted-foreground" />
      </button>

      <div className="w-px h-5 bg-border mx-2" />

      <input
        key={page}
        aria-label="Page number"
        inputMode="numeric"
        disabled={disabled}
        defaultValue={String(page)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitPage(e.currentTarget); } }}
        onBlur={(e) => commitPage(e.currentTarget)}
        className="w-11 h-7 text-center text-sm tabular-nums border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
      />
      <span className="text-sm text-muted-foreground whitespace-nowrap tabular-nums">/ {numPages}</span>

      <div className="w-px h-5 bg-border mx-2" />

      <button className={iconBtn} title="Search" disabled={disabled} onClick={onToggleFind}>
        <Search className="size-4 text-muted-foreground" />
      </button>

      <div className="flex-1" />

      <button className={iconBtn} title="Print" disabled={disabled || printing} onClick={onPrint}>
        <Printer className="size-4 text-muted-foreground" />
      </button>
      <a className={iconBtn} title="Download" href={downloadUrl} download>
        <Download className="size-4 text-muted-foreground" />
      </a>
    </div>
  );
}
