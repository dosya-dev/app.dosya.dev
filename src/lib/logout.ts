import { cancelAll } from './upload-runner';
import { useUploads } from '@/stores/uploads';
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
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // best-effort - cookie invalidation can fail offline; redirect regardless
  }
  window.location.href = '/login';
}
