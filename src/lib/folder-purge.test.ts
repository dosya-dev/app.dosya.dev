import { describe, it, expect, vi } from 'vitest';
import {
  purgeTrashedFolder, purgeSummary, bulkPurgeStillEmptying, bulkPurgeCancelled,
  partialProgressNote, purgeProgressOf, MAX_PURGE_CALLS,
  type PurgeResponse,
} from './folder-purge';

/**
 * Group B made the permanent purge of a trashed folder bounded: it used to
 * spend three storage round trips per file and die against the platform's
 * subrequest ceiling on a few hundred files. DELETE now answers 202
 * `{ complete: false, remaining, files_affected }` when its budget runs out and
 * 200 `{ complete: true, remaining: 0 }` when it finishes, and the call is
 * idempotent - so the client's job is to keep asking.
 */
const page = (over: Partial<PurgeResponse> = {}): PurgeResponse =>
  ({ ok: true, permanent: true, complete: false, remaining: 10, files_affected: 5, ...over });

describe('purgeTrashedFolder', () => {
  it('keeps calling while the server says it is not finished, and sums what each pass removed', async () => {
    const purgeOnce = vi.fn<() => Promise<PurgeResponse>>()
      .mockResolvedValueOnce(page({ complete: false, remaining: 120, files_affected: 300 }))
      .mockResolvedValueOnce(page({ complete: true, remaining: 0, files_affected: 120 }));

    const outcome = await purgeTrashedFolder(purgeOnce);

    expect(purgeOnce).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ complete: true, cancelled: false, filesAffected: 420, remaining: 0, calls: 2 });
  });

  it('is a single call when the first answer is already complete', async () => {
    const purgeOnce = vi.fn<() => Promise<PurgeResponse>>()
      .mockResolvedValue(page({ complete: true, remaining: 0, files_affected: 3 }));

    const outcome = await purgeTrashedFolder(purgeOnce);

    expect(purgeOnce).toHaveBeenCalledTimes(1);
    expect(outcome.complete).toBe(true);
    expect(outcome.filesAffected).toBe(3);
  });

  // A folder big enough to never finish would otherwise spin forever, hammering
  // the API from a tab nobody is watching.
  it('stops at the call cap and reports itself unfinished', async () => {
    const purgeOnce = vi.fn<() => Promise<PurgeResponse>>()
      .mockResolvedValue(page({ complete: false, remaining: 999, files_affected: 2 }));

    const outcome = await purgeTrashedFolder(purgeOnce, { maxCalls: 4 });

    expect(purgeOnce).toHaveBeenCalledTimes(4);
    expect(outcome).toEqual({ complete: false, cancelled: false, filesAffected: 8, remaining: 999, calls: 4 });
  });

  it('defaults that cap to about fifty passes', () => {
    expect(MAX_PURGE_CALLS).toBe(50);
  });

  // An older API answers a permanent delete with a bare `{ ok: true }`. Reading
  // a missing flag as "not finished" would loop fifty times against a server
  // that had already done the whole job on the first call.
  it('treats an answer with no complete flag as finished', async () => {
    const purgeOnce = vi.fn<() => Promise<PurgeResponse>>().mockResolvedValue({ ok: true });

    const outcome = await purgeTrashedFolder(purgeOnce);

    expect(purgeOnce).toHaveBeenCalledTimes(1);
    expect(outcome.complete).toBe(true);
    expect(outcome.filesAffected).toBe(0);
  });

  it('lets a failure out rather than retrying it fifty times', async () => {
    const purgeOnce = vi.fn<() => Promise<PurgeResponse>>()
      .mockResolvedValueOnce(page({ complete: false }))
      .mockRejectedValueOnce(new Error('Access denied'));

    await expect(purgeTrashedFolder(purgeOnce)).rejects.toThrow('Access denied');
    expect(purgeOnce).toHaveBeenCalledTimes(2);
  });

  // A purge that dies on pass three has still removed everything passes one and
  // two removed. Throwing that away told the user "the item could not be
  // deleted" over several hundred files that are gone for good.
  it('carries the work already done out with the failure', async () => {
    const boom = new Error('Access denied');
    const purgeOnce = vi.fn<() => Promise<PurgeResponse>>()
      .mockResolvedValueOnce(page({ complete: false, remaining: 500, files_affected: 300 }))
      .mockResolvedValueOnce(page({ complete: false, remaining: 400, files_affected: 100 }))
      .mockRejectedValueOnce(boom);

    const err = await purgeTrashedFolder(purgeOnce).catch((e: unknown) => e);

    // The original error, untouched - callers still read the server's sentence
    // off it (apiErrorMessage checks `instanceof ApiError`).
    expect(err).toBe(boom);
    expect(purgeProgressOf(err)).toEqual({ filesAffected: 400, remaining: 400, calls: 2 });
  });

  it('reports no progress for an error that never came from a purge', () => {
    expect(purgeProgressOf(new Error('unrelated'))).toBeNull();
    expect(purgeProgressOf('a string')).toBeNull();
    expect(purgeProgressOf(undefined)).toBeNull();
  });

  // A bulk cancel has to land between passes: without this, cancelling while a
  // folder is mid-purge waits out up to fifty sequential round trips.
  it('stops between passes when the caller cancels', async () => {
    let cancelled = false;
    const purgeOnce = vi.fn<() => Promise<PurgeResponse>>().mockImplementation(async () => {
      cancelled = true; // the user hits Cancel while pass one is in flight
      return page({ complete: false, remaining: 900, files_affected: 400 });
    });

    const outcome = await purgeTrashedFolder(purgeOnce, { shouldStop: () => cancelled });

    expect(purgeOnce).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ complete: false, cancelled: true, filesAffected: 400, remaining: 900, calls: 1 });
  });

  it('does not start at all when it is cancelled before the first pass', async () => {
    const purgeOnce = vi.fn<() => Promise<PurgeResponse>>();

    const outcome = await purgeTrashedFolder(purgeOnce, { shouldStop: () => true });

    expect(purgeOnce).not.toHaveBeenCalled();
    expect(outcome).toEqual({ complete: false, cancelled: true, filesAffected: 0, remaining: 0, calls: 0 });
  });
});

