import { useState, useEffect, Suspense } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { DashboardSidebar } from './dashboard-sidebar';
import { DashboardTopbar } from './dashboard-topbar';
import { api, API_BASE } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import UploadDock from '@/components/uploads/upload-dock';
import { NotificationPoller } from '../notifications/notification-poller';
import { applyTheme, writeCache, readCache, initSystemListener } from '@/lib/theme';
import { bootDashboard } from '@/lib/boot';

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [wsReady, setWsReady] = useState(false);

  // Auth + workspace gate (mirrors mobile's WorkspaceGate): a signed-in user
  // with no workspaces only ever sees the create-workspace screen, and a
  // missing/stale selection (e.g. after switching accounts) heals to the first
  // workspace. API errors pass through rather than locking the user out of the
  // app. Both requests run in parallel — see bootDashboard.
  useEffect(() => {
    const stopListener = initSystemListener(readCache);
    let cancelled = false;
    bootDashboard({
      fetchMe: () => fetch(`${API_BASE}/api/me`, { credentials: 'include' }),
      fetchWorkspaces: () => api<{ ok: boolean; workspaces: { id: string }[] }>('/api/workspaces'),
      currentActiveId: useWorkspace.getState().activeId,
    }).then((boot) => {
      if (cancelled) return;
      if (boot.themePref) {
        applyTheme(boot.themePref);
        writeCache(boot.themePref);
      }
      if (boot.activeWorkspaceId) {
        useWorkspace.getState().setActiveId(boot.activeWorkspaceId);
      }
      setAuthed(boot.authed);
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
  }, [navigate]);

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
        {/* key={pathname} remounts the content area on navigation so the
            fade/rise animation replays — the page's skeleton fades in first,
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
