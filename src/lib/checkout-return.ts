// Remembers the storage limit from just before a purchase, so the thank-you page
// can show what the purchase added. Checkout leaves the app for Stripe and comes
// back on a fresh page load, so this has to survive a navigation: sessionStorage.

const KEY = 'dosya_storage_before_purchase';
const CHANGE_KEY = 'dosya_plan_change_at';

/** A plan change has no Stripe session to prove it happened, so it is vouched
 *  for here, by the code that just made it, and consumed once on arrival. */
const CHANGE_TTL_MS = 10 * 60 * 1000;

export function rememberPlanChange(): void {
  try {
    sessionStorage.setItem(CHANGE_KEY, String(Date.now()));
  } catch {
    // The thank-you page then sends them to Billing, which shows the same facts.
  }
}

/** True once, for a plan change made in this tab in the last ten minutes. */
export function takeRecentPlanChange(): boolean {
  try {
    const raw = sessionStorage.getItem(CHANGE_KEY);
    sessionStorage.removeItem(CHANGE_KEY);
    const at = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(at) && Date.now() - at < CHANGE_TTL_MS;
  } catch {
    return false;
  }
}

export function rememberStorageBeforePurchase(limitBytes: number): void {
  if (!Number.isFinite(limitBytes) || limitBytes < 0) return;
  try {
    sessionStorage.setItem(KEY, String(Math.floor(limitBytes)));
  } catch {
    // Without it the page shows the new total instead of the difference.
  }
}

/** The remembered limit; null when there is none. */
export function readStorageBeforePurchase(): number | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export function clearStorageBeforePurchase(): void {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(CHANGE_KEY);
  } catch {
    // Best-effort; a stale value is overwritten by the next purchase.
  }
}
