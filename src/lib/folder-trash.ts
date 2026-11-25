import { purgeTrashedFolder, type PurgeOutcome, type PurgeResponse } from './folder-purge';

/**
 * Moving a folder to the trash, one bounded pass at a time.
 *
 * A folder of thousands of files used to be one long call on the object that
 * also serves the workspace's uploads and listings, so every other client
 * stalled behind it. With `bounded=1` the API moves a few hundred files and
 * answers 202 `{ complete: false, remaining, files_affected }`, leaving the
 * object free until the next pass.
 *
 * `trash_only=1` is not optional here. The last pass puts the folder in the
 * trash, and a plain DELETE on a folder already in the trash starts the
 * permanent purge.
 */

/** Far above the purge's cap: a pass is small, so a big folder needs many. */
export const MAX_TRASH_CALLS = 2000;

export function trashFolderInPasses(
  folderId: string,
  request: (path: string) => Promise<PurgeResponse>,
  onMoved?: (filesMoved: number) => void,
): Promise<PurgeOutcome> {
  let moved = 0;
  return purgeTrashedFolder(async () => {
    const body = await request(`/api/folders/${folderId}?trash_only=1&bounded=1`);
    moved += body.files_affected ?? 0;
    onMoved?.(moved);
    return body;
  }, { maxCalls: MAX_TRASH_CALLS });
}
