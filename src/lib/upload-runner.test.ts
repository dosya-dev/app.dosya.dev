import { describe, it, expect } from 'vitest';
import { missingPartNumbers, bytesForParts, PartBytes, runPool } from './upload-runner';

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
