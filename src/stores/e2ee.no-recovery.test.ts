import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recoveryUnlockFrom, useE2ee, type E2eeEngine } from './e2ee';

/**
 * The web app builds against the VENDORED e2ee bundle (apps/web/vendor),
 * re-vendored by hand from packages/e2ee-client. Until that lands, the bundle
 * has no `unlockWithRecoveryKey` at all - the shape of the module TODAY - and
 * the adapter that copes with it had no test of its own: nothing proved the
 * app degrades to a sentence instead of a TypeError, and deleting the fallback
 * would have gone unnoticed.
 *
 * The resolver is tested directly rather than through `vi.mock`, because
 * vitest's mocked-module guard throws on ANY access to an export the factory
 * omitted - which is the one thing this code must survive.
 */
describe('recoveryUnlockFrom', () => {
  it('is null for the bundle shape shipping today (no such export)', () => {
    expect(recoveryUnlockFrom({})).toBeNull();
    expect(recoveryUnlockFrom(undefined)).toBeNull();
  });

  it('is null when the export exists but is not callable', () => {
    expect(recoveryUnlockFrom({ unlockWithRecoveryKey: 'soon' })).toBeNull();
    expect(recoveryUnlockFrom({ unlockWithRecoveryKey: null })).toBeNull();
  });

  it('hands back the function once the bundle carries one', () => {
    const fn = vi.fn();
    expect(recoveryUnlockFrom({ unlockWithRecoveryKey: fn })).toBe(fn);
  });
});

function engineThatCannotRecover(): E2eeEngine {
  return {
    hasIdentity: async () => true,
    setup: async () => ({ recoveryKeyHex: 'ab12' }),
    unlock: async () => {},
    unlockWithRecoveryKey: async () => { throw new Error('e2ee: recovery unlock unavailable in this build'); },
    destroyIdentity: async () => {},
    lock: () => {},
    createWorkspace: async () => {},
    setWorkspaceScope: async () => {},
    openWorkspace: async () => {},
    listFolder: async () => [],
    uploadFile: async () => {},
    downloadFile: async () => new Uint8Array(),
    listMembers: async () => [],
    inviteMember: async () => {},
    revokeMember: async () => {},
    listMyWorkspaces: async () => [],
  };
}

beforeEach(() => {
  useE2ee.setState({ status: 'locked', error: null, hasIdentity: true, busy: false });
});

describe('the store, when the build cannot do recovery unlock', () => {
  it('blames the build, not the key - the key was never tried', async () => {
    useE2ee.getState().__setEngine(engineThatCannotRecover());

    await useE2ee.getState().unlockWithRecoveryKey('ab12cd34');

    const error = useE2ee.getState().error ?? '';
    expect(useE2ee.getState().status).toBe('locked');
    expect(error).not.toMatch(/did not unlock/i);
    expect(error).toMatch(/not available in this version/i);
  });
});
