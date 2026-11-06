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

import type { MessageKey } from '@/i18n/keys';

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
  /** Catalog key of the title. Translated when rendered. */
  titleKey: MessageKey;
  /** Key of one line on why it is worth doing. Not a description of the click. */
  whyKey: MessageKey;
  ctaKey: MessageKey;
  /** Where the button goes. The doing place, never a docs page. */
  href: string;
}

const UPLOAD: OnboardingStep = {
  key: 'upload',
  titleKey: 'dashboard.heading.uploadYourFirstFile',
  whyKey: 'dashboard.description.dragAnythingInItIsStoredEncryptedAtRestAndStays',
  ctaKey: 'dashboard.label.goToFiles',
  href: '/files',
};

const SHARE: OnboardingStep = {
  key: 'share',
  titleKey: 'dashboard.heading.createAShareLink',
  whyKey: 'dashboard.description.sendAFileToAnyoneTheyDoNotNeedAnAccount',
  ctaKey: 'dashboard.label.goToFiles',
  href: '/files',
};

const CLIENT_USED: OnboardingStep = {
  key: 'client_used',
  titleKey: 'dashboard.heading.connectAClient',
  whyKey: 'dashboard.description.mountDosyaOnYourMachineWithTheCliRcloneWebdavOr',
  ctaKey: 'dashboard.label.seeSetupGuides',
  href: '/integrations',
};

const INVITE: OnboardingStep = {
  key: 'invite',
  titleKey: 'dashboard.heading.inviteATeammate',
  whyKey: 'dashboard.description.aSharedWorkspaceKeepsEveryoneOnTheSameFilesAndPermissions',
  ctaKey: 'dashboard.label.inviteSomeone',
  href: '/teams',
};

export const STEP_SETS: Record<Purpose | 'generic', OnboardingStep[]> = {
  personal: [
    UPLOAD,
    {
      key: 'desktop',
      titleKey: 'dashboard.heading.installTheDesktopApp',
      whyKey: 'dashboard.description.keepAFolderOnYourMacOrPcInSyncAutomatically',
      ctaKey: 'dashboard.label.getTheApp',
      href: '/integrations/desktop',
    },
    {
      key: 'import',
      titleKey: 'dashboard.heading.importFromGoogleDrive',
      whyKey: 'dashboard.description.bringWhatYouAlreadyHaveAcrossInOnePass',
      ctaKey: 'dashboard.label.startAnImport',
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
      titleKey: 'dashboard.heading.createAnApiKey',
      whyKey: 'dashboard.description.oneKeyAuthenticatesTheCliRcloneWebdavAndTheRestApi',
      ctaKey: 'dashboard.label.createAKey',
      href: '/profile/api',
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
      titleKey: 'dashboard.heading.setUpAFileRequest',
      whyKey: 'dashboard.description.collectFilesFromPeopleWhoDoNotHaveADosyaAccount',
      ctaKey: 'dashboard.label.createARequest',
      href: '/file-requests',
    },
  ],

  media: [
    UPLOAD,
    {
      key: 'geo',
      titleKey: 'dashboard.heading.seeYourPhotosOnTheMap',
      whyKey: 'dashboard.description.photosCarryingGpsDataAppearWhereTheyWereTaken',
      ctaKey: 'dashboard.label.openTheMap',
      href: '/map',
    },
    {
      key: 'mobile',
      titleKey: 'dashboard.heading.installTheMobileApp',
      whyKey: 'dashboard.description.backUpYourCameraRollInTheBackground',
      ctaKey: 'dashboard.label.getTheApp',
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
