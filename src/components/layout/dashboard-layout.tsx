import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { DashboardSidebar } from './dashboard-sidebar';
import { DashboardTopbar } from './dashboard-topbar';
import { DeletionBanner } from '@/components/deletion-banner';
import { useWorkspace } from '@/stores/workspace';
import { useSession } from '@/stores/session';
import UploadDock from '@/components/uploads/upload-dock';
import { NotificationPoller } from '../notifications/notification-poller';
import { applyTheme, writeCache, readCache, initSystemListener } from '@/lib/theme';
import { bootDashboard } from '@/lib/boot';
import { pendingPostAuthPath } from '@/lib/redemption-claim';
import { queryClient } from '@/lib/query-client';
import { prefetchDashboard } from '@/lib/dashboard-query';
import { MaintenanceScreen } from '@/components/maintenance-screen';
import { logoutAndRedirect } from '@/lib/logout';
import type { MaintenanceInfo } from '@/lib/maintenance-signal';

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialPathname = useRef(location.pathname);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const [bootMaintenance, setBootMaintenance] = useState<MaintenanceInfo | null>(null);
  // Bumped by the maintenance screen's onRetry to force the boot effect below
  // to run again once the surface comes back, rather than duplicating its body.
  const [bootKey, setBootKey] = useState(0);
  const storeMaintenance = useSession((s) => s.maintenance);
  const email = useSession((s) => s.user?.email);

  // Auth + workspace gate (mirrors mobile's WorkspaceGate): a signed-in user
  // with no workspaces only ever sees the create-workspace screen, and a
  // missing/stale selection (e.g. after switching accounts) heals to the first
  // workspace. API errors pass through rather than locking the user out of the
  // app. Both requests run in parallel - see bootDashboard. They go through
  // the session store so the topbar, sidebar and deletion banner read the
  // answers instead of asking again.
  useEffect(() => {
    const stopListener = initSystemListener(readCache);
    let cancelled = false;
    const persistedWorkspaceId = useWorkspace.getState().activeId;
    // The dashboard is the landing page, and its request is the one this
    // gate used to hold back until both boot calls had returned. The
    // workspace id it needs is already persisted from the last visit, so
    // start it now, alongside the boot; the page reads the cached answer
    // when it mounts. If the boot heals to a different workspace the
    // prefetch is simply never read.
    if (initialPathname.current === '/') prefetchDashboard(queryClient, persistedWorkspaceId);
    const session = useSession.getState();
    bootDashboard({
      fetchMe: session.fetchMe,
      fetchWorkspaces: session.fetchWorkspaces,
      currentActiveId: persistedWorkspaceId,
    }).then((boot) => {
      if (cancelled) return;
      if (boot.maintenance) {
        setBootMaintenance(boot.maintenance);
        return;
      }
      if (boot.themePref) {
        applyTheme(boot.themePref);
        writeCache(boot.themePref);
      }
      if (boot.activeWorkspaceId) {
        useWorkspace.getState().setActiveId(boot.activeWorkspaceId);
      }
      setAuthed(boot.authed);
      if (boot.authed && initialPathname.current === '/') {
        const next = pendingPostAuthPath();
        if (next) {
          navigate(next, { replace: true });
          return;
        }
      }
      if (boot.redirect) {
        navigate(boot.redirect, { replace: true });
        return;
      }
      setWsReady(true);
    });
    return () => {
      cancelled = true;
      stopListener();
    };
  }, [navigate, bootKey]);

  const maintenance = bootMaintenance ?? storeMaintenance;

  const retryMaintenance = useCallback(async () => {
    const me = await useSession.getState().fetchMe();
    if (me.ok) {
      useSession.getState().setMaintenance(null);
      setBootMaintenance(null);
      setBootKey((k) => k + 1);
      return true;
    }
    return false;
  }, []);

  if (maintenance) {
    return (
      <MaintenanceScreen
        surface={maintenance.surface}
        message={maintenance.message}
        email={email ?? null}
        onSignOut={logoutAndRedirect}
        onRetry={retryMaintenance}
      />
    );
  }

  if (authed === null || (authed && !wsReady)) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authed) return null;

  // shadcn writes `sidebar_state=true|false` on every toggle; read it back on
  // mount so the collapsed/open state survives a page refresh (this SPA has no
  // SSR to inject defaultOpen). Defaults to open when the cookie is absent.
  const savedState = document.cookie
    .split('; ')
    .find((c) => c.startsWith('sidebar_state='))
    ?.split('=')[1];
  const defaultOpen = savedState !== 'false';

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      className="h-svh overflow-hidden"
      style={{ '--sidebar-width': '200px' } as React.CSSProperties}
    >
      <DashboardSidebar />
      <SidebarInset className="min-h-0 overflow-hidden">
        <NotificationPoller />
        <DashboardTopbar />
        {/* Above the scroll container on purpose: a pending deletion must stay
            visible while the user scrolls, not scroll away with the page. */}
        <DeletionBanner />
        {/* key={pathname} remounts the content area on navigation so the
            fade/rise animation replays - the page's skeleton fades in first,
            then its data pops in. Remount also resets scroll to the top. */}
        <main
          key={location.pathname}
          className="relative flex-1 min-h-0 overflow-y-auto animate-in fade-in slide-in-from-bottom-1 duration-300"
        >
          {/* Pages are lazy chunks (see router.tsx); keep the sidebar/topbar
              painted while a page's code is still downloading. */}
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
        <UploadDock />
      </SidebarInset>
    </SidebarProvider>
  );
}
