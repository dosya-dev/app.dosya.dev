// In dev (localhost), Vite proxy handles /api → Astro dev server.
// In production, requests go to api.dosya.dev.
// VITE_API_URL can override in any environment.
export const API_BASE = import.meta.env.VITE_API_URL
  || (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? '' : 'https://api.dosya.dev');

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`API ${status}: ${body}`);
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
    if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) return parsed.error;
  } catch { /* non-JSON body */ }
  return fallback;
}

/** Extract the server's error message from a thrown ApiError (falls back for real network failures). */
export function apiErrorMessage(err: unknown, fallback = 'Network error. Please try again.'): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.body) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch { /* non-JSON body */ }
    // A non-JSON body is a gateway/HTML error page - not something to show users.
    if (err.body && !err.body.trimStart().startsWith('<')) return err.body;
    return `Request failed (${err.status}). Please try again.`;
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
    throw new ApiError(res.status, text || res.statusText);
  }

  return res.json();
}
