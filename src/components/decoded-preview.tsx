import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Eye, Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { extOf, humanSize } from '@/lib/helpers';
import { CLIENT_DECODE_MAX_BYTES } from '@/lib/preview-formats.generated';
import { Progress } from '@/components/ui/progress';
import type { FileItem } from '@/lib/file-types';

/**
 * TIFF, camera RAW, Photoshop and iWork files: formats no browser draws, which
 * client-decode.generated.ts decodes in this browser.
 *
 * Nothing happens until the person clicks Open. Opening a folder full of RAW
 * files must not pull hundreds of megabytes, nor the decoder's code, into a
 * browser that only wanted to look at the next photo. So the card comes first,
 * the download shows a real progress bar, and the decoder module is imported
 * only after the bytes have arrived.
 */
type Phase =
  | { at: 'idle' }
  | { at: 'loading'; percent: number }
  | { at: 'decoding' }
  | { at: 'ready'; url: string; page: number; pageCount: number; turning: boolean }
  | { at: 'failed' };

/** Read a response body with progress, into one buffer. */
async function readWithProgress(res: Response, expected: number, onProgress: (percent: number) => void): Promise<Uint8Array> {
  const total = Number(res.headers.get('content-length')) || expected;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let shown = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const percent = total ? Math.min(99, Math.floor((received / total) * 100)) : 0;
    if (percent !== shown) {
      shown = percent;
      onProgress(percent);
    }
  }
  const out = new Uint8Array(received);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function DecodedPreview({ file, rawUrl, downloadUrl, zoom }: { file: FileItem; rawUrl: string; downloadUrl: string; zoom?: number }) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ at: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  // The downloaded file, kept so turning a page decodes again without
  // downloading again.
  const bytesRef = useRef<Uint8Array | null>(null);
  const tooLarge = file.size_bytes > CLIENT_DECODE_MAX_BYTES;

  // Leaving the file (or the viewer) stops the download and frees the image.
  useEffect(() => () => {
    abort.current?.abort();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  async function open() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ at: 'loading', percent: 0 });
    try {
      const res = await fetch(rawUrl, { credentials: 'include', signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await readWithProgress(res, file.size_bytes, (percent) => {
        if (!controller.signal.aborted) setPhase({ at: 'loading', percent });
      });
      if (controller.signal.aborted) return;
      bytesRef.current = bytes;
      setPhase({ at: 'decoding' });
      // Let "Preparing preview" paint before the decoder takes the thread.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      await show(0, controller);
    } catch {
      if (!controller.signal.aborted) setPhase({ at: 'failed' });
    }
  }

  /** Decode one page of the downloaded file and put it on screen. */
  async function show(page: number, controller: AbortController) {
    const { renderPreview } = await import('@/lib/client-decode.generated');
    const image = await renderPreview(file.name, bytesRef.current!, { page });
    if (controller.signal.aborted) return;
    const url = URL.createObjectURL(image.blob);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setPhase({ at: 'ready', url, page: image.page, pageCount: image.pageCount, turning: false });
  }

  async function turn(page: number) {
    if (phase.at !== 'ready' || phase.turning || !bytesRef.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ ...phase, turning: true });
    try {
      await show(page, controller);
    } catch {
      if (!controller.signal.aborted) setPhase({ at: 'failed' });
    }
  }

  if (phase.at === 'ready') {
    const { page, pageCount, turning } = phase;
    const pageLabel = t('common.label.pagePageOfPaginationtotalPages', { page: page + 1, pageCount });
    return (
      <>
        <div
          className="max-w-full max-h-full flex items-center justify-center transition-transform duration-150"
          style={zoom && zoom !== 100 ? { transform: `scale(${zoom / 100})` } : undefined}
        >
          <img
            src={phase.url}
            alt={pageCount > 1 ? `${file.name}, ${pageLabel}` : file.name}
            className={`max-w-full max-h-full object-contain rounded-md transition-opacity duration-150 ${turning ? 'opacity-60' : ''}`}
            data-testid="decoded-preview-image"
          />
        </div>
        {/* Scanned documents are often several pages: TIFFs get page controls. */}
        {pageCount > 1 && (
          <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none" data-testid="decoded-preview-pager">
            <div className="pointer-events-auto flex items-center gap-0.5 p-1 rounded-full bg-black/55 text-white backdrop-blur-sm" role="group" aria-label={pageLabel}>
              <button
                type="button"
                className="size-8 rounded-full flex items-center justify-center hover:bg-white/15 disabled:opacity-35 disabled:pointer-events-none"
                aria-label={t('common.tooltip.previousPage')}
                disabled={page === 0 || turning}
                onClick={() => turn(page - 1)}
              >
                <ChevronLeft className="size-4 rtl:rotate-180" />
              </button>
              <span className="min-w-24 px-1 text-center text-xs tabular-nums" aria-live="polite">
                {turning ? <Loader2 className="inline size-3.5 animate-spin" /> : pageLabel}
              </span>
              <button
                type="button"
                className="size-8 rounded-full flex items-center justify-center hover:bg-white/15 disabled:opacity-35 disabled:pointer-events-none"
                aria-label={t('common.tooltip.nextPage')}
                disabled={page >= pageCount - 1 || turning}
                onClick={() => turn(page + 1)}
              >
                <ChevronRight className="size-4 rtl:rotate-180" />
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  const ext = extOf(file.name);
  const busy = phase.at === 'loading' || phase.at === 'decoding';
  return (
    <div className="bg-background border rounded-xl p-10 text-center w-80 max-w-full" data-testid="decoded-preview-card">
      <p className="text-4xl font-bold text-muted-foreground/30 tracking-wider mb-3">{ext.toUpperCase()}</p>
      <p className="text-sm text-muted-foreground mb-1 break-all"><bdi>{file.name}</bdi></p>
      <p className="text-xs text-muted-foreground mb-5">{humanSize(file.size_bytes)}</p>

      {busy ? (
        <div className="mb-1" role="status" aria-live="polite">
          {phase.at === 'loading' ? (
            <>
              <Progress value={phase.percent} aria-label={t('common.description.loadingPreview')} />
              <p className="text-xs text-muted-foreground mt-2 tabular-nums">{t('common.description.loadingPreview')} {phase.percent}%</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> {t('common.description.preparingPreview')}
            </p>
          )}
        </div>
      ) : (
        <>
          {tooLarge && <p className="text-xs text-muted-foreground mb-5">{t('common.error.fileTooLargeToPreviewInlineSizeStr', { sizeStr: humanSize(file.size_bytes) })}</p>}
          {phase.at === 'failed' && <p className="text-xs text-destructive mb-5">{t('common.error.couldNotPreviewThisFileDownloadItToOpenIt')}</p>}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {!tooLarge && (
              <button
                type="button"
                onClick={open}
                className="whitespace-nowrap inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90"
              >
                <Eye className="size-4" /> {phase.at === 'failed' ? t('common.action.tryAgain') : t('files.open')}
              </button>
            )}
            <a
              href={downloadUrl}
              download
              className="whitespace-nowrap inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border text-sm font-semibold hover:bg-muted"
            >
              <Download className="size-4" /> {t('common.action.download')}
            </a>
          </div>
        </>
      )}
    </div>
  );
}
