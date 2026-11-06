import { afterEach, describe, expect, it, vi } from 'vitest';

const reload = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/lib/chunk-reload', () => ({ recoverFromChunkErrorInBrowser: reload }));
// Like Vite's __vitePreload: a failed import dispatches vite:preloadError, then rejects.
vi.mock('@/i18n/loaders', () => ({
  LOADERS: {
    de: () => {
      const err = new Error('Failed to fetch dynamically imported module');
      const ev = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown };
      ev.payload = err;
      window.dispatchEvent(ev);
      return Promise.reject(err);
    },
  },
}));

import { installPreloadRecovery } from './preload-recovery';
import { loadStartupMessages, currentLocale } from './i18n';

afterEach(() => reload.mockClear());

describe('failed language chunk', () => {
  it('never reaches the chunk-reload recovery and leaves the app in English', async () => {
    installPreloadRecovery();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await loadStartupMessages('de');
    expect(r.locale).toBe('en');
    expect(currentLocale()).toBe('en');
    expect(reload).not.toHaveBeenCalled();
  });

  it('still recovers for a page chunk failing outside a language load', () => {
    const ev = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown };
    ev.payload = new Error('Failed to fetch dynamically imported module');
    window.dispatchEvent(ev);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
