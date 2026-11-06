/**
 * The lock dialog's model: everything the dialog says, decided in one place
 * so the three clients describe the same lock_mode the same way.
 *
 * Desktop and mobile carry ports of this file
 * (apps/desktop/src/renderer/lib/lock-mode.ts, apps/mobile/src/files/protection.ts):
 * neither consumes web's UI copy through a package, so a copy change here is a
 * copy change there.
 */

import { t } from '@/lib/i18n';

export type LockMode = 'none' | 'view_only' | 'full_lock';
export type LockKind = 'file' | 'folder';

/** The server rejects anything shorter (POST /api/files/:id/lock). */
export const MIN_LOCK_PASSWORD_LENGTH = 8;

// `label` is a getter so the name is translated when it is read (at render),
// never frozen at import time.
export const LOCK_MODE_OPTIONS: readonly { value: LockMode; readonly label: string }[] = [
  { value: 'none', get label() { return t('file-security.label.unlocked'); } },
  { value: 'view_only', get label() { return t('files.label.viewOnly'); } },
  { value: 'full_lock', get label() { return t('common.label.password'); } },
];

// Each sentence maps to shipped behaviour in the API's download-guard and
// share lock-gate: view_only denies the bytes but not the preview; full_lock
// hands out one-hour unlock tokens, seals a folder against additions, and
// refuses share links to the item.
// The table holds message KEYS; describeLockMode translates at call time.
const DESCRIPTIONS = {
  file: {
    none: 'file-security.label.anyoneWithAccessToItCanOpenDownloadAnd',
    view_only: 'file-security.label.membersCanPreviewItInTheViewerButNot',
    full_lock: 'file-security.description.opensOnlyWithAPasswordAnUnlockLastsAn',
  },
  folder: {
    none: 'file-security.label.anyoneWithAccessToItCanOpenItAnd',
    view_only: 'file-security.label.membersCanBrowseAndPreviewWhatIsInsideBut',
    full_lock: 'file-security.description.opensOnlyWithAPasswordWhileItIsLocked',
  },
} as const;

export function describeLockMode(kind: LockKind, mode: LockMode): string {
  return t(DESCRIPTIONS[kind][mode]);
}

/** What the primary button will do. Neutral while the current mode is unknown. */
export function lockActionLabel(input: { selected: LockMode; current: LockMode; loading?: boolean }): string {
  if (input.loading) return t('files.label.apply');
  if (input.selected === 'none') return t('files.label.removeLock');
  if (input.selected === 'view_only') return t('files.label.setViewOnly');
  return input.current === 'full_lock' ? t('files.label.updatePassword') : t('files.label.lockWithPassword');
}

/**
 * Whether pressing the button would do anything the server accepts. A password
 * lock always needs a password - the server has no "keep the old one" path -
 * so re-choosing Password on a locked item is a password change, not a no-op.
 */
export function canApplyLock(input: { selected: LockMode; current: LockMode; password: string; loading?: boolean }): boolean {
  if (input.loading) return false;
  if (input.selected === 'full_lock') return input.password.trim().length >= MIN_LOCK_PASSWORD_LENGTH;
  return input.selected !== input.current;
}

export function passwordFieldLabel(current: LockMode): string {
  return current === 'full_lock' ? t('common.label.newPassword') : t('common.label.password');
}

export function passwordHint(current: LockMode): string {
  const base = t('files.description.atLeastMinLockPasswordLengthCharacters', { minLockPasswordLength: MIN_LOCK_PASSWORD_LENGTH });
  return current === 'full_lock' ? t('files.description.baseReplacesTheCurrentOne', { base }) : base;
}

/**
 * The "already locked" line. `lockedWhen` is pre-formatted by the caller
 * (each client has its own relative-time helper). Null when there is no lock.
 */
export function describeLockStatus(input: { lock_mode: string; locked_by_name?: string | null; lockedWhen?: string | null }): string | null {
  const mode = input.lock_mode;
  if (mode !== 'full_lock' && mode !== 'view_only') return null;
  const by = input.locked_by_name?.trim();
  const when = input.lockedWhen?.trim();
  if (!by && !when) return mode === 'full_lock' ? t('file-security.label.currentlyPasswordLocked') : t('file-security.label.currentlyViewOnly');
  const base = mode === 'full_lock' ? t('files.label.passwordLock') : t('files.label.viewOnly');
  if (by && when) return t('files.label.baseSetByByWhen', { base, by, when });
  if (by) return t('files.label.baseSetByBy', { base, by });
  return t('files.label.baseSetWhen', { base, when: when ?? '' });
}

/** The chip under the title. `size` is pre-formatted; unknown parts are left out. */
export function describeLockTarget(input: { kind: LockKind; extension?: string | null; size?: string | null; file_count?: number | null }): string {
  const parts: string[] = [];
  if (input.kind === 'folder') {
    parts.push(t('common.label.folder'));
    // TODO(catalog): borrowed plural-files message from file-requests (no lock-mode entry).
    if (typeof input.file_count === 'number') parts.push(t('file-requests.status.ruploadCountPluralOneFileOtherFiles', { rUpload_count: input.file_count }));
  } else {
    const ext = input.extension?.trim();
    parts.push(ext ? ext.toUpperCase() : t('common.label.fileTitleCase'));
  }
  if (input.size) parts.push(input.size);
  return parts.join(' · ');
}
