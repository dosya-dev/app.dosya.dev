import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyTheme, applyThemeAnimated, withThemeSweep, resolveDark, readCache, writeCache, subscribeThemeChange, type ThemePref } from './theme';

function mockMatchMedia(dark: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: dark, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark');
  mockMatchMedia(false);
});

describe('applyTheme', () => {
  it('sets data-theme + dark class for a non-default dark theme', () => {
    applyTheme({ theme: 'ocean', mode: 'dark' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('ocean');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
  it('removes data-theme for the default light theme', () => {
    applyTheme({ theme: 'ocean', mode: 'dark' });
    applyTheme({ theme: 'default', mode: 'light' });
    expect(document.documentElement.getAttribute('data-theme')).toBe(null);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('resolveDark', () => {
  it('follows the OS when mode is system', () => {
    mockMatchMedia(true);
    expect(resolveDark('system')).toBe(true);
    mockMatchMedia(false);
    expect(resolveDark('system')).toBe(false);
  });
  it('honours explicit modes regardless of OS', () => {
    mockMatchMedia(true);
    expect(resolveDark('light')).toBe(false);
    expect(resolveDark('dark')).toBe(true);
  });
});

describe('cache', () => {
  it('round-trips a preference', () => {
    writeCache({ theme: 'amber', mode: 'dark' });
    expect(readCache()).toEqual({ theme: 'amber', mode: 'dark' });
  });
  it('falls back to defaults when empty', () => {
    expect(readCache()).toEqual({ theme: 'default', mode: 'system' });
  });
  it('migrates a legacy theme=dark key', () => {
    localStorage.setItem('theme', 'dark');
    expect(readCache()).toEqual({ theme: 'default', mode: 'dark' });
  });
});

describe('withThemeSweep', () => {
  // lib.dom declares startViewTransition as always-present and fully typed, so
  // reach it through a loose shape to stub a two-line fake and to delete it.
  const doc = document as unknown as { startViewTransition?: unknown };

  /**
   * Stub the API and hand back the resolver so a test can end the transition.
   *
   * Shaped like a REAL ViewTransition, verified against Chromium 151: when a
   * transition is skipped (a second toggle) or aborted (the document torn down
   * mid-sweep), `ready` REJECTS while `finished` still RESOLVES. The earlier
   * fake returned only `finished` and rejected it on interruption, which is the
   * opposite of what browsers do, so it passed against code that could not work.
   */
  function stubViewTransition(outcome: 'finish' | 'interrupt' = 'finish') {
    let settle = () => {};
    doc.startViewTransition = (cb: () => void) => {
      cb();
      let rejectReady: (reason: unknown) => void = () => {};
      const ready = new Promise<void>((resolve, reject) => {
        if (outcome === 'finish') resolve();
        else rejectReady = reject;
      });
      return {
        ready,
        finished: new Promise<void>((resolve) => {
          settle = () => {
            if (outcome === 'interrupt') {
              rejectReady(Object.assign(new Error('Transition was skipped'), { name: 'AbortError' }));
            }
            resolve();
          };
        }),
      };
    };
    return () => { settle(); };
  }

  afterEach(() => { delete doc.startViewTransition; });

  it('applies instantly and arms nothing when the API is missing', () => {
    delete doc.startViewTransition;
    let ran = 0;
    withThemeSweep(() => { ran += 1; });
    expect(ran).toBe(1);
    expect(document.documentElement.hasAttribute('data-theme-sweep')).toBe(false);
  });

  it('arms data-theme-sweep for the length of the transition', async () => {
    const finish = stubViewTransition();
    applyThemeAnimated({ theme: 'ocean', mode: 'dark' });
    // The mutation ran, and the CSS is armed until the transition settles.
    expect(document.documentElement.getAttribute('data-theme')).toBe('ocean');
    expect(document.documentElement.hasAttribute('data-theme-sweep')).toBe(true);
    finish();
    await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-theme-sweep')).toBe(false));
  });

  it('disarms when a second toggle interrupts the transition', async () => {
    const interrupt = stubViewTransition('interrupt');
    withThemeSweep(() => {});
    interrupt();
    // An interrupted transition must still clean up, or the wipe rules stay
    // armed and catch every later view transition.
    await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-theme-sweep')).toBe(false));
  });

  // Sentry 149371532's sibling: the browser rejects `ready` on every skipped or
  // aborted transition. withThemeSweep only ever claimed `finished`, so that
  // rejection went unhandled and Sentry's global handler reported it as
  // "InvalidStateError: Transition was aborted because of invalid state" even
  // though the theme change itself had succeeded.
  it('claims the ready rejection so it never reaches the global handler', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const interrupt = stubViewTransition('interrupt');
      withThemeSweep(() => {});
      interrupt();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('survives an implementation that exposes no ready promise', async () => {
    let ran = 0;
    doc.startViewTransition = (cb: () => void) => { cb(); return { finished: Promise.resolve() }; };
    withThemeSweep(() => { ran += 1; });
    expect(ran).toBe(1);
    await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-theme-sweep')).toBe(false));
  });

  it('skips the transition under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduced-motion'), media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }));
    let started = 0;
    doc.startViewTransition = (cb: () => void) => { started += 1; cb(); return { finished: Promise.resolve() }; };
    let ran = 0;
    withThemeSweep(() => { ran += 1; });
    expect(started).toBe(0);
    expect(ran).toBe(1);
    expect(document.documentElement.hasAttribute('data-theme-sweep')).toBe(false);
  });
});

describe('theme change events', () => {
  it('applyTheme dispatches ui-theme-change carrying the applied pref', () => {
    let received: ThemePref | null = null;
    const off = subscribeThemeChange((p) => { received = p; });
    applyTheme({ theme: 'ocean', mode: 'dark' });
    expect(received).toEqual({ theme: 'ocean', mode: 'dark' });
    off();
  });
  it('unsubscribe stops further notifications', () => {
    let fired = 0;
    const off = subscribeThemeChange(() => { fired += 1; });
    off();
    applyTheme({ theme: 'amber', mode: 'light' });
    expect(fired).toBe(0);
  });
});
