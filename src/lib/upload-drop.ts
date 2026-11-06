/**
 * The drop/pick entry point the pages call: expand what was dropped, recreate
 * its folder structure server-side, and queue every file into the right folder.
 */
import { formatNumber } from '@/lib/format-locale';
import { api, apiErrorMessage } from '@/api/client';
import { toast } from '@/lib/toast';
import { t } from '@/lib/i18n';
import { enqueue, enqueueByFolder, enqueueRejected } from '@/lib/upload-runner';
import type { UploadInput } from '@/lib/upload-types';
import {
  readDroppedEntries, entriesFromPickedFiles, MAX_DROPPED_FILES,
  type DroppedTree,
} from '@/lib/dropped-entries';
import { orderedDirs, createFolderTree, groupByFolder } from '@/lib/folder-upload';
import { getUploadLimits, screenBatch, summariseRejections } from '@/lib/upload-limits';

export interface DropUploadResult {
  /** Files handed to the upload queue. */
  queued: number;
  /** Folders that had to be created. */
  folders: number;
  /** Files left out because a folder could not be created. */
  skipped: number;
  /** True when at least one folder was involved. */
  hadDirectory: boolean;
}

// "3 files" and "2 folders" in the chosen language.
const filesLabel = (n: number) => t('file-requests.status.ruploadCountPluralOneFileOtherFiles', { rUpload_count: n });
const foldersLabel = (n: number) => t('files.label.folders', { count: n });

function createFolderVia(workspaceId: string) {
  return async (name: string, parentId: string | null): Promise<string> => {
    try {
      const res = await api<{ ok: boolean; error?: string; folder?: { id: string } }>(
        '/api/folders',
        {
          method: 'POST',
          body: JSON.stringify({ workspace_id: workspaceId, parent_id: parentId, name }),
        },
      );
      if (!res.ok || !res.folder?.id) throw new Error(res.error ?? t('common.error.couldNotCreateFolder'));
      return res.folder.id;
    } catch (err) {
      // Surfaces the server's sentence ("...is too long", a permission refusal)
      // rather than a generic failure, since that is what the user has to act on.
      throw new Error(apiErrorMessage(err, t('common.error.couldNotCreateFolder')), { cause: err });
    }
  };
}

/**
 * Queue an already-expanded tree. Folders are created before anything is
 * queued, because each file needs its folder's id to upload into.
 */
