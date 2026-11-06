// In dev (localhost), Vite proxy handles /api → Astro dev server.
// In production, requests go to api.dosya.dev.
// VITE_API_URL can override in any environment.
export const API_BASE = import.meta.env.VITE_API_URL
  || (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? '' : 'https://api.dosya.dev');

import { humanizeApiError } from './error-copy';
import { notifyMaintenance } from '@/lib/maintenance-signal';
import { notifyUnauthorized } from '@/lib/session-expiry';
import { t } from '@/lib/i18n';

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(t('common.label.apiStatusBody', { status, body }));
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Response-flavored sibling of apiErrorMessage, for handlers that use raw
 * fetch() (blob downloads) and hold a failed Response instead of a thrown
 * ApiError. Surfaces the API's `{ error }` string; falls back for non-JSON
 * bodies (gateway/HTML error pages).
 */
export async function responseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await res.json()) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) return humanizeApiError(parsed.error);
  } catch { /* non-JSON body */ }
  return fallback;
}

/**
 * The API's machine-readable error code, when the body carried one.
 *
 * Deliberately separate from apiErrorMessage: that returns something to SHOW,
 * this returns something to BRANCH on. `folder_locked` needs both - the files
 * page recognises the code to render an unlock prompt, and still needs a
 * sentence for the cases where it reaches the screen anyway.
 */
export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  try {
    const parsed = JSON.parse(err.body) as { error?: unknown };
    return typeof parsed.error === 'string' && parsed.error.trim().length > 0 ? parsed.error : null;
  } catch {
    return null; // non-JSON body (gateway/HTML error page)
  }
}

/**
 * The JSON body of a thrown ApiError, for refusals that carry figures next to
 * their `code` (a 409 with `max_gb`, say). Null for anything else.
 */
export function apiErrorBody(err: unknown): Record<string, unknown> | null {
  if (!(err instanceof ApiError)) return null;
  try {
    const parsed = JSON.parse(err.body) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Extract the server's error message from a thrown ApiError (falls back for real network failures). */
export function apiErrorMessage(err: unknown, fallback = t('common.description.networkErrorPleaseTryAgain')): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.body) as { error?: string };
      if (parsed.error) return humanizeApiError(parsed.error);
    } catch { /* non-JSON body */ }
    // A non-JSON body is a gateway/HTML error page - not something to show users.
    if (err.body && !err.body.trimStart().startsWith('<')) return err.body;
    return t('common.error.requestFailedErrstatusPleaseTryAgain', { errStatus: err.status });
  }
  return fallback;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // `headers` must be merged AFTER spreading `options`, not before: spreading
  // options last overwrote the merged object with the caller's raw `headers`,
  // dropping the JSON Content-Type default for any caller that set a header of
  // its own. Everything else on `options` still wins over the defaults.
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // A switched-off surface answers every gated call (not just /api/me) with
    // this shape. Surface it through the session store so any page's request
    // can trip the full-screen maintenance view, not just the boot gate.
    if (res.status === 503) {
      try {
        const body = JSON.parse(text) as { code?: unknown; surface?: unknown; message?: unknown };
        if (body?.code === 'surface_disabled') {
          notifyMaintenance({
            surface: typeof body.surface === 'string' ? body.surface : 'web',
            message: typeof body.message === 'string' ? body.message : null,
          });
        }
      } catch { /* non-JSON body */ }
    }
    // A signed-out session (logout in another tab, expiry) must not leave the
    // page on an error state no retry can fix; session-expiry.ts confirms it
    // and sends the tab to /login.
    if (res.status === 401) notifyUnauthorized(path);
    throw new ApiError(res.status, text || res.statusText);
  }

  // A 204 (DELETE /api/e2ee/user-keys) has no body to parse: res.json() threw
  // "Unexpected end of JSON input" for a call that had succeeded, so a
  // destroyed Vault was reported as an error.
  if (res.status === 204) return undefined as T;
  return res.json();
}
