import { Suspense, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { initAnalytics, installActivityListeners, trackPageView, trackSignUp } from '@/lib/analytics';
import { RouteTitle } from '@/lib/page-title';
import { Hairline } from '@/components/ui/hairline';
import { SealLoader } from '@/components/ui/seal-loader';
import { LoadingEscape } from '@/components/ui/loading-escape';
import { useT } from '@/lib/i18n';

// Root layout: keeps the browser tab title in sync with the route for every
// page. The Suspense boundary covers routes outside DashboardLayout (login,
// sign-up, …) with the same centered seal the boot gate and the static
// index.html splash use, so the handoff is seamless.
// One page_view per route change, and only when the visitor accepted
// analytics on dosya.dev (lib/analytics.ts). Path only: no query string.
const OAUTH_SIGNUP_METHODS = new Set(['google', 'apple']);

function AnalyticsPageViews() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (initAnalytics()) {
      installActivityListeners();
      trackPageView(pathname);
    }
  }, [pathname]);
  // A brand-new OAuth account arrives from the API callback with
  // `?signup=<provider>`, once; count it like the password form does, then
  // drop the marker so a reload or a shared URL cannot count it again.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const method = params.get('signup');
    if (!method) return;
    if (OAUTH_SIGNUP_METHODS.has(method) && initAnalytics()) trackSignUp(method as 'google' | 'apple');
    params.delete('signup');
    const rest = params.toString();
    navigate({ pathname, search: rest ? `?${rest}` : '' }, { replace: true });
  }, [pathname, search, navigate]);
  return null;
}

export function RootLayout() {
  const t = useT();
  return (
    <>
      <RouteTitle />
      <AnalyticsPageViews />
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
