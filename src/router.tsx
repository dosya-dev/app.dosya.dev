import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet, Navigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { RouteTitle } from '@/lib/page-title';
import ErrorPage from '@/pages/error-page';

// Every page is a lazy chunk: the entry bundle carries only the shell
// (layout, sidebar, boot gate), so first paint doesn't wait for feature code
// like the map engine or the vault's crypto bundle. ErrorPage stays eager -
// it must render even when a chunk fails to download.
const DashboardPage = lazy(() => import('@/pages/dashboard'));
const FileRequestsPage = lazy(() => import('@/pages/file-requests'));
const UploadsPage = lazy(() => import('@/pages/uploads'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const ProfilePage = lazy(() => import('@/pages/profile'));
const ApiAnalyticsPage = lazy(() => import('@/pages/api-analytics'));
const FilesPage = lazy(() => import('@/pages/files'));
const EncryptedPage = lazy(() => import('@/pages/encrypted'));
const MapPage = lazy(() => import('@/pages/map'));
const CreateWorkspacePage = lazy(() => import('@/pages/create-workspace'));
const TeamsPage = lazy(() => import('@/pages/teams'));
const SharedPage = lazy(() => import('@/pages/shared'));
const CommentsPage = lazy(() => import('@/pages/comments'));
const ActivityPage = lazy(() => import('@/pages/activity'));
const NotificationsPage = lazy(() => import('@/pages/notifications'));
const SearchPage = lazy(() => import('@/pages/search'));
const BillingPage = lazy(() => import('@/pages/billing'));
const ReferralsPage = lazy(() => import('@/pages/referrals'));
const WorkspaceDashboardPage = lazy(() => import('@/pages/workspace-dashboard'));
const RoleCreatePage = lazy(() => import('@/pages/role-create'));
const IntegrationsPage = lazy(() => import('@/pages/integrations'));
const RcloneSetup = lazy(() => import('@/pages/integrations/rclone'));
const WebdavSetup = lazy(() => import('@/pages/integrations/webdav'));
const SftpSetup = lazy(() => import('@/pages/integrations/sftp'));
const S3Setup = lazy(() => import('@/pages/integrations/s3'));
const DesktopSetup = lazy(() => import('@/pages/integrations/desktop'));
const CliSetup = lazy(() => import('@/pages/integrations/cli'));
const RestApiSetup = lazy(() => import('@/pages/integrations/rest-api'));
const GoogleSetup = lazy(() => import('@/pages/integrations/google'));
const WebhooksPage = lazy(() => import('@/pages/integrations/webhooks'));
const RemoteDownloadPage = lazy(() => import('@/pages/integrations/remote-download'));
const FileRequestDetailPage = lazy(() => import('@/pages/file-request-detail'));
const SupportPage = lazy(() => import('@/pages/support'));
const SupportTicketPage = lazy(() => import('@/pages/support-ticket'));
const LoginPage = lazy(() => import('@/pages/login'));
const Login2faPage = lazy(() => import('@/pages/login-2fa'));
const SignUpPage = lazy(() => import('@/pages/sign-up'));
const VerifyPage = lazy(() => import('@/pages/verify'));
const ForgotPasswordPage = lazy(() => import('@/pages/forgot-password'));
const ResetPasswordPage = lazy(() => import('@/pages/reset-password'));
const NotFoundPage = lazy(() => import('@/pages/not-found'));
const WelcomePage = lazy(() => import('@/pages/welcome'));

// Root layout: keeps the browser tab title in sync with the route for every
// page. The Suspense boundary covers routes outside DashboardLayout (login,
// sign-up, …) with the same centered spinner the boot gate and the static
// index.html splash use, so the handoff is seamless.
function RootLayout() {
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

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <ErrorPage />,
    children: [
  {
    element: <DashboardLayout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/files', element: <FilesPage /> },
      { path: '/map', element: <MapPage /> },
      { path: '/file-requests', element: <FileRequestsPage /> },
      { path: '/file-requests/:id', element: <FileRequestDetailPage /> },
      { path: '/support', element: <SupportPage /> },
      { path: '/support/:id', element: <SupportTicketPage /> },
      { path: '/uploads', element: <UploadsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/api-analytics', element: <ApiAnalyticsPage /> },
      { path: '/teams', element: <TeamsPage /> },
      { path: '/integrations', element: <IntegrationsPage /> },
      { path: '/integrations/rclone', element: <RcloneSetup /> },
      { path: '/integrations/webdav', element: <WebdavSetup /> },
      { path: '/integrations/sftp', element: <SftpSetup /> },
      { path: '/integrations/s3', element: <S3Setup /> },
      { path: '/integrations/desktop', element: <DesktopSetup /> },
      { path: '/integrations/cli', element: <CliSetup /> },
      { path: '/integrations/rest-api', element: <RestApiSetup /> },
      { path: '/integrations/google', element: <GoogleSetup /> },
      { path: '/integrations/webhooks', element: <WebhooksPage /> },
      { path: '/integrations/remote-download', element: <RemoteDownloadPage /> },
      { path: '/shared', element: <SharedPage /> },
      { path: '/vault', element: <EncryptedPage /> },
      { path: '/comments', element: <CommentsPage /> },
      { path: '/activity', element: <ActivityPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/billing', element: <BillingPage /> },
      { path: '/referrals', element: <ReferralsPage /> },
      { path: '/workspaces', element: <WorkspaceDashboardPage /> },
      { path: '/role-create', element: <RoleCreatePage /> },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  // Outside DashboardLayout, on purpose: bootDashboard redirects tour-less
  // users here, and the boot gate lives inside DashboardLayout. Nesting this
  // route under it would put the gate above the route it redirects to - the
  // exact loop this placement avoids.
  { path: '/welcome', element: <WelcomePage /> },
  { path: '/login/2fa', element: <Login2faPage /> },
  { path: '/sign-up', element: <SignUpPage /> },
  { path: '/verify', element: <VerifyPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/dashboard', element: <Navigate to="/" replace /> },
  { path: '/create-workspace', element: <CreateWorkspacePage /> },
  { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
