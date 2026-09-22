import { describe, it, expect, vi } from 'vitest';
import { missingPartNumbers, bytesForParts, PartBytes, runPool, buildQueueItems, sourceTimeHeaders, enqueue, enqueueRejected, retryAllFailed, canRetry } from './upload-runner';
import { useUploads } from '@/stores/uploads';

describe('sourceTimeHeaders', () => {
  it('converts File.lastModified (ms) to a unix-seconds header', () => {
    expect(sourceTimeHeaders(1_600_000_000_500)).toEqual({ 'X-Dosya-Source-Mtime': '1600000000' });
  });

  it('sends nothing for the epoch-zero fallback some browsers report', () => {
    // A File with no real mtime reports lastModified 0 - sending that would
    // just be sanitized to NULL server-side, so skip the header entirely.
    expect(sourceTimeHeaders(0)).toEqual({});
    expect(sourceTimeHeaders(undefined as unknown as number)).toEqual({});
  });
});

describe('missingPartNumbers', () => {
  it('returns all parts when none uploaded', () => {
    expect(missingPartNumbers(4, [])).toEqual([1, 2, 3, 4]);
  });
  it('skips already-uploaded parts, order preserved', () => {
    expect(missingPartNumbers(5, [1, 2, 4])).toEqual([3, 5]);
  });
  it('returns [] when all uploaded', () => {
    expect(missingPartNumbers(3, [1, 2, 3])).toEqual([]);
  });
  it('ignores out-of-range uploaded parts', () => {
    expect(missingPartNumbers(2, [1, 2, 7])).toEqual([]);
  });
});

describe('bytesForParts', () => {
  it('sums whole parts', () => {
    expect(bytesForParts([1, 2], 10, 100)).toBe(20);
  });
  it('counts a short final part at its real size', () => {
    // 25-byte file, 10-byte parts: part 3 holds only 5 bytes.
    expect(bytesForParts([3], 10, 25)).toBe(5);
    expect(bytesForParts([1, 2, 3], 10, 25)).toBe(25);
  });
  it('is 0 for no parts', () => {
    expect(bytesForParts([], 10, 25)).toBe(0);
  });
  it('never counts past the end of the file', () => {
    expect(bytesForParts([9], 10, 25)).toBe(0);
  });
});

describe('PartBytes', () => {
  it('starts at the resumed byte count', () => {
    expect(new PartBytes(500).total()).toBe(500);
  });

  it('sums in-flight parts rather than letting them overwrite each other', () => {
    const b = new PartBytes(0);
    b.onProgress(1, 100);
    b.onProgress(2, 200);
    expect(b.total()).toBe(300);
  });

  it('replaces a part\'s previous in-flight reading, not adds to it', () => {
    const b = new PartBytes(0);
    b.onProgress(1, 100);
    b.onProgress(1, 250);
    expect(b.total()).toBe(250);
  });

  it('retires a completed part at its exact size', () => {
    const b = new PartBytes(0);
    b.onProgress(1, 900);      // in flight, under-reported
    expect(b.onComplete(1, 1000)).toBe(1000);
  });

  it('handles parts completing out of order', () => {
    const b = new PartBytes(0);
    b.onProgress(1, 500);
    b.onProgress(2, 500);
    b.onProgress(3, 500);
    b.onComplete(3, 1000);
    b.onComplete(1, 1000);
    b.onComplete(2, 1000);
    expect(b.total()).toBe(3000);
  });

  it('stays monotonic across interleaved progress and completion', () => {
    const b = new PartBytes(1000);
    const seen: number[] = [b.total()];
    seen.push(b.onProgress(1, 400));
    seen.push(b.onProgress(2, 400));
    seen.push(b.onComplete(1, 1000));
    seen.push(b.onProgress(3, 200));
    seen.push(b.onComplete(2, 1000));
    seen.push(b.onComplete(3, 1000));
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(seen[seen.length - 1]).toBe(4000);
  });
});

