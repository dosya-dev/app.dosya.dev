/**
 * Turns files-page view state into the /api/files request and its cache key.
 *
 * Kept pure and React-free so the rules are unit-testable and live in one
 * place. The cache key is derived FROM the request path, which is what
 * guarantees they cannot drift: any param that changes the response
 * necessarily changes the key, so a stale entry can never be served for a
 * different view.
 */

export interface FilesView {
  workspaceId: string;
  /** Live folder, or the trashed folder being browsed when filter === 'deleted'. null = root. */
  folderId: string | null;
  /** Sidebar selection: '' (all), a type filter, 'deleted', or 'hidden'. */
  filter: string;
  /** Group view id, '' when not in one. */
  group: string;
  sort: string;
  search: string;
  page: number;
  /**
   * Unlock token for `folderId`, once the user has entered the password of a
   * full_lock folder. Part of the view - and so of the cache key - on purpose:
   * the locked and unlocked listings of the same folder are different
   * responses, and a token that expires must not keep serving the unlocked one.
   */
  unlockToken?: string | null;
}

/** Root segment of every files query key, for workspace-wide invalidation. */
export const FILES_QUERY_ROOT = 'files';

const PER_PAGE = '100';

export function filesRequestPath(view: FilesView): string {
  const { workspaceId, folderId, filter, group, sort, search, page, unlockToken } = view;
  const isDeleted = filter === 'deleted';

  const params = new URLSearchParams({
    workspace_id: workspaceId,
    sort,
    page: String(page),
    per_page: PER_PAGE,
  });

  if (search) params.set('q', search);

  if (isDeleted) {
    // Inside the trash, `folder` addresses a TRASHED folder - a distinct param
    // the API keeps separate from the live `folder_id` filter.
    params.set('deleted', '1');
    if (folderId) params.set('folder', folderId);
  } else if (folderId) {
    params.set('folder_id', folderId);
    // Only meaningful alongside folder_id: the API checks the lock exactly when
    // it is entering a live folder, and ignores `ut` in the trash.
    if (unlockToken) params.set('ut', unlockToken);
  }

  if (filter === 'hidden') params.set('hidden', '1');
  else if (filter && !isDeleted) params.set('filter', filter);

  if (group) params.set('group_id', group);

  return `/api/files?${params}`;
}

export function filesQueryKey(view: FilesView): [string, string, string] {
  return [FILES_QUERY_ROOT, view.workspaceId, filesRequestPath(view)];
}
