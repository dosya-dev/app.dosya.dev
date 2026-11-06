import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { t as translate } from '@/lib/i18n';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
// Public by design - a Turnstile sitekey is served in the HTML to every
// visitor, and is domain-locked at Cloudflare. The literal is a fallback
// because the dosya-web Pages project does not inject build variables (its
// build log reports "Build environment variables: (none found)", including
// for the pre-existing NPM_TOKEN). The env var still wins where it works.
//
// Do not "simplify" this back to a bare env read when resolving a merge
// conflict here. That happened once already: the fallback was dropped in a
// merge, synced to the dosya-dev/app.dosya.dev mirror, and the login widget
// silently vanished because SITEKEY became undefined and the guard below
// tree-shook the entire render path out of the bundle.
const SITEKEY = (import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined)
  || '0x4AAAAAAEEZLpy907cv9Zl_';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

/**
 * Why the widget has no token right now.
 *
 * `waiting` is the ordinary case for the first second or so after mount (the
 * script is loading, or the challenge is still running) and is also what an
 * interactive challenge looks like while it waits to be clicked. `unavailable`
 * means no token is ever coming on this page load: no sitekey in the build, the
 * script could not be fetched, or Turnstile handed us an error. The two need
 * different words in front of the user, which is the only reason this is
 * exposed at all.
 */
export type TurnstileStatus = 'waiting' | 'ready' | 'unavailable';

export interface TurnstileHandle {
  /** Current token, or '' if none has been issued yet. */
  getToken(): string;
  /**
   * Resolve as soon as a token exists, or with '' if none arrives in time.
   *
   * getToken() alone loses a race every real user can win: the challenge
   * usually resolves in well under a second, but a person who types a 6-digit
   * code and hits Enter can beat it, and then the token is '' and an enforcing
   * route 403s them. Awaiting this instead costs nothing in the common case
   * (the token is already there and it resolves synchronously on the
   * microtask queue) and turns that race into a short wait.
   */
  waitForToken(timeoutMs?: number): Promise<string>;
  /** Why there is no token, for choosing what to tell the user. */
  status(): TurnstileStatus;
  /** Discard the current token and ask for a fresh one. */
  reset(): void;
}

/**
 * How long waitForToken() waits before giving up and letting the submit go
 * out tokenless. Generous: a slow phone on hotel wifi still has to fetch
 * challenges.cloudflare.com and run the challenge, and the cost of being
 * wrong here is a 403 on a login.
 */
export const TURNSTILE_WAIT_MS = 8000;

// One script tag per document no matter how many widgets mount. Deduped behind
// a module-level promise so concurrent mounts do not each inject a tag.
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = SCRIPT_SRC;
    tag.async = true;
    tag.defer = true;
    tag.onload = () => resolve();
    tag.onerror = () => {
      // Let a later mount retry rather than caching the failure forever.
      scriptPromise = null;
      reject(new Error(translate('common.error.turnstileScriptFailedToLoad')));
    };
    document.head.appendChild(tag);
  });
  return scriptPromise;
}

/** Read the app's active theme so the widget matches it. */
function currentTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export const TurnstileWidget = forwardRef<TurnstileHandle, { action: string }>(
  function TurnstileWidget({ action }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const tokenRef = useRef('');
    const [failed, setFailed] = useState(false);
    // Mirrors `failed` for the imperative handle, which is built once with
    // [] deps and so cannot read the state variable.
    const unavailableRef = useRef(!SITEKEY);
    // Callers parked in waitForToken(). Resolved by the success callback, or
    // by whichever of the failure paths fires first, so nobody waits out the
    // full timeout for an answer we already have.
    const waitersRef = useRef(new Set<(token: string) => void>());

    const settle = (token: string) => {
      for (const resolve of waitersRef.current) resolve(token);
      waitersRef.current.clear();
    };

    useImperativeHandle(ref, () => ({
      getToken: () => tokenRef.current,
      status: () => (tokenRef.current ? 'ready' : unavailableRef.current ? 'unavailable' : 'waiting'),
      waitForToken: (timeoutMs = TURNSTILE_WAIT_MS) => {
        if (tokenRef.current) return Promise.resolve(tokenRef.current);
        if (unavailableRef.current) return Promise.resolve('');
        return new Promise<string>((resolve) => {
          const done = (token: string) => {
            clearTimeout(timer);
            waitersRef.current.delete(done);
            resolve(token);
          };
          const timer = setTimeout(() => done(''), timeoutMs);
          waitersRef.current.add(done);
        });
      },
      reset: () => {
        tokenRef.current = '';
        const id = widgetIdRef.current;
        if (id && window.turnstile) window.turnstile.reset(id);
      },
    }), []);

    useEffect(() => {
      // No sitekey means the build env var was never set AND the literal
      // fallback above was lost. Rendering anyway makes Turnstile throw
      // "expected string, got object" into every visitor's console, so skip.
      //
      // This used to be described as harmless because every route was on
      // `monitor` and a "missing" outcome still submitted. That is no longer
      // true: the auth routes are `enforce-web` and isBlocking() treats
      // "missing" as a block, so on production a tokenless submit is a 403.
      // Only an unreachable siteverify fails open, which is a server-side
      // condition this component cannot produce. Hence status(): the form asks
      // what went wrong and says so, rather than relaying a bare 403.
      if (!SITEKEY) return;

      let cancelled = false;

      loadScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: SITEKEY,
            action,
            theme: currentTheme(),
            callback: (token: string) => { tokenRef.current = token; settle(token); },
            'expired-callback': () => { tokenRef.current = ''; },
            // Turnstile itself gave up (network, blocked domain, bad sitekey
            // for this hostname). No token is coming, so release anyone
            // waiting immediately instead of making them sit out the timeout.
            'error-callback': () => {
              tokenRef.current = '';
              unavailableRef.current = true;
              settle('');
            },
          });
        })
        .catch(() => {
          if (cancelled) return;
          unavailableRef.current = true;
          settle('');
          setFailed(true);
        });

      return () => {
        cancelled = true;
        // Nobody is left to receive a token, and an unresolved promise here
        // would keep a submit handler parked for the full timeout after the
        // page it belongs to is gone.
        settle('');
        const id = widgetIdRef.current;
        if (id && window.turnstile) window.turnstile.remove(id);
        widgetIdRef.current = null;
      };
    }, [action]);

    // Render nothing rather than an error box: whether this actually blocks
    // the user depends on the route's mode and on server config this component
    // cannot see (a missing TURNSTILE_SECRET_KEY lets everything through -
    // which is why local dev works), so a warning here would often be a false
    // alarm. The form handles it at submit time, where the answer is known.
    if (failed || !SITEKEY) return null;

    return <div ref={containerRef} className="my-3" />;
  },
);
