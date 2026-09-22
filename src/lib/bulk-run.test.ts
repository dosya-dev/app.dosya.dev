import { describe, it, expect } from 'vitest';
import { runBulk, chunkSelection } from './bulk-run';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('runBulk', () => {
  it('returns zero counts for an empty list without calling the task', async () => {
    let calls = 0;
    const r = await runBulk([], async () => { calls++; });
    expect(r).toEqual({ ok: 0, fail: 0, results: [] });
    expect(calls).toBe(0);
  });

  it('runs every item and counts successes', async () => {
    const seen: number[] = [];
    const r = await runBulk([1, 2, 3, 4, 5], async (n) => { seen.push(n); return n * 2; });
    expect(r.ok).toBe(5);
    expect(r.fail).toBe(0);
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('counts rejections as failures without aborting the rest', async () => {
    const r = await runBulk([1, 2, 3, 4], async (n) => {
      if (n % 2 === 0) throw new Error('nope');
      return n;
    });
    expect(r.ok).toBe(2);
    expect(r.fail).toBe(2);
  });

  it('keeps results aligned with the input order, with null for failures', async () => {
    const r = await runBulk([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('nope');
      return `v${n}`;
    });
    expect(r.results).toEqual(['v1', null, 'v3']);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await runBulk(
      Array.from({ length: 20 }, (_, i) => i),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight--;
      },
      4,
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // actually parallel, not sequential
  });

  it('runs in parallel rather than sequentially', async () => {
    // 8 items each awaiting a macrotask: sequential would need 8 rounds,
    // a pool of 8 needs one.
    let rounds = 0;
    await runBulk(
      Array.from({ length: 8 }, (_, i) => i),
      async () => { rounds++; await tick(); },
      8,
    );
    expect(rounds).toBe(8);
  });

  it('calls onItemDone once per settled item, including failures', async () => {
    let done = 0;
    const r = await runBulk(
      [1, 2, 3, 4],
      async (n) => { if (n % 2 === 0) throw new Error('nope'); return n; },
      2,
      { onItemDone: () => { done++; } },
    );
    expect(done).toBe(4);
    expect(r.ok).toBe(2);
    expect(r.fail).toBe(2);
  });

  it('stops starting new items once shouldStop returns true', async () => {
    let settled = 0;
    const r = await runBulk(
      [1, 2, 3, 4],
      async (n) => { settled++; return `v${n}`; },
      1,
      { shouldStop: () => settled >= 2 },
    );
    expect(r.ok).toBe(2);
    expect(r.fail).toBe(0);
    expect(r.results).toEqual(['v1', 'v2', null, null]);
  });

  it('does not call onItemDone for items skipped by shouldStop', async () => {
    let done = 0;
    await runBulk(
      [1, 2, 3],
      async () => {},
      1,
      { shouldStop: () => done >= 1, onItemDone: () => { done++; } },
    );
    expect(done).toBe(1);
  });

  it('treats a non-positive limit as one at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    await runBulk([1, 2, 3], async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
    }, 0);
    expect(peak).toBe(1);
  });
});

describe('chunkSelection', () => {
  it('returns no chunks for an empty selection', () => {
    expect(chunkSelection([], [], 20)).toEqual([]);
  });

  it('caps each chunk at the given combined size', () => {
    const files = ['f1', 'f2', 'f3'];
    const folders = ['d1', 'd2', 'd3'];
    const chunks = chunkSelection(files, folders, 4);
    expect(chunks.length).toBe(2);
    for (const c of chunks) {
      expect(c.file_ids.length + c.folder_ids.length).toBeLessThanOrEqual(4);
    }
  });

  it('preserves every id exactly once, files before folders, in order', () => {
    const files = ['f1', 'f2', 'f3'];
    const folders = ['d1', 'd2'];
    const chunks = chunkSelection(files, folders, 2);
    expect(chunks.flatMap((c) => [...c.file_ids, ...c.folder_ids]))
      .toEqual(['f1', 'f2', 'f3', 'd1', 'd2']);
  });

  it('puts a selection smaller than the size in a single chunk', () => {
    expect(chunkSelection(['f1'], ['d1'], 20)).toEqual([
      { file_ids: ['f1'], folder_ids: ['d1'] },
    ]);
  });
});
