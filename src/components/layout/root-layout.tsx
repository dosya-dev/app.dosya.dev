import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { RouteTitle } from '@/lib/page-title';
import { Hairline } from '@/components/ui/hairline';
import { SealLoader } from '@/components/ui/seal-loader';
import { LoadingEscape } from '@/components/ui/loading-escape';
import { useT } from '@/lib/i18n';

// Root layout: keeps the browser tab title in sync with the route for every
// page. The Suspense boundary covers routes outside DashboardLayout (login,
// sign-up, …) with the same centered seal the boot gate and the static
// index.html splash use, so the handoff is seamless.
export function RootLayout() {
  const t = useT();
  return (
    <>
      <RouteTitle />
      <Suspense
        fallback={
          <div className="relative h-screen flex items-center justify-center">
            <Hairline />
            <div className="relative">
              <SealLoader size="xl" label={t('common.label.loadingDosya')} />
              <LoadingEscape />
            </div>
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </>
  );
}
