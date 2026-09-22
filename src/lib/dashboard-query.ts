import type { QueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

/**
 * GET /api/dashboard through React Query, so the layout can start the
 * request the moment the app boots (prefetchDashboard) and the page picks
 * the answer up from the cache when it mounts - one round trip to a D1
 * primary in Sydney instead of two in sequence (boot, then page). A
 * revisit inside staleTime paints from cache and costs no request at all.
 */
export const DASHBOARD_QUERY_ROOT = 'dashboard';

export const dashboardQueryKey = (wsId: string) => [DASHBOARD_QUERY_ROOT, wsId] as const;

export interface DashboardActivity {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: number;
  user_id: string | null;
  user_name: string | null;
  user_avatar: string | null;
  // Forensic fields - nulled server-side (shapeActivityRow) for
  // non-privileged viewers looking at another member's row.
  source_ip?: string | null;
  user_agent?: string | null;
  outcome?: string | null;
  source?: string | null;
  resource_name?: string | null;
  // Only the keys the page reads are typed; the rest of the metadata is
  // whatever the emitting route recorded.
  meta?: ({
    geo?: { country?: string | null; city?: string | null } | null;
    name?: string | null;
    reason?: string | null;
  } & Record<string, unknown>) | null;
}

export interface DashboardData {
  user_name: string;
  workspace_name: string | null;
  stats: {
    total_files: number;
    files_this_week: number;
    shared_externally: number;
    total_bytes: number;
    trash_bytes: number;
    storage_cap_bytes: number | null;
    plan: string;
  };
  storage_breakdown: { name: string; bytes: number; color: string }[];
  region_breakdown: { region: string; bytes: number; file_count: number; color: string }[];
  recent_files: { id: string; name: string; size_bytes: number; created_at: number }[];
  team_stats: { user_id: string; name: string; email: string; avatar_url: string | null; file_count: number; total_bytes: number }[];
  activity: DashboardActivity[];
}

export async function fetchDashboard(wsId: string): Promise<DashboardData> {
  const d = await api<{ ok: boolean } & DashboardData>(`/api/dashboard?workspace_id=${wsId}`);
  if (!d.ok) throw new Error('The dashboard could not be loaded.');
  return d;
}

export function dashboardQueryOptions(wsId: string) {
  return {
    queryKey: dashboardQueryKey(wsId),
    queryFn: () => fetchDashboard(wsId),
    // Uploads finishing invalidate this explicitly (see pages/dashboard.tsx),
    // and the numbers here are summary figures the API itself serves up to
    // 60s stale - refetching every time the tab regains focus would only add
    // requests the user did not ask for.
    refetchOnWindowFocus: false,
  };
}

/**
 * Starts the dashboard request without waiting for it. Nothing happens if the
 * cache already holds a fresh answer, and a failure (a 401 for a signed-out
 * tab, a 403 for a workspace the user has left) is swallowed - the page's own
 * query reports errors when it mounts.
 */
export function prefetchDashboard(queryClient: QueryClient, wsId: string): void {
  if (!wsId) return;
  void queryClient.prefetchQuery(dashboardQueryOptions(wsId));
}
