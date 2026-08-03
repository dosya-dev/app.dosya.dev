/**
 * The app's single QueryClient.
 *
 * Mirrors apps/desktop/src/renderer/lib/query-client.ts on purpose - the two
 * clients show the same data and should agree on how stale it may be.
 *
 * staleTime 30s + gcTime 10min is the stale-while-revalidate contract: a
 * revisited folder paints immediately from cache and quietly revalidates
 * behind the paint. Mutations invalidate explicitly, so a user never waits on
 * the TTL to see their own change.
 */
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { FILES_QUERY_ROOT } from '@/lib/files-request';

/**
 * 401 and 403 are terminal: the session is gone or the permission is absent,
 * and a retry burns a round trip to learn the same thing. Everything else gets
 * two retries, which covers a transient replica hiccup or a dropped connection.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && [401, 403].includes(error.status)) return false;
  return failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      staleTime: 30_000,
      gcTime: 600_000,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Uploads finish in the background (dock/other tab) well after the request
 * that started them returns, so the listing has to react to the runner's
 * completion event rather than to whatever handler kicked the upload off.
 *
 * This used to be a `useEffect` inside FilesPage, which only listens while
 * that page is mounted. staleTime 30s means a background revalidation is no
 * longer a given on remount either (`refetchOnMount` only refetches STALE
 * queries): start an upload on /files, navigate away before it finishes, come
 * back within 30s, and the just-uploaded file was silently missing - nothing
 * else was going to invalidate the cache for it. Module scope means this
 * listener is registered once, for the app's lifetime, regardless of which
 * page (if any) is currently mounted.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('dosya:upload-complete', () => {
    queryClient.invalidateQueries({ queryKey: [FILES_QUERY_ROOT] });
  });
}
