import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { fileThumbUrl, fileRawUrl, type ThumbSize } from '@/lib/file-url';
import { getHeicPreviewUrl } from '@/lib/heic';
import { isImage, isHeic } from '@/lib/helpers';

interface FilePreviewImageProps {
  fileId: string;
  fileName: string;
  version?: number;
  /** Extra query params, e.g. `ut=<unlock token>`. */
  query?: string;
  /** Longest edge of the thumbnail. */
  size?: ThumbSize;
  className?: string;
  alt?: string;
  /** Shown when the file isn't an image, or every preview path has failed. */
  fallback: React.ReactNode;
}

/**
 * The one place a file preview image is rendered.
 *
 * Non-HEIC images render natively from the original bytes (`/raw`). HEIC is the
 * one format browsers can't display, and it's handled with a hybrid strategy:
 *
 *  1. Ask the server for a small WebP thumbnail (`/thumb`). The server decodes
 *     HEIC in a Cloudflare Worker, which is capped at 128MB of memory — enough
 *     for photos up to ~12MP.
 *  2. Modern iPhones shoot 24MP/48MP HEIC, which is too large to decode in that
 *     memory budget, so the server returns 415. For those, fall back to decoding
 *     in the browser (via a lazily-loaded WASM worker), which isn't
 *     memory-capped the way a Worker is and handles any resolution.
 *  3. If the browser decode also fails (a genuinely corrupt file), show the
 *     `fallback` icon.
 *
 * This wrapper picks a `key` from the file identity so React fully remounts the
 * inner component whenever it's pointed at a different file/version/query/size
 * (e.g. next/prev navigation in a lightbox that reuses the same JSX slot),
 * resetting the failure state for free — no effect required (a bare
 * `setState` inside a `useEffect` trips `react-hooks/set-state-in-effect`).
 */
export function FilePreviewImage(props: FilePreviewImageProps) {
  const resetKey = `${props.fileId}:${props.version ?? 0}:${props.query ?? ''}:${props.size ?? 256}`;
  return <FilePreviewImageForFile key={resetKey} {...props} />;
}

function FilePreviewImageForFile({
  fileId,
  fileName,
  version,
  query,
  size = 256,
  className,
  alt = '',
  fallback,
}: FilePreviewImageProps) {
  // `failed` = every path exhausted → show the fallback icon.
  const [failed, setFailed] = useState(false);
  // `serverFailed` = the server couldn't make a thumbnail (e.g. 415 for a photo
  // too large to decode in a Worker) → decode it in the browser instead.
  const [serverFailed, setServerFailed] = useState(false);

  if (!isImage(fileName) || failed) return <>{fallback}</>;

  if (isHeic(fileName)) {
    if (!serverFailed) {
      return (
        <img
          src={fileThumbUrl({ fileId, version, query, size })}
          alt={alt}
          className={className}
          loading="lazy"
          onError={() => setServerFailed(true)}
        />
      );
    }
    return (
      <HeicPreview
        fileId={fileId}
        version={version}
        query={query}
        maxDim={size}
        className={className}
        alt={alt}
        onFail={() => setFailed(true)}
      />
    );
  }

  // Every other image format renders natively — point straight at the original.
  return (
    <img
      src={fileRawUrl({ fileId, version, query })}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Browser-side HEIC decode, used only when the server couldn't produce a
 * thumbnail. Decodes the original bytes to an object URL via the WASM worker
 * pool, gated on an IntersectionObserver so a big grid only decodes what's
 * actually visible (an object URL can't use `loading="lazy"`).
 */
function HeicPreview({
  fileId,
  version,
  query,
  maxDim,
  className,
  alt,
  onFail,
}: {
  fileId: string;
  version?: number;
  query?: string;
  maxDim: number;
  className?: string;
  alt: string;
  onFail: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  // `onFail` is a fresh closure every render; useEffectEvent gives the decode
  // effect a stable function that always sees the latest one, so it doesn't need
  // to be a dependency and doesn't re-trigger the decode on every re-render.
  const handleFail = useEffectEvent(() => {
    onFail();
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || visible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    getHeicPreviewUrl({ fileId, version, query, maxDim })
      .then((decoded) => {
        if (!cancelled) setUrl(decoded);
      })
      .catch(() => {
        if (!cancelled) handleFail();
      });

    return () => {
      cancelled = true;
    };
  }, [visible, fileId, version, query, maxDim]);

  // NB: the object URL is owned and revoked by the LRU cache in heic-cache.ts —
  // do NOT revoke it here. Other mounted components may still be showing it.
  if (!url) {
    return <div ref={hostRef} className={`${className ?? ''} animate-pulse bg-muted`} />;
  }

  return <img src={url} alt={alt} className={className} />;
}
