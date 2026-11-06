/**
 * The marketing site's origin, where public share pages live (dosya.dev/s/...).
 * The app runs on app.dosya.dev in production and on localhost in dev, where
 * the Astro site serves on 4321. VITE_SITE_URL overrides either.
 */
export function siteOrigin(): string {
  const override = import.meta.env.VITE_SITE_URL as string | undefined;
  if (override) return override.replace(/\/+$/, '');
  const local = typeof window !== 'undefined' && window.location.hostname === 'localhost';
  return local ? 'http://localhost:4321' : 'https://dosya.dev';
}

/** The public page for a share link, where a visitor unlocks it. */
export function sharePageUrl(token: string): string {
  return `${siteOrigin()}/s/${encodeURIComponent(token)}`;
}
