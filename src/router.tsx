import { createBrowserRouter as createBrowserRouterBase, Navigate } from 'react-router-dom';
import { wrapCreateBrowserRouterV7 } from '@sentry/react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { RootLayout } from '@/components/layout/root-layout';
import ErrorPage from '@/pages/error-page';
import { RequirePermission } from '@/components/require-permission';
import { lazyChunk } from '@/lib/chunk-reload';

// Every page is a lazy chunk: the entry bundle carries only the shell
// (layout, sidebar, boot gate), so first paint doesn't wait for feature code
// like the map engine or the vault's crypto bundle. ErrorPage stays eager -
// it must render even when a chunk fails to download.
const DashboardPage = lazyChunk(() => import('@/pages/dashboard'));
const FileRequestsPage = lazyChunk(() => import('@/pages/file-requests'));
const UploadsPage = lazyChunk(() => import('@/pages/uploads'));
const SettingsPage = lazyChunk(() => import('@/pages/settings'));
const ProfilePage = lazyChunk(() => import('@/pages/profile'));
const ApiAnalyticsPage = lazyChunk(() => import('@/pages/api-analytics'));
const FilesPage = lazyChunk(() => import('@/pages/files'));
const EncryptedPage = lazyChunk(() => import('@/pages/encrypted'));
const MapPage = lazyChunk(() => import('@/pages/map'));
const DuplicatesPage = lazyChunk(() => import('@/pages/duplicates'));
const CreateWorkspacePage = lazyChunk(() => import('@/pages/create-workspace'));
const TeamsPage = lazyChunk(() => import('@/pages/teams'));
const SharedPage = lazyChunk(() => import('@/pages/shared'));
const ShareAnalyticsPage = lazyChunk(() => import('@/pages/share-analytics'));
const CommentsPage = lazyChunk(() => import('@/pages/comments'));
const ActivityPage = lazyChunk(() => import('@/pages/activity'));
const NotificationsPage = lazyChunk(() => import('@/pages/notifications'));
const SearchPage = lazyChunk(() => import('@/pages/search'));
const BillingPage = lazyChunk(() => import('@/pages/billing'));
const CheckoutSuccessPage = lazyChunk(() => import('@/pages/checkout-success'));
const ReferralsPage = lazyChunk(() => import('@/pages/referrals'));
const WorkspaceDashboardPage = lazyChunk(() => import('@/pages/workspace-dashboard'));
const RoleCreatePage = lazyChunk(() => import('@/pages/role-create'));
const IntegrationsPage = lazyChunk(() => import('@/pages/integrations'));
const RcloneSetup = lazyChunk(() => import('@/pages/integrations/rclone'));
const WebdavSetup = lazyChunk(() => import('@/pages/integrations/webdav'));
const SftpSetup = lazyChunk(() => import('@/pages/integrations/sftp'));
const S3Setup = lazyChunk(() => import('@/pages/integrations/s3'));
const DesktopSetup = lazyChunk(() => import('@/pages/integrations/desktop'));
const CliSetup = lazyChunk(() => import('@/pages/integrations/cli'));
const RestApiSetup = lazyChunk(() => import('@/pages/integrations/rest-api'));
const GoogleSetup = lazyChunk(() => import('@/pages/integrations/google'));
const OneDriveSetup = lazyChunk(() => import('@/pages/integrations/onedrive'));
const DropboxSetup = lazyChunk(() => import('@/pages/integrations/dropbox'));
const WebhooksPage = lazyChunk(() => import('@/pages/integrations/webhooks'));
const RemoteDownloadPage = lazyChunk(() => import('@/pages/integrations/remote-download'));
const FileRequestDetailPage = lazyChunk(() => import('@/pages/file-request-detail'));
const SupportPage = lazyChunk(() => import('@/pages/support'));
const SupportTicketPage = lazyChunk(() => import('@/pages/support-ticket'));
const LoginPage = lazyChunk(() => import('@/pages/login'));
const Login2faPage = lazyChunk(() => import('@/pages/login-2fa'));
const SignUpPage = lazyChunk(() => import('@/pages/sign-up'));
const VerifyPage = lazyChunk(() => import('@/pages/verify'));
const RedeemPage = lazyChunk(() => import('@/pages/redeem'));
const ForgotPasswordPage = lazyChunk(() => import('@/pages/forgot-password'));
const ResetPasswordPage = lazyChunk(() => import('@/pages/reset-password'));
const NotFoundPage = lazyChunk(() => import('@/pages/not-found'));
const WelcomePage = lazyChunk(() => import('@/pages/welcome'));
const EditorPage = lazyChunk(() => import('@/pages/editor'));

// Navigation spans and route names for crash reports. Requires Sentry.init to
// have run already - main.tsx imports instrument.ts before this module.
const createBrowserRouter = wrapCreateBrowserRouterV7(createBrowserRouterBase);

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
      { path: '/duplicates', element: <DuplicatesPage /> },
      { path: '/file-requests', element: <FileRequestsPage /> },
      { path: '/file-requests/:id', element: <FileRequestDetailPage /> },
      { path: '/support', element: <SupportPage /> },
      { path: '/support/:id', element: <SupportTicketPage /> },
      { path: '/uploads', element: <UploadsPage /> },
      {
        path: '/settings',
        // Hiding the sidebar link never stopped anyone typing the URL. See
        // components/require-permission.tsx.
        element: (
          <RequirePermission perm="access_settings">
            <SettingsPage />
          </RequirePermission>
        ),
      },
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
      { path: '/integrations/onedrive', element: <OneDriveSetup /> },
      { path: '/integrations/dropbox', element: <DropboxSetup /> },
      { path: '/integrations/webhooks', element: <WebhooksPage /> },
      { path: '/integrations/remote-download', element: <RemoteDownloadPage /> },
      { path: '/shared', element: <SharedPage /> },
      { path: '/shared/:id', element: <ShareAnalyticsPage /> },
      { path: '/vault', element: <EncryptedPage /> },
      { path: '/comments', element: <CommentsPage /> },
      { path: '/activity', element: <ActivityPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/billing', element: <BillingPage /> },
      // Stripe Checkout's success_url, and where a plan change lands.
      { path: '/checkout/success', element: <CheckoutSuccessPage /> },
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
  // Outside DashboardLayout, on purpose: the editor is full-viewport with no
  // sidebar. Auth is enforced by the API - an unauthenticated visitor gets
  // the page shell with the error card ("Not authenticated").
  { path: '/editor/:fileId', element: <EditorPage /> },
  { path: '/login/2fa', element: <Login2faPage /> },
  { path: '/sign-up', element: <SignUpPage /> },
  { path: '/verify', element: <VerifyPage /> },
  // Public shell: captures Gumroad links before sign-in and resumes here
  // afterward. The API gates preview and activation with a cookie session.
  { path: '/redeem', element: <RedeemPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/dashboard', element: <Navigate to="/" replace /> },
  { path: '/create-workspace', element: <CreateWorkspacePage /> },
  { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
