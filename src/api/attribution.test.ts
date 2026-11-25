// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiCalls: Array<{ path: string; body: unknown }> = [];
vi.mock('./client', () => ({
  api: vi.fn(async (path: string, init?: { body?: string }) => { apiCalls.push({ path, body: JSON.parse(init?.body ?? 'null') }); }),
}));

import { __resetAnalyticsForTests, initAnalytics } from '@/lib/analytics';
import { buildAttribution, syncAnalyticsAttribution } from './attribution';

const ID = 'G-TEST123456';
type Pushed = IArguments[];
const pushed = () => ((window as unknown as { dataLayer?: Pushed }).dataLayer ?? []);

/** Answers the two gtag('get') calls the way the tag would. */
function answerGets(clientId = '1234.5678', sessionId = 1799999000) {
  for (const a of pushed()) {
    if (a[0] !== 'get') continue;
    (a[3] as (v: unknown) => void)(a[2] === 'client_id' ? clientId : sessionId);
  }
}

beforeEach(() => {
  __resetAnalyticsForTests();
  apiCalls.length = 0;
  localStorage.clear();
  (window as unknown as { dataLayer?: Pushed }).dataLayer = [];
  document.cookie = 'dosya_analytics_consent=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
});
afterEach(() => __resetAnalyticsForTests());

describe('analytics attribution handed to the API', () => {
  it('without consent sends only the refusal, with no identifiers', async () => {
    expect(await buildAttribution()).toEqual({ analytics_consent: false });
    expect(await syncAnalyticsAttribution()).toBe(true);
    expect(apiCalls).toEqual([{ path: '/api/me/analytics-attribution', body: { analytics_consent: false } }]);
  });

  it('with consent sends the ids the tag reports', async () => {
    document.cookie = 'dosya_analytics_consent=1;path=/';
    initAnalytics(ID);
    const pending = syncAnalyticsAttribution();
    answerGets();
    expect(await pending).toBe(true);
    expect(apiCalls[0].body).toEqual({ ga_client_id: '1234.5678', ga_session_id: '1799999000', analytics_consent: true });
  });

  it('does not repeat an unchanged record, but a forced write (checkout start) always goes', async () => {
    expect(await syncAnalyticsAttribution()).toBe(true);
    expect(await syncAnalyticsAttribution()).toBe(false);
    expect(await syncAnalyticsAttribution(true)).toBe(true);
    expect(apiCalls).toHaveLength(2);
  });

  it('a withdrawal after an accepted record is sent, so the server can stop a delayed report', async () => {
    document.cookie = 'dosya_analytics_consent=1;path=/';
    initAnalytics(ID);
    const first = syncAnalyticsAttribution();
    answerGets();
    await first;
    __resetAnalyticsForTests();
    document.cookie = 'dosya_analytics_consent=0;path=/';
    expect(await syncAnalyticsAttribution()).toBe(true);
    expect(apiCalls[1].body).toEqual({ analytics_consent: false });
  });
});
