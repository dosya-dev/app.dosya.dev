import { useState } from 'react';
import { fileThumbUrl, fileRawUrl, type ThumbSize } from '@/lib/file-url';
import { isImage, isHeic } from '@/lib/helpers';

interface FilePreviewImageProps {
  fileId: string;
  fileName: string;
  version?: number;
  /** Extra query params, e.g. `ut=<unlock token>`. */
  query?: string;
  /** Longest edge of the server-generated thumbnail. */
  size?: ThumbSize;
  className?: string;
  alt?: string;
  /** Shown when the file isn't an image, or the thumbnail fails to load. */
  fallback: React.ReactNode;
}

/**
 * The one place a file preview image is rendered.
 *
 * HEIC/HEIF is the one format browsers can't render natively, so it's the only
 * one the server generates (and caches) a small WebP derivative for — see
 * `fileThumbUrl`. Every other image format is already renderable by the
 * browser, so it's pointed straight at the original bytes via `fileRawUrl`:
 * no server-side decode, no redirect round-trip through `/thumb`, exactly
 * production behavior for JPEG/PNG/etc. prior to HEIC support.
 *
 * This just picks a `key` from the file identity and delegates to the real
 * component below. Keying on (fileId, version, query, size) makes React fully
 * remount the inner component whenever we're pointed at a different
 * file/version/query/size (e.g. next/prev navigation in a lightbox that reuses
 * the same JSX slot), which resets `failed` for free — no effect required to
 * "reset state when a prop changes" (a bare `setFailed(false)` inside a
 * `useEffect` trips `react-hooks/set-state-in-effect`).
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
  const [failed, setFailed] = useState(false);

  if (!isImage(fileName) || failed) return <>{fallback}</>;

  // HEIC/HEIF: the browser can't render it, so use the server-generated thumb.
  // Everything else: the browser already renders it, so use the original bytes.
  const src = isHeic(fileName)
    ? fileThumbUrl({ fileId, version, query, size })
    : fileRawUrl({ fileId, version, query });

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
