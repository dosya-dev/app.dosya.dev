import type { CloudJob } from '@/api/cloud-import';
import { PROVIDER_LABELS } from '@/lib/cloud-providers';
import { t } from '@/lib/i18n';

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
    const parts = [t('common.description.jobcompletedFilesPluralOneFileOtherFilesFromFrom', { jobCompleted_files: job.completed_files, from })];
    if (job.skipped_files > 0) parts.push(t('common.label.jobskippedFilesSkipped', { count: String(job.skipped_files) }));
    if (job.failed_files > 0) parts.push(t('common.error.jobfailedFilesFailed', { count: String(job.failed_files) }));
    return { kind: 'success', title: t('common.heading.importComplete'), description: parts.join(' - ') };
  }
  if (job.status === 'failed') {
    return {
      kind: 'error',
      title: t('common.error.importFailed'),
      description: job.error_message ?? t('common.error.theImportFromFromCouldNotBeCompleted', { from }),
    };
  }
  if (job.status === 'cancelled') {
    return { kind: 'info', title: t('common.heading.importCancelled'), description: t('common.description.fromFrom', { from }) };
  }
  return null;
}
