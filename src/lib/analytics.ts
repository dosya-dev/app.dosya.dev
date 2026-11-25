// Google Analytics 4 in the app, behind the marketing site's cookie banner.
//
// The banner on dosya.dev writes `dosya_analytics_consent=1` on `.dosya.dev`
// when a visitor accepts analytics (root src/lib/ga4-consent.ts is the
// contract). The app never asks on its own: no cookie, or any value but "1",
// means nothing here loads and every track* call is a no-op. Without a
// VITE_GA4_MEASUREMENT_ID at build time the module is inert as well.
//
// What is sent, and nothing else: a page_view per route change, sign_up once
// after the form succeeds, checkout_complete when a Stripe checkout returns,
// and the activity events in analytics-events.ts. The acquisition `purchase`
// is NOT sent from here: the API reports a customer's first positive payment
// from the Stripe webhook (apps/api/src/lib/acquisition-event.ts), so that a
// returning customer's new checkout can never count as a new customer and a
// buyer who closes the tab early is still counted. The browser's part is to
// hand the API its Analytics ids and consent (api/attribution.ts). No user
// id, no email, no file names.

import { activityFromApi, downloadEventFromHref, sanitizeAppPath, sizeBand } from './analytics-events';

export const ANALYTICS_CONSENT_COOKIE = 'dosya_analytics_consent';
const MEASUREMENT_ID = /^G-[A-Z0-9]{6,14}$/;
const SCRIPT_HOST = 'https://www.googletagmanager.com';

type Gtag = (...args: unknown[]) => void;
interface GaWindow extends Window { dataLayer?: unknown[]; gtag?: Gtag }

let measurementId: string | null = null;
let loaded = false;

function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(';')) {
    const eq = part.indexOf('=');
    const key = (eq === -1 ? part : part.slice(0, eq)).trim();
    if (key !== name) continue;
    return eq === -1 ? '' : part.slice(eq + 1).trim();
  }
  return null;
}

export function analyticsConsented(cookieString = document.cookie): boolean {
  return readCookie(cookieString, ANALYTICS_CONSENT_COOKIE) === '1';
}

function consentSignals(allowed: boolean) {
  const v = allowed ? 'granted' : 'denied';
  return { analytics_storage: v, ad_storage: v, ad_user_data: v, ad_personalization: 'denied' };
}

function gtag(...args: unknown[]): void {
  const w = window as GaWindow;
  w.dataLayer = w.dataLayer ?? [];
  // gtag.js reads `arguments`; an array literal would be ignored.
  w.dataLayer.push(arguments);
}

/** True once the tag is on the page; the signal the track* helpers key on. */
export function analyticsActive(): boolean {
  return loaded;
}

/**
 * Loads the tag when a build has an id and the visitor has accepted. Safe to
 * call more than once; later calls do nothing. Returns whether it is active.
 */
export function initAnalytics(
  id: string | undefined = import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined,
  cookieString: string = document.cookie,
): boolean {
  if (loaded) return true;
  if (!id || !MEASUREMENT_ID.test(id) || !analyticsConsented(cookieString)) return false;
  measurementId = id;
  const w = window as GaWindow;
  w.gtag = gtag;
  gtag('consent', 'default', { ...consentSignals(true), wait_for_update: 0 });
  gtag('js', new Date());
  gtag('config', id, {
    // The app sends its own page_view per route change (trackPageView), so
    // the tag's automatic one on load would double the first page.
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    // Same cookie as dosya.dev: a visit that starts on the pricing page and
    // ends with a paid plan here is one session.
    cookie_domain: 'dosya.dev',
    cookie_flags: 'SameSite=Lax;Secure',
  });
  const s = document.createElement('script');
  s.async = true;
  s.src = `${SCRIPT_HOST}/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  loaded = true;
  return true;
}

/** Path only, with ids replaced: a share token, a file id or a search term never leaves the app. */
export function trackPageView(pathname: string): void {
  if (!loaded || !measurementId) return;
  const path = sanitizeAppPath(pathname);
  gtag('event', 'page_view', {
    page_location: `${location.origin}${path}`,
    page_path: path,
    page_title: document.title,
  });
}

/** Any named activity. Params are categories and figures, never names or ids. */
export function trackEvent(name: string, params?: Record<string, string | number | boolean>): void {
  if (!loaded) return;
  gtag('event', name, params ?? {});
}

/** Called by api() after a successful request; a no-op for reads. */
export function recordApiActivity(method: string | undefined, path: string): void {
  if (!loaded) return;
  const activity = activityFromApi(method, path);
  if (activity) gtag('event', activity.name, activity.params ?? {});
}

/** A finished upload, by size band only. */
export function trackUpload(bytes: number): void {
  trackEvent('file_upload', { size_band: sizeBand(bytes) });
}

let listenersInstalled = false;
/**
 * Clicks the API never sees: a download link opens the file straight from the
 * API, so the anchor is the only place to count it. One delegated listener;
 * installed once, after analytics is active.
 */
export function installActivityListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  document.addEventListener('click', (event) => {
    if (!loaded) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]');
    if (!anchor) return;
    const activity = downloadEventFromHref((anchor as HTMLAnchorElement).href);
    if (activity) gtag('event', activity.name, activity.params ?? {});
  }, { capture: true, passive: true });
}

export function trackSignUp(method: 'password' | 'google' | 'apple' | 'passkey' = 'password'): void {
  if (!loaded) return;
  gtag('event', 'sign_up', { method });
}

export interface CheckoutFacts {
  planId?: string;
  interval?: 'month' | 'year';
  currency: string;
  /** Minor units, as Stripe reports them; 0 for a trial start. */
  amountCents: number;
  trial: boolean;
}

/**
 * A Stripe checkout came back to the thank-you page. Sent for every
 * checkout, including a returning customer's and a trial start, so it is a
 * funnel step, never the acquisition itself (see the header). Not imported
 * into Google Ads.
 */
export function trackCheckoutComplete(facts: CheckoutFacts): void {
  if (!loaded) return;
  gtag('event', 'checkout_complete', {
    plan_id: facts.planId ?? 'plan',
    interval: facts.interval ?? 'unknown',
    currency: facts.currency.toUpperCase(),
    value: Math.round(facts.amountCents) / 100,
    trial: facts.trial,
  });
}

export interface AnalyticsIds { clientId: string; sessionId: string }

/**
 * The tag's own client and session ids, through gtag's documented `get`
 * interface rather than by parsing its cookies. Resolves null when analytics
 * is off, or when the tag has not answered within a moment (it never answers
 * while the script is blocked), so callers can carry on without it.
 */
export function getAnalyticsIds(timeoutMs = 1500): Promise<AnalyticsIds | null> {
  if (!loaded || !measurementId) return Promise.resolve(null);
  return new Promise((resolve) => {
    let clientId: unknown;
    let sessionId: unknown;
    let answered = 0;
    const done = () => {
      if (++answered < 2) return;
      clearTimeout(timer);
      resolve(typeof clientId === 'string' && clientId && sessionId !== undefined && sessionId !== null
        ? { clientId, sessionId: String(sessionId) }
        : null);
    };
    const timer = setTimeout(() => resolve(null), timeoutMs);
    gtag('get', measurementId, 'client_id', (v: unknown) => { clientId = v; done(); });
    gtag('get', measurementId, 'session_id', (v: unknown) => { sessionId = v; done(); });
  });
}

/** Test seam: forgets the loaded state. */
export function __resetAnalyticsForTests(): void {
  loaded = false;
  measurementId = null;
  listenersInstalled = false;
  const w = window as GaWindow;
  delete w.dataLayer;
  delete w.gtag;
}
