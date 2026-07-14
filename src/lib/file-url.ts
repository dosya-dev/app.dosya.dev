import { API_BASE } from '@/api/client';

export interface FileRef {
  fileId: string;
  /** Omit or pass 0 for the current version. */
  version?: number;
  /** Extra query params, e.g. `ut=<unlock token>` or a cache-buster. */
  query?: string;
}

/**
 * The single place a /raw URL is built. Every preview surface goes through here
 * so that API_BASE can't be forgotten — a relative URL works in dev (Vite proxies
 * /api) but breaks in production, where the SPA and the API are on different hosts.
 */
export function fileRawUrl({ fileId, version, query }: FileRef): string {
  const params = new URLSearchParams();
  if (version && version > 0) params.set('version', String(version));
  if (query) {
    for (const [k, v] of new URLSearchParams(query)) params.set(k, v);
  }
  const qs = params.toString();
  return `${API_BASE}/api/files/${fileId}/raw${qs ? `?${qs}` : ''}`;
}

/** Longest-edge sizes the API will serve. Anything else is rejected with a 400. */
export type ThumbSize = 128 | 256 | 512 | 1600;

/** URL of a server-generated WebP thumbnail. The browser never decodes anything. */
export function fileThumbUrl({ fileId, version, query, size }: FileRef & { size: ThumbSize }): string {
  const params = new URLSearchParams();
  if (version && version > 0) params.set('version', String(version));
  if (query) {
    for (const [k, v] of new URLSearchParams(query)) params.set(k, v);
  }
  params.set('w', String(size));
  return `${API_BASE}/api/files/${fileId}/thumb?${params}`;
}
