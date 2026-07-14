import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { fileRawUrl } from '@/lib/file-url';
import { getHeicPreviewUrl } from '@/lib/heic';
import { isHeic, isImage } from '@/lib/helpers';

interface FilePreviewImageProps {
  fileId: string;
  fileName: string;
  version?: number;
  /** Extra query params, e.g. `ut=<unlock token>` or a cache-buster. */
  query?: string;
  /** Longest edge for HEIC decodes. Small for thumbs, large for the lightbox. */
  maxDim?: number;
  className?: string;
  alt?: string;
  /** Shown when the file isn't an image, or when the preview fails to load. */
  fallback: React.ReactNode;
}

/**
 * The one place a file preview image is rendered.
 *
 * Ordinary images get a plain <img> pointed at /raw, exactly as before. HEIC gets
 * decoded to an object URL first, because only Safari can decode it natively.
 *
 * This just picks a `key` from the file identity and delegates to the real
 * component below. Keying on (fileId, version, query) makes React fully remount
 * the inner component whenever we're pointed at a different file/version/query
 * (e.g. next/prev navigation in a lightbox that reuses the same JSX slot),
 * which resets `failed` and any in-flight HEIC decode state for free — no
 * effect required to "reset state when a prop changes".
 */
export function FilePreviewImage(props: FilePreviewImageProps) {
  const resetKey = `${props.fileId}:${props.version ?? 0}:${props.query ?? ''}`;
  return <FilePreviewImageForFile key={resetKey} {...props} />;
}

function FilePreviewImageForFile({
  fileId,
  fileName,
  version,
  query,
  maxDim = 512,
  className,
  alt = '',
  fallback,
}: FilePreviewImageProps) {
  const [failed, setFailed] = useState(false);

  if (!isImage(fileName) || failed) return <>{fallback}</>;

  if (isHeic(fileName)) {
    return (
      <HeicPreview
        fileId={fileId}
        version={version}
        query={query}
        maxDim={maxDim}
        className={className}
        alt={alt}
        onFail={() => setFailed(true)}
      />
    );
  }

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

  // `onFail` is a fresh closure every render (it's an inline arrow at the call
  // site above). useEffectEvent gives the decode effect below a stable function
  // that always sees the latest `onFail`, so `onFail` doesn't need to be a
  // dependency and doesn't re-trigger the decode on every parent re-render.
  const handleFail = useEffectEvent(() => {
    onFail();
  });

  // Only decode once the element is near the viewport. An object URL can't use
  // loading="lazy", so without this a 200-file grid would decode all 200.
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
