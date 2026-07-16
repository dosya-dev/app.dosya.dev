import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { DashboardSidebar } from './dashboard-sidebar';
import { DashboardTopbar } from './dashboard-topbar';
import { API_BASE } from '@/api/client';
import UploadDock from '@/components/uploads/upload-dock';
import { NotificationPoller } from '../notifications/notification-poller';
import { applyTheme, writeCache, readCache, initSystemListener } from '@/lib/theme';
import { isThemeId, isMode, DEFAULT_THEME, DEFAULT_MODE } from '@/lib/themes';

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const stopListener = initSystemListener(readCache);
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(async (res) => {
        if (res.ok) {
          setAuthed(true);
          try {
            const data = await res.json();
            if (data?.user) {
              const pref = {
                theme: isThemeId(data.user.ui_theme) ? data.user.ui_theme : DEFAULT_THEME,
                mode: isMode(data.user.ui_mode) ? data.user.ui_mode : DEFAULT_MODE,
              };
              applyTheme(pref);
              writeCache(pref);
            }
          } catch { /* body already consumed / not json */ }
        } else {
          setAuthed(false);
          navigate('/login', { replace: true });
        }
      })
      .catch(() => {
        setAuthed(false);
        navigate('/login', { replace: true });
      });
    return stopListener;
  }, [navigate]);

  if (authed === null) {
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
          <Outlet />
        </main>
        <UploadDock />
      </SidebarInset>
    </SidebarProvider>
  );
}
