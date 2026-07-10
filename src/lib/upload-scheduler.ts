export interface SchedulerDeps {
  /** ids of items currently eligible to start (status 'queued'), in order. */
  getQueuedIds: () => string[];
  /** effective max concurrent uploads right now. */
  getConcurrency: () => number;
  /** perform one upload; must move the id out of getQueuedIds() before its first await. */
  runOne: (id: string) => Promise<void>;
}

export interface Scheduler {
  wake: () => void;
  inFlightCount: () => number;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const inFlight = new Set<string>();
  let pumping = false;

  function pump() {
    // Guard against re-entrancy: a synchronous runOne + resolved finally could
    // otherwise recurse into pump() while we're still inside the loop.
    if (pumping) return;
    pumping = true;
    try {
      while (inFlight.size < deps.getConcurrency()) {
        const next = deps.getQueuedIds().find((id) => !inFlight.has(id));
        if (!next) break;
        inFlight.add(next);
        deps
          .runOne(next)
          .catch(() => { /* runOne records its own error state */ })
          .finally(() => {
            inFlight.delete(next);
            pump();
          });
      }
    } finally {
      pumping = false;
    }
  }

  return { wake: pump, inFlightCount: () => inFlight.size };
}
