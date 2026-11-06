import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';

/**
 * Inline result notice for the OAuth connect round trip. The API callback
 * lands the browser back on the provider's setup page with either
 * ?cloud_connected=1 or ?cloud_error=<code>; success needs no banner (the
 * new account appearing in the connected-accounts card IS the feedback),
 * errors render here. Both params are stripped from the URL right after
 * mount so a reload or a shared link does not resurrect them - the error
 * itself is captured into state first, so the banner survives its own
 * cleanup.
 */
const ERROR_COPY: Record<string, MessageKey> = {
  denied: 'common.description.connectionCancelledTheConnectionWasDeclinedOnTheProviderSConsent',
  invalid_state: 'common.error.connectionFailedTheSignInAttemptExpiredPleaseTryConnectingAgain',
  token_failed: 'common.error.connectionFailedTheProviderDidNotAcceptTheSignInPlease',
  save_failed: 'common.error.connectionFailedWhileSavingTheAccountPleaseTryAgain',
  unknown_provider: 'common.error.connectionFailedUnknownProvider',
};

export function CloudConnectNotice() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  // Captured once at mount: the OAuth callback always lands as a fresh
  // navigation, so mount-time params are exactly the round trip's result.
  const [error] = useState(() => searchParams.get('cloud_error'));
  const [hadParams] = useState(
    () => searchParams.has('cloud_error') || searchParams.has('cloud_connected'),
  );

  useEffect(() => {
    if (!hadParams) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('cloud_error');
      next.delete('cloud_connected');
      return next;
    }, { replace: true });
    // Mount-only cleanup of the mount-time params.
  }, [hadParams]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!error) return null;

  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      data-testid="cloud-connect-notice"
    >
      {t(ERROR_COPY[error] ?? 'common.error.connectionFailedPleaseTryAgain')}
    </div>
  );
}
