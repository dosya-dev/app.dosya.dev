import { createBrowserRouter, Outlet } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { RouteTitle } from '@/lib/page-title';
import DashboardPage from '@/pages/dashboard';
import FileRequestsPage from '@/pages/file-requests';
import UploadsPage from '@/pages/uploads';
import SettingsPage from '@/pages/settings';
import ProfilePage from '@/pages/profile';
import FilesPage from '@/pages/files';
import CreateWorkspacePage from '@/pages/create-workspace';
import TeamsPage from '@/pages/teams';
import SharedPage from '@/pages/shared';
import CommentsPage from '@/pages/comments';
import ActivityPage from '@/pages/activity';
import SearchPage from '@/pages/search';
import BillingPage from '@/pages/billing';
import RoleCreatePage from '@/pages/role-create';
import FileRequestDetailPage from '@/pages/file-request-detail';
import LoginPage from '@/pages/login';
import Login2faPage from '@/pages/login-2fa';

// Admin

import AdminOverviewPage, { AdminLayout } from '@/pages/admin/index';
import AdminUsersPage from '@/pages/admin/users';
import {
  AdminFilesPage, AdminSharesPage, AdminSessionsPage, AdminActivityPage,
  AdminPaymentsPage, AdminEmailsPage, AdminInvitesPage, AdminAnnouncementsPage,
  AdminHealthPage, AdminGrowthPage, AdminSecurityPage, AdminContactPage, AdminPlansPage,
} from '@/pages/admin/sections';

// Root layout: keeps the browser tab title in sync with the route for every page.
function RootLayout() {
  return (
    <>
      <RouteTitle />
      <Outlet />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
  {
    element: <DashboardLayout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/files', element: <FilesPage /> },
      { path: '/file-requests', element: <FileRequestsPage /> },
      { path: '/file-requests/:id', element: <FileRequestDetailPage /> },
      { path: '/uploads', element: <UploadsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/teams', element: <TeamsPage /> },
      { path: '/shared', element: <SharedPage /> },
      { path: '/comments', element: <CommentsPage /> },
      { path: '/activity', element: <ActivityPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/billing', element: <BillingPage /> },
      { path: '/role-create', element: <RoleCreatePage /> },
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminOverviewPage /> },
          { path: 'users', element: <AdminUsersPage /> },
          { path: 'files', element: <AdminFilesPage /> },
          { path: 'shares', element: <AdminSharesPage /> },
          { path: 'sessions', element: <AdminSessionsPage /> },
          { path: 'activity', element: <AdminActivityPage /> },
          { path: 'payments', element: <AdminPaymentsPage /> },
          { path: 'emails', element: <AdminEmailsPage /> },
          { path: 'invites', element: <AdminInvitesPage /> },
          { path: 'announcements', element: <AdminAnnouncementsPage /> },
          { path: 'health', element: <AdminHealthPage /> },
          { path: 'growth', element: <AdminGrowthPage /> },
          { path: 'security', element: <AdminSecurityPage /> },
          { path: 'contact', element: <AdminContactPage /> },
          { path: 'plans', element: <AdminPlansPage /> },
        ],
      },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  { path: '/login/2fa', element: <Login2faPage /> },
  { path: '/create-workspace', element: <CreateWorkspacePage /> },
    ],
  },
]);
