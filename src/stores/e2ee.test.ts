import { describe, it, expect, beforeEach } from 'vitest';
import { useE2ee, type E2eeEngine, type EncryptedEntry, type KnownWorkspace } from './e2ee';

// jsdom (this vitest env, v25.0.1) implements Blob/File storage but not the
// async read methods (`arrayBuffer`/`text`) real browsers have long shipped —
// only `FileReader` can pull bytes out. Polyfill just enough for the
// `uploadFiles` test below to exercise the SAME `file.arrayBuffer()` call the
// production store code makes; this is a test-environment shim only, never
// shipped, and does not change what the store does in a real browser.
if (typeof File.prototype.arrayBuffer !== 'function') {
  File.prototype.arrayBuffer = function (this: File) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

function makeFakeEngine(overrides: Partial<E2eeEngine> = {}): E2eeEngine {
  return {
    hasIdentity: async () => true,
    setup: async () => ({ recoveryKeyHex: 'ab12' }),
    unlock: async () => {},
    lock: () => {},
    createWorkspace: async () => {},
    openWorkspace: async () => {},
    listFolder: async () => [],
    uploadFile: async () => {},
    downloadFile: async () => new Uint8Array(),
    ...overrides,
  };
}

/** Reset every field the tests touch between cases (actions live on the same object and are untouched by a partial setState). */
beforeEach(() => {
  localStorage.clear();
  useE2ee.setState({
    status: 'locked',
    error: null,
    hasIdentity: null,
    workspaces: [],
    activeWorkspaceId: null,
    entries: [],
    busy: false,
    recoveryKeyOnce: null,
  });
});

describe('useE2ee: unlock', () => {
  it('success sets status=unlocked and clears error', async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({ unlock: async () => {} }));

    await useE2ee.getState().unlock('correct horse battery staple');

    expect(useE2ee.getState().status).toBe('unlocked');
    expect(useE2ee.getState().error).toBeNull();
  });

  it('failure sets status=locked and a GENERIC error that never leaks the engine\'s message', async () => {
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        unlock: async () => {
          throw new Error('e2ee: unlock failed');
        },
      }),
    );

    await useE2ee.getState().unlock('wrong passphrase');

    expect(useE2ee.getState().status).toBe('locked');
    expect(useE2ee.getState().error).toBe('Incorrect passphrase or no identity found.');
    // No-leak: the surfaced message must not contain the engine's raw text.
    expect(useE2ee.getState().error).not.toContain('unlock failed');
  });
});

describe('useE2ee: setup', () => {
  it('success sets status=unlocked and recoveryKeyOnce; dismissRecoveryKey clears it', async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({ setup: async () => ({ recoveryKeyHex: 'ab12' }) }));

    await useE2ee.getState().setup('a brand new passphrase');

    expect(useE2ee.getState().status).toBe('unlocked');
    expect(useE2ee.getState().recoveryKeyOnce).toBe('ab12');

    useE2ee.getState().dismissRecoveryKey();

    expect(useE2ee.getState().recoveryKeyOnce).toBeNull();
  });
});

describe('useE2ee: createWorkspace', () => {
  it('adds {id,name} to workspaces and makes it the active workspace', async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({ createWorkspace: async () => {} }));

    await useE2ee.getState().createWorkspace('Docs');

    const { workspaces, activeWorkspaceId } = useE2ee.getState();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].name).toBe('Docs');
    expect(workspaces[0].id).toBeTruthy();
    expect(activeWorkspaceId).toBe(workspaces[0].id);
  });
});

describe('useE2ee: refreshFolder', () => {
  it('populates entries from the engine\'s listFolder', async () => {
    const fakeEntries: EncryptedEntry[] = [
      { id: '1', name: 'a.txt', kind: 'file' },
      { id: '2', name: 'sub', kind: 'folder' },
    ];
    useE2ee.getState().__setEngine(makeFakeEngine({ listFolder: async () => fakeEntries }));

    await useE2ee.getState().refreshFolder();

    expect(useE2ee.getState().entries).toHaveLength(2);
  });
});

