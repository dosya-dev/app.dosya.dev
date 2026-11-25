import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { API_BASE } from '@/api/client';
import type { T } from '@/i18n/translator';

export interface PasskeyVerifyBody {
  ok: boolean;
  error?: string;
  redirect?: string;
}

export type PasskeySignInResult =
  | { status: 'ok'; data: PasskeyVerifyBody }
  | { status: 'cancelled' }
  | { status: 'refused'; error?: string }
  | { status: 'device-failed' }
  | { status: 'unreachable' };

/**
 * True when the person dismissed the OS prompt. WebAuthn reports that as
 * NotAllowedError on purpose (a page must not learn whether a passkey exists),
 * so it is not a failure worth telling them about. AbortError is a ceremony we
 * replaced ourselves. Read by name: the library rethrows its own error class.
 */
export function isPasskeyCeremonyCancelled(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'NotAllowedError' || name === 'AbortError';
}

function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/**
 * One passkey sign-in, from the options request to the verify response. Plain
 * fetch rather than api(): a refused passkey answers 401, which api() would
 * report as an expired session on a page that has none.
 *
 * `desktopState` is the nonce from /connect/desktop-passkey. With it the API
 * answers with a dosya:// callback instead of setting a cookie.
 */
export async function signInWithPasskey(desktopState?: string): Promise<PasskeySignInResult> {
  try {
    const optionsRes = await post('/api/auth/passkey/options');
    const begun = await optionsRes.json() as {
      ok?: boolean; error?: string; challenge_token?: string; options?: PublicKeyCredentialRequestOptionsJSON;
    };
    if (!optionsRes.ok || !begun.ok || !begun.challenge_token || !begun.options) {
      return { status: 'refused', error: begun.error };
    }

    let response: Awaited<ReturnType<typeof startAuthentication>>;
    try {
      response = await startAuthentication({ optionsJSON: begun.options });
    } catch (err) {
      return isPasskeyCeremonyCancelled(err) ? { status: 'cancelled' } : { status: 'device-failed' };
    }

    const verifyRes = await post('/api/auth/passkey/verify', {
      challenge_token: begun.challenge_token,
      response,
      ...(desktopState === undefined ? {} : { desktop_state: desktopState }),
    });
    const data = await verifyRes.json() as PasskeyVerifyBody;
    if (verifyRes.ok && data.ok) return { status: 'ok', data };
    return { status: 'refused', error: data.error };
  } catch {
    return { status: 'unreachable' };
  }
}

/** What to show for a sign-in that did not finish. Empty for a cancelled prompt. */
export function passkeySignInError(result: Exclude<PasskeySignInResult, { status: 'ok' }>, t: T): string {
  switch (result.status) {
    case 'cancelled': return '';
    case 'refused': return result.error ?? t('sign-in.error.signInFailed');
    case 'device-failed': return t('sign-in.error.weCouldNotUseAPasskeyOnThisDeviceTryAgainOrUseAnotherSignInMethod');
    case 'unreachable': return t('common.error.canTReachTheServerCheckYourConnectionAnd');
  }
}
