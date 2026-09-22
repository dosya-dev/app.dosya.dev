import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { RouteTitle } from '@/lib/page-title';

// Root layout: keeps the browser tab title in sync with the route for every
// page. The Suspense boundary covers routes outside DashboardLayout (login,
// sign-up, …) with the same centered spinner the boot gate and the static
// index.html splash use, so the handoff is seamless.
export function RootLayout() {
  return (
    <>
      <RouteTitle />
      <Suspense
        fallback={
          <div className="h-screen flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </>
  );
}
