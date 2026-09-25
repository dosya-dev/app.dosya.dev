import * as Sentry from '@sentry/react';
import { useEffect } from 'react';
import { createRoutesFromChildren, matchRoutes, useLocation, useNavigationType } from 'react-router-dom';
import { isChunkLoadError } from '@/lib/chunk-reload';

/**
 * Crash and error reporting (Sentry, org dosya-pty-ltd, project dosya-web).
 *
 * Before this the web app had NO off-browser error signal: the router's error
 * page told users "We've been notified" while nothing was, and an unhandled
 * rejection outside the React tree vanished with the tab.
 *
 * What is reported: unhandled exceptions and rejections (the SDK's default
 * global handlers), route errors the router's errorElement catches (see
 * `reportRouteError`), and navigation spans from the React Router integration
 * at a 10% sample. Session Replay is deliberately not enabled.
 *
 * What is NOT sent: the account's email or name. `setSentryUser` records the
 * opaque user id only and `scrubEvent` strips anything an integration adds on
 * top (`dataCollection.userInfo` is off as well). Request bodies are never
 * collected. The DSN is a public write-only key, so a checked-in default is
 * fine; VITE_SENTRY_DSN overrides it for a different project and an EMPTY
 * value turns reporting off.
 *
 * Off in dev (`vite dev`) by default - the overlay already shows the error and
 * a dev session's crashes would drown the dashboard. VITE_SENTRY_DEV=1 turns
 * it on to exercise the pipeline locally.
 *
 * Source maps: vite.config.ts uploads hidden maps at build time when
 * SENTRY_AUTH_TOKEN is set (a hand deploy from a machine with the token, or
 * CI); without it the build is unchanged and stack traces arrive minified.
 *
 * Init order matters: `wrapCreateBrowserRouterV7` in router.tsx has to run
 * AFTER `Sentry.init`, and router.tsx is evaluated as an import of main.tsx,
 * before main.tsx's own body. src/instrument.ts exists only to be main.tsx's
 * first import so init happens first.
 */

export const DEFAULT_SENTRY_DSN =
  'https://9d609c9f67ce7c30ac59c5fcf5b07de8@o4512130123825152.ingest.de.sentry.io/4512130522939472';

/** Sample rate for navigation/pageload traces. Errors are always sent. */
export const TRACES_SAMPLE_RATE = 0.1;

/** The variables read, from `import.meta.env` or a test's stand-in. */
export type SentryEnv = Record<string, string | boolean | undefined>;

/** The DSN to report to; `null` when reporting is switched off. */
export function resolveDsn(env: SentryEnv): string | null {
  const configured = env['VITE_SENTRY_DSN'];
  if (configured === undefined) return DEFAULT_SENTRY_DSN;
  const trimmed = String(configured).trim();
  return trimmed === '' ? null : trimmed;
}

/** Whether events should leave the browser for this build. */
export function isSentryEnabled(env: SentryEnv, dev: boolean): boolean {
  if (resolveDsn(env) === null) return false;
  if (!dev) return true;
  return env['VITE_SENTRY_DEV'] === '1';
}

/** The slice of a Sentry event the scrubber touches. */
interface Scrubbable {
  user?: { id?: string | number } & Record<string, unknown>;
}

/**
 * Drops personal fields an integration may have attached. The user id set by
 * `setSentryUser` survives; email, username and IP do not.
 */
export function scrubEvent<E extends Scrubbable>(event: E): E {
  if (event.user) {
    const { id } = event.user;
    event.user = id === undefined ? undefined : { id };
  }
  return event;
}

/**
 * Which route errors are worth a report. A 404 route response is a user
 * typing a bad URL, not a defect; a stale-chunk load after a deploy is the
 * reload path's job (chunk-reload.ts) and would page for every release.
 */
export function shouldReportRouteError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  if (isChunkLoadError(err)) return false;
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number' && status === 404) return false;
  return true;
}

let initialised = false;

/** Idempotent; called from src/instrument.ts. */
export function initSentry(env: SentryEnv = import.meta.env, dev: boolean = import.meta.env.DEV): void {
  if (initialised) return;
  initialised = true;
  Sentry.init({
    dsn: resolveDsn(env) ?? '',
    enabled: isSentryEnabled(env, dev),
    environment: dev ? 'development' : 'production',
    dataCollection: { userInfo: false, httpBodies: [] },
    tracesSampleRate: TRACES_SAMPLE_RATE,
    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],
    beforeSend: scrubEvent,
  });
}

/** Attach (or clear, with null) the signed-in account's opaque id. */
export function setSentryUser(userId: string | null): void {
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Report an error the app caught itself (boundaries, swallowed catches). */
export function reportError(error: unknown, extra?: Record<string, unknown>): void {
  Sentry.captureException(error, extra ? { extra } : undefined);
}

/** The router's errorElement calls this; applies `shouldReportRouteError`. */
export function reportRouteError(err: unknown): void {
  if (shouldReportRouteError(err)) reportError(err, { source: 'router' });
}
