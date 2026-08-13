/**
 * The signed-in user's own permissions in the active workspace.
 *
 * Before this existed, nothing in the app knew what the current role could do.
 * The settings page approximated it by fetching /api/roles AND /api/team and
 * cross-referencing its own membership row; every other page simply rendered
 * every control to everybody, so a viewer was shown Upload, Lock, Hide,
 * Rename, Share and Remove-member and learned the truth from a 403 toast. That
 * is what "the roles don't work" looked like from the outside: the gates were
 * mostly right, the interface just never asked.
 *
 * The API remains the authority. This is for hiding doors that are known to be
 * locked, never for deciding what is allowed.
 *
 * FAILURE MODE, ON PURPOSE: while the query is loading or has errored,
 * `can()` answers TRUE. A permission map that fails open in the UI shows a
 * button that may 403; one that fails closed hides the whole app behind a
 * network blip and looks like the account broke. The server is what says no.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';

export interface MyPermissions {
  ok: boolean;
  /** The caller's user id - needed to evaluate `delete_own_files` on a row. */
  user_id: string;
  role_id: string;
  role_name: string | null;
  is_builtin: boolean;
  /** Set when this member is confined to one folder subtree; null otherwise. */
  root_folder_id: string | null;
  /** The anchor's name, or null if it has been trashed. */
  root_folder_name: string | null;
  permissions: Record<string, boolean>;
}

export const permissionsQueryKey = (wsId: string) => ['me-permissions', wsId] as const;

export function usePermissions() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);

  const { data, isLoading, isError } = useQuery({
    queryKey: permissionsQueryKey(wsId ?? ''),
    queryFn: () => api<MyPermissions>(`/api/me/permissions?workspace_id=${wsId}`),
    enabled: !!wsId,
    // Permissions change when an owner edits a role or moves someone between
    // roles - rare, but it must not need a hard reload to take effect. The
    // server-side KV cache already has a 30 min TTL of its own; this is the
    // browser's much shorter window on top of it.
    staleTime: 60_000,
  });

  const permissions = data?.permissions;

  /** Whether the current role holds `perm`. Optimistic until the map loads. */
  const can = (perm: string): boolean => {
    if (!permissions) return true;
    return permissions[perm] ?? false;
  };

  return {
    can,
    permissions,
    userId: data?.user_id ?? null,
    roleId: data?.role_id ?? null,
    roleName: data?.role_name ?? null,
    /** True once we actually know - use to defer a redirect until then. */
    isResolved: !!permissions,
    isLoading,
    isError,
    /** Non-null when the member is confined to a single folder subtree. */
    rootFolderId: data?.root_folder_id ?? null,
    rootFolderName: data?.root_folder_name ?? null,
  };
}
