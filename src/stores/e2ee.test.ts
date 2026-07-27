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
    listMembers: async () => [],
    inviteMember: async () => {},
    revokeMember: async () => {},
    listMyWorkspaces: async () => [],
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
    members: [],
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
  it('adds {id,name,selfFounded:true} to workspaces and makes it the active workspace', async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({ createWorkspace: async () => {} }));

    await useE2ee.getState().createWorkspace('Docs');

    const { workspaces, activeWorkspaceId } = useE2ee.getState();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].name).toBe('Docs');
    expect(workspaces[0].id).toBeTruthy();
    // Security-critical: a workspace THIS account created is hard-anchored —
    // selfFounded must be true, and (per the store's own persisted-state
    // source of truth) it is set here, never derived from anything the
    // server returns.
    expect(workspaces[0].selfFounded).toBe(true);
    expect(activeWorkspaceId).toBe(workspaces[0].id);
  });
});

describe('useE2ee: refreshSharedWorkspaces', () => {
  it('adds a discovered workspace id as {selfFounded:false} when not already known', async () => {
    useE2ee.getState().__setEngine(
      makeFakeEngine({ listMyWorkspaces: async () => [{ workspaceId: 'ws-shared-1' }] }),
    );

    await useE2ee.getState().refreshSharedWorkspaces();

    const { workspaces } = useE2ee.getState();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toEqual({ id: 'ws-shared-1', name: 'Shared workspace', selfFounded: false });
  });

  it('does NOT overwrite an existing created workspace\'s selfFounded:true, even if the server also lists it in my-workspaces (forge-resistance)', async () => {
    useE2ee.setState({
      workspaces: [{ id: 'ws-mine', name: 'Docs', selfFounded: true }],
    });
    useE2ee.getState().__setEngine(
      makeFakeEngine({ listMyWorkspaces: async () => [{ workspaceId: 'ws-mine' }, { workspaceId: 'ws-shared-1' }] }),
    );

    await useE2ee.getState().refreshSharedWorkspaces();

    const { workspaces } = useE2ee.getState();
    expect(workspaces).toHaveLength(2);
    const mine = workspaces.find((w) => w.id === 'ws-mine');
    const shared = workspaces.find((w) => w.id === 'ws-shared-1');
    expect(mine?.selfFounded).toBe(true);
    expect(mine?.name).toBe('Docs');
    expect(shared).toEqual({ id: 'ws-shared-1', name: 'Shared workspace', selfFounded: false });
  });
});

describe('useE2ee: openWorkspace (store action)', () => {
  it('passes the KnownWorkspace\'s stored selfFounded:true through to the engine', async () => {
    let seen: { id: string; selfFounded: boolean } | null = null;
    useE2ee.setState({
      workspaces: [{ id: 'ws-mine', name: 'Docs', selfFounded: true }],
    });
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        openWorkspace: async (id, selfFounded) => {
          seen = { id, selfFounded };
        },
      }),
    );

    await useE2ee.getState().openWorkspace('ws-mine');

    expect(seen).toEqual({ id: 'ws-mine', selfFounded: true });
    expect(useE2ee.getState().activeWorkspaceId).toBe('ws-mine');
  });

  it('passes selfFounded:false for a known-shared workspace, and defaults to false (safe) for an unknown id', async () => {
    let seen: { id: string; selfFounded: boolean } | null = null;
    useE2ee.setState({
      workspaces: [{ id: 'ws-shared', name: 'Shared workspace', selfFounded: false }],
    });
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        openWorkspace: async (id, selfFounded) => {
          seen = { id, selfFounded };
        },
      }),
    );

    await useE2ee.getState().openWorkspace('ws-shared');
    expect(seen).toEqual({ id: 'ws-shared', selfFounded: false });

    await useE2ee.getState().openWorkspace('ws-never-seen-before');
    expect(seen).toEqual({ id: 'ws-never-seen-before', selfFounded: false });
  });
});

