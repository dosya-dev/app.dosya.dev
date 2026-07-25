import { api } from '@/api/client';
import type { WorkspaceDashboardData } from '@/lib/workspace-dashboard';

export const getWorkspaceDashboard = () =>
  api<{ ok: true } & WorkspaceDashboardData>('/api/workspace-dashboard');
