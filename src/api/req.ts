import { api, ApiError } from '@/api/client';

// A request helper that never throws: an API refusal comes back as the JSON
// body the server sent ({ ok: false, error }), a non-JSON failure as
// { ok: false, error: <status text> }. Pages that show the server's own
// message inline use this instead of try/catch around every call.
export interface OkResult { ok: boolean; error?: string }

export async function req<T extends OkResult = OkResult>(path: string, options?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, options);
  } catch (e) {
    if (e instanceof ApiError) {
      try { return JSON.parse(e.body) as T; } catch { /* not json */ }
      return { ok: false, error: e.body || `Request failed (${e.status})` } as T;
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' } as T;
  }
}
