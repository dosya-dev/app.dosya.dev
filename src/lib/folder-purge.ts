/**
 * Permanently deleting a trashed folder, one bounded pass at a time.
 *
 * The purge spends storage round trips per file, so the API stopped trying to
 * do the whole thing in one request: it works through the folder until its
 * budget runs out and answers 202 `{ complete: false, remaining, files_affected }`,
 * or 200 `{ complete: true, remaining: 0 }` when there is nothing left. The
 * call is idempotent and the folder rows deliberately survive an unfinished
 * pass - they are how the next call re-enumerates what remains - so finishing
 * the job is simply asking again.
 *
 * The client half is this loop. Without it the page took the first answer as
 * the whole job and reported a folder gone while most of it was still there.
 */

/** The body of a permanent-delete answer. Every field is optional: an older API answers `{ ok: true }`. */
export interface PurgeResponse {
  ok?: boolean;
  permanent?: boolean;
  complete?: boolean;
  remaining?: number;
  files_affected?: number;
}

export interface PurgeOutcome {
  /** False when the call cap or a cancel stopped us with work still to do. */
  complete: boolean;
  /** True when the caller's `shouldStop` ended it rather than the cap. */
  cancelled: boolean;
  /** Files removed across every pass. */
  filesAffected: number;
  /** What the last pass said was left. */
  remaining: number;
  calls: number;
}

/** What a purge had achieved before it threw. */
export interface PurgePartial {
  filesAffected: number;
  remaining: number;
  calls: number;
}

/**
 * Progress carried alongside a rejection.
 *
 * A WeakMap rather than a property on the error: the error object reaches the
 * caller untouched, so `err instanceof ApiError` still holds and
 * `apiErrorMessage` still finds the server's own sentence on it. A purge that
 * dies on pass three has still removed everything passes one and two removed,
 * and dropping that number told people "the item could not be deleted" over
 * several hundred files that are gone for good.
 */
const progressByError = new WeakMap<object, PurgePartial>();

export function purgeProgressOf(err: unknown): PurgePartial | null {
  if (typeof err !== 'object' || err === null) return null;
  return progressByError.get(err) ?? null;
}

/**
 * How many passes one click will make. A folder large enough to never finish
 * would otherwise spin forever, hammering the API from a tab nobody is
 * watching; at the cap the user is told it is still emptying and can ask
 * again, which resumes exactly where this left off.
 */
export const MAX_PURGE_CALLS = 50;

export async function purgeTrashedFolder(
  purgeOnce: () => Promise<PurgeResponse>,
  opts: {
    maxCalls?: number;
    /**
     * Polled before every pass. A bulk cancel has to land BETWEEN passes -
     * without this, cancelling while a folder is mid-purge waits out up to
     * fifty sequential round trips before anything stops.
     */
    shouldStop?: () => boolean;
  } = {},
): Promise<PurgeOutcome> {
  const maxCalls = Math.max(1, opts.maxCalls ?? MAX_PURGE_CALLS);
  let filesAffected = 0;
  let remaining = 0;
  let calls = 0;

  // A failure is thrown, not retried: a 403 or a 404 would be just as refused
  // fifty times over, and the caller has a message to show for it - along with
  // the count of what had already gone, recorded above.
  while (calls < maxCalls) {
    if (opts.shouldStop?.()) return { complete: false, cancelled: true, filesAffected, remaining, calls };
    let body: PurgeResponse;
    try {
      body = await purgeOnce();
    } catch (err) {
      if (typeof err === 'object' && err !== null) {
        progressByError.set(err, { filesAffected, remaining, calls });
      }
      throw err;
    }
    calls += 1;
    filesAffected += body.files_affected ?? 0;
    remaining = body.remaining ?? 0;
    // Anything but an explicit `false` counts as finished, so an API that
    // predates this contract (a bare `{ ok: true }`) is not looped against.
    if (body.complete !== false) return { complete: true, cancelled: false, filesAffected, remaining, calls };
  }

  return { complete: false, cancelled: false, filesAffected, remaining, calls };
}

export interface PurgeMessage {
  kind: 'success' | 'info';
  title: string;
  body: string;
}

