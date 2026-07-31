import { useEffect, useRef } from 'react';
import { ACTIVE_CLOUD_STATUSES, useCloudImports } from '@/stores/cloud-imports';

/**
 * Calls `onComplete` exactly once per cloud-import job that transitions from
 * an active status (discovering/running) to a terminal one (complete/failed/
 * cancelled), scoped to `workspaceId`.
 *
 * This never polls on its own - `jobs` already updates on its own schedule
 * (ImportProgressCard's mount effect and the store's own drive() loop both
 * poll it), this hook only reacts to that array changing. It diffs the
 * previous active-job-id set against the current one on every change: an id
 * that drops out of "active" is a completion edge; an id that stays active
 * (an ordinary progress tick - counts changed, status didn't) or was never
 * tracked as active in the first place is not, so `onComplete` is not
 * called for either of those.
 *
 * Scoped to `workspaceId` (job.workspace_id === workspaceId) because that's
 * cheap - CloudJob already carries workspace_id. NOT scoped to a destination
 * folder: neither CloudJob nor GET /api/cloud/imports/:id expose
 * dest_folder_id, so folder-level scoping isn't determinable client-side
 * without an API change. Callers refresh unconditionally within the
 * workspace on completion instead.
 */
export function useCloudImportCompletionRefresh(workspaceId: string, onComplete: () => void): void {
  const jobs = useCloudImports((s) => s.jobs);
  const prevActiveIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentActive = new Set(
      jobs.filter((j) => ACTIVE_CLOUD_STATUSES.has(j.status)).map((j) => j.id),
    );
    const justCompletedHere = jobs.some(
      (j) => prevActiveIds.current.has(j.id) && !currentActive.has(j.id) && j.workspace_id === workspaceId,
    );
    prevActiveIds.current = currentActive;
    if (justCompletedHere) onComplete();
  }, [jobs, workspaceId, onComplete]);
}
