/**
 * The onboarding step catalogue.
 *
 * Every step is identified by a `key` that names a DERIVATION - a fact the
 * API can prove from real rows (see GET /api/onboarding). Steps are never
 * "completed" by being clicked; they are complete when the underlying thing
 * is true. That is what stops the checklist telling a user with 200 files to
 * upload their first one.
 *
 * The API owns the derivations, this file owns the copy and the ordering,
 * and the only contract between them is these key names. apps/web and
 * apps/api share no package, so the union below is duplicated as string
 * literals on the API side and pinned by tests on both.
 */

export type DerivationKey =
  | 'upload'
  | 'share'
  | 'import'
  | 'api_key'
  | 'client_used'
  | 'invite'
  | 'file_request'
  | 'geo'
  | 'desktop'
  | 'mobile';

export const ALL_DERIVATION_KEYS: DerivationKey[] = [
  'upload', 'share', 'import', 'api_key', 'client_used',
  'invite', 'file_request', 'geo', 'desktop', 'mobile',
];

export type Purpose = 'personal' | 'dev' | 'team' | 'media';

export interface OnboardingStep {
  /** The derivation that proves this step is done. */
  key: DerivationKey;
  title: string;
  /** One line on why it is worth doing. Not a description of the click. */
  why: string;
  cta: string;
  /** Where the button goes. The doing place, never a docs page. */
  href: string;
}

const UPLOAD: OnboardingStep = {
  key: 'upload',
  title: 'Upload your first file',
  why: 'Drag anything in. It is stored encrypted at rest and stays yours.',
  cta: 'Go to Files',
  href: '/files',
};

const SHARE: OnboardingStep = {
  key: 'share',
  title: 'Create a share link',
  why: 'Send a file to anyone. They do not need an account to open it.',
  cta: 'Go to Files',
  href: '/files',
};

const CLIENT_USED: OnboardingStep = {
  key: 'client_used',
  title: 'Connect a client',
  why: 'Mount dosya on your machine with the CLI, rclone, WebDAV or S3.',
  cta: 'See setup guides',
  href: '/integrations',
};

const INVITE: OnboardingStep = {
  key: 'invite',
  title: 'Invite a teammate',
  why: 'A shared workspace keeps everyone on the same files and permissions.',
  cta: 'Invite someone',
  href: '/teams',
};

export const STEP_SETS: Record<Purpose | 'generic', OnboardingStep[]> = {
  personal: [
    UPLOAD,
    {
      key: 'desktop',
      title: 'Install the desktop app',
      why: 'Keep a folder on your Mac or PC in sync automatically.',
      cta: 'Get the app',
      href: '/integrations/desktop',
    },
    {
      key: 'import',
      title: 'Import from Google Drive',
      why: 'Bring what you already have across in one pass.',
      cta: 'Start an import',
      href: '/integrations/google',
    },
    SHARE,
  ],

  // "Connect a client" rather than naming S3, because one API key serves the
  // CLI, rclone, WebDAV and S3 alike - and because a new user has no basis
  // yet for choosing between them.
  dev: [
    UPLOAD,
    {
      key: 'api_key',
      title: 'Create an API key',
      why: 'One key authenticates the CLI, rclone, WebDAV and the REST API.',
      cta: 'Create a key',
      href: '/profile?section=api',
    },
    CLIENT_USED,
    SHARE,
  ],

  team: [
    UPLOAD,
    INVITE,
    SHARE,
    {
      key: 'file_request',
      title: 'Set up a file request',
      why: 'Collect files from people who do not have a dosya account.',
      cta: 'Create a request',
      href: '/file-requests',
    },
  ],

  media: [
    UPLOAD,
    {
      key: 'geo',
      title: 'See your photos on the map',
      why: 'Photos carrying GPS data appear where they were taken.',
      cta: 'Open the map',
      href: '/map',
    },
    {
      key: 'mobile',
      title: 'Install the mobile app',
      why: 'Back up your camera roll in the background.',
      cta: 'Get the app',
      href: 'https://dosya.dev/mobile',
    },
    SHARE,
  ],

  generic: [UPLOAD, SHARE, CLIENT_USED, INVITE],
};

export function stepsFor(purpose: Purpose | null): OnboardingStep[] {
  // `purpose` is copied in from the API unvalidated (see stores/onboarding.ts),
  // and this file cannot import the API's own PURPOSES check since the two
  // apps share no package. SetupPill renders inside the router root, whose
  // errorElement is the app's error page - an unknown value here (a fifth
  // purpose deployed API-side before the web build, or a value written
  // straight to D1) must fall back, not throw, or it takes down every
  // dashboard route for the affected user. Onboarding must never be
  // load-bearing.
  return STEP_SETS[purpose as Purpose] ?? STEP_SETS.generic;
}

/**
 * Whether the dashboard should show the first-run home screen instead of the
 * normal dashboard.
 *
 * Requires no live files AND no trashed bytes. `total_files` alone is not
 * enough: a two-year-old account that selects all and deletes still occupies
 * its quota, and showing "put your first file in" would make the storage and
 * plan cards disappear while the data is still there. Kept dependency-free so
 * it is trivial to unit test on its own.
 */
export function shouldShowFirstRun(
  stats: { total_files: number; trash_bytes: number },
  dismissed: boolean,
): boolean {
  return stats.total_files === 0 && stats.trash_bytes === 0 && !dismissed;
}
