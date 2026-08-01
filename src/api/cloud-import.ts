import { api } from '@/api/client';

export interface CloudProvider { id: string; label: string }

export interface CloudAccount {
  id: string;
  provider: string;
  account_email: string;
  account_name: string;
  created_at: number;
}

export interface CloudEntryDto {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  size: number;
  modifiedAt?: number;
  mimeType?: string;
  unsupported?: boolean;
  exportAs?: { mime: string; ext: string };
}

export interface CloudJob {
  id: string;
  provider: string;
  workspace_id: string;
  status: 'discovering' | 'running' | 'complete' | 'failed' | 'cancelled';
  total_files: number;
  total_bytes: number;
  total_folders: number;
  completed_files: number;
  completed_bytes: number;
  failed_files: number;
  skipped_files: number;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export interface SelectionEntry {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  size?: number;
  mimeType?: string;
  exportMime?: string | null;
}

export const listProviders = () =>
  api<{ providers: CloudProvider[] }>('/api/cloud/providers').then((r) => r.providers);

export const listAccounts = () =>
  api<{ accounts: CloudAccount[] }>('/api/cloud/accounts').then((r) => r.accounts);

export const disconnectAccount = (id: string) =>
  api<{ ok: boolean }>(`/api/cloud/accounts/${id}`, { method: 'DELETE' });

export function browse(args: { accountId: string; folderId?: string; cursor?: string }) {
  const params = new URLSearchParams({ account_id: args.accountId });
  if (args.folderId) params.set('folder_id', args.folderId);
  if (args.cursor) params.set('cursor', args.cursor);
  return api<{ entries: CloudEntryDto[]; cursor: string | null }>(
    `/api/cloud/browse?${params}`,
  );
}

export const createImport = (args: {
  accountId: string;
  workspaceId: string;
  destFolderId: string | null;
  selection: SelectionEntry[];
}) =>
  api<{ job_id: string; status: string }>('/api/cloud/imports', {
    method: 'POST',
    body: JSON.stringify({
      account_id: args.accountId,
      workspace_id: args.workspaceId,
      dest_folder_id: args.destFolderId,
      selection: args.selection,
    }),
  });

export const listJobs = () =>
  api<{ jobs: CloudJob[] }>('/api/cloud/imports').then((r) => r.jobs);

export const getJob = (id: string) =>
  api<{
    job: CloudJob;
    current: { remote_name: string; size_bytes: number; bytes_uploaded: number } | null;
    problems: Array<{ remote_name: string; status: string; error_message: string | null }>;
  }>(`/api/cloud/imports/${id}`);

export const cancelJob = (id: string) =>
  api<{ ok: boolean }>(`/api/cloud/imports/${id}/cancel`, { method: 'POST' });
