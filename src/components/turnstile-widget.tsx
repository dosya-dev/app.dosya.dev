import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

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

export interface TurnstileHandle {
  /** Current token, or '' if none has been issued yet. */
  getToken(): string;
  /** Discard the current token and ask for a fresh one. */
  reset(): void;
}

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
      reject(new Error('Turnstile script failed to load'));
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

    useImperativeHandle(ref, () => ({
      getToken: () => tokenRef.current,
      reset: () => {
        tokenRef.current = '';
        const id = widgetIdRef.current;
        if (id && window.turnstile) window.turnstile.reset(id);
      },
    }), []);

    useEffect(() => {
      // No sitekey means the build env var was never set. Rendering anyway
      // makes Turnstile throw "expected string, got object" into every
      // visitor's console. Skip silently instead: getToken() keeps returning
      // '', which the server logs as outcome "missing" under monitor mode, so
      // the form still submits. Fail quiet, not loud, on a config mistake.
      if (!SITEKEY) return;

      let cancelled = false;

      loadScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: SITEKEY,
            action,
            theme: currentTheme(),
            callback: (token: string) => { tokenRef.current = token; },
            'expired-callback': () => { tokenRef.current = ''; },
            'error-callback': () => { tokenRef.current = ''; },
          });
        })
        .catch(() => { if (!cancelled) setFailed(true); });

      return () => {
        cancelled = true;
        const id = widgetIdRef.current;
        if (id && window.turnstile) window.turnstile.remove(id);
        widgetIdRef.current = null;
      };
    }, [action]);

    // The server fails open when Turnstile is unreachable, so a load failure
    // must not present as a blocked form. Same for a missing sitekey.
    if (failed || !SITEKEY) return null;

    return <div ref={containerRef} className="my-3" />;
  },
);
