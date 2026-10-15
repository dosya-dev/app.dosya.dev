import { useEffect } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { useLocation } from 'react-router-dom';
import { useSession } from '@/stores/session';
import { useUploads } from '@/stores/uploads';
import { titleForPath, iconForPath } from '@/lib/page-title';
import { NotificationBell } from '../notifications/notification-bell';
import { SetupPill } from '@/components/onboarding/setup-pill';
import { ProfileMenu } from './profile-menu';
import { GlobalSearch } from './global-search';

export function DashboardTopbar() {
  const location = useLocation();
  const PageIcon = iconForPath(location.pathname);
  const pageLabel = titleForPath(location.pathname);
  // Fetched once by the boot gate (dashboard-layout.tsx); this used to be a
  // second GET /api/me of its own on every mount.
  const userId = useSession((s) => s.user?.id);

  // Drop another account's persisted upload rows once we know who this is.
  useEffect(() => {
    if (userId) useUploads.getState().pruneForOwner(userId);
  }, [userId]);

  return (
    <header className="flex h-14 items-center gap-3 border-b px-4 shrink-0">
      <SidebarTrigger />
      <Separator orientation="vertical" className="self-stretch! my-3" />

      {/* Page title + icon */}
      {pageLabel && (
        <>
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {PageIcon && <PageIcon className="size-4 text-muted-foreground" />}
            <span className="text-sm font-semibold whitespace-nowrap">{pageLabel}</span>
          </div>
          <Separator orientation="vertical" className="self-stretch! my-3 hidden md:block" />
        </>
      )}

      <GlobalSearch />

      {/* Right side */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Setup progress */}
        <SetupPill />

        {/* Notifications */}
        <NotificationBell />

        {/* Profile: who you are, your plan, your storage, the account pages,
            and the light/dark switch that used to be its own button here. */}
        <ProfileMenu />
      </div>
    </header>
  );
}
