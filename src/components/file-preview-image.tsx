import { useState } from 'react';
import { fileThumbUrl, type ThumbSize } from '@/lib/file-url';
import { isImage } from '@/lib/helpers';

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
 * The API generates and caches a small WebP; the browser just displays it. There
 * is no client-side decoding of any format, HEIC included.
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

  return (
    <img
      src={fileThumbUrl({ fileId, version, query, size })}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
