import { API_BASE } from '@/api/client';
import { sendAcquisition } from '@/lib/acquisition-context';
import { useState, useEffect, useLayoutEffect, useRef, useCallback, Suspense } from 'react';
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
import { consumePostAuthPath, rememberPostAuthPath } from '@/lib/post-auth-path';
import { queryClient } from '@/lib/query-client';
import { prefetchDashboard } from '@/lib/dashboard-query';
import { MaintenanceScreen } from '@/components/maintenance-screen';
import { clearClientSession, logoutAndRedirect } from '@/lib/logout';
import { watchSessionExpiry } from '@/lib/session-expiry';
import type { MaintenanceInfo } from '@/lib/maintenance-signal';
import { beginLoading } from '@/lib/loading-bar';
import { Hairline } from '@/components/ui/hairline';
import { SealLoader } from '@/components/ui/seal-loader';
import { LoadingEscape } from '@/components/ui/loading-escape';
import { useT } from '@/lib/i18n';
import { SupportChatPanel } from '@/components/support-chat/panel';
import { ReportProblemDialog } from '@/components/support/report-problem-dialog';

/** The pathname of a remembered same-origin path ("/files?folder=x" -> "/files"). */
function pathOf(path: string): string {
  return path.split(/[?#]/, 1)[0] || '/';
}

export function DashboardLayout() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const initialPathname = useRef(location.pathname);
  const initialSearch = useRef(location.search);
  const handoffPath = useRef<string | null>(null);
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
    // The boot gate shows the hairline above the seal; this is what drives it.
    const endBootLoading = beginLoading();
    bootDashboard({
      fetchMe: session.fetchMe,
      fetchWorkspaces: session.fetchWorkspaces,
      currentActiveId: persistedWorkspaceId,
    }).then((boot) => {
      endBootLoading();
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
      if (boot.authed) void sendAcquisition(import.meta.env.VITE_ACQUISITION_MEASUREMENT_ENABLED === 'true', API_BASE);
      if (boot.authed && initialPathname.current === '/') {
        // A held redemption claim wins, and /redeem lives outside this layout.
        const pending = pendingPostAuthPath();
        if (pending) {
          navigate(pending, { replace: true });
          return;
        }
        const next = consumePostAuthPath();
        if (next && boot.redirect) {
          // The tour or a first workspace comes first. Keep the path for the
          // boot that runs when that screen sends the visitor back to /.
          rememberPostAuthPath(next);
        } else if (next && pathOf(next) !== '/') {
          // Most remembered paths (/save/:token, /settings, a /files deep
          // link) are children of THIS layout, which stays mounted across the
          // navigation, so the gate has to open once the route has moved.
          // Opening it now would mount the dashboard page for a frame.
          handoffPath.current = pathOf(next);
          navigate(next, { replace: true });
          return;
        }
      }
      if (boot.redirect) {
        // A deep link (the "Sign in and manage settings" button on
        // dosya.dev/unsubscribe, a bookmark, a link in an email, a "Save to
        // dosya" link) comes back to where it was going once the login, the
        // tour or the first workspace is done, instead of the dashboard.
        if (initialPathname.current !== '/') {
          rememberPostAuthPath(`${initialPathname.current}${initialSearch.current}`);
        }
        navigate(boot.redirect, { replace: true });
        return;
      }
      setWsReady(true);
    });
    return () => {
      cancelled = true;
      endBootLoading();
      stopListener();
    };
  }, [navigate, bootKey]);

  // Second half of the post-auth handoff above: open the gate once the
  // router has actually left /.
  useEffect(() => {
    if (handoffPath.current && location.pathname === handoffPath.current) {
      handoffPath.current = null;
      setWsReady(true);
    }
  }, [location.pathname]);

  // The boot gate asks about the session once. After that, a 401 from any
  // request or a logout in another tab re-asks, and a session that is gone
  // sends the tab to /login instead of leaving the page on a "Try again" error
  // no retry can fix. The page is remembered so signing back in returns here.
  useEffect(() => {
    if (!authed) return;
    return watchSessionExpiry({
      verify: async () => (await useSession.getState().fetchMe()).status,
      onExpired: () => {
        rememberPostAuthPath(`${window.location.pathname}${window.location.search}`);
        void clearClientSession().then(() => {
          window.location.href = '/login';
        });
      },
    });
  }, [authed]);

  // The content area is a stable scroll container now (see below), so a
  // navigation no longer resets its scroll by remounting it. Done here, in a
  // layout effect, so the new page is never painted mid-scroll.
  const mainRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

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
      <div className="relative h-screen flex items-center justify-center">
        <Hairline />
        <div className="relative">
          <SealLoader size="xl" label={t('common.label.loadingDosya')} />
          <LoadingEscape />
        </div>
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
        <ReportProblemDialog />
        <SupportChatPanel />
        {/* Above the scroll container on purpose: a pending deletion must stay
            visible while the user scrolls, not scroll away with the page. */}
        <DeletionBanner />
        {/* The hairline pins to this wrapper's top edge, just under the topbar,
            and stays there while the content area below scrolls. */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          <Hairline />
          <main ref={mainRef} className="relative flex-1 min-h-0 overflow-y-auto">
            {/* Pages are lazy chunks (see router.tsx). The Suspense boundary
                sits OUTSIDE the keyed wrapper on purpose: the router wraps
                every navigation in a React transition, and a transition only
                keeps the previous page on screen while the next chunk downloads
                if the boundary it suspends inside is one that is already
                mounted. A boundary keyed by pathname would be new on every
                navigation, and React shows a new boundary's fallback at once.
                So: a cached chunk swaps pages instantly, a cold one holds the
                old page under the hairline, and the seal below is only ever
                seen on the very first route (nothing to keep yet). */}
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center">
                  <div className="relative">
                    <SealLoader size="lg" delay />
                    <LoadingEscape />
                  </div>
                </div>
              }
            >
              {/* key={pathname} remounts the page on navigation so the
                  fade/rise animation replays - the page's skeleton fades in
                  first, then its data pops in. */}
              <div
                key={location.pathname}
                className="h-full animate-in fade-in slide-in-from-bottom-1 duration-300"
              >
                <Outlet />
              </div>
            </Suspense>
          </main>
        </div>
        <UploadDock />
      </SidebarInset>
    </SidebarProvider>
  );
}
