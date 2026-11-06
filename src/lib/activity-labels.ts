/**
 * Web-owned mapper from the activity vocabulary to catalog messages.
 *
 * lib/activity-catalog.generated.ts is generated from packages/shared and holds
 * English only: a verb phrase per action code ("uploaded a new version of"),
 * a label per filterable action ("Version uploaded"), a label per category and
 * a user-agent parser. The feed renders "<actor> <phrase> <subject>" itself, so
 * the actor and the subject (user content) are never part of a message; this
 * module translates the phrase, the labels and the device names, and nothing
 * else.
 *
 * Every lookup starts from the generated English, so the English output is the
 * generated text by construction, and a code or label the catalog does not know
 * (a new server action, a phrase with no catalog entry) shows the generated
 * text as it is.
 */
import {
  ACTIVITY_CATEGORIES, CATEGORY_ACTIONS, actionPhrase, actionsForCategories, parseUA,
  type ActivityOption, type ParsedUA,
} from '@/lib/activity-catalog.generated';
import type { MessageKey } from '@/i18n/keys';
import { t } from '@/lib/i18n';

/** The generated English text to its catalog key. */
const KEY_BY_ENGLISH: Record<string, MessageKey> = {
  // categories
  Files: 'common.label.files',
  Folders: 'common.label.folders',
  Sharing: 'common.label.sharing',
  Members: 'common.label.members',
  Workspace: 'common.label.workspace',
  Comments: 'common.label.comments',
  // action labels
  'File uploaded': 'common.label.fileUploaded',
  'Version uploaded': 'common.label.versionUploaded',
  'File downloaded': 'common.label.fileDownloaded',
  'File deleted': 'common.label.fileDeleted',
  'Permanently deleted': 'common.label.permanentlyDeleted',
  'File restored': 'common.label.fileRestored',
  'File renamed': 'common.label.fileRenamed',
  'File moved': 'common.label.fileMoved',
  'File copied': 'common.label.fileCopied',
  'File locked': 'common.label.fileLocked',
  'File hidden': 'common.label.fileHidden',
  'Folder created': 'common.label.folderCreated',
  'Folder renamed': 'common.label.folderRenamed',
  'Folder moved': 'common.label.folderMoved',
  'Folder deleted': 'common.label.folderDeleted',
  'File shared (link)': 'common.label.fileSharedLink',
  'File shared (email)': 'common.label.fileSharedEmail',
  'Folder shared': 'common.label.folderShared',
  'Link revoked': 'common.label.linkRevoked',
  'File request created': 'common.label.fileRequestCreated',
  'Request upload': 'common.label.requestUpload',
  'Request revoked': 'common.label.requestRevoked',
  'Member invited': 'common.label.memberInvited',
  'Member joined': 'common.label.memberJoined',
  'Member removed': 'common.label.memberRemoved',
  'Member left': 'common.label.memberLeft',
  'Invite revoked': 'common.label.inviteRevoked',
  'Ownership transferred': 'common.label.ownershipTransferred',
  'Member role changed': 'common.label.memberRoleChanged',
  'Folder access changed': 'common.label.folderAccessChanged',
  'Workspace created': 'common.label.workspaceCreated',
  'Workspace updated': 'common.label.workspaceUpdated',
  'Settings changed': 'common.label.settingsChanged',
  'Role updated': 'common.label.roleUpdated',
  'Role deleted': 'common.label.roleDeleted',
  'Comment added': 'common.label.commentAdded',
  'Comment deleted': 'common.label.commentDeleted',
  // verb phrases that read after an actor's name
  uploaded: 'activity.label.uploaded',
  downloaded: 'activity.label.downloaded',
  deleted: 'activity.label.deleted',
  restored: 'activity.label.restored',
  renamed: 'activity.label.renamed',
  moved: 'activity.label.moved',
  copied: 'activity.label.copied',
  locked: 'activity.label.locked',
  unlocked: 'activity.label.unlocked',
  shared: 'activity.label.shared',
  invited: 'activity.label.invited',
  joined: 'activity.label.joined',
  removed: 'activity.label.removed',
  favourited: 'activity.label.favourited',
  unfavourited: 'activity.label.unfavourited',
  'uploaded a new version of': 'common.label.uploadedANewVersionOf',
  'permanently deleted': 'common.label.permanentlyDeleted.permanentlyDeleted',
  'changed visibility of': 'common.label.changedVisibilityOf',
  'created folder': 'common.label.createdFolder',
  'renamed folder': 'common.label.renamedFolder',
  'moved folder': 'common.label.movedFolder',
  'deleted folder': 'common.label.deletedFolder',
  'shared via email': 'common.label.sharedViaEmail',
  'shared folder': 'common.label.sharedFolder',
  'revoked link for': 'common.label.revokedLinkFor',
  'created file request': 'common.label.createdFileRequest',
  'uploaded to request': 'common.label.uploadedToRequest',
  'revoked file request': 'common.label.revokedFileRequest',
  'left the workspace': 'common.label.activityLeftTheWorkspaceFragment',
  'revoked invite for': 'common.label.revokedInviteFor',
  'transferred ownership to': 'common.label.transferredOwnershipTo',
  'changed the folder access of': 'common.label.changedTheFolderAccessOf',
  'changed the role of': 'common.label.changedTheRoleOf',
  'created workspace': 'common.label.createdWorkspace',
  'updated workspace': 'common.label.updatedWorkspace',
  'changed settings': 'common.label.changedSettings',
  'updated settings': 'common.label.updatedSettings',
  'updated role': 'common.label.updatedRole',
  'deleted role': 'common.label.deletedRole',
  'changed role of': 'common.label.changedRoleOf',
  'commented on': 'common.label.commentedOn',
  'deleted comment on': 'common.label.deletedCommentOn',
  'locked folder': 'common.label.lockedFolder',
  'unlocked folder': 'common.label.unlockedFolder',
  'changed visibility of folder': 'common.label.changedVisibilityOfFolder',
  'deleted multiple files': 'common.label.deletedMultipleFiles',
  'unlocked share link': 'common.label.unlockedShareLink',
  'edited comment on': 'common.label.editedCommentOn',
  'created role': 'common.label.createdRole',
  'created group': 'common.label.createdGroup',
  'updated group': 'common.label.updatedGroup',
  'deleted group': 'common.label.deletedGroup',
  'added to group': 'common.label.addedToGroup',
  'removed from group': 'common.label.removedFromGroup',
  'reported (DMCA)': 'common.label.reportedDmca',
  'started a sync': 'common.label.startedASync',
  'completed a sync': 'common.label.completedASync',
  'sync failed': 'common.error.syncFailed',
  'updated profile': 'common.label.updatedProfile',
  'changed plan': 'common.label.changedPlan',
  'redeemed a Gumroad package': 'common.label.redeemedAGumroadPackage',
  'redeemed a coupon code': 'common.label.redeemedACouponCode',
};