describe('purgeSummary', () => {
  it('reports the total removed when the purge finished', () => {
    const s = purgeSummary({ complete: true, cancelled: false, filesAffected: 420, remaining: 0, calls: 2 }, 'Archive');
    expect(s.kind).toBe('success');
    expect(s.title).toBe('Deleted');
    expect(s.body).toContain('Archive');
    expect(s.body).toContain('420');
  });

  it('does not count files when there were none to count', () => {
    const s = purgeSummary({ complete: true, cancelled: false, filesAffected: 0, remaining: 0, calls: 1 }, 'Empty');
    expect(s.kind).toBe('success');
    expect(s.body).not.toMatch(/\b0 files\b/);
  });

  it('says the folder is still emptying when the cap stopped it', () => {
    const s = purgeSummary({ complete: false, cancelled: false, filesAffected: 5_000, remaining: 900, calls: 50 }, 'Huge');
    expect(s.kind).toBe('info');
    expect(`${s.title} ${s.body}`.toLowerCase()).toContain('still emptying');
    expect(`${s.title} ${s.body}`.toLowerCase()).toContain('very large');
    // What it did manage is still reported, and so is what is left.
    expect(s.body).toContain('5,000');
    expect(s.body).toContain('900');
  });
});

/**
 * The multi-select purge runs the same loop per folder, so it can end the same
 * way: some items gone, one folder only partly emptied. Reporting that as
 * "1 item permanently deleted" is the defect this whole change set exists to
 * remove, one path over.
 */
