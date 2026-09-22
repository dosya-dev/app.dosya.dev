import { cancelAll } from './upload-runner';
import { useUploads } from '@/stores/uploads';
import { clearShareDefaultsCache } from './share-defaults';
import { API_BASE } from '@/api/client';

/**
 * Logout with full client teardown. Kills in-flight uploads and forgets this
 * account's upload history BEFORE leaving - localStorage survives the
 * redirect, and the dock would rehydrate the previous account's items for
 * whoever logs in next. The redirect always happens, even if the server call
 * fails: the client state is already destroyed, so staying logged-in-looking
 * would be worse.
 */
export async function logoutAndRedirect(): Promise<void> {
  cancelAll();
  useUploads.getState().reset();
  // Per-account memos must not outlive the account: the next person to sign in
  // on this browser may be a member of the same workspace with a different
  // answer, or of no workspace at all.
  clearShareDefaultsCache();
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // best-effort - cookie invalidation can fail offline; redirect regardless
  }
  window.location.href = '/login';
}