/** The generated English text in the chosen language; unknown text as it is. */
function translated(english: string): string {
  const key = KEY_BY_ENGLISH[english];
  return key ? t(key) : english;
}

/**
 * The verb phrase after the actor's name: "uploaded a new version of".
 * A code the generated table does not know reads as its machine name, as sent.
 */
export function activityPhrase(action: string): string {
  return translated(actionPhrase(action));
}

/** The catalog key of an action's phrase, or null when the catalog has none. */
export function activityPhraseKey(action: string): MessageKey | null {
  return KEY_BY_ENGLISH[actionPhrase(action)] ?? null;
}

/** A category or action option with its label in the chosen language. */
export function localizedOption(option: ActivityOption): ActivityOption {
  return { value: option.value, label: translated(option.label) };
}

/** The category filter's options, in the chosen language. */
export function localizedCategories(): ActivityOption[] {
  return ACTIVITY_CATEGORIES.map(localizedOption);
}

/** The action filter's options for the chosen categories, in the chosen language. */
export function localizedActionsFor(categories: Iterable<string>): ActivityOption[] {
  return actionsForCategories(categories).map(localizedOption);
}

/** Whether a category code is one the catalog offers. */
export const isActivityCategory = (value: string): boolean => value in CATEGORY_ACTIONS;

const BROWSER_KEYS: Record<string, MessageKey> = {
  Edge: 'common.label.edgeM',
  Opera: 'common.label.operaM',
  Firefox: 'common.label.firefoxM',
  Chrome: 'common.label.chromeM',
  Safari: 'common.label.safariM',
};

const OS_KEYS: Record<string, MessageKey> = {
  Windows: 'common.label.windows',
  Android: 'common.label.android',
  ChromeOS: 'common.label.chromeos',
  Linux: 'common.label.linux',
};

/** parseUA with the browser and system names in the chosen language. */
export function describeDevice(ua: string | null | undefined): ParsedUA {
  const parsed = parseUA(ua);
  let browser = parsed.browser;
  const versioned = /^(Edge|Opera|Firefox|Chrome|Safari) (\d+)$/.exec(browser);
  if (versioned) browser = t(BROWSER_KEYS[versioned[1]], { m: versioned[2] });
  else if (browser === 'Safari') browser = t('common.label.safari');
  else if (browser === 'Unknown') browser = t('common.label.unknown');
  const osKey = OS_KEYS[parsed.os];
  return { browser, os: osKey ? t(osKey) : parsed.os };
}
