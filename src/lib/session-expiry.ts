/**
 * Sends a signed-in tab to /login once its session is gone.
 *
 * Only the dashboard's boot gate used to ask whether the session was alive,
 * and it asks once, on mount. Sign out in one tab and the other tab kept
 * rendering the dashboard: every later request answered 401, api() threw, and
 * the page showed its "Try again" error state for a session that no retry
 * could bring back.
 *
 * Two triggers now reach the same check:
 * - any api() call answering 401 (api/client.ts calls notifyUnauthorized), and
 * - a logout in another tab of this browser (broadcastLogout, sent by
 *   lib/logout.ts once the server has dropped the cookie).
 *
 * A 401 alone is not proof the session is gone: the API also answers 401 for
 * a wrong share code or a wrong password, so the trigger re-asks GET /api/me
 * and only a 401 there redirects. Concurrent 401s (a page fires several
 * requests at once) share that one check.
 *
 * Same pub/sub shape as maintenance-signal.ts, for the same reason: the API
 * client must not import the session store or the router.
 */

const CHANNEL_NAME = 'dosya-auth';
const LOGOUT_MESSAGE = 'logout';

export interface SessionExpiryDeps {
  /** Status of GET /api/me. Anything but 401 leaves the tab alone. */
  verify: () => Promise<number>;
  /** Called at most once per install, when the session is confirmed gone. */
  onExpired: () => void;
}

let trigger: (() => void) | null = null;

/** The sign-in endpoints answer 401 for a wrong password or code, not for a dead session. */
function isAuthPath(path: string): boolean {
  return path.startsWith('/api/auth/');
}

/** Called by api() for every 401 response. */
export function notifyUnauthorized(path: string): void {
  if (isAuthPath(path)) return;
  trigger?.();
}

function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

/** Tells this browser's other tabs that the user signed out. */
export function broadcastLogout(): void {
  const channel = openChannel();
  if (!channel) return;
  try {
    channel.postMessage(LOGOUT_MESSAGE);
  } finally {
    channel.close();
  }
}

/**
 * Starts watching, for as long as a signed-in surface is mounted. Returns the
 * cleanup. Only one watch is live at a time; a later install replaces it.
 */
export function watchSessionExpiry(deps: SessionExpiryDeps): () => void {
  let checking: Promise<void> | null = null;
  let done = false;

  const check = () => {
    if (done || checking) return;
    checking = deps
      .verify()
      .then((status) => {
        if (status === 401 && !done) {
          done = true;
          deps.onExpired();
        }
      })
      // A network failure says nothing about the session; the next 401 asks again.
      .catch(() => {})
      .finally(() => {
        checking = null;
      });
  };

  trigger = check;
  const channel = openChannel();
  const onMessage = (e: MessageEvent) => {
    if (e.data === LOGOUT_MESSAGE) check();
  };
  channel?.addEventListener('message', onMessage);

  return () => {
    done = true;
    if (trigger === check) trigger = null;
    channel?.removeEventListener('message', onMessage);
    channel?.close();
  };
}
