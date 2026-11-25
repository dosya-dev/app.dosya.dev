// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetAnalyticsForTests,
  analyticsActive,
  analyticsConsented,
  initAnalytics,
  trackPageView,
  getAnalyticsIds,
  trackCheckoutComplete,
  trackSignUp,
} from './analytics';

const ID = 'G-TEST123456';

type Pushed = IArguments[];
function pushed(): Pushed {
  return ((window as unknown as { dataLayer?: Pushed }).dataLayer ?? []);
}
function events(name: string) {
  return pushed().filter((a) => a[0] === 'event' && a[1] === name).map((a) => a[2] as Record<string, unknown>);
}

function clearCookie() {
  document.cookie = 'dosya_analytics_consent=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
}

beforeEach(() => {
  __resetAnalyticsForTests();
  clearCookie();
  localStorage.clear();
  document.querySelectorAll('script[src*="googletagmanager"]').forEach((s) => s.remove());
});
afterEach(() => {
  __resetAnalyticsForTests();
  clearCookie();
});

describe('consent gate', () => {
  it('reads only the exact accepted value', () => {
    expect(analyticsConsented('dosya_analytics_consent=1')).toBe(true);
    expect(analyticsConsented('dosya_analytics_consent=0')).toBe(false);
    expect(analyticsConsented('dosya_analytics_consent=true')).toBe(false);
    expect(analyticsConsented('other=1; dosya_analytics_consent=1; x=2')).toBe(true);
    expect(analyticsConsented('')).toBe(false);
    expect(analyticsConsented('xdosya_analytics_consent=1')).toBe(false);
  });

  it('loads nothing without consent, even with an id', () => {
    expect(initAnalytics(ID, '')).toBe(false);
    expect(analyticsActive()).toBe(false);
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
    expect((window as unknown as { gtag?: unknown }).gtag).toBeUndefined();
  });

  it('loads nothing without a well-formed id, even with consent', () => {
    expect(initAnalytics(undefined, 'dosya_analytics_consent=1')).toBe(false);
    expect(initAnalytics('', 'dosya_analytics_consent=1')).toBe(false);
    expect(initAnalytics('UA-12345-1', 'dosya_analytics_consent=1')).toBe(false);
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
  });

  it('loads the tag from googletagmanager with consent and an id, once', () => {
    expect(initAnalytics(ID, 'dosya_analytics_consent=1')).toBe(true);
    expect(initAnalytics(ID, 'dosya_analytics_consent=1')).toBe(true);
    const scripts = document.querySelectorAll('script[src*="googletagmanager"]');
    expect(scripts).toHaveLength(1);
    expect((scripts[0] as HTMLScriptElement).src).toBe(`https://www.googletagmanager.com/gtag/js?id=${ID}`);
    const config = pushed().find((a) => a[0] === 'config');
    expect(config?.[1]).toBe(ID);
    expect((config?.[2] as Record<string, unknown>).send_page_view).toBe(false);
    expect((config?.[2] as Record<string, unknown>).allow_google_signals).toBe(false);
    const consent = pushed().find((a) => a[0] === 'consent') ?? [];
    expect((consent[2] as Record<string, unknown>).ad_personalization).toBe('denied');
  });
});

describe('events', () => {
  it('are dropped while analytics is inactive', () => {
    trackPageView('/files');
    trackSignUp();
    trackCheckoutComplete({ planId: 'pro', currency: 'usd', amountCents: 1499, trial: false });
    expect(events('checkout_complete')).toHaveLength(0);
    expect(pushed()).toHaveLength(0);
  });

  it('page_view carries the path only, never a query string', () => {
    initAnalytics(ID, 'dosya_analytics_consent=1');
    trackPageView('/files');
    const [view] = events('page_view');
    expect(view.page_path).toBe('/files');
    expect(String(view.page_location)).not.toContain('?');
  });

  it('sign_up names its method', () => {
    initAnalytics(ID, 'dosya_analytics_consent=1');
    trackSignUp();
    expect(events('sign_up')[0]).toEqual({ method: 'password' });
  });

  it('checkout_complete carries plan, interval, currency, value and the trial flag, nothing else', () => {
    initAnalytics(ID, 'dosya_analytics_consent=1');
    trackCheckoutComplete({ planId: 'pro', interval: 'year', currency: 'eur', amountCents: 3999, trial: false });
    trackCheckoutComplete({ planId: 'starter', currency: 'usd', amountCents: 0, trial: true });
    expect(events('checkout_complete')).toEqual([
      { plan_id: 'pro', interval: 'year', currency: 'EUR', value: 39.99, trial: false },
      { plan_id: 'starter', interval: 'unknown', currency: 'USD', value: 0, trial: true },
    ]);
  });

  it('never sends the acquisition purchase itself: that is the API webhook\'s job', () => {
    initAnalytics(ID, 'dosya_analytics_consent=1');
    trackCheckoutComplete({ planId: 'pro', interval: 'month', currency: 'usd', amountCents: 449, trial: false });
    expect(events('purchase')).toHaveLength(0);
  });

  it('getAnalyticsIds asks the tag through gtag get and answers null when it never replies', async () => {
    expect(await getAnalyticsIds()).toBeNull();
    initAnalytics(ID, 'dosya_analytics_consent=1');
    const pending = getAnalyticsIds(50);
    const gets = pushed().filter((a) => a[0] === 'get');
    expect(gets.map((a) => [a[1], a[2]])).toEqual([[ID, 'client_id'], [ID, 'session_id']]);
    (gets[0][3] as (v: unknown) => void)('1234.5678');
    (gets[1][3] as (v: unknown) => void)(1799999000);
    expect(await pending).toEqual({ clientId: '1234.5678', sessionId: '1799999000' });
    expect(await getAnalyticsIds(20)).toBeNull();
  });
});
