import { describe, it, expect } from 'vitest';
import { createScheduler } from './upload-scheduler';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createScheduler', () => {
  it('never exceeds the concurrency cap and promotes as slots free', async () => {
    const queue = ['a', 'b', 'c', 'd', 'e'];
    const started: string[] = [];
    const defs = new Map<string, ReturnType<typeof deferred>>();
    let active = 0, peak = 0;

    const sched = createScheduler({
      // an id leaves the queue as soon as it starts
      getQueuedIds: () => queue.filter((id) => !started.includes(id)),
      getConcurrency: () => 2,
      runOne: (id) => {
        started.push(id);
        active++; peak = Math.max(peak, active);
        const d = deferred();
        defs.set(id, d);
        return d.promise.finally(() => { active--; });
      },
    });

    sched.wake();
    expect(sched.inFlightCount()).toBe(2);
    expect(started).toEqual(['a', 'b']);

    defs.get('a')!.resolve();
    await flush();
    expect(started).toContain('c');
    expect(sched.inFlightCount()).toBe(2);

    // Drain: resolve everything currently started-and-pending, flush so the
    // scheduler can promote the rest, and repeat until the queue is exhausted.
    // (Resolving an already-settled deferred is a no-op. This avoids resolving
    // ids by name before they've been promoted — which would strand their
    // not-yet-created deferreds and leave them in-flight forever.)
    while (sched.inFlightCount() > 0) {
      for (const id of [...started]) defs.get(id)!.resolve();
      await flush();
    }

    expect(peak).toBe(2);
    expect([...started].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(sched.inFlightCount()).toBe(0);
  });

  it('keeps going when a runOne rejects', async () => {
    const queue = ['a', 'b'];
    const started: string[] = [];
    const sched = createScheduler({
      getQueuedIds: () => queue.filter((id) => !started.includes(id)),
      getConcurrency: () => 1,
      runOne: (id) => { started.push(id); return Promise.reject(new Error('boom')); },
    });
    sched.wake();
    await flush();
    expect(started).toEqual(['a', 'b']);
    expect(sched.inFlightCount()).toBe(0);
  });

  it('does not start the same id twice while it is in flight', () => {
    // 'a' stays queued even after starting (runOne does NOT remove it), so the
    // scheduler's own inFlight guard is the only thing preventing a second
    // concurrent start. Two synchronous wake() calls must still start it once.
    const started: string[] = [];
    const d = deferred();
    const sched = createScheduler({
      getQueuedIds: () => ['a'],
      getConcurrency: () => 3,
      runOne: (id) => { started.push(id); return d.promise; },
    });
    sched.wake();
    sched.wake();
    expect(started).toEqual(['a']);
    expect(sched.inFlightCount()).toBe(1);
    // `d` is intentionally left unresolved. Resolving it would let the
    // scheduler correctly re-promote the still-queued 'a' (since this fixture
    // never removes it) — a different behavior that isn't this test's subject,
    // and one that, combined with a reused settled promise, would loop forever.
  });
});
