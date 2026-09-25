import { describe, expect, it, vi } from 'vitest';

// The SDK itself is not under test; mocking it keeps this suite free of
// network transports and lets the wiring functions be asserted directly.
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  reactRouterV7BrowserTracingIntegration: vi.fn(() => ({ name: 'ReactRouterV7' })),
}));
vi.mock('@sentry/react', () => sentry);

import {
  DEFAULT_SENTRY_DSN,
  initSentry,
  isSentryEnabled,
  reportRouteError,
  resolveDsn,
  scrubEvent,
  setSentryUser,
  shouldReportRouteError,
} from './sentry';

/**
 * These pin the decisions that decide whether a user's crash reaches the
 * dashboard and what travels with it: which DSN, whether this build may send
 * at all, which personal fields are stripped, and which route errors are
 * noise rather than defects.
 */
describe('resolveDsn / isSentryEnabled', () => {
  it('uses the checked-in DSN when nothing is configured', () => {
    expect(resolveDsn({})).toBe(DEFAULT_SENTRY_DSN);
  });

  it('VITE_SENTRY_DSN overrides the default, trimmed', () => {
    expect(resolveDsn({ VITE_SENTRY_DSN: '  https://k@o1.ingest.de.sentry.io/2 ' })).toBe('https://k@o1.ingest.de.sentry.io/2');
  });

  it('an empty VITE_SENTRY_DSN switches reporting off, even in production', () => {
    expect(resolveDsn({ VITE_SENTRY_DSN: '' })).toBeNull();
    expect(isSentryEnabled({ VITE_SENTRY_DSN: '   ' }, false)).toBe(false);
  });

  it('production builds report; dev does not unless VITE_SENTRY_DEV=1', () => {
    expect(isSentryEnabled({}, false)).toBe(true);
    expect(isSentryEnabled({}, true)).toBe(false);
    expect(isSentryEnabled({ VITE_SENTRY_DEV: '1' }, true)).toBe(true);
    expect(isSentryEnabled({ VITE_SENTRY_DEV: '0' }, true)).toBe(false);
  });
});

describe('scrubEvent', () => {
  it('keeps only the opaque user id', () => {
    const input = {
      user: { id: 'usr_abc', email: 'a@example.com', username: 'firat', ip_address: '1.2.3.4' },
      message: 'boom',
    };
    const event = scrubEvent(input);
    expect(event.user).toEqual({ id: 'usr_abc' });
    expect(event.message).toBe('boom');
  });

  it('removes a user block that has no id', () => {
    expect(scrubEvent({ user: { email: 'a@example.com' } }).user).toBeUndefined();
  });

  it('leaves an event with no user untouched', () => {
    const input: { user?: { id?: string }; message: string } = { message: 'x' };
    expect(scrubEvent(input)).toEqual({ message: 'x' });
  });
});

describe('shouldReportRouteError', () => {
  it('skips a 404 route response - a bad URL is not a defect', () => {
    expect(shouldReportRouteError({ status: 404, statusText: 'Not Found', data: null })).toBe(false);
  });

  it('skips a stale-chunk load error - the reload path owns those', () => {
    expect(shouldReportRouteError(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(false);
  });

  it('skips nothing-at-all', () => {
    expect(shouldReportRouteError(undefined)).toBe(false);
    expect(shouldReportRouteError(null)).toBe(false);
  });

  it('reports a real render error and a non-404 route response', () => {
    expect(shouldReportRouteError(new Error('Cannot read properties of undefined'))).toBe(true);
    expect(shouldReportRouteError({ status: 500, statusText: 'Server Error', data: null })).toBe(true);
  });

  it('reportRouteError forwards only what shouldReportRouteError allows', () => {
    reportRouteError({ status: 404 });
    expect(sentry.captureException).not.toHaveBeenCalled();
    const err = new Error('render exploded');
    reportRouteError(err);
    expect(sentry.captureException).toHaveBeenCalledWith(err, { extra: { source: 'router' } });
  });
});

describe('init and user wiring', () => {
  it('initialises once with the privacy options and the router integration', () => {
    initSentry({}, false);
    initSentry({}, false);
    expect(sentry.init).toHaveBeenCalledTimes(1);
    const options = sentry.init.mock.calls[0][0];
    expect(options.dsn).toBe(DEFAULT_SENTRY_DSN);
    expect(options.enabled).toBe(true);
    expect(options.environment).toBe('production');
    expect(options.dataCollection).toEqual({ userInfo: false, httpBodies: [] });
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.integrations).toEqual([{ name: 'ReactRouterV7' }]);
  });

  it('setSentryUser sends the id only and clears with null', () => {
    setSentryUser('usr_1');
    expect(sentry.setUser).toHaveBeenLastCalledWith({ id: 'usr_1' });
    setSentryUser(null);
    expect(sentry.setUser).toHaveBeenLastCalledWith(null);
  });
});
