import { describe, it, expect, vi } from "vitest";

vi.mock("@/api/client", () => ({ API_BASE: "https://api.example.com" }));

const { createHeicCache, heicCacheKey } = await import("./heic-cache");

/** A decoder we can resolve by hand, so we can observe concurrency precisely. */
function controllableDecoder() {
  const calls: string[] = [];
  const resolvers: Array<(b: Blob) => void> = [];
  let active = 0;
  let peak = 0;
  const decoder = (url: string) => {
    calls.push(url);
    active++;
    peak = Math.max(peak, active);
    return new Promise<Blob>((resolve) => {
      resolvers.push((b) => {
        active--;
        resolve(b);
      });
    });
  };
  return {
    decoder,
    calls,
    get peak() { return peak; },
    async resolveAll() {
      // Drain in waves: resolving the current batch may (via the cache's
      // internal release-on-completion) admit queued work that calls the
      // decoder again and pushes new resolvers. Those pushes happen inside
      // the *next* microtask tick (promise reactions are never synchronous
      // with the resolve() call that triggers them), so we must yield with
      // `await` between waves to let them land before checking again.
      while (resolvers.length) {
        const batch = resolvers.splice(0, resolvers.length);
        for (const r of batch) r(new Blob(["x"]));
        await Promise.resolve();
      }
    },
  };
}

function urlStubs() {
  let n = 0;
  const revoked: string[] = [];
  return {
    createUrl: () => `blob:${++n}`,
    revokeUrl: (u: string) => { revoked.push(u); },
    revoked,
  };
}

describe("heicCacheKey", () => {
  it("varies on file, version and maxDim", () => {
    const base = { fileId: "f1", maxDim: 256 };
    expect(heicCacheKey(base)).toBe(heicCacheKey({ ...base }));
    expect(heicCacheKey(base)).not.toBe(heicCacheKey({ ...base, maxDim: 2048 }));
    expect(heicCacheKey(base)).not.toBe(heicCacheKey({ ...base, version: 2 }));
    expect(heicCacheKey(base)).not.toBe(heicCacheKey({ ...base, fileId: "f2" }));
  });
});

describe("createHeicCache", () => {
  it("decodes once and caches the result", async () => {
    const d = controllableDecoder();
    const cache = createHeicCache({ decoder: d.decoder, ...urlStubs() });

    const p = cache.get({ fileId: "f1", maxDim: 256 });
    d.resolveAll();
    const first = await p;

    const second = await cache.get({ fileId: "f1", maxDim: 256 });

    expect(first).toBe(second);
    expect(d.calls).toHaveLength(1);
  });

  it("dedupes concurrent requests for the same file (grid + panel + lightbox)", async () => {
    const d = controllableDecoder();
    const cache = createHeicCache({ decoder: d.decoder, ...urlStubs() });

    const a = cache.get({ fileId: "f1", maxDim: 256 });
    const b = cache.get({ fileId: "f1", maxDim: 256 });
    const c = cache.get({ fileId: "f1", maxDim: 256 });
    d.resolveAll();

    expect(await a).toBe(await b);
    expect(await b).toBe(await c);
    expect(d.calls).toHaveLength(1);
  });

  it("treats a different maxDim as a different entry", async () => {
    const d = controllableDecoder();
    const cache = createHeicCache({ decoder: d.decoder, ...urlStubs() });

    const a = cache.get({ fileId: "f1", maxDim: 256 });
    const b = cache.get({ fileId: "f1", maxDim: 2048 });
    d.resolveAll();
    await Promise.all([a, b]);

    expect(d.calls).toHaveLength(2);
  });

  it("never runs more than `concurrency` decodes at once", async () => {
    const d = controllableDecoder();
    const cache = createHeicCache({ decoder: d.decoder, concurrency: 2, ...urlStubs() });

    const all = Array.from({ length: 10 }, (_, i) =>
      cache.get({ fileId: `f${i}`, maxDim: 256 }),
    );
    // Only `concurrency` may have started before anything resolves.
    expect(d.calls).toHaveLength(2);

    d.resolveAll();
    await Promise.all(all);

    expect(d.peak).toBeLessThanOrEqual(2);
    expect(d.calls).toHaveLength(10);
  });

  it("evicts the least-recently-used entry AND revokes its object URL", async () => {
    const d = controllableDecoder();
    const u = urlStubs();
    const cache = createHeicCache({ decoder: d.decoder, maxEntries: 2, ...u });

    const a = cache.get({ fileId: "f1", maxDim: 256 });
    const b = cache.get({ fileId: "f2", maxDim: 256 });
    d.resolveAll();
    const urlA = await a;
    await b;

    // Touch f1 so f2 becomes the least-recently-used.
    await cache.get({ fileId: "f1", maxDim: 256 });

    const c = cache.get({ fileId: "f3", maxDim: 256 });
    d.resolveAll();
    await c;

    expect(cache.size()).toBe(2);
    expect(u.revoked).toEqual(["blob:2"]); // f2 evicted, not f1
    expect(await cache.get({ fileId: "f1", maxDim: 256 })).toBe(urlA); // f1 still cached
  });

  it("does not cache failures, and a later call can retry", async () => {
    let attempt = 0;
    const decoder = () => {
      attempt++;
      return attempt === 1
        ? Promise.reject(new Error("corrupt"))
        : Promise.resolve(new Blob(["ok"]));
    };
    const cache = createHeicCache({ decoder, ...urlStubs() });

    await expect(cache.get({ fileId: "f1", maxDim: 256 })).rejects.toThrow("corrupt");
    await expect(cache.get({ fileId: "f1", maxDim: 256 })).resolves.toBe("blob:1");
    expect(attempt).toBe(2);
  });

  it("releases its concurrency slot when a decode fails", async () => {
    const decoder = vi.fn().mockRejectedValue(new Error("boom"));
    const cache = createHeicCache({ decoder, concurrency: 1, ...urlStubs() });

    await expect(cache.get({ fileId: "f1", maxDim: 256 })).rejects.toThrow("boom");
    // If the slot leaked, this second call would hang forever rather than reject.
    await expect(cache.get({ fileId: "f2", maxDim: 256 })).rejects.toThrow("boom");
    expect(decoder).toHaveBeenCalledTimes(2);
  });
});
