import { describe, it, expect, vi } from "vitest";

import { createHeicPool, type PoolWorker } from "./heic-pool";

/** A fake worker whose message flow we drive by hand from the test. */
interface FakeWorker extends PoolWorker {
  posted: Array<{ id: number; url: string; maxDim: number }>;
}

function fakeWorkerFactory() {
  const workers: FakeWorker[] = [];
  const spawn = (): PoolWorker => {
    const w: FakeWorker = {
      posted: [],
      postMessage: vi.fn((msg: unknown) => {
        w.posted.push(msg as { id: number; url: string; maxDim: number });
      }),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
      onmessageerror: null,
    };
    workers.push(w);
    return w;
  };
  return { spawn, workers };
}

function reply(w: FakeWorker, id: number, blob: Blob) {
  w.onmessage?.({ data: { id, blob } });
}

function replyError(w: FakeWorker, id: number, error: string) {
  w.onmessage?.({ data: { id, error } });
}

describe("createHeicPool", () => {
  it("spawns no workers until the first request, and never exceeds size", async () => {
    const f = fakeWorkerFactory();
    const pool = createHeicPool({ spawn: f.spawn, size: 4 });

    expect(f.workers).toHaveLength(0);

    const promises = Array.from({ length: 6 }, (_, i) => pool.decode(`u${i}`, 256));
    // Only up to `size` workers may ever be spawned, even though 6 requests came in.
    expect(f.workers.length).toBeLessThanOrEqual(4);
    expect(f.workers).toHaveLength(4);

    // Drain everything, including follow-up jobs the pool dispatches onto a
    // worker as soon as it frees up. Bounded rounds so a stuck pool fails
    // the assertion below instead of hanging the test.
    const repliedCount = new Map<FakeWorker, number>();
    let totalReplied = 0;
    for (let round = 0; round < 10 && totalReplied < 6; round++) {
      for (const w of f.workers) {
        const done = repliedCount.get(w) ?? 0;
        if (w.posted.length > done) {
          reply(w, w.posted[done].id, new Blob([w.posted[done].url]));
          repliedCount.set(w, done + 1);
          totalReplied++;
        }
      }
    }
    expect(totalReplied).toBe(6);
    await Promise.all(promises);
  });

  it("parallelizes: 4 concurrent requests with size 4 occupy 4 distinct workers at once", async () => {
    const f = fakeWorkerFactory();
    const pool = createHeicPool({ spawn: f.spawn, size: 4 });

    const promises = Array.from({ length: 4 }, (_, i) => pool.decode(`u${i}`, 256));

    // The whole point: all 4 requests must be in flight on 4 DIFFERENT workers
    // at the same time, not queued behind one worker.
    expect(f.workers).toHaveLength(4);
    for (const w of f.workers) {
      expect(w.posted).toHaveLength(1);
    }
    // Each worker holds a distinct request id.
    const ids = f.workers.map((w) => w.posted[0].id);
    expect(new Set(ids).size).toBe(4);

    f.workers.forEach((w, i) => reply(w, w.posted[0].id, new Blob([`b${i}`])));
    await Promise.all(promises);
  });

  it("queues a request when all workers are busy, then dispatches it once one frees", async () => {
    const f = fakeWorkerFactory();
    const pool = createHeicPool({ spawn: f.spawn, size: 2 });

    const p1 = pool.decode("u1", 256);
    const p2 = pool.decode("u2", 256);
    expect(f.workers).toHaveLength(2);

    const p3 = pool.decode("u3", 256);
    // Still only 2 workers — the pool is at capacity, so the 3rd request queues
    // instead of spawning a 3rd worker.
    expect(f.workers).toHaveLength(2);
    expect(f.workers[0].posted).toHaveLength(1);
    expect(f.workers[1].posted).toHaveLength(1);

    // Free worker 0; the queued request should land on it.
    reply(f.workers[0], f.workers[0].posted[0].id, new Blob(["b1"]));
    await p1;
    expect(f.workers[0].posted).toHaveLength(2);
    expect(f.workers[0].posted[1].url).toBe("u3");

    reply(f.workers[0], f.workers[0].posted[1].id, new Blob(["b3"]));
    reply(f.workers[1], f.workers[1].posted[0].id, new Blob(["b2"]));
    await Promise.all([p2, p3]);
  });

  it("correlates replies to the right caller by id, even resolved out of order", async () => {
    const f = fakeWorkerFactory();
    const pool = createHeicPool({ spawn: f.spawn, size: 2 });

    const pA = pool.decode("a", 256);
    const pB = pool.decode("b", 256);
    expect(f.workers).toHaveLength(2);

    const idA = f.workers[0].posted[0].id;
    const idB = f.workers[1].posted[0].id;
    const blobA = new Blob(["A"]);
    const blobB = new Blob(["B"]);

    // Resolve B's worker first, then A's — out of order.
    reply(f.workers[1], idB, blobB);
    reply(f.workers[0], idA, blobA);

    const [resultA, resultB] = await Promise.all([pA, pB]);
    expect(resultA).toBe(blobA);
    expect(resultB).toBe(blobB);
  });

  it("on worker onerror, rejects its in-flight request, terminates it, and keeps serving new requests", async () => {
    const f = fakeWorkerFactory();
    const pool = createHeicPool({ spawn: f.spawn, size: 1 });

    const p1 = pool.decode("u1", 256);
    expect(f.workers).toHaveLength(1);
    const dead = f.workers[0];

    dead.onerror?.(new Event("error"));

    await expect(p1).rejects.toThrow();
    expect(dead.terminate).toHaveBeenCalledTimes(1);

    // A later request must spawn a fresh worker (the dead one was removed) and succeed.
    const p2 = pool.decode("u2", 256);
    expect(f.workers).toHaveLength(2);
    const fresh = f.workers[1];
    expect(fresh).not.toBe(dead);
    reply(fresh, fresh.posted[0].id, new Blob(["ok"]));
    await expect(p2).resolves.toBeInstanceOf(Blob);
  });

  it("onmessageerror on a worker rejects its in-flight request and removes the worker", async () => {
    const f = fakeWorkerFactory();
    const pool = createHeicPool({ spawn: f.spawn, size: 1 });

    const p1 = pool.decode("u1", 256);
    const dead = f.workers[0];
    dead.onmessageerror?.(new Event("messageerror"));

    await expect(p1).rejects.toThrow();
    expect(dead.terminate).toHaveBeenCalledTimes(1);
  });

  it("a rejected decode frees its worker so subsequent requests don't hang (size + 1 requests, first fails)", async () => {
    const f = fakeWorkerFactory();
    const size = 3;
    const pool = createHeicPool({ spawn: f.spawn, size });

    const promises = Array.from({ length: size + 1 }, (_, i) => pool.decode(`u${i}`, 256));
    expect(f.workers).toHaveLength(size);

    // Fail the first job (a normal decode error reply, not a worker crash).
    replyError(f.workers[0], f.workers[0].posted[0].id, "boom");

    // The 4th (queued) request should now be dispatched onto the freed worker 0.
    expect(f.workers[0].posted).toHaveLength(2);

    // Resolve everything else so nothing hangs.
    reply(f.workers[0], f.workers[0].posted[1].id, new Blob(["last"]));
    reply(f.workers[1], f.workers[1].posted[0].id, new Blob(["b1"]));
    reply(f.workers[2], f.workers[2].posted[0].id, new Blob(["b2"]));

    await expect(promises[0]).rejects.toThrow("boom");
    await expect(Promise.all(promises.slice(1))).resolves.toHaveLength(size);
  });

  it("exposes the configured size", () => {
    const f = fakeWorkerFactory();
    const pool = createHeicPool({ spawn: f.spawn, size: 4 });
    expect(pool.size).toBe(4);
  });
});
