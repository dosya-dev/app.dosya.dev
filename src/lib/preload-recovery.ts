import { recoverFromChunkErrorInBrowser } from '@/lib/chunk-reload';
import { isLanguageLoadInFlight } from '@/lib/i18n';

/**
 * Vite fires `vite:preloadError` when a lazy chunk's preload fails, which after
 * a deploy means the tab is asking for hashed filenames that no longer exist.
 * Catching it here recovers before the router's error boundary ever paints an
 * error page. The boundary keeps its own copy of this check for the paths that
 * skip the event.
 */
export function installPreloadRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    // A missing language file falls back to English; it must not reload the tab.
    if (isLanguageLoadInFlight()) return;
    const err = (event as Event & { payload?: unknown }).payload ?? event;
    if (recoverFromChunkErrorInBrowser(err)) event.preventDefault();
  });
}
