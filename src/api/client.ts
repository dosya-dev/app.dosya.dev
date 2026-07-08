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

/** Extract the server's error message from a thrown ApiError (falls back for real network failures). */
export function apiErrorMessage(err: unknown, fallback = 'Network error. Please try again.'): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.body) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch { /* non-JSON body */ }
    return err.body || fallback;
  }
  return fallback;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText);
  }

  return res.json();
}
