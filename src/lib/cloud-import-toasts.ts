import type { CloudJob } from '@/api/cloud-import';
import { PROVIDER_LABELS } from '@/lib/cloud-providers';

export interface CompletionToast {
  kind: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}

/** "o@example.com" when known, else the provider label - never a raw id. */
function sourceLabel(job: CloudJob): string {
  return job.account_email ?? (PROVIDER_LABELS[job.provider] ?? job.provider);
}

/**
 * Maps a TERMINAL job to the toast the completion subscriber should raise.
 * Pure so it stays unit-testable; returns null for non-terminal statuses
 * (the subscriber only feeds it jobs that just left the active set, but a
 * mid-flight snapshot glitch must not produce a bogus toast).
 */
export function completionToast(job: CloudJob): CompletionToast | null {
  const from = sourceLabel(job);

  if (job.status === 'complete') {
    const parts = [`${job.completed_files} file${job.completed_files === 1 ? '' : 's'} from ${from}`];
    if (job.skipped_files > 0) parts.push(`${job.skipped_files} skipped`);
    if (job.failed_files > 0) parts.push(`${job.failed_files} failed`);
    return { kind: 'success', title: 'Import complete', description: parts.join(' - ') };
  }
  if (job.status === 'failed') {
    return {
      kind: 'error',
      title: 'Import failed',
      description: job.error_message ?? `The import from ${from} could not be completed.`,
    };
  }
  if (job.status === 'cancelled') {
    return { kind: 'info', title: 'Import cancelled', description: `From ${from}` };
  }
  return null;
}
