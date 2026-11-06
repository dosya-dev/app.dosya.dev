// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { webKeyStore, webLocalCache } from './ports';
import { clearKeyIfLastWorkspace, wipePersonasDevice } from './wipe';
import { FakeIdbFactory } from './__fixtures__/fake-idb';

describe('wipePersonasDevice', () => {
  it("removes the user's key and snapshots, and leaves another user's", async () => {
    const idb = new FakeIdbFactory().asFactory();
    const keys = webKeyStore(idb);
    const cache = webLocalCache(idb);
    await keys.set('u1', new Uint8Array([1, 2, 3]));
    await keys.set('u2', new Uint8Array([4, 5, 6]));
    await cache.save('u1', 'w1', new Uint8Array([9]));
    await cache.save('u1', 'w2', new Uint8Array([9]));
    await cache.save('u2', 'w1', new Uint8Array([8]));

    await wipePersonasDevice('u1', idb);

    expect(await keys.get('u1')).toBeNull();
    expect(await cache.load('u1', 'w1')).toBeNull();
    expect(await cache.load('u1', 'w2')).toBeNull();
    expect(await keys.get('u2')).toEqual(new Uint8Array([4, 5, 6]));
    expect(await cache.load('u2', 'w1')).toEqual(new Uint8Array([8]));
  });

  it('does nothing without a user and never throws when storage fails', async () => {
    await expect(wipePersonasDevice(null)).resolves.toBeUndefined();
    const broken = { open: () => { throw new Error('blocked'); } };
    await expect(wipePersonasDevice('u1', broken as never)).resolves.toBeUndefined();
  });
});

describe('clearKeyIfLastWorkspace', () => {
  it('clears the key only when no other workspace snapshot of the user is left', async () => {
    const idb = new FakeIdbFactory().asFactory();
    const keys = webKeyStore(idb);
    const cache = webLocalCache(idb);
    await keys.set('u1', new Uint8Array([1]));
    await cache.save('u1', 'w2', new Uint8Array([9]));
    await clearKeyIfLastWorkspace('u1', idb);
    expect(await keys.get('u1')).not.toBeNull();
    await cache.clear('u1', 'w2');
    await clearKeyIfLastWorkspace('u1', idb);
    expect(await keys.get('u1')).toBeNull();
  });

  it('never throws when storage is unavailable', async () => {
    const broken = { open: () => { throw new Error('blocked'); } };
    await expect(clearKeyIfLastWorkspace('u1', broken as never)).resolves.toBeUndefined();
    await expect(clearKeyIfLastWorkspace(null)).resolves.toBeUndefined();
  });
});
