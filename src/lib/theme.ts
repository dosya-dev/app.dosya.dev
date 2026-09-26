import { type Mode, DEFAULT_THEME, DEFAULT_MODE, isThemeId, isMode } from './themes';

export const THEME_CHANGE_EVENT = 'ui-theme-change';

export interface ThemePref { theme: string; mode: Mode }

export const CACHE_KEY = 'ui-theme';

export function readCache(): ThemePref {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ThemePref>;
      if (isThemeId(p.theme) && isMode(p.mode)) return { theme: p.theme, mode: p.mode };
    }
    // Legacy: pre-multitheme builds stored only localStorage.theme = 'dark' | 'light'.
    const legacy = localStorage.getItem('theme');
    if (legacy === 'dark' || legacy === 'light') return { theme: DEFAULT_THEME, mode: legacy };
  } catch { /* ignore malformed storage */ }
  return { theme: DEFAULT_THEME, mode: DEFAULT_MODE };
}

export function writeCache(pref: ThemePref): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(pref)); } catch { /* ignore */ }
}

export function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveDark(mode: Mode): boolean {
  return mode === 'dark' || (mode === 'system' && prefersDark());
}

export function applyTheme(pref: ThemePref): void {
  const el = document.documentElement;
  if (pref.theme && pref.theme !== DEFAULT_THEME) el.setAttribute('data-theme', pref.theme);
  else el.removeAttribute('data-theme');
  el.classList.toggle('dark', resolveDark(pref.mode));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: pref }));
}

/** lib.dom types startViewTransition as always-present; it isn't, so read it
 *  through a shape that admits `undefined` and check before calling. */
interface ViewTransitionLike {
  /** Rejects whenever the transition is skipped or aborted. Optional because a
   *  partial implementation could omit it, and reading it must never throw. */
  ready?: Promise<void>;
  finished: Promise<void>;
}
type StartViewTransition = (cb: () => void) => ViewTransitionLike;

function viewTransitionStarter(): StartViewTransition | null {
  if (typeof document === 'undefined') return null;
  const fn = (document as { startViewTransition?: unknown }).startViewTransition;
  return typeof fn === 'function' ? (fn as StartViewTransition).bind(document) : null;
}

/**
 * Run a theme mutation behind a left-to-right wipe.
 *
 * The View Transitions API screenshots the page, runs `mutate()`, then
 * cross-fades old to new; index.css replaces that cross-fade with a clip-path
 * wipe while `data-theme-sweep` is set, so only theme changes sweep and any
 * other transition keeps its default. Browsers without the API and anyone on
 * prefers-reduced-motion get the instant swap they had before.
 *
 * Only for user-initiated changes. Boot and account reconciliation call
 * applyTheme() directly - a wipe on page load would look like a glitch.
 */
export function withThemeSweep(mutate: () => void): void {
  const start = viewTransitionStarter();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!start || reduced) { mutate(); return; }

  const el = document.documentElement;
  el.setAttribute('data-theme-sweep', '');
  const done = () => el.removeAttribute('data-theme-sweep');
  try {
    const transition = start(mutate);
    // `finished` settles once the DOM is updated, whether or not the animation
    // ran, so it is what disarms the CSS. Either outcome is fine here.
    transition.finished.then(done, done);
    // `ready` is the one that REJECTS when this sweep is skipped (a second
    // toggle: AbortError) or aborted (the document torn down mid-sweep:
    // InvalidStateError). Neither is worth reporting - the theme change itself
    // still lands - but an unclaimed rejection reaches Sentry's global handler,
    // which is how "Transition was aborted because of invalid state" got
    // reported from a toggle that worked. Claim it and drop it.
    transition.ready?.catch(() => {});
  } catch {
    done();
    mutate();
  }
}

/** applyTheme() with the wipe. Use from toggles and pickers, not from boot. */
export function applyThemeAnimated(pref: ThemePref): void {
  withThemeSweep(() => applyTheme(pref));
}

/** Re-apply on OS scheme change while the user is on 'system'. Returns an unsubscribe fn. */
export function initSystemListener(getPref: () => ThemePref): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const handler = () => { const p = getPref(); if (p.mode === 'system') applyTheme(p); };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

/** Subscribe to any applyTheme() call; the callback receives the applied pref
 *  (via the event detail) so late account reconciliation updates consumers' UI. */
export function subscribeThemeChange(cb: (pref: ThemePref) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<ThemePref>).detail);
  window.addEventListener(THEME_CHANGE_EVENT, handler);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, handler);
}
