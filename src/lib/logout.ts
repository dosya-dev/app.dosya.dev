import { cancelAll } from './upload-runner';
import { useUploads } from '@/stores/uploads';
import { clearShareDefaultsCache } from './share-defaults';
import { clearAllRecents } from './search/recent';
import { API_BASE } from '@/api/client';
import { broadcastLogout } from './session-expiry';

/**
 * Logout with full client teardown, landing on `to`.
 *
 * Kills in-flight uploads and forgets this account's upload history BEFORE
 * leaving - localStorage survives the redirect, and the dock would rehydrate
 * the previous account's items for whoever logs in next. The redirect always
 * happens, even if the server call fails: the client state is already
 * destroyed, so staying logged-in-looking would be worse.
 *
 * `to` is required, and deliberately so. Making it optional on
 * logoutAndRedirect instead would have been a quieter change and a worse one:
 * that function is passed by reference as a click handler (MaintenanceScreen's
 * `onSignOut`, create-workspace's footer button), React calls a handler with
 * the event, and `(to?: string) => …` is assignable to `() => void` - so the
 * event would have arrived as the destination with nothing to catch it.
 */
export async function logoutAndRedirectTo(to: string): Promise<void> {
  clearClientSession();
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // best-effort - cookie invalidation can fail offline; redirect regardless
  }
  // After the server call, so the other tabs' /api/me check sees the cookie gone.
  broadcastLogout();
  window.location.href = to;
}

/**
 * The client half of a logout: everything this account left in the tab.
 * Also run when another tab's logout (or an expired session) sends this tab
 * to /login, where the server half has already happened.
 */
export function clearClientSession(): void {
  cancelAll();
  useUploads.getState().reset();
  // Per-account memos must not outlive the account: the next person to sign in
  // on this browser may be a member of the same workspace with a different
  // answer, or of no workspace at all.
  clearShareDefaultsCache();
  clearAllRecents();
}

/** Logout, landing on the login page. The default for every signed-in surface. */
export function logoutAndRedirect(): Promise<void> {
  return logoutAndRedirectTo('/login');
}