describe('runPool', () => {
  const defer = () => new Promise((r) => setTimeout(r, 0));

  it('runs every item', async () => {
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (n) => { await defer(); done.push(n); });
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await defer();
      inFlight--;
    });
    expect(peak).toBe(4);
  });

  it('does not spawn more workers than items', async () => {
    let peak = 0;
    let inFlight = 0;
    await runPool([1, 2], 8, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await defer();
      inFlight--;
    });
    expect(peak).toBe(2);
  });

  it('resolves immediately on an empty queue', async () => {
    let ran = false;
    await runPool([], 4, async () => { ran = true; });
    expect(ran).toBe(false);
  });

  it('rethrows the first failure', async () => {
    await expect(
      runPool([1, 2, 3], 2, async (n) => {
        await defer();
        if (n === 2) throw new Error('part 2 exploded');
      }),
    ).rejects.toThrow('part 2 exploded');
  });

  it('starts no further items after a failure', async () => {
    const started: number[] = [];
    await expect(
      runPool(Array.from({ length: 20 }, (_, i) => i), 2, async (n) => {
        started.push(n);
        await defer();
        if (n === 0) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Item 0 and its one concurrent sibling start; the rest must be abandoned.
    expect(started.length).toBeLessThan(20);
  });

  it('waits for in-flight items to settle before rethrowing', async () => {
    let settled = 0;
    await expect(
      runPool([1, 2], 2, async (n) => {
        await defer();
        if (n === 1) throw new Error('boom');
        await defer();
        settled++;
      }),
    ).rejects.toThrow('boom');
    expect(settled).toBe(1);
  });

  it('stops pulling work when shouldStop flips', async () => {
    let cancel = false;
    const done: number[] = [];
    await runPool(
      Array.from({ length: 20 }, (_, i) => i),
      2,
      async (n) => { await defer(); done.push(n); if (n === 1) cancel = true; },
      () => cancel,
    );
    expect(done.length).toBeLessThan(20);
    expect(done).toContain(0);
  });

  it('treats a cancel as success, not an error', async () => {
    let cancel = false;
    await expect(
      runPool([1, 2, 3], 1, async () => { await defer(); cancel = true; }, () => cancel),
    ).resolves.toBeUndefined();
  });
});

describe('buildQueueItems', () => {
  const input = { workspace_id: 'ws_1', folder_id: 'fld_root' };
  const f = (name: string) => new File(['abc'], name, { type: 'text/plain' });

  it('keeps each file pointed at its own folder', () => {
    const items = buildQueueItems([
      { file: f('a.txt'), folder_id: 'fld_photos' },
      { file: f('b.txt'), folder_id: null },
      { file: f('c.txt'), folder_id: 'fld_2024' },
    ], input);
    expect(items.map((i) => [i.fileName, i.folder_id])).toEqual([
      ['a.txt', 'fld_photos'],
      ['b.txt', null],
      ['c.txt', 'fld_2024'],
    ]);
  });

  // Ids index into the batch, so a folder tree queued as one batch cannot
  // produce two rows that share an id and overwrite each other in the store.
  it('gives every file in a batch a distinct id', () => {
    const items = buildQueueItems(
      Array.from({ length: 50 }, (_, i) => ({ file: f(`f${i}.txt`), folder_id: `fld_${i % 3}` })),
      input,
    );
    expect(new Set(items.map((i) => i.id)).size).toBe(50);
  });

  it('carries group and status defaults onto every row', () => {
    const [item] = buildQueueItems([{ file: f('a.txt'), folder_id: 'fld_x' }], {
      ...input, group_id: 'grp_1',
    });
    expect(item).toMatchObject({
      group_id: 'grp_1', status: 'queued',
      progress: 0, bytesUploaded: 0, mimeType: 'text/plain', fileSize: 3,
    });
    expect(item).not.toHaveProperty('region');
  });
});

// F3 (field report): pre-screen rejections are queue rows, and one action
// retries every failure.
describe('enqueueRejected', () => {
  it('adds one error row per rejected file, carrying the reason', () => {
    localStorage.clear();
    useUploads.setState({ items: [] });
    enqueueRejected(
      [{ file: new File(['x'], 'a.exe'), reason: 'File type .exe is not allowed in this workspace' }],
      { workspace_id: 'ws_1', folder_id: 'fld_1' },
    );
    const items = useUploads.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].fileName).toBe('a.exe');
    expect(items[0].status).toBe('error');
    expect(items[0].error).toBe('File type .exe is not allowed in this workspace');
    expect(items[0].folder_id).toBe('fld_1');
    expect(items[0].progress).toBe(0);
  });
});

describe('retryAllFailed (runner)', () => {
  it('re-queues failures whose File is still in memory and marks the rest interrupted', () => {
    localStorage.clear();
    useUploads.setState({ items: [] });
    // In memory: the rejected row registered its File with the runner.
    enqueueRejected([{ file: new File(['x'], 'a.exe'), reason: 'nope' }], { workspace_id: 'ws_1', folder_id: null });
    // Not in memory: an error row that survived a reload has no File.
    useUploads.getState().addItems([{
      id: 'ghost', session_id: null, fileName: 'g.txt', fileSize: 1, mimeType: 't', workspace_id: 'ws_1',
      folder_id: null, status: 'error', error: 'Upload failed', progress: 0, bytesUploaded: 0,
      part_size: null, total_parts: null, uploaded_parts: [],
    }]);
    retryAllFailed();
    const byName = Object.fromEntries(useUploads.getState().items.map((i) => [i.fileName, i]));
    // Re-queued - and, since the scheduler wakes synchronously, possibly
    // already picked up. Either way it is no longer a failure.
    expect(['queued', 'uploading']).toContain(byName['a.exe'].status);
    expect(byName['a.exe'].error).toBeUndefined();
    expect(byName['g.txt'].status).toBe('interrupted');
    // Fix round 1, MINOR (a): the parked row keeps the reason it failed.
    expect(byName['g.txt'].error).toBe('Upload failed');
  });
});

// Fix round 1, MINOR (a): the UI needs to know a Retry would do nothing, so
// it can disable the control instead of silently ignoring the click.
describe('canRetry', () => {
  it('is true only while the file\'s bytes are still held in this tab', () => {
    localStorage.clear();
    useUploads.setState({ items: [] });
    enqueueRejected([{ file: new File(['x'], 'a.exe'), reason: 'nope' }], { workspace_id: 'ws_1', folder_id: null });
    const id = useUploads.getState().items[0].id;
    expect(canRetry(id)).toBe(true);
    expect(canRetry('never-queued')).toBe(false);
  });
});

// Where a file lands is the workspace's location, decided server-side. A
// client that still named a region would be asking for one it cannot have -
// the door ignores it, so the client must stop sending it.
describe('initSession', () => {
  it('never puts a region in the init body', async () => {
    localStorage.clear();
    useUploads.setState({ items: [] });
    const bodies: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(String(init?.body ?? ''));
      return { ok: false, status: 500, json: async () => ({ ok: false, error: 'stopped by the test' }) };
    }) as unknown as typeof fetch;
    try {
      enqueue([new File(['x'], 'a.txt')], { workspace_id: 'ws_1', folder_id: 'fld_1' });
      await vi.waitFor(() => expect(bodies).toHaveLength(1));
    } finally {
      globalThis.fetch = realFetch;
    }
    const body = JSON.parse(bodies[0]);
    expect(body).toMatchObject({ workspace_id: 'ws_1', folder_id: 'fld_1', file_name: 'a.txt' });
    expect(body).not.toHaveProperty('region');
  });
});