/** The title both paths use when a purge stopped with work still to do. */
const STILL_EMPTYING_TITLE = 'Still emptying';

/** "Ask again" is the whole recovery, so both paths say it the same way. */
const CARRY_ON = 'Choose "Delete permanently" again to carry on.';

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** What to tell the user when the loop stops, finished or not. */
export function purgeSummary(outcome: PurgeOutcome, folderName: string): PurgeMessage {
  const files = outcome.filesAffected.toLocaleString();
  if (outcome.complete) {
    return {
      kind: 'success',
      title: 'Deleted',
      body: outcome.filesAffected > 0
        ? `"${folderName}" and its ${files} file${outcome.filesAffected === 1 ? '' : 's'} were permanently deleted.`
        : `"${folderName}" was permanently deleted.`,
    };
  }
  return {
    kind: 'info',
    title: STILL_EMPTYING_TITLE,
    body: `"${folderName}" is very large - ${files} file${outcome.filesAffected === 1 ? '' : 's'} removed so far, `
      + `about ${outcome.remaining.toLocaleString()} to go. ${CARRY_ON}`,
  };
}

/** One folder the bulk purge could not finish. */
export interface UnfinishedFolder {
  name: string;
  filesAffected: number;
  remaining: number;
}

/**
 * The multi-select purge's summary when at least one selected folder is still
 * emptying.
 *
 * A folder that answered 202 is NOT a deleted item, and saying "2 items
 * permanently deleted" over a folder that is still half full is the same lie
 * the single-folder path was fixed for. The wording is deliberately the row
 * -level wording: same title, same "very large", same instruction to ask
 * again, so the two paths cannot drift into describing one behaviour two ways.
 */
export function bulkPurgeStillEmptying(opts: {
  /** Items that really are gone: deleted files plus folders that completed. */
  deleted: number;
  failed: number;
  incomplete: UnfinishedFolder[];
}): PurgeMessage {
  const { deleted, failed, incomplete } = opts;
  const removed = incomplete.reduce((sum, f) => sum + f.filesAffected, 0);
  const left = incomplete.reduce((sum, f) => sum + f.remaining, 0);

  const parts: string[] = [];
  if (deleted > 0) parts.push(`${plural(deleted, 'item')} permanently deleted.`);
  parts.push(
    incomplete.length === 1
      ? `"${incomplete[0].name}" is very large - ${plural(removed, 'file')} removed so far, about ${left.toLocaleString()} to go.`
      : `${plural(incomplete.length, 'folder')} are very large - ${plural(removed, 'file')} removed so far, about ${left.toLocaleString()} to go.`,
  );
  parts.push(CARRY_ON);
  if (failed > 0) parts.push(`${plural(failed, 'item')} could not be deleted.`);

  return { kind: 'info', title: STILL_EMPTYING_TITLE, body: parts.join(' ') };
}

/**
 * The clause that reports work a folder had done before it was interrupted -
 * by a failure or by a cancel. Empty when there is nothing to report, so a
 * caller can append it unconditionally without gluing on a sentence about
 * zero files.
 */
export function partialProgressNote(partial: UnfinishedFolder[]): string {
  const withWork = partial.filter((f) => f.filesAffected > 0);
  if (withWork.length === 0) return '';
  const removed = withWork.reduce((sum, f) => sum + f.filesAffected, 0);
  const where = withWork.length === 1 ? `"${withWork[0].name}"` : plural(withWork.length, 'folder');
  return `${plural(removed, 'file')} had already been removed from ${where}.`;
}

/**
 * The multi-select purge's summary when the user cancelled.
 *
 * A folder whose purge was interrupted is still in the trash - it is NOT a
 * deleted item, which is what this used to imply by counting it among them.
 */
export function bulkPurgeCancelled(opts: {
  deleted: number;
  leftInTrash: number;
  partial: UnfinishedFolder[];
}): PurgeMessage {
  const note = partialProgressNote(opts.partial);
  const counts = `${plural(opts.deleted, 'item')} already deleted, ${opts.leftInTrash.toLocaleString()} left in the trash.`;
  return {
    kind: 'info',
    title: 'Delete cancelled',
    body: note ? `${counts} ${note}` : counts,
  };
}
