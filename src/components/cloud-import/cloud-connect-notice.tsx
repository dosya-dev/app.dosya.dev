import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

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
const ERROR_COPY: Record<string, string> = {
  denied: 'Connection cancelled - access was declined on the provider\'s consent screen.',
  invalid_state: 'Connection failed - the sign-in attempt expired. Please try connecting again.',
  token_failed: 'Connection failed - the provider did not accept the sign-in. Please try again.',
  save_failed: 'Connection failed while saving the account. Please try again.',
  unknown_provider: 'Connection failed - unknown provider.',
};

export function CloudConnectNotice() {
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
      {ERROR_COPY[error] ?? 'Connection failed. Please try again.'}
    </div>
  );
}
