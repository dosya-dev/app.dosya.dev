/**
 * The files page's listing, cached.
 *
 * Deliberately logic-free glue: every rule about what to request and how to key
 * it lives in @/lib/files-request, which is unit tested. This file only wires
 * that to React Query.
 *
 * `placeholderData: keepPreviousData` is what removes the skeleton flash when
 * moving between folders - the previous folder's rows stay on screen until the
 * next payload lands, instead of the list emptying to a spinner.
 *
 * The API sets X-D1-Bookmark and the d1b cookie for D1 read-replica
 * consistency. This client is cookie-based, so that round-trips automatically -
 * do not add bookmark handling here.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, apiErrorCode, apiErrorMessage } from '@/api/client';
import { filesQueryKey, filesRequestPath, FILES_QUERY_ROOT, type FilesView } from '@/lib/files-request';
import type { FileItem, FolderItem, Breadcrumb, Pagination } from '@/lib/file-types';

export interface FilesResponse {
  ok: boolean;
  folders: FolderItem[];
  files: FileItem[];
  breadcrumbs: Breadcrumb[];
  pagination?: Pagination;
  /**
   * Whether this member's role may lock / hide. /api/files has always sent
   * both (it computes them to decide what to include in the listing) and no
   * client had ever read them, so every role was offered Lock and Hide and
   * only the owner's clicks actually worked - both permissions are seeded to
   * owner-only, and until migration 0110 no custom role could hold either.
   */
  can_lock?: boolean;
  can_hide?: boolean;
}

/**
 * Fetch a listing and reject an `ok:false` body.
 *
 * Shared with the hover prefetch in files.tsx: a prefetch writes to the SAME
 * cache key the hook reads, so if it skipped this check it could cache a
 * failure as data and the hook would serve it for a full staleTime without
 * ever running its own validation.
 */
export async function fetchFilesListing(path: string): Promise<FilesResponse> {
  const data = await api<FilesResponse>(path);
  // A 200 with ok:false is a real failure; surfacing it as data would render
  // the ordinary "no files here" empty state and read as "my files are gone".
  if (!data.ok) throw new Error('This folder could not be loaded.');
  return data;
}

export interface FilesListing {
  folders: FolderItem[];
  files: FileItem[];
  breadcrumbs: Breadcrumb[];
  pagination: Pagination | null;
  /** Role may lock files/folders. Absent payload → false (fail closed: the
   *  endpoint refuses anyway, and showing Lock to someone who cannot is the
   *  exact defect this replaced). */
  canLock: boolean;
  canHide: boolean;
  isLoading: boolean;
  isPlaceholder: boolean;
  error: string | null;
  /**
   * The API's machine code for the failure, when it sent one. The page branches
   * on `folder_locked` to offer an unlock prompt instead of a dead error panel.
   */
  errorCode: string | null;
  refresh: () => void;
}

const EMPTY_FOLDERS: FolderItem[] = [];
const EMPTY_FILES: FileItem[] = [];
const EMPTY_CRUMBS: Breadcrumb[] = [];

export function useFilesListing(view: FilesView | null): FilesListing {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: view ? filesQueryKey(view) : [FILES_QUERY_ROOT, 'none', 'none'],
    queryFn: () => fetchFilesListing(filesRequestPath(view!)),
    enabled: !!view,
    placeholderData: keepPreviousData,
  });

  const refresh = useCallback(() => {
    // Workspace-scoped, not view-scoped: a rename or delete can change the
    // current folder, its parent's counts, and any other cached page.
    queryClient.invalidateQueries({ queryKey: [FILES_QUERY_ROOT, view?.workspaceId] });
  }, [queryClient, view?.workspaceId]);

  return {
    folders: query.data?.folders ?? EMPTY_FOLDERS,
    files: query.data?.files ?? EMPTY_FILES,
    breadcrumbs: query.data?.breadcrumbs ?? EMPTY_CRUMBS,
    pagination: query.data?.pagination ?? null,
    canLock: query.data?.can_lock ?? false,
    canHide: query.data?.can_hide ?? false,
    isLoading: query.isLoading,
    isPlaceholder: query.isPlaceholderData,
    error: query.isError ? apiErrorMessage(query.error, 'This folder could not be loaded.') : null,
    errorCode: query.isError ? apiErrorCode(query.error) : null,
    refresh,
  };
}
