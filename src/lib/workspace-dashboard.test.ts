import { describe, it, expect } from 'vitest';
import { storageColor, stackedSegments, roleLabel, type OwnedWorkspace } from './workspace-dashboard';

const ws = (id: string, used_bytes: number): OwnedWorkspace => ({
  id, name: id, icon_initials: 'X', icon_color: '#000', icon_image_url: null,
  used_bytes, share_pct: 0,
});

describe('storageColor', () => {
  it('is green up to 70%, amber up to 90%, red above', () => {
    expect(storageColor(0)).toBe('#22c55e');
    expect(storageColor(70)).toBe('#22c55e');
    expect(storageColor(71)).toBe('#D97706');
    expect(storageColor(90)).toBe('#D97706');
    expect(storageColor(91)).toBe('#ef4444');
  });
});

describe('stackedSegments', () => {
  it('returns filled-portion widths that sum to ~100, skipping zero-usage rows', () => {
    const segs = stackedSegments([ws('a', 30), ws('b', 10), ws('c', 0)], 40);
    expect(segs.map((s) => s.id)).toEqual(['a', 'b']);
    expect(segs[0].widthPct).toBeCloseTo(75);
    expect(segs[1].widthPct).toBeCloseTo(25);
  });
  it('excludes zero-usage rows regardless of position', () => {
    const segs = stackedSegments([ws('a', 0), ws('b', 30), ws('c', 10)], 40);
    expect(segs.map((s) => s.id)).toEqual(['b', 'c']);
  });
  it('divides by the usedBytes parameter, not the array sum', () => {
    const segs = stackedSegments([ws('a', 30), ws('b', 10)], 50);
    expect(segs[0].widthPct).toBeCloseTo(60);
    expect(segs[1].widthPct).toBeCloseTo(20);
  });
  it('returns [] when nothing is used', () => {
    expect(stackedSegments([ws('a', 0)], 0)).toEqual([]);
  });
});

describe('roleLabel', () => {
  it('maps the four builtins and calls anything else a custom role', () => {
    expect(roleLabel('role_owner')).toBe('Owner');
    expect(roleLabel('role_admin')).toBe('Admin');
    expect(roleLabel('role_member')).toBe('Member');
    expect(roleLabel('role_viewer')).toBe('Viewer');
    // Deliberately NOT 'Member'. A workspace-defined role has an id like
    // `role_a1b2c3`, and labelling it "Member" asserted a specific builtin
    // role the holder does not have - so a workspace running on custom roles
    // rendered as if everyone were a plain member, everywhere this is used.
    expect(roleLabel('role_custom_xyz')).toBe('Custom role');
  });
});
