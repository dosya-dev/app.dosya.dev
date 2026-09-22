import { create } from 'zustand';
import { api, API_BASE } from '@/api/client';
import { onMaintenance, type MaintenanceInfo } from '@/lib/maintenance-signal';

/**
 * The signed-in user and their workspace list, fetched once at boot.
 *
 * Before this store existed, the layout, the topbar and the deletion banner
 * each called GET /api/me on mount, and the layout and the sidebar each called
 * GET /api/workspaces - five requests for two answers, all racing the page's
 * own fetch on every cold load, against a D1 primary in Sydney. The boot gate
 * (lib/boot.ts) now fetches through this store, and every other consumer
 * reads what it already has.
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  /** Non-null while an account deletion is pending. */
  deletion_scheduled_for: number | null;
  ui_theme?: string;
  ui_mode?: string;
  tour_completed?: boolean;
}

export interface SessionWorkspace {
  id: string;
  name: string;
  slug: string;
  icon_initials: string;
  icon_color: string;
  icon_image_url: string | null;
  owner_id: string;
  role_id: string;
  // `total` is this workspace's own ceiling (its admin cap when one is set,
  // the owner's entitlement when not) and `free` is what will actually fit -
  // never `total - used`, which cannot see the sibling workspaces draining
  // the same account pool.
  storage?: {
    used: number;
    total: number;
    free?: number;
    cap_bytes?: number | null;
    account_limit_bytes?: number;
    account_used_bytes?: number;
  } | null;
}

export interface MeResponse { ok: boolean; user?: SessionUser | null }
export interface WorkspacesResponse { ok: boolean; workspaces: SessionWorkspace[] }

/**
 * What the boot gate reads off GET /api/me: the status, and the body parsed
 * exactly once. Shaped like the slice of a Response bootDashboard consumes.
 */
export interface MeFetchResult {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

interface SessionState {
  user: SessionUser | null;
  /**
   * Null until the first successful list. The sidebar fetches on its own only
   * in that state (the boot's list failed, or the sidebar is rendered without
   * the boot, as in tests).
   */
  workspaces: SessionWorkspace[] | null;
  /**
   * Non-null while the web surface is switched off (a 503 surface_disabled
   * from either the boot gate's /api/me or any later API call). Set by
   * dashboard-layout from the boot result, or asynchronously by any api()
   * call via maintenance-signal.ts - a request made mid-session can discover
   * the outage before the next boot would.
   */
  maintenance: MaintenanceInfo | null;
  setMaintenance: (m: MaintenanceInfo | null) => void;
  /** GET /api/me. Stores the user on success, clears it on a 401. */
  fetchMe: () => Promise<MeFetchResult>;
  /** GET /api/workspaces. Concurrent callers share one request. */
  fetchWorkspaces: () => Promise<WorkspacesResponse>;
}

let workspacesInFlight: Promise<WorkspacesResponse> | null = null;

export const useSession = create<SessionState>((set) => ({
  user: null,
  workspaces: null,
  maintenance: null,
  setMaintenance: (m) => set({ maintenance: m }),

  fetchMe: async () => {
    // A raw fetch rather than api(): the boot gate tells a 401 (signed out)
    // apart from a network failure by the response, and api() throws on both.
    const res = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const me = body as MeResponse | null;
    if (res.ok && me?.ok && me.user) set({ user: me.user });
    else if (res.status === 401) set({ user: null });
    return { ok: res.ok, status: res.status, json: async () => body };
  },

  fetchWorkspaces: () => {
    if (workspacesInFlight) return workspacesInFlight;
    const p = (async () => {
      try {
        const data = await api<WorkspacesResponse>('/api/workspaces');
        if (data.ok) set({ workspaces: data.workspaces });
        return data;
      } finally {
        workspacesInFlight = null;
      }
    })();
    workspacesInFlight = p;
    return p;
  },
}));

// Registered once, at module load, so api/client.ts can report a
// surface_disabled response without importing this store (see
// maintenance-signal.ts for why that import would be circular).
onMaintenance((m) => useSession.getState().setMaintenance(m));
