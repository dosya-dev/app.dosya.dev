import { api } from '@/api/client';

/** Mirrors apps/api/src/lib/rclone-import/types.ts. */
export interface RcloneOption {
  name: string;
  help: string;
  type: string;
  required: boolean;
  password: boolean;
  sensitive: boolean;
  default: string;
  provider?: string;
  exclusive?: boolean;
  examples?: { value: string; help: string; provider?: string }[];
}

export interface RcloneBackend {
  name: string;
  label: string;
  description: string;
  category: 'object' | 'drive' | 'server';
  oauth: boolean;
  options: RcloneOption[];
}

export type EntitlementReason =
  | 'ok' | 'free_plan' | 'grace_period' | 'allowance_used' | 'concurrency' | 'not_enabled' | 'unavailable';

export interface RcloneEntitlement {
  allowed: boolean;
  reason: EntitlementReason;
  plan: string | null;
  trial: boolean;
  concurrent: number;
  running: number;
  bytes_limit: number;
  bytes_used: number;
  bytes_remaining: number;
  owner_is_you: boolean;
}

export interface RcloneBackendsResponse {
  enabled: boolean;
  backends: RcloneBackend[];
  entitlement: RcloneEntitlement | null;
  native_providers?: string[];
}

export interface RcloneProbeEntry {
  name: string;
  kind: 'dir' | 'file';
  size: number;
  modified: string | null;
}

export interface RcloneJob {
  id: string;
  workspace_id: string;
  kind: 'probe' | 'import';
  backend: string;
  label: string;
  source_path: string;
  /** Hostname the import reads from; null for fixed-address services. */
  source_host: string | null;
  dest_folder_id: string | null;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  cancel_requested: number;
  bytes_total: number;
  bytes_done: number;
  files_total: number;
  files_done: number;
  files_failed: number;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  finished_at: number | null;
  entries?: RcloneProbeEntry[];
}

export interface CreateJobInput {
  kind: 'probe' | 'import';
  backend: string;
  options: Record<string, string>;
  source_path: string;
  workspace_id: string;
  dest_folder_id?: string | null;
  label?: string;
}

export const getBackends = (workspaceId: string) =>
  api<RcloneBackendsResponse>(`/api/rclone/backends?workspace_id=${encodeURIComponent(workspaceId)}`);

export const createJob = (input: CreateJobInput) =>
  api<{ job: RcloneJob }>('/api/rclone/jobs', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.job);

export const getJob = (id: string) =>
  api<{ job: RcloneJob }>(`/api/rclone/jobs/${encodeURIComponent(id)}`).then((r) => r.job);

export const listJobs = (workspaceId: string) =>
  api<{ jobs: RcloneJob[] }>(`/api/rclone/jobs?workspace_id=${encodeURIComponent(workspaceId)}`).then((r) => r.jobs);

export const cancelJob = (id: string) =>
  api<{ status: string }>(`/api/rclone/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });

export const isActive = (j: Pick<RcloneJob, 'status'>) => j.status === 'queued' || j.status === 'running';
