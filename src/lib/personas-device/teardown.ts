// Sign-out hook for on-device Personas, kept apart from engine-host so the
// logout path does not pull the engine into the main bundle. engine-host
// registers its teardown when it loads.
const fns = new Set<() => void>();
let tornDown = false;

/** True from a sign-out teardown until the session's user changes: no engine may be made meanwhile. */
export function personasTornDown(): boolean {
  return tornDown;
}

/** The session's user changed (signed out, or someone signed in): engines may be made again. */
export function resumePersonas(): void {
  tornDown = false;
}

export function onPersonasTeardown(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}

/**
 * Stop every read loop, the reader worker and the listing cache without
 * barring new engines (Vault destroy: the user stays signed in and may set the
 * Vault up again).
 */
export function stopPersonas(): void {
  for (const fn of [...fns]) {
    try {
      fn();
    } catch {
      // best effort
    }
  }
}

/** Stop everything and make no new engine until the session's user changes (sign-out). */
export function teardownPersonas(): void {
  tornDown = true;
  stopPersonas();
}

