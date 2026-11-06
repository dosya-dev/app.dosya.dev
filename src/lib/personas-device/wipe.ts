// Sign-out and Vault destroy: remove the user's cached personas key and sealed
// snapshots from this browser. Kept apart from engine-host so the logout path
// loads the ports (and so the engine package) only when it runs. The
// per-browser wrapping key stays: it protects nothing without a record.
import type { IdbFactoryLike } from './idb';

const WIPE_TIMEOUT_MS = 2000;

/**
 * Best effort and never throws: storage that is missing, blocked or slow must
 * not stop a sign-out. Gives up after two seconds so a redirect is not held.
 */
export async function wipePersonasDevice(userId: string | null, idb?: IdbFactoryLike): Promise<void> {
  if (!userId) return;
  const work = (async () => {
    const { webKeyStore, webLocalCache } = await import('./ports');
    await Promise.allSettled([webKeyStore(idb).clear(userId), webLocalCache(idb).clear(userId)]);
  })().catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, WIPE_TIMEOUT_MS);
  });
  try {
    await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "Turn off and delete" just succeeded in one workspace: if this device holds
 * no snapshot for any other workspace of the user, remove the cached key too
 * (the server key stays; the next turn-on asks for the Vault once). Never throws.
 */
export async function clearKeyIfLastWorkspace(userId: string | null, idb?: IdbFactoryLike): Promise<void> {
  if (!userId) return;
  try {
    const { hasSnapshots, webKeyStore } = await import('./ports');
    if (!(await hasSnapshots(userId, idb))) await webKeyStore(idb).clear(userId);
  } catch {
    // best effort
  }
}