export async function uploadTree(
  tree: DroppedTree,
  input: UploadInput,
  opts: { note?: string } = {},
): Promise<DropUploadResult> {
  const note = opts.note ? ` ${opts.note}` : '';
  const empty: DropUploadResult = {
    queued: 0, folders: 0, skipped: 0, hadDirectory: tree.hadDirectory,
  };

  // Screen BEFORE any folder is created. Recreating a tree is a round trip per
  // folder, and building it for files that were never going to be accepted is
  // the expensive half of the old behaviour, not just the confusing half.
  if (tree.entries.length > 0) {
    const limits = await getUploadLimits(input.workspace_id);
    const screened = screenBatch(
      tree.entries, limits, (e) => e.file.name, (e) => e.file.size,
    );
    if (screened.rejected.length > 0) {
      toast.error(
        screened.accepted.length > 0
          ? t('common.error.rejectedcountLeftOut', { rejectedCount: filesLabel(screened.rejected.length) })
          : t('common.error.nothingCouldBeUploaded'),
        summariseRejections(screened.rejected),
      );
      // The toast is a summary that disappears; the rows stay. Each refused
      // file is listed as a failure with its reason, retryable and removable.
      enqueueRejected(
        screened.rejectedItems.map((r) => ({ file: r.item.file, reason: r.reason })),
        input,
      );
      tree = { ...tree, entries: screened.accepted };
      if (screened.accepted.length === 0) {
        return { ...empty, skipped: screened.rejected.length + tree.skipped };
      }
    }
    if (screened.quotaWarning) {
      toast.info(t('common.feedback.thisMayNotAllFit'), screened.quotaWarning);
    }
  }
  if (tree.entries.length === 0) {
    if (!tree.hadDirectory) return empty;
    // An empty folder is still something the user dropped, and empty folders
    // NESTED in a tree are recreated - so a wholly empty one is too, rather
    // than silently doing nothing because it happens to hold no files.
    const plan = await createFolderTree(
      orderedDirs(tree), input.folder_id, createFolderVia(input.workspace_id),
    );
    if (plan.failed.length > 0) {
      toast.error(t('common.error.folderCouldNotBeCreated'), plan.error ?? t('common.error.pleaseTryAgain'));
    } else {
      toast.info(
        t('common.feedback.createdIdssize', { idsSize: foldersLabel(plan.ids.size) }),
        t('common.feedback.thereWereNoFilesInsideToUpload'),
      );
    }
    return { ...empty, folders: plan.ids.size };
  }

  // Loose files: no folders to build, so this is the old path unchanged.
  if (!tree.hadDirectory) {
    enqueue(tree.entries.map((e) => e.file), input);
    toast.info(
      t('common.feedback.uploadingEntriescount', { entriesCount: filesLabel(tree.entries.length) }),
      t('common.feedback.progressIsShownInTheUploadDockNote', { note }),
    );
    return { ...empty, queued: tree.entries.length };
  }

  const dirs = orderedDirs(tree);
  // Said up front, not after: recreating a deep tree is a round trip per folder,
  // and silence in between reads as a dead drop.
  toast.info(
    t('common.feedback.uploadingEntriescount', { entriesCount: filesLabel(tree.entries.length) }),
    t('common.feedback.recreatingDirscountThenUploadingProgressIsShownInTheUploadDockNote', {
      dirsCount: foldersLabel(dirs.length), note,
    }),
  );

  const plan = await createFolderTree(dirs, input.folder_id, createFolderVia(input.workspace_id));
  const { groups, skipped } = groupByFolder(tree.entries, plan, input.folder_id);
  const paths = new Map(tree.entries.map((e) => [e.file, e.path]));
  const queued = enqueueByFolder(groups, input, (file) => paths.get(file) ?? '');

  if (plan.failed.length > 0) {
    toast.error(
      queued > 0 ? t('common.error.someFoldersCouldNotBeCreated') : t('common.error.foldersCouldNotBeCreated'),
      t('common.error.failedcountPluralFolderFailedSoSkippedPluralFileWasLeftOut', {
        failedCount: plan.failed.length, skipped, planError: plan.error ?? '',
      }).trim(),
    );
  }
  if (tree.skipped > 0) {
    toast.error(
      t('common.error.tooManyFilesInOneGo'),
      t('common.error.onlyTheFirstMaxDroppedFilestolocalestringFilesWereQueuedTreeskippedLeftOut', {
        MAX_DROPPED_FILESToLocaleString: formatNumber(MAX_DROPPED_FILES), treeSkipped: filesLabel(tree.skipped),
      }),
    );
  }

  return {
    queued,
    folders: plan.ids.size,
    skipped: skipped + tree.skipped,
    hadDirectory: true,
  };
}

/**
 * Call this synchronously from a drop handler - `dataTransfer` is only readable
 * during the event, so the item list must be taken before the first await.
 */
export function uploadFromDrop(
  dt: DataTransfer,
  input: UploadInput,
  opts: { note?: string } = {},
): Promise<DropUploadResult> {
  // readDroppedEntries takes the item list before its own first await, so this
  // stays valid as long as the caller does not await anything before it.
  return readDroppedEntries(dt).then((tree) => uploadTree(tree, input, opts));
}

/** Same, for `<input webkitdirectory>` and plain file pickers. */
export function uploadFromPicker(
  files: FileList | File[],
  input: UploadInput,
  opts: { note?: string } = {},
): Promise<DropUploadResult> {
  return uploadTree(entriesFromPickedFiles(files), input, opts);
}
