import { useEffect, useState } from 'react';
import { useRouteError, isRouteErrorResponse } from 'react-router-dom';
import { ErrorLayout } from '@/components/error-layout';
import { isChunkLoadError, recoverFromChunkErrorInBrowser } from '@/lib/chunk-reload';

// Router errorElement - renders for thrown render/loader errors (and 404 route responses).
export default function ErrorPage() {
  const err = useRouteError();
  const staleChunk = isChunkLoadError(err);
  const [recovering, setRecovering] = useState(staleChunk);

  // A deploy replaces every hashed chunk filename, so a tab opened before it
  // asks for files that no longer exist and lands here. Reloading picks up the
  // new index and its new chunk names. Done in an effect rather than during
  // render so we are not navigating away mid-render; the helper's own guard
  // stops this becoming a reload loop when a chunk is genuinely missing.
  useEffect(() => {
    if (!staleChunk) return;
    if (!recoverFromChunkErrorInBrowser(err)) setRecovering(false);
  }, [staleChunk, err]);

  if (isRouteErrorResponse(err) && err.status === 404) {
    return (
      <ErrorLayout code="404" title="Page not found" message="The page you're looking for doesn't exist or may have moved." />
    );
  }

  // The reload is already in flight - do not accuse the server of an outage on
  // the way out.
  if (recovering) {
    return (
      <ErrorLayout
        title="Updating to the latest version"
        message="A new version of dosya.dev was just released. Reloading now."
      />
    );
  }

  // A stale chunk that survived a reload attempt is a real missing asset, not
  // a transient deploy race, so say something the user can act on.
  if (staleChunk) {
    return (
      <ErrorLayout
        title="Couldn't finish loading"
        message="Part of the app failed to download. Reload the page, and if it keeps happening, clear your cache for this site."
      />
    );
  }

  return (
    <ErrorLayout
      code="500"
      title="Something went wrong"
      message="An unexpected error occurred. We've been notified and are looking into it - please try again."
    />
  );
}
