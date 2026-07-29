import type { ThemePref } from '@/lib/theme';
import { isThemeId, isMode, DEFAULT_THEME, DEFAULT_MODE } from '@/lib/themes';

// Dashboard boot sequence. Fires /api/me and /api/workspaces together instead
// of serially — on cold loads far from the D1 primary each round trip is
// expensive, and the workspaces answer is only *used* once /api/me confirms
// the session, so there is no reason to wait for one before starting the other.

interface MeResponseLike {
  ok: boolean;
  json: () => Promise<unknown>;
}

interface WorkspacesResponse {
  ok: boolean;
  workspaces: { id: string }[];
}

export interface BootDeps {
  fetchMe: () => Promise<MeResponseLike>;
  fetchWorkspaces: () => Promise<WorkspacesResponse>;
  currentActiveId: string;
}

export interface BootResult {
  authed: boolean;
  redirect: '/login' | '/create-workspace' | null;
  themePref: ThemePref | null;
  /** Non-null when the persisted selection is missing/stale and should heal to this id. */
  activeWorkspaceId: string | null;
}

const LOGGED_OUT: BootResult = { authed: false, redirect: '/login', themePref: null, activeWorkspaceId: null };

export async function bootDashboard(deps: BootDeps): Promise<BootResult> {
  const mePromise = deps.fetchMe();
  // Start immediately and absorb failures here: if /api/me says logged-out,
  // this in-flight request is abandoned and must not surface as an unhandled
  // rejection. An authed user with a failing workspaces API passes through
  // rather than being locked out of the app.
  const workspacesPromise: Promise<WorkspacesResponse | null> = deps
    .fetchWorkspaces()
    .catch(() => null);

  let me: MeResponseLike;
  try {
    me = await mePromise;
  } catch {
    return LOGGED_OUT;
  }
  if (!me.ok) return LOGGED_OUT;

  let themePref: ThemePref | null = null;
  try {
    const data = (await me.json()) as { user?: { ui_theme?: unknown; ui_mode?: unknown } | null };
    if (data?.user) {
      themePref = {
        theme: isThemeId(data.user.ui_theme) ? data.user.ui_theme : DEFAULT_THEME,
        mode: isMode(data.user.ui_mode) ? data.user.ui_mode : DEFAULT_MODE,
      };
    }
  } catch { /* body already consumed / not json */ }

  const ws = await workspacesPromise;
  if (ws?.ok) {
    if (ws.workspaces.length === 0) {
      return { authed: true, redirect: '/create-workspace', themePref, activeWorkspaceId: null };
    }
    if (!ws.workspaces.some((w) => w.id === deps.currentActiveId)) {
      return { authed: true, redirect: null, themePref, activeWorkspaceId: ws.workspaces[0].id };
    }
  }
  return { authed: true, redirect: null, themePref, activeWorkspaceId: null };
}
