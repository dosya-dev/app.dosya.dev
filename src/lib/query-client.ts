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
import { ACTIVE_CLOUD_STATUSES, completedJobIds, useCloudImports } from '@/stores/cloud-imports';

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

/**
 * Cloud imports (stores/cloud-imports.ts) are the same shape of problem as
 * the upload listener above, just longer-running: they poll in the
 * background for minutes, so "the user is on some other page when the job
 * finishes" is the normal case, not the edge case. This used to be
 * useCloudImportCompletionRefresh, a useEffect-scoped hook called only from
 * FilesPage - it stopped listening the moment that page unmounted, so an
 * import finishing while the user was anywhere else silently left the
 * listing missing the imported files (staleTime 30s means a remount doesn't
 * even guarantee a revalidation). Fixed the same way as upload-complete:
 * module scope, wired once for the app's lifetime.
 *
 * useCloudImports is a zustand store, not a DOM event source, so this does
 * NOT need the `typeof window !== 'undefined'` guard above - .subscribe() is
 * plain JS with no `window` dependency and cannot throw in a non-DOM
 * context. The guard above exists only because `window.addEventListener`
 * itself would throw if `window` doesn't exist; nothing here calls it.
 *
 * The active -> terminal edge detection is `completedJobIds`, kept pure and
 * exported from stores/cloud-imports.ts precisely so it stays unit-tested
 * without rendering anything. This subscriber owns only the prevActiveIds
 * bookkeeping between calls - recomputing it is one line, mirroring what
 * completedJobIds already computes internally to find the edge.
 *
 * Deliberately NOT workspace-scoped, unlike the old hook: a module-scope
 * subscriber has no "current workspace" to filter on. Invalidating
 * [FILES_QUERY_ROOT] app-wide is correct here for the same reason it is for
 * uploads - React Query only refetches queries with active observers, so
 * invalidating for a workspace nobody is viewing costs nothing.
 */
let prevActiveCloudImportIds = new Set<string>();
useCloudImports.subscribe((state) => {
  const completed = completedJobIds(prevActiveCloudImportIds, state.jobs);
  prevActiveCloudImportIds = new Set(
    state.jobs.filter((j) => ACTIVE_CLOUD_STATUSES.has(j.status)).map((j) => j.id),
  );
  if (completed.length > 0) {
    queryClient.invalidateQueries({ queryKey: [FILES_QUERY_ROOT] });
  }
});
