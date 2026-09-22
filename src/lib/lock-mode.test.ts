import { describe, expect, it } from 'vitest';
import {
  LOCK_MODE_OPTIONS, MIN_LOCK_PASSWORD_LENGTH,
  canApplyLock, describeLockMode, describeLockStatus, describeLockTarget,
  lockActionLabel, passwordFieldLabel, passwordHint,
} from './lock-mode';

describe('LOCK_MODE_OPTIONS', () => {
  it('offers the three modes in order, with the user-facing labels', () => {
    expect(LOCK_MODE_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ['none', 'Unlocked'], ['view_only', 'View only'], ['full_lock', 'Password'],
    ]);
  });
});

describe('describeLockMode', () => {
  it('tells a file owner what each mode allows', () => {
    expect(describeLockMode('file', 'none')).toBe('Anyone with access to it can open, download and edit it.');
    expect(describeLockMode('file', 'view_only')).toBe('Members can preview it in the viewer, but not download or edit it.');
    expect(describeLockMode('file', 'full_lock')).toBe('Opens only with a password. An unlock lasts an hour, and share links to it stop working while it is locked.');
  });

  it('tells a folder owner the folder-specific consequences', () => {
    expect(describeLockMode('folder', 'none')).toBe('Anyone with access to it can open it and work with everything inside.');
    expect(describeLockMode('folder', 'view_only')).toBe('Members can browse and preview what is inside, but not download it.');
    expect(describeLockMode('folder', 'full_lock')).toBe('Opens only with a password. While it is locked nothing can be added inside and share links to its contents stop working. An unlock lasts an hour.');
  });
});

describe('lockActionLabel', () => {
  it('names the change the button will make', () => {
    expect(lockActionLabel({ selected: 'none', current: 'full_lock' })).toBe('Remove lock');
    expect(lockActionLabel({ selected: 'view_only', current: 'none' })).toBe('Set view only');
    expect(lockActionLabel({ selected: 'full_lock', current: 'none' })).toBe('Lock with password');
    expect(lockActionLabel({ selected: 'full_lock', current: 'view_only' })).toBe('Lock with password');
  });

  it('offers a password change when the item is already password-locked', () => {
    expect(lockActionLabel({ selected: 'full_lock', current: 'full_lock' })).toBe('Update password');
  });

  it('stays neutral while the current mode is still loading', () => {
    expect(lockActionLabel({ selected: 'none', current: 'none', loading: true })).toBe('Apply');
  });
});

describe('canApplyLock', () => {
  it('is off until something would change', () => {
    expect(canApplyLock({ selected: 'none', current: 'none', password: '' })).toBe(false);
    expect(canApplyLock({ selected: 'view_only', current: 'view_only', password: '' })).toBe(false);
    expect(canApplyLock({ selected: 'none', current: 'view_only', password: '' })).toBe(true);
    expect(canApplyLock({ selected: 'view_only', current: 'none', password: '' })).toBe(true);
  });

  it('needs a password of at least the minimum length for a password lock', () => {
    expect(MIN_LOCK_PASSWORD_LENGTH).toBe(4);
    expect(canApplyLock({ selected: 'full_lock', current: 'none', password: 'abc' })).toBe(false);
    expect(canApplyLock({ selected: 'full_lock', current: 'none', password: '   abc ' })).toBe(false);
    expect(canApplyLock({ selected: 'full_lock', current: 'none', password: 'abcd' })).toBe(true);
    // Re-choosing Password on a password-locked item is a password change, so it still needs one.
    expect(canApplyLock({ selected: 'full_lock', current: 'full_lock', password: '' })).toBe(false);
    expect(canApplyLock({ selected: 'full_lock', current: 'full_lock', password: 'new-one' })).toBe(true);
  });

  it('is off while loading, whatever is selected', () => {
    expect(canApplyLock({ selected: 'none', current: 'full_lock', password: '', loading: true })).toBe(false);
    expect(canApplyLock({ selected: 'full_lock', current: 'none', password: 'abcd', loading: true })).toBe(false);
  });
});

describe('password field copy', () => {
  it('asks for a new password only when one already exists', () => {
    expect(passwordFieldLabel('none')).toBe('Password');
    expect(passwordFieldLabel('view_only')).toBe('Password');
    expect(passwordFieldLabel('full_lock')).toBe('New password');
    expect(passwordHint('none')).toBe('At least 4 characters.');
    expect(passwordHint('full_lock')).toBe('At least 4 characters. Replaces the current one.');
  });
});

describe('describeLockStatus', () => {
  it('is empty for an unlocked item', () => {
    expect(describeLockStatus({ lock_mode: 'none', locked_by_name: 'Firat Kaya', lockedWhen: '2d ago' })).toBeNull();
  });

  it('says who set the lock and when, as the API reports them', () => {
    expect(describeLockStatus({ lock_mode: 'full_lock', locked_by_name: 'Firat Kaya', lockedWhen: '2d ago' })).toBe('Password lock · set by Firat Kaya, 2d ago');
    expect(describeLockStatus({ lock_mode: 'view_only', locked_by_name: 'Firat Kaya', lockedWhen: '2d ago' })).toBe('View only · set by Firat Kaya, 2d ago');
  });

  it('degrades when only part of the provenance is known', () => {
    expect(describeLockStatus({ lock_mode: 'full_lock', locked_by_name: 'Firat Kaya' })).toBe('Password lock · set by Firat Kaya');
    expect(describeLockStatus({ lock_mode: 'full_lock', lockedWhen: '2d ago' })).toBe('Password lock · set 2d ago');
    expect(describeLockStatus({ lock_mode: 'full_lock' })).toBe('Currently password-locked');
    expect(describeLockStatus({ lock_mode: 'view_only', locked_by_name: null, lockedWhen: null })).toBe('Currently view only');
  });
});

describe('describeLockTarget', () => {
  it('summarises a folder by its contents', () => {
    expect(describeLockTarget({ kind: 'folder', file_count: 128, size: '1.9 GB' })).toBe('Folder · 128 files · 1.9 GB');
    expect(describeLockTarget({ kind: 'folder', file_count: 1, size: '12 KB' })).toBe('Folder · 1 file · 12 KB');
    expect(describeLockTarget({ kind: 'folder', file_count: 0 })).toBe('Folder · 0 files');
    expect(describeLockTarget({ kind: 'folder' })).toBe('Folder');
  });

  it('summarises a file by its type and size', () => {
    expect(describeLockTarget({ kind: 'file', extension: 'pdf', size: '2.4 MB' })).toBe('PDF · 2.4 MB');
    expect(describeLockTarget({ kind: 'file', extension: '', size: '2.4 MB' })).toBe('File · 2.4 MB');
    expect(describeLockTarget({ kind: 'file', extension: 'jpg' })).toBe('JPG');
    expect(describeLockTarget({ kind: 'file' })).toBe('File');
  });
});