describe('bulkPurgeStillEmptying', () => {
  const folder = (name: string, filesAffected: number, remaining: number) => ({ name, filesAffected, remaining });

  it('names the folder, what went, and what is left - in the row-level voice', () => {
    const m = bulkPurgeStillEmptying({
      deleted: 3, failed: 0, incomplete: [folder('Archive', 500, 900)],
    });
    expect(m.kind).toBe('info');
    // Identical title to the single-folder path, so the two cannot drift.
    expect(m.title).toBe(purgeSummary({ complete: false, cancelled: false, filesAffected: 1, remaining: 1, calls: 50 }, 'x').title);
    expect(m.body).toContain('3 items permanently deleted');
    expect(m.body).toContain('"Archive"');
    expect(m.body).toContain('very large');
    expect(m.body).toContain('500');
    expect(m.body).toContain('900');
    expect(m.body).toContain('Choose "Delete permanently" again to carry on.');
  });

  it('counts the folders when more than one is still emptying', () => {
    const m = bulkPurgeStillEmptying({
      deleted: 0, failed: 0, incomplete: [folder('A', 300, 100), folder('B', 500, 1_400)],
    });
    expect(m.body).toContain('2 folders are very large');
    expect(m.body).toContain('800');   // 300 + 500 removed
    expect(m.body).toContain('1,500'); // 100 + 1,400 left
    // Nothing finished, so nothing is claimed to have finished.
    expect(m.body).not.toMatch(/\b0 items permanently deleted\b/);
  });

  it('still reports failures alongside the unfinished folder', () => {
    const m = bulkPurgeStillEmptying({
      deleted: 2, failed: 1, incomplete: [folder('Archive', 10, 5)],
    });
    expect(m.body).toContain('1 item could not be deleted');
  });

  it('uses singular wording for a single deleted item and a single failure', () => {
    const m = bulkPurgeStillEmptying({
      deleted: 1, failed: 1, incomplete: [folder('Archive', 1, 1)],
    });
    expect(m.body).toContain('1 item permanently deleted');
    expect(m.body).not.toContain('1 items');
  });
});

describe('partialProgressNote', () => {
  it('says what a failed or cancelled folder had already removed', () => {
    expect(partialProgressNote([{ name: 'Archive', filesAffected: 400, remaining: 900 }]))
      .toBe('400 files had already been removed from "Archive".');
  });

  it('sums across several folders', () => {
    const note = partialProgressNote([
      { name: 'A', filesAffected: 400, remaining: 10 },
      { name: 'B', filesAffected: 1_200, remaining: 20 },
    ]);
    expect(note).toContain('1,600 files');
    expect(note).toContain('2 folders');
  });

  it('is empty when nothing had been removed, so no clause is glued on for nothing', () => {
    expect(partialProgressNote([])).toBe('');
    expect(partialProgressNote([{ name: 'A', filesAffected: 0, remaining: 5 }])).toBe('');
  });
});

// Nothing covered the cancelled summary before, which is how it came to count a
// half-emptied folder as deleted.
describe('bulkPurgeCancelled', () => {
  it('counts a half-emptied folder as left in the trash, never as deleted', () => {
    const m = bulkPurgeCancelled({
      deleted: 1, leftInTrash: 2, partial: [{ name: 'Archive', filesAffected: 400, remaining: 900 }],
    });
    expect(m.kind).toBe('info');
    expect(m.title).toBe('Delete cancelled');
    expect(m.body).toContain('1 item already deleted');
    expect(m.body).toContain('2 left in the trash');
    expect(m.body).not.toContain('2 items already deleted');
    // And what the interrupted folder did manage is still reported.
    expect(m.body).toContain('400 files had already been removed from "Archive".');
  });

  it('says only the counts when no folder was mid-purge', () => {
    const m = bulkPurgeCancelled({ deleted: 3, leftInTrash: 4, partial: [] });
    expect(m.body).toBe('3 items already deleted, 4 left in the trash.');
  });
});
