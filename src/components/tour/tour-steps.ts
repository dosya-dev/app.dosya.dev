/**
 * Copy for the five-page welcome tour.
 *
 * Pure data, no React, so the wording is testable and the layout does not
 * have to change when the words do. Every claim here describes something the
 * product actually ships - see the security page in particular.
 */

import type { MessageKey } from '@/i18n/keys';
import { t } from '@/lib/i18n';

export type TourStepId = 'welcome' | 'sharing' | 'security' | 'integrations' | 'ready';

export interface TourPoint {
  titleKey: MessageKey;
  /** One short sentence. No em dashes. */
  bodyKey: MessageKey;
  /** The translated title, resolved when read (never at import time). */
  readonly title: string;
  readonly body: string;
}

export interface TourStep {
  id: TourStepId;
  headingKey: MessageKey;
  /** The translated heading, resolved when read. */
  readonly heading: string;
  points: TourPoint[];
}

type PointKeys = { titleKey: MessageKey; bodyKey: MessageKey };
type StepKeys = { id: TourStepId; headingKey: MessageKey; points: PointKeys[] };

// The table below holds catalog keys only. The getters translate with the
// language current at the moment they are read, so no sentence is frozen here.
function point({ titleKey, bodyKey }: PointKeys): TourPoint {
  return { titleKey, bodyKey, get title() { return t(titleKey); }, get body() { return t(bodyKey); } };
}
function step({ id, headingKey, points }: StepKeys): TourStep {
  return { id, headingKey, get heading() { return t(headingKey); }, points: points.map(point) };
}

const STEP_KEYS: StepKeys[] = [
  {
    id: 'welcome',
    headingKey: 'onboarding.heading.welcomeToDosyaDev',
    points: [
      { titleKey: 'common.heading.upload', bodyKey: 'welcome.description.dragAnythingInFoldersLargeVideoFilesWholeArchives' },
      { titleKey: 'common.heading.share', bodyKey: 'welcome.description.oneLinkWithAnExpiryAndAPasswordIfYouWant' },
      { titleKey: 'welcome.heading.invite', bodyKey: 'welcome.description.bringYourTeamIntoASharedWorkspaceWithRoles' },
      { titleKey: 'welcome.heading.fast', bodyKey: 'welcome.description.noUploadCapsAndNoDownloadThrottlingOnAnyPlan' },
    ],
  },
  {
    id: 'sharing',
    headingKey: 'welcome.heading.sendFilesAndAskForThemBack',
    points: [
      { titleKey: 'welcome.heading.shareALink', bodyKey: 'welcome.description.thePersonYouSendItToOpensItInABrowser' },
      { titleKey: 'welcome.heading.setTheTerms', bodyKey: 'welcome.description.addAnExpiryDateAPasswordOrLimitItToCertain' },
      { titleKey: 'welcome.heading.collectUploads', bodyKey: 'welcome.description.aFileRequestGathersFilesFromPeopleIntoAFolderYou' },
      { titleKey: 'welcome.heading.workTogether', bodyKey: 'welcome.description.rolesDecideWhoCanUploadShareMoveAndDelete' },
    ],
  },
  {
    // Every line here is a shipped feature. The vault's zero-knowledge
    // question is unresolved, so nothing on this page claims it.
    id: 'security',
    headingKey: 'welcome.heading.yourFilesOnYourTerms',
    points: [
      { titleKey: 'welcome.heading.encryptedAtRest', bodyKey: 'welcome.description.filesAreEncryptedWhereTheyAreStored' },
      { titleKey: 'welcome.heading.chooseYourLocation', bodyKey: 'welcome.description.pickWhereAWorkspaceStoresItsFilesWhenYouCreateIt' },
      { titleKey: 'welcome.heading.seeEveryAction', bodyKey: 'welcome.description.aTamperEvidentAuditTrailRecordsWhatHappenedAndWhen' },
      { titleKey: 'welcome.heading.lockYourAccount', bodyKey: 'welcome.description.twoFactorAuthenticationWithAnAppOrByEmail' },
    ],
  },
  {
    id: 'integrations',
    headingKey: 'welcome.heading.itFitsWhatYouAlreadyUse',
    points: [
      { titleKey: 'welcome.heading.mountItLikeADrive', bodyKey: 'welcome.description.webdavAndS3WorkWithFinderRcloneAndYourOwnCode' },
      { titleKey: 'welcome.heading.useItFromTheTerminal', bodyKey: 'welcome.description.theCliMovesFilesAndSyncsFoldersFromAnyShell' },
      { titleKey: 'welcome.heading.bringYourData', bodyKey: 'welcome.description.importStraightFromGoogleDriveWithoutDownloadingFirst' },
      { titleKey: 'welcome.heading.pasteAUrl', bodyKey: 'welcome.description.weFetchTheFileIntoYourStorageForYou' },
    ],
  },
  {
    id: 'ready',
    headingKey: 'welcome.heading.youAreReadyToGo',
    points: [
      { titleKey: 'welcome.heading.freeForever', bodyKey: 'welcome.description.yourPlanIncludes5GbWithNoTimeLimit' },
      { titleKey: 'welcome.heading.earnMoreSpace', bodyKey: 'welcome.description.everyFriendWhoStartsUsingDosyaAdds5GbUpTo' },
      { titleKey: 'welcome.heading.startAnywhere', bodyKey: 'welcome.description.theWebAppTheDesktopAppTheCliOrAMounted' },
    ],
  },
];

export const TOUR_STEPS: TourStep[] = STEP_KEYS.map(step);
