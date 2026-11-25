import { api } from './client';
import { analyticsActive, analyticsConsented, getAnalyticsIds } from '@/lib/analytics';

/**
 * Tells the API what this browser knows about its Google Analytics identity
 * and whether the visitor accepted analytics (POST /api/me/analytics-attribution).
 *
 * The API reports a customer's first positive payment to Analytics from the
 * Stripe webhook, and reads this record immediately before every delivery
 * attempt. So the write at checkout start is what makes a later first
 * payment attributable, and the write on every app load while signed in is
 * what lets a withdrawn consent win over the state at checkout.
 *
 * Idempotent on the wire: the last body sent is remembered per browser and a
 * repeat of it is not sent again, except when `force` is set (checkout
 * start, where a fresh session id matters).
 */
const LAST_KEY = 'dosya_ga_attribution_sent'; // gitleaks:allow - localStorage key name

export interface AttributionBody {
  ga_client_id?: string;
  ga_session_id?: string;
  analytics_consent: boolean;
}

export async function buildAttribution(): Promise<AttributionBody> {
  const consent = analyticsConsented();
  if (!consent || !analyticsActive()) return { analytics_consent: consent };
  const ids = await getAnalyticsIds();
  return ids ? { ga_client_id: ids.clientId, ga_session_id: ids.sessionId, analytics_consent: true } : { analytics_consent: true };
}

export async function syncAnalyticsAttribution(force = false): Promise<boolean> {
  const body = await buildAttribution();
  const encoded = JSON.stringify(body);
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_KEY); } catch { /* storage blocked: send every time */ }
  if (!force && last === encoded) return false;
  await api<undefined>('/api/me/analytics-attribution', { method: 'POST', body: encoded });
  try { localStorage.setItem(LAST_KEY, encoded); } catch { /* measurement is optional */ }
  return true;
}
