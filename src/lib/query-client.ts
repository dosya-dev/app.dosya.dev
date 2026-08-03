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
