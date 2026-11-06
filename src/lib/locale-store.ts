import { isLocale, type Locale } from '@/i18n/locales';

/** The browser-local home of the language choice. Not synced to the account. */
export const LOCALE_STORAGE_KEY = 'dosya_locale';

/** The stored language; anything missing, unknown or unreadable is English. */
export function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : 'en';
  } catch {
    return 'en';
  }
}

export function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* private mode or blocked storage: the choice lasts until reload */
  }
}

/** Calls `fn` when another tab changes the stored language. Returns the unsubscribe. */
export function subscribeStoredLocale(fn: (locale: Locale) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== LOCALE_STORAGE_KEY && e.key !== null) return;
    fn(readStoredLocale());
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
