import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Loader2, SquarePen } from 'lucide-react';
import { API_BASE } from '@/api/client';
import type { FileItem } from '@/lib/file-types';

// Retries a 503 ("conversion in flight") this many times before giving up
// and showing the fallback - 2 retries plus the initial attempt covers the
// first-conversion window (a few seconds) with room to spare.
const MAX_RETRIES = 2;
const DEFAULT_RETRY_SECONDS = 3;
// Above this, an inline PDF preview is more trouble than it's worth (slow
// blob decode, sluggish iframe) - the fallback card's download link is the
// better path for a document this size.
const MAX_DISPLAY_BYTES = 20 * 1024 * 1024;

type Status = 'loading' | 'preparing' | 'ready' | 'fallback';

interface OfficePreviewProps {
  file: FileItem;
  version?: number;
  fallback: ReactNode;
  /** Chromeless iframe (#toolbar=0&navpanes=0) for small surfaces (the detail
   *  panel's thumbnail card) - and skips the floating "Open in editor" row,
   *  since callers that pass `compact` already show their own editor button. */
  compact?: boolean;
}

/**
 * Inline PDF preview for office documents (docx/xlsx/pptx/...), backed by
 * GET /api/files/:id/preview-pdf. That endpoint converts on demand via
 * ONLYOFFICE's Document Server, so the first request for a given version can
 * take a few seconds - a 503 + Retry-After means "still converting," not an
 * error, hence the "Preparing preview..." state and bounded retry below.
 */
export function OfficePreview({ file, version, fallback, compact }: OfficePreviewProps) {
  const [status, setStatus] = useState<Status>('loading');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let createdUrl: string | null = null;

    setStatus('loading');
    setObjectUrl(null);

    const clearRetryTimer = () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const params = new URLSearchParams();
    if (version !== undefined) params.set('version', String(version));
    const qs = params.toString();
    const url = `${API_BASE}/api/files/${file.id}/preview-pdf${qs ? `?${qs}` : ''}`;

    const attempt = async (retriesLeft: number) => {
      let res: Response;
      try {
        res = await fetch(url, { credentials: 'include', signal: controller.signal });
      } catch {
        if (!cancelled) setStatus('fallback');
        return;
      }
      if (cancelled) return;

      if (res.status === 503) {
        if (retriesLeft <= 0) { setStatus('fallback'); return; }
        setStatus('preparing');
        const header = res.headers?.get ? res.headers.get('Retry-After') : null;
        const retrySeconds = Number(header);
        const delayMs = (Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds : DEFAULT_RETRY_SECONDS) * 1000;
        clearRetryTimer();
        retryTimerRef.current = setTimeout(() => { attempt(retriesLeft - 1); }, delayMs);
        return;
      }

      if (!res.ok) { setStatus('fallback'); return; }

      const blob = await res.blob();
      if (cancelled) return;
      if (blob.size > MAX_DISPLAY_BYTES) { setStatus('fallback'); return; }

      const objUrl = URL.createObjectURL(blob);
      createdUrl = objUrl;
      setObjectUrl(objUrl);
      setStatus('ready');
    };

    attempt(MAX_RETRIES);

    return () => {
      cancelled = true;
      controller.abort();
      clearRetryTimer();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [file.id, version]);

  if (status === 'fallback') return <>{fallback}</>;

  if (status === 'ready' && objectUrl) {
    const hash = compact ? 'toolbar=0&navpanes=0' : 'toolbar=1';
    return (
      <div className="relative w-full h-full">
        {!compact && (
          <div className="absolute top-2 right-2 z-10">
            <a
              href={`/editor/${file.id}`}
              target="_blank"
              rel="noreferrer"
              className="h-7 px-2.5 rounded-md border bg-background/90 backdrop-blur-sm shadow-sm flex items-center gap-1.5 text-xs font-medium hover:bg-muted"
            >
              <SquarePen className="size-3 text-muted-foreground" /> Open in editor
            </a>
          </div>
        )}
        <iframe
          src={`${objectUrl}#${hash}`}
          className="w-full h-full border-none rounded-md bg-white"
          title={`Preview: ${file.name}`}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 w-full h-full min-h-40 p-10 text-sm text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      <span>{status === 'preparing' ? 'Preparing preview...' : 'Loading preview...'}</span>
    </div>
  );
}
