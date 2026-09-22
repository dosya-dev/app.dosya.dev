import {
  createFetchApiClient,
  createFetchChunkTransport,
  type ApiClient,
  type ChunkTransport,
} from '@dosya-dev/e2ee-client';
import { API_BASE } from '@/api/client';

/** fetch that always includes the session cookie (same-origin/CORS-credentialed API auth). */
const credentialedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: 'include' });

/**
 * Build the E2EE engine's server-transport pair for the web app.
 * - `api`: all /api/e2ee/* calls, cookie-authed.
 * - `transport`: presigned R2 chunk PUT/GET, NO credentials (the URL is the credential).
 */
export function buildE2eeClient(): { api: ApiClient; transport: ChunkTransport } {
  const api = createFetchApiClient({ baseUrl: API_BASE, fetchFn: credentialedFetch });
  const transport = createFetchChunkTransport(); // plain fetch, no cookies
  return { api, transport };
}

/**
 * The recovery key as the engine wants it.
 *
 * `setup()` shows the key as one unbroken hex string, but people paste it back
 * from a password manager or a note with spaces, dashes or a line break in it
 * (Contract 6 calls the key whitespace- and dash-insensitive). Nothing else is
 * touched: the value is hex, and case is the caller's business.
 */
export function normalizeRecoveryKey(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}
