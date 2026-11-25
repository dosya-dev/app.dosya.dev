import { describe, it, expect, vi } from 'vitest';
import { purgeProgressOf, type PurgeResponse } from './folder-purge';
import { MAX_TRASH_CALLS, trashFolderInPasses } from './folder-trash';

const pass = (over: Partial<PurgeResponse>): PurgeResponse => ({ ok: true, permanent: false, ...over });

describe('trashFolderInPasses', () => {
  it('asks again until the server finishes and reports the running total', async () => {
    const request = vi.fn<(path: string) => Promise<PurgeResponse>>()
      .mockResolvedValueOnce(pass({ complete: false, remaining: 600, files_affected: 500 }))
      .mockResolvedValueOnce(pass({ complete: false, remaining: 100, files_affected: 500 }))
      .mockResolvedValueOnce(pass({ complete: true, remaining: 0, files_affected: 100 }));
    const seen: number[] = [];

    const outcome = await trashFolderInPasses('fld_1', request, (moved) => seen.push(moved));

    expect(seen).toEqual([500, 1000, 1100]);
    expect(outcome).toEqual({ complete: true, cancelled: false, filesAffected: 1100, remaining: 0, calls: 3 });
  });

  it('never sends a plain DELETE, which would purge a folder that had just reached the trash', async () => {
    const request = vi.fn(async (_path: string) => pass({ complete: true }));
    await trashFolderInPasses('fld_1', request);
    expect(request).toHaveBeenCalledWith('/api/folders/fld_1?trash_only=1&bounded=1');
  });

  it('stops after one answer from an API that does not know about passes', async () => {
    const request = vi.fn(async (_path: string) => ({ ok: true, already_trashed: true }) as PurgeResponse);
    const outcome = await trashFolderInPasses('fld_1', request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(outcome.complete).toBe(true);
  });

  it('keeps what earlier passes moved on the rejection', async () => {
    const failure = new Error('overloaded');
    const request = vi.fn<(path: string) => Promise<PurgeResponse>>()
      .mockResolvedValueOnce(pass({ complete: false, remaining: 500, files_affected: 500 }))
      .mockRejectedValueOnce(failure);

    await expect(trashFolderInPasses('fld_1', request)).rejects.toBe(failure);
    expect(purgeProgressOf(failure)).toEqual({ filesAffected: 500, remaining: 500, calls: 1 });
  });

  it('allows far more passes than a purge, because each one moves few files', async () => {
    const request = vi.fn(async (_path: string) => pass({ complete: false, remaining: 1, files_affected: 1 }));
    const outcome = await trashFolderInPasses('fld_1', request);
    expect(request).toHaveBeenCalledTimes(MAX_TRASH_CALLS);
    expect(outcome.complete).toBe(false);
    expect(MAX_TRASH_CALLS).toBeGreaterThanOrEqual(1000);
  });
});
