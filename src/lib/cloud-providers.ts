import { t } from '@/lib/i18n';

/**
 * Two label maps with DIFFERENT key spaces. Keep them separate: conflating
 * them does not blank the label out - consumers guard lookups with a
 * `?? provider` fallback - it silently renders the raw provider id instead,
 * e.g. a lowercase "google" heading instead of "Google Drive".
 *
 * IMPORT_SOURCE_LABELS is keyed by `files.import_source` values, where
 * Google is the historical string 'google-drive' (that's what's already
 * stored on existing rows).
 *
 * PROVIDER_LABELS is keyed by provider id (job.provider, account.provider,
 * connect-route slugs), where Google is 'google'.
 */
export const IMPORT_SOURCE_LABELS: Record<string, string> = {
  'google-drive': 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
  // Copied in from someone's share link (POST /api/share/:token/save).
  // A getter, so the label follows the language chosen at read time (this
  // module is evaluated once, before the catalog is loaded).
  get share() {
    return t('search.label.sharedLink');
  },
};

export const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
};

// A per-account row icon keyed by provider id. An unmapped provider falls
// back to a generic icon at the call site rather than silently reusing
// another provider's mark (see profile.tsx MINOR 16, 2026-07-30 review).
export const PROVIDER_ICONS: Record<string, string> = {
  google: '/google-color.svg',
  onedrive: '/onedrive-color.svg',
  dropbox: '/dropbox-color.svg',
};
