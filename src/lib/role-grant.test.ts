import { describe, it, expect } from 'vitest';
import { permissionsBeyondGrantor, canGrantRole, permissionsNamedInRefusal } from './role-grant';

// Mirrors the grant rule in apps/api/src/lib/role-rank.ts. If a case here
// disagrees with the server, the server is right and this file is stale.

const ALL_TRUE: Record<string, boolean> = {
  upload_files: true, download_files: true, lock_files: true, hide_files: true,
  manage_roles: true, invite_members: true, view_team_members: true, access_team: true, access_files: true,
};
// The built-in admin: everything except the two file-management grants.
const ADMIN_PERMS: Record<string, boolean> = {
  ...ALL_TRUE, lock_files: false, hide_files: false,
};
const MEMBER_PERMS: Record<string, boolean> = {
  upload_files: true, download_files: true, access_files: true,
};
const VIEWER_PERMS: Record<string, boolean> = {
  download_files: true, access_files: true,
};

const OWNER = { id: 'role_owner', is_builtin: true, permissions: { ...ALL_TRUE } };
const ADMIN = { id: 'role_admin', is_builtin: true, permissions: { ...ADMIN_PERMS } };
const MEMBER = { id: 'role_member', is_builtin: true, permissions: { ...MEMBER_PERMS } };
const VIEWER = { id: 'role_viewer', is_builtin: true, permissions: { ...VIEWER_PERMS } };

describe('permissionsBeyondGrantor', () => {
  it('names the requested grants the grantor lacks, in request order', () => {
    expect(permissionsBeyondGrantor(ADMIN_PERMS, { lock_files: true, upload_files: true, hide_files: true }))
      .toEqual(['lock_files', 'hide_files']);
  });

  it('never counts a requested false or an unrequested key as an escalation', () => {
    expect(permissionsBeyondGrantor({}, { lock_files: false })).toEqual([]);
    expect(permissionsBeyondGrantor({ upload_files: true }, {})).toEqual([]);
  });
});

describe('canGrantRole', () => {
  it('never lets anyone grant owner, not even an owner holding everything', () => {
    expect(canGrantRole(ALL_TRUE, OWNER)).toBe(false);
    expect(canGrantRole(ADMIN_PERMS, OWNER)).toBe(false);
  });

  it('lets an admin grant admin, member and viewer', () => {
    expect(canGrantRole(ADMIN_PERMS, ADMIN)).toBe(true);
    expect(canGrantRole(ADMIN_PERMS, MEMBER)).toBe(true);
    expect(canGrantRole(ADMIN_PERMS, VIEWER)).toBe(true);
  });

  it('refuses a custom target carrying lock_files to an admin who lacks it', () => {
    const target = { id: 'role_custom_locker', is_builtin: false, permissions: { upload_files: true, lock_files: true } };
    expect(canGrantRole(ADMIN_PERMS, target)).toBe(false);
  });

  it('allows a custom target whose grants sit within the caller permissions', () => {
    const target = { id: 'role_custom_uploader', is_builtin: false, permissions: { upload_files: true, download_files: true, lock_files: false } };
    expect(canGrantRole(ADMIN_PERMS, target)).toBe(true);
  });

  it('holds built-in targets to the same ceiling: a team manager without download_files cannot grant viewer', () => {
    // Before the rule was simplified the four built-in tiers were exempt from
    // the ceiling and a "team manager" made of invite_members + manage_roles
    // could add viewers. Now every grant, built-in or custom, must sit within
    // what the caller holds, and viewers hold download_files the manager lacks.
    const perms = { invite_members: true, manage_roles: true, view_team_members: true, access_team: true };
    expect(canGrantRole(perms, VIEWER)).toBe(false);
    expect(canGrantRole(perms, MEMBER)).toBe(false);
    expect(canGrantRole(perms, ADMIN)).toBe(false);
  });

  it('no longer lifts a custom-role caller holding manage_roles above what it holds', () => {
    const perms = { invite_members: true, manage_roles: true };
    expect(canGrantRole(perms, ADMIN)).toBe(false);
    // A target made only of grants the caller holds is fine, whatever its id.
    expect(canGrantRole(perms, { id: 'role_custom_inviter', is_builtin: false, permissions: { invite_members: true } })).toBe(true);
  });

  it('lets an owner holding everything grant anything but owner', () => {
    expect(canGrantRole(ALL_TRUE, ADMIN)).toBe(true);
    expect(canGrantRole(ALL_TRUE, MEMBER)).toBe(true);
    expect(canGrantRole(ALL_TRUE, VIEWER)).toBe(true);
    const target = { id: 'role_custom_everything', is_builtin: false, permissions: { ...ALL_TRUE } };
    expect(canGrantRole(ALL_TRUE, target)).toBe(true);
  });

  it('treats a target with no permission map as granting nothing', () => {
    expect(canGrantRole({}, { id: 'role_custom_empty' })).toBe(true);
  });
});

describe('permissionsNamedInRefusal', () => {
  it('parses the keys after the colon of the server ceiling sentence', () => {
    expect(permissionsNamedInRefusal("You can't grant permissions you don't hold yourself: lock_files, hide_files"))
      .toEqual(['lock_files', 'hide_files']);
  });

  it('returns nothing for any other error', () => {
    expect(permissionsNamedInRefusal('You cannot edit your own role')).toEqual([]);
    expect(permissionsNamedInRefusal('Role name is required.')).toEqual([]);
  });
});
