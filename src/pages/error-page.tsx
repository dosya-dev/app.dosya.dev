import { useEffect, useRef, useState } from 'react';
import { useRouteError, isRouteErrorResponse } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { ErrorLayout } from '@/components/error-layout';
import { isChunkLoadError, recoverFromChunkErrorInBrowser } from '@/lib/chunk-reload';
import { reportRouteError } from '@/lib/sentry';
import { ReportProblemDialog } from '@/components/support/report-problem-dialog';
import { openReport } from '@/stores/report-problem';
import { useT } from '@/lib/i18n';

// Fallback only: used when reportRouteError's own result (in eventIdRef) is
// null, which happens before the effect below has run, or when the SDK is
// off. `lastEventId()` is the LAST event reported by anything, not
// necessarily this error, and is undefined in dev and for filtered errors;
// the report then carries null, never the string "undefined".
function fallbackErrorRef(): string | null {
  const id = Sentry.lastEventId();
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function errorText(err: unknown): string | null {
  if (err instanceof Error) return err.message;
  if (isRouteErrorResponse(err)) return `${err.status} ${err.statusText}`;
  return null;
}

// Router errorElement - renders for thrown render/loader errors (and 404 route responses).
export default function ErrorPage() {
  const t = useT();
  const err = useRouteError();
  const staleChunk = isChunkLoadError(err);
  const [recovering, setRecovering] = useState(staleChunk);
  // A ref, not state: it is only read inside the Report click handler below,
  // never rendered, so there is nothing for a re-render to show and no need
  // to pay for one. (A state setter here would also be a second
  // setState-in-effect alongside the chunk-recovery effect below - this
  // avoids piling a second one on top of it.)
  const eventIdRef = useRef<string | null>(null);

  // The router catches these before the SDK's global handler can see them,
  // so this is what makes the "We've been notified" line below true. 404s and
  // stale chunks are filtered inside reportRouteError, which then returns
  // null; the id it does return is THIS error's, unlike Sentry.lastEventId().
  useEffect(() => {
    eventIdRef.current = reportRouteError(err);
  }, [err]);

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
      <ErrorLayout code="404" title={t('common.tooltip.pageNotFound')} message={t('common.description.thePageYouReLookingForDoesnTExistOrMayHaveMoved')} />
    );
  }

  // The reload is already in flight - do not accuse the server of an outage on
  // the way out.
  if (recovering) {
    return (
      <ErrorLayout
        title={t('error-page.tooltip.updatingToTheLatestVersion')}
        message={t('error-page.description.aNewVersionOfDosyaDevWasJustReleasedReloadingNow')}
      />
    );
  }

  // A stale chunk that survived a reload attempt is a real missing asset, not
  // a transient deploy race, so say something the user can act on.
  if (staleChunk) {
    return (
      <ErrorLayout
        title={t('error-page.error.couldnTFinishLoading')}
        message={t('error-page.error.partOfTheAppFailedToDownloadReloadThePageAnd')}
      />
    );
  }

  return (
    <>
      <ErrorLayout
        code="500"
        title={t('error-page.tooltip.somethingWentWrong')}
        message={t('error-page.description.anUnexpectedErrorOccurredWeVeBeenNotifiedAndAreLookingInto')}
        onReport={() => openReport({ errorRef: eventIdRef.current ?? fallbackErrorRef(), errorMessage: errorText(err) })}
      />
      <ReportProblemDialog />
    </>
  );
}
