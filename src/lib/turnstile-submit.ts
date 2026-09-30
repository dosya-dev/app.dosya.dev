import type { TurnstileHandle } from '@/components/turnstile-widget';

/**
 * Shared pieces of "submit a form that sits behind a Turnstile challenge".
 *
 * Six call sites (sign-up, login, forgot-password, reset-password, and both
 * buttons on verify) all post to routes the API has on `enforce-web`, so all
 * six have the same two problems and should answer them the same way.
 */

/**
 * The token to send, waiting briefly for the challenge if it has not resolved.
 *
 * Returns '' when no token is obtainable, and the caller submits anyway rather
 * than refusing locally: the server is the one that knows whether this route
 * enforces, whether the request carries a native-client signal that relaxes it,
 * and whether siteverify is reachable at all. Guessing "this will be rejected"
 * on the client would break local development, where TURNSTILE_SECRET_KEY is
 * unset and the middleware lets every request through.
 */
export function resolveTurnstileToken(handle: TurnstileHandle | null): Promise<string> {
    return handle?.waitForToken() ?? Promise.resolve('');
}

/**
 * What to show when the API answers 403 `turnstile_failed`.
 *
 * The server's own wording is "Verification failed. Please try again." - which
 * is right for a bot and useless for the two humans who see it: someone whose
 * browser cannot reach challenges.cloudflare.com (an extension, a filtering
 * DNS resolver, a corporate proxy), and someone facing an interactive challenge
 * they have not answered yet. Neither is helped by "try again", and the first
 * will fail identically forever without being told why.
 */
export function turnstileFailureMessage(handle: TurnstileHandle | null): string {
    return handle?.status() === 'unavailable'
        ? "We couldn't load the verification challenge. If you use an ad blocker or a privacy extension, allow challenges.cloudflare.com and reload this page."
        : 'Please complete the verification challenge above, then try again.';
}

/** Whether a response body is the API's Turnstile rejection. */
export function isTurnstileRejection(data: unknown): boolean {
    return !!data && typeof data === 'object' && (data as { code?: string }).code === 'turnstile_failed';
}