describe('useE2ee: members (refreshMembers/inviteMember/revokeMember)', () => {
  const fakeMembers = [
    { userId: 'u1', email: 'a@example.com', ed25519Pub: 'ed-a' },
    { userId: 'u2', email: 'b@example.com', ed25519Pub: 'ed-b' },
  ];

  it('refreshMembers populates members from the engine', async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({ listMembers: async () => fakeMembers }));

    await useE2ee.getState().refreshMembers();

    expect(useE2ee.getState().members).toEqual(fakeMembers);
  });

  it('inviteMember calls the engine then refreshes members', async () => {
    let invitedEmail: string | null = null;
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        inviteMember: async (email) => {
          invitedEmail = email;
        },
        listMembers: async () => fakeMembers,
      }),
    );

    await useE2ee.getState().inviteMember('new@example.com');

    expect(invitedEmail).toBe('new@example.com');
    expect(useE2ee.getState().members).toEqual(fakeMembers);
    expect(useE2ee.getState().busy).toBe(false);
    expect(useE2ee.getState().error).toBeNull();
  });

  it('inviteMember maps the engine\'s no-E2EE-identity error to a friendly message', async () => {
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        inviteMember: async () => {
          throw new Error('e2ee: grantAccess: that user has no E2EE identity');
        },
      }),
    );

    await useE2ee.getState().inviteMember('nobody@example.com');

    expect(useE2ee.getState().error).toBe("That user hasn't set up encryption yet");
    expect(useE2ee.getState().busy).toBe(false);
  });

  it('revokeMember calls the engine with (userId, ed25519Pub) then refreshes members', async () => {
    let revoked: { userId: string; ed25519Pub: string } | null = null;
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        revokeMember: async (userId, ed25519Pub) => {
          revoked = { userId, ed25519Pub };
        },
        listMembers: async () => [fakeMembers[0]],
      }),
    );

    await useE2ee.getState().revokeMember('u2', 'ed-b');

    expect(revoked).toEqual({ userId: 'u2', ed25519Pub: 'ed-b' });
    expect(useE2ee.getState().members).toEqual([fakeMembers[0]]);
    expect(useE2ee.getState().busy).toBe(false);
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
  it('clears entries/activeWorkspaceId/members, sets status=locked, and calls engine.lock()', async () => {
    let lockCalled = false;
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        unlock: async () => {},
        listFolder: async () => [{ id: '1', name: 'a.txt', kind: 'file' }],
        listMembers: async () => [{ userId: 'u1', email: 'a@example.com', ed25519Pub: 'ed-a' }],
        lock: () => {
          lockCalled = true;
        },
      }),
    );

    await useE2ee.getState().unlock('pass');
    useE2ee.setState({ activeWorkspaceId: 'ws-1' });
    await useE2ee.getState().refreshFolder();
    await useE2ee.getState().refreshMembers();
    expect(useE2ee.getState().entries).toHaveLength(1);
    expect(useE2ee.getState().members).toHaveLength(1);

    useE2ee.getState().lock();

    expect(useE2ee.getState().status).toBe('locked');
    expect(useE2ee.getState().entries).toEqual([]);
    expect(useE2ee.getState().activeWorkspaceId).toBeNull();
    expect(useE2ee.getState().members).toEqual([]);
    expect(lockCalled).toBe(true);
  });
});

describe('useE2ee: checkIdentity', () => {
  it('success (identity exists) sets hasIdentity=true and clears error', async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({ hasIdentity: async () => true }));

    await useE2ee.getState().checkIdentity();

    expect(useE2ee.getState().hasIdentity).toBe(true);
    expect(useE2ee.getState().error).toBeNull();
  });

  it('success (no identity yet) sets hasIdentity=false and clears error', async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({ hasIdentity: async () => false }));

    await useE2ee.getState().checkIdentity();

    expect(useE2ee.getState().hasIdentity).toBe(false);
    expect(useE2ee.getState().error).toBeNull();
  });

  it('a transient error leaves hasIdentity=null (never false) and sets error — regression guard: showing Setup on a network blip lets setupIdentity silently overwrite real keys', async () => {
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        hasIdentity: async () => {
          throw new Error('network blip');
        },
      }),
    );

    await useE2ee.getState().checkIdentity();

    expect(useE2ee.getState().hasIdentity).toBeNull();
    expect(useE2ee.getState().error).not.toBeNull();
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
  it('partialize excludes session/engine/members (secrets/in-memory-only) and persists only workspaces (with selfFounded — non-secret)', () => {
    const partialize = useE2ee.persist.getOptions().partialize;
    expect(partialize).toBeTypeOf('function');

    const knownWorkspaces: KnownWorkspace[] = [
      { id: 'w1', name: 'Docs', selfFounded: true },
      { id: 'w2', name: 'Shared workspace', selfFounded: false },
    ];
    // Simulate a state object carrying secret-shaped fields (as if someone
    // accidentally added them to the store) to prove partialize is an
    // ALLOWLIST that drops them regardless — not a denylist that could miss one.
    const stateWithSecrets = {
      ...useE2ee.getState(),
      workspaces: knownWorkspaces,
      session: { kek: new Uint8Array(32), identity: {} },
      recoveryKeyOnce: 'should-not-persist',
      members: [{ userId: 'u1', email: 'a@example.com', ed25519Pub: 'ed-a' }],
    };

    const persisted = partialize!(stateWithSecrets) as Record<string, unknown>;

    expect(persisted).not.toHaveProperty('session');
    expect(persisted).not.toHaveProperty('engine');
    expect(persisted).not.toHaveProperty('recoveryKeyOnce');
    expect(persisted).not.toHaveProperty('members');
    expect(persisted.workspaces).toEqual(knownWorkspaces);
  });
});
