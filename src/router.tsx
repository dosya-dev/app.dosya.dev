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
const BrandingPage = lazyChunk(() => import('@/pages/settings/branding'));
const ProfilePage = lazyChunk(() => import('@/pages/profile'));
const ApiAnalyticsPage = lazyChunk(() => import('@/pages/api-analytics'));
const FilesPage = lazyChunk(() => import('@/pages/files'));
const EncryptedPage = lazyChunk(() => import('@/pages/encrypted'));
const MapPage = lazyChunk(() => import('@/pages/map'));
const PersonasPage = lazyChunk(() => import('@/pages/personas'));
const PersonasSettingsPage = lazyChunk(() => import('@/pages/personas/settings-page'));
const DuplicatesPage = lazyChunk(() => import('@/pages/duplicates'));
const CreateWorkspacePage = lazyChunk(() => import('@/pages/create-workspace'));
const TeamsPage = lazyChunk(() => import('@/pages/teams'));
const SharedPage = lazyChunk(() => import('@/pages/shared'));
const ShareAnalyticsPage = lazyChunk(() => import('@/pages/share-analytics'));
const SaveSharePage = lazyChunk(() => import('@/pages/save-share'));
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
const ExtensionSetup = lazyChunk(() => import('@/pages/integrations/extension'));
const ZapierSetup = lazyChunk(() => import('@/pages/integrations/zapier'));
const WordPressSetup = lazyChunk(() => import('@/pages/integrations/wordpress'));
const N8nSetup = lazyChunk(() => import('@/pages/integrations/n8n'));
const LightroomSetup = lazyChunk(() => import('@/pages/integrations/lightroom'));
const GoogleSetup = lazyChunk(() => import('@/pages/integrations/google'));
const GoogleTakeoutImport = lazyChunk(() => import('@/pages/integrations/google-takeout'));
const OneDriveSetup = lazyChunk(() => import('@/pages/integrations/onedrive'));
const DropboxSetup = lazyChunk(() => import('@/pages/integrations/dropbox'));
const WebhooksPage = lazyChunk(() => import('@/pages/integrations/webhooks'));
const RemoteDownloadPage = lazyChunk(() => import('@/pages/integrations/remote-download'));
const RemoteRclonePage = lazyChunk(() => import('@/pages/integrations/remote-rclone'));
const FileRequestDetailPage = lazyChunk(() => import('@/pages/file-request-detail'));
const SupportPage = lazyChunk(() => import('@/pages/support'));
const SupportChatPage = lazyChunk(() => import('@/pages/support-chat'));
const SupportTicketPage = lazyChunk(() => import('@/pages/support-ticket'));
const LoginPage = lazyChunk(() => import('@/pages/login'));
const Login2faPage = lazyChunk(() => import('@/pages/login-2fa'));
const SignUpPage = lazyChunk(() => import('@/pages/sign-up'));
const VerifyPage = lazyChunk(() => import('@/pages/verify'));
const RedeemPage = lazyChunk(() => import('@/pages/redeem'));
const FamilyJoinPage = lazyChunk(() => import('@/pages/family-join'));
const ForgotPasswordPage = lazyChunk(() => import('@/pages/forgot-password'));
const ResetPasswordPage = lazyChunk(() => import('@/pages/reset-password'));
const NotFoundPage = lazyChunk(() => import('@/pages/not-found'));
const WelcomePage = lazyChunk(() => import('@/pages/welcome'));
const EditorPage = lazyChunk(() => import('@/pages/editor'));
// CodeMirror, marked and DOMPurify ride in this chunk only.
const TextEditorPage = lazyChunk(() => import('@/pages/text-editor'));
const ConnectExtensionPage = lazyChunk(() => import('@/pages/connect/extension'));
const ConnectLightroomPage = lazyChunk(() => import('@/pages/connect/lightroom'));
const ConnectWordPressPage = lazyChunk(() => import('@/pages/connect/wordpress'));
const ConnectAiPage = lazyChunk(() => import('@/pages/connect/ai'));
const ConnectExtensionDonePage = lazyChunk(() => import('@/pages/connect/extension-done'));
const TvPage = lazyChunk(() => import('@/pages/tv'));

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
      // Each access_* page is gated the way /settings is (see the comment
      // there): the sidebar hides the link, the gate keeps the page shut.
      { path: '/', element: <RequirePermission perm="access_dashboard"><DashboardPage /></RequirePermission> },
      { path: '/files', element: <RequirePermission perm="access_files"><FilesPage /></RequirePermission> },
      { path: '/map', element: <MapPage /> },
      // Personas (face grouping, on the member's own devices): the first run
      // while off, the grid while on, one persona, and this member's Personas
      // settings. Gated the way /files is: it reads the member's photos.
      { path: '/personas', element: <RequirePermission perm="access_files"><PersonasPage /></RequirePermission> },
      { path: '/personas/settings', element: <RequirePermission perm="access_files"><PersonasSettingsPage /></RequirePermission> },
      { path: '/personas/:personaId', element: <RequirePermission perm="access_files"><PersonasPage /></RequirePermission> },
      { path: '/duplicates', element: <DuplicatesPage /> },
      { path: '/file-requests', element: <FileRequestsPage /> },
      { path: '/file-requests/:id', element: <FileRequestDetailPage /> },
      { path: '/support', element: <SupportPage /> },
      { path: '/support/chat', element: <SupportChatPage /> },
      { path: '/support/:id', element: <SupportTicketPage /> },
      { path: '/uploads', element: <RequirePermission perm="access_upload"><UploadsPage /></RequirePermission> },
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
      { path: '/settings/branding', element: <RequirePermission perm="manage_branding"><BrandingPage /></RequirePermission> },
      // One page per section; the layout handles the old ?section= deep links.
      { path: '/profile/:section?', element: <ProfilePage /> },
      { path: '/api-analytics', element: <ApiAnalyticsPage /> },
      { path: '/teams', element: <RequirePermission perm="access_team"><TeamsPage /></RequirePermission> },
      { path: '/integrations', element: <IntegrationsPage /> },
      { path: '/integrations/rclone', element: <RcloneSetup /> },
      { path: '/integrations/webdav', element: <WebdavSetup /> },
      { path: '/integrations/sftp', element: <SftpSetup /> },
      { path: '/integrations/s3', element: <S3Setup /> },
      { path: '/integrations/desktop', element: <DesktopSetup /> },
      { path: '/integrations/cli', element: <CliSetup /> },
      { path: '/integrations/rest-api', element: <RestApiSetup /> },
      { path: '/integrations/extension', element: <ExtensionSetup /> },
      { path: '/integrations/zapier', element: <ZapierSetup /> },
      { path: '/integrations/wordpress', element: <WordPressSetup /> },
      { path: '/integrations/n8n', element: <N8nSetup /> },
      { path: '/integrations/lightroom', element: <LightroomSetup /> },
      { path: '/integrations/google', element: <GoogleSetup /> },
      { path: '/integrations/google-takeout', element: <GoogleTakeoutImport /> },
      { path: '/integrations/onedrive', element: <OneDriveSetup /> },
      { path: '/integrations/dropbox', element: <DropboxSetup /> },
      { path: '/integrations/webhooks', element: <WebhooksPage /> },
      { path: '/integrations/remote-download', element: <RemoteDownloadPage /> },
      { path: '/integrations/remote-rclone', element: <RemoteRclonePage /> },
      { path: '/shared', element: <RequirePermission perm="access_shared"><SharedPage /></RequirePermission> },
      { path: '/shared/:id', element: <ShareAnalyticsPage /> },
      // "Save to dosya" from a share page. Inside this layout on purpose: a
      // signed-out visitor is sent to /login and brought back here.
      { path: '/save/:token', element: <SaveSharePage /> },
      { path: '/vault', element: <EncryptedPage /> },
      { path: '/comments', element: <CommentsPage /> },
      // GET /api/activity answers 403 for the whole page without
      // view_activity - it IS the audit trail, nothing is narrowed - so the
      // page is gated on that rather than an access_* key it does not have.
      { path: '/activity', element: <RequirePermission perm="view_activity"><ActivityPage /></RequirePermission> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/billing', element: <BillingPage /> },
      // Stripe Checkout's success_url, and where a plan change lands.
      { path: '/checkout/success', element: <CheckoutSuccessPage /> },
      { path: '/referrals', element: <ReferralsPage /> },
      { path: '/workspaces', element: <WorkspaceDashboardPage /> },
      // Every write the editor makes needs manage_roles; the read-only
      // ?view= mode is not worth a second door.
      { path: '/role-create', element: <RequirePermission perm="manage_roles"><RoleCreatePage /></RequirePermission> },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  // Outside DashboardLayout, on purpose: the browser extension opens these
  // in a popup window with no session guarantee; the page itself sends a
  // signed-out visitor through /login and back (lib/post-auth-path.ts).
  { path: '/connect/extension', element: <ConnectExtensionPage /> },
  { path: '/connect/wordpress', element: <ConnectWordPressPage /> },
  { path: '/connect/lightroom', element: <ConnectLightroomPage /> },
  { path: '/connect/ai', element: <ConnectAiPage /> },
  { path: '/connect/extension/done', element: <ConnectExtensionDonePage /> },
  // Signing in a dosya TV app: its QR code opens /tv?code=..., and the typed
  // dosya.dev/tv redirects here. Outside DashboardLayout for the same reason
  // as the /connect pages; the page sends a signed-out visitor through /login.
  { path: '/tv', element: <TvPage /> },
  // Outside DashboardLayout, on purpose: bootDashboard redirects tour-less
  // users here, and the boot gate lives inside DashboardLayout. Nesting this
  // route under it would put the gate above the route it redirects to - the
  // exact loop this placement avoids.
  { path: '/welcome', element: <WelcomePage /> },
  // Outside DashboardLayout, on purpose: the editor is full-viewport with no
  // sidebar. Auth is enforced by the API - an unauthenticated visitor gets
  // the page shell with the error card ("Not authenticated").
  { path: '/editor/:fileId', element: <EditorPage /> },
  // The Markdown and plain-text editor, full-viewport for the same reason.
  // A data router is what lets it ask before leaving with unsaved changes
  // (useBlocker).
  { path: '/text-editor/:fileId', element: <TextEditorPage /> },
  { path: '/login/2fa', element: <Login2faPage /> },
  { path: '/sign-up', element: <SignUpPage /> },
  { path: '/verify', element: <VerifyPage /> },
  // Public shell: captures Gumroad links before sign-in and resumes here
  // afterward. The API gates preview and activation with a cookie session.
  { path: '/redeem', element: <RedeemPage /> },
  { path: '/family/join/:token', element: <FamilyJoinPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/dashboard', element: <Navigate to="/" replace /> },
  { path: '/create-workspace', element: <CreateWorkspacePage /> },
  { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