describe('useE2ee: lock', () => {
  it('clears entries/activeWorkspaceId, sets status=locked, and calls engine.lock()', async () => {
    let lockCalled = false;
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        unlock: async () => {},
        listFolder: async () => [{ id: '1', name: 'a.txt', kind: 'file' }],
        lock: () => {
          lockCalled = true;
        },
      }),
    );

    await useE2ee.getState().unlock('pass');
    useE2ee.setState({ activeWorkspaceId: 'ws-1' });
    await useE2ee.getState().refreshFolder();
    expect(useE2ee.getState().entries).toHaveLength(1);

    useE2ee.getState().lock();

    expect(useE2ee.getState().status).toBe('locked');
    expect(useE2ee.getState().entries).toEqual([]);
    expect(useE2ee.getState().activeWorkspaceId).toBeNull();
    expect(lockCalled).toBe(true);
  });
});

describe('useE2ee: checkIdentity', () => {
  it('sets hasIdentity from the engine', async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({ hasIdentity: async () => false }));

    await useE2ee.getState().checkIdentity();

    expect(useE2ee.getState().hasIdentity).toBe(false);
  });
});

describe('useE2ee: uploadFiles', () => {
  it('uploads each file\'s bytes via the engine, then refreshes the folder', async () => {
    const uploadCalls: { folderId: string; name: string; text: string }[] = [];
    let listFolderCalled = false;
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        uploadFile: async (folderId, name, bytes) => {
          uploadCalls.push({ folderId, name, text: new TextDecoder().decode(bytes) });
        },
        listFolder: async () => {
          listFolderCalled = true;
          return [{ id: '1', name: 'a.txt', kind: 'file' }];
        },
      }),
    );

    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    await useE2ee.getState().uploadFiles([file]);

    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].name).toBe('a.txt');
    expect(uploadCalls[0].text).toBe('hello');
    expect(uploadCalls[0].folderId).toBe('');
    expect(listFolderCalled).toBe(true);
    expect(useE2ee.getState().entries).toHaveLength(1);
    expect(useE2ee.getState().busy).toBe(false);
  });
});

describe('useE2ee: downloadEntry', () => {
  it('downloads bytes via the engine and hands them to the injected saver', async () => {
    const fakeBytes = new TextEncoder().encode('secret content');
    let downloadedArgs: [string, string] | null = null;
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        downloadFile: async (_folderId, entryId) => {
          expect(entryId).toBe('id1');
          return fakeBytes;
        },
      }),
    );
    useE2ee.getState().__setSaver((name, bytes) => {
      downloadedArgs = [name, new TextDecoder().decode(bytes)];
    });

    await useE2ee.getState().downloadEntry('id1', 'a.txt');

    expect(downloadedArgs).toEqual(['a.txt', 'secret content']);
    expect(useE2ee.getState().busy).toBe(false);
    expect(useE2ee.getState().error).toBeNull();
  });
});

describe('useE2ee: persistence', () => {
  it('partialize excludes session/engine (secrets) and persists only workspaces', () => {
    const partialize = useE2ee.persist.getOptions().partialize;
    expect(partialize).toBeTypeOf('function');

    const knownWorkspaces: KnownWorkspace[] = [{ id: 'w1', name: 'Docs' }];
    // Simulate a state object carrying secret-shaped fields (as if someone
    // accidentally added them to the store) to prove partialize is an
    // ALLOWLIST that drops them regardless — not a denylist that could miss one.
    const stateWithSecrets = {
      ...useE2ee.getState(),
      workspaces: knownWorkspaces,
      session: { kek: new Uint8Array(32), identity: {} },
      recoveryKeyOnce: 'should-not-persist',
    };

    const persisted = partialize!(stateWithSecrets) as Record<string, unknown>;

    expect(persisted).not.toHaveProperty('session');
    expect(persisted).not.toHaveProperty('engine');
    expect(persisted).not.toHaveProperty('recoveryKeyOnce');
    expect(persisted.workspaces).toEqual(knownWorkspaces);
  });
});
