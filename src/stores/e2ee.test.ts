import { describe, it, expect, beforeEach } from 'vitest';
import { useE2ee, type E2eeEngine, type EncryptedEntry, type KnownWorkspace } from './e2ee';
import { useWorkspace } from '@/stores/workspace';

// jsdom (this vitest env, v25.0.1) implements Blob/File storage but not the
// async read methods (`arrayBuffer`/`text`) real browsers have long shipped -
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
    setWorkspaceScope: async () => {},
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
  // The active GLOBAL workspace (a separate store, `stores/workspace.ts`) -
  // reset to its own default between cases; individual tests below set
  // `activeId` explicitly where the active workspace matters.
  useWorkspace.setState({ activeId: '' });
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
  it('adds {id,name,selfFounded:true,shared:false,globalWorkspaceId} to workspaces and makes it the active workspace', async () => {
    useWorkspace.setState({ activeId: 'gw-1' });
    useE2ee.getState().__setEngine(makeFakeEngine({ createWorkspace: async () => {} }));

    await useE2ee.getState().createWorkspace('Docs');

    const { workspaces, activeWorkspaceId } = useE2ee.getState();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].name).toBe('Docs');
    expect(workspaces[0].id).toBeTruthy();
    // Security-critical: a workspace THIS account created is hard-anchored -
    // selfFounded must be true, and (per the store's own persisted-state
    // source of truth) it is set here, never derived from anything the
    // server returns.
    expect(workspaces[0].selfFounded).toBe(true);
    // P2e: scoped to the ACTIVE global workspace at creation time - read
    // from `useWorkspace`, display-only, never affects selfFounded above.
    expect(workspaces[0].globalWorkspaceId).toBe('gw-1');
    expect(workspaces[0].shared).toBe(false);
    expect(activeWorkspaceId).toBe(workspaces[0].id);
  });

  it('records the workspace scope via engine.setWorkspaceScope(id, activeGlobalId)', async () => {
    useWorkspace.setState({ activeId: 'gw-1' });
    let seenScope: { workspaceId: string; globalWorkspaceId: string } | null = null;
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        setWorkspaceScope: async (workspaceId, globalWorkspaceId) => {
          seenScope = { workspaceId, globalWorkspaceId };
        },
      }),
    );

    await useE2ee.getState().createWorkspace('Docs');

    const { workspaces } = useE2ee.getState();
    expect(seenScope).toEqual({ workspaceId: workspaces[0].id, globalWorkspaceId: 'gw-1' });
  });
});

describe('useE2ee: refreshMyWorkspaces', () => {
  it('adds a discovered createdByMe:false entry as {shared:true, selfFounded:false} with its globalWorkspaceId', async () => {
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        listMyWorkspaces: async () => [
          { workspaceId: 'ws-shared-1', globalWorkspaceId: 'gw-1', createdByMe: false },
        ],
      }),
    );

    await useE2ee.getState().refreshMyWorkspaces();

    const { workspaces } = useE2ee.getState();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toEqual({
      id: 'ws-shared-1',
      name: 'Shared Space',
      globalWorkspaceId: 'gw-1',
      shared: true,
      selfFounded: false,
    });
  });

  it('adds a discovered createdByMe:true entry as {shared:false, selfFounded:false} -- SECURITY: createdByMe is server-reported and display-only, it must NEVER set selfFounded:true (that is reserved for this client\'s OWN createWorkspace call -- see the P2e forge-defense invariant)', async () => {
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        listMyWorkspaces: async () => [
          { workspaceId: 'ws-other-device', globalWorkspaceId: 'gw-2', createdByMe: true },
        ],
      }),
    );

    await useE2ee.getState().refreshMyWorkspaces();

    const { workspaces } = useE2ee.getState();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toEqual({
      id: 'ws-other-device',
      name: 'Space',
      globalWorkspaceId: 'gw-2',
      shared: false,
      selfFounded: false,
    });
    // Explicit, isolated assertion of the security invariant: a
    // createdByMe:true discovered entry must NOT become selfFounded:true.
    expect(workspaces[0].selfFounded).toBe(false);
  });

  it('does NOT overwrite an existing created workspace\'s selfFounded:true (or its globalWorkspaceId), even if the server also lists it in my-workspaces with createdByMe:true (forge-resistance)', async () => {
    useE2ee.setState({
      workspaces: [
        { id: 'ws-mine', name: 'Docs', selfFounded: true, shared: false, globalWorkspaceId: 'gw-1' },
      ],
    });
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        listMyWorkspaces: async () => [
          { workspaceId: 'ws-mine', globalWorkspaceId: 'gw-1', createdByMe: true },
          { workspaceId: 'ws-shared-1', globalWorkspaceId: 'gw-1', createdByMe: false },
        ],
      }),
    );

    await useE2ee.getState().refreshMyWorkspaces();

    const { workspaces } = useE2ee.getState();
    expect(workspaces).toHaveLength(2);
    const mine = workspaces.find((w) => w.id === 'ws-mine');
    const shared = workspaces.find((w) => w.id === 'ws-shared-1');
    expect(mine?.selfFounded).toBe(true);
    expect(mine?.name).toBe('Docs');
    expect(mine?.globalWorkspaceId).toBe('gw-1');
    expect(shared).toEqual({
      id: 'ws-shared-1',
      name: 'Shared Space',
      globalWorkspaceId: 'gw-1',
      shared: true,
      selfFounded: false,
    });
  });
});

describe('useE2ee: mySpacesForActiveWorkspace / sharedSpaces selectors', () => {
  const workspaces: KnownWorkspace[] = [
    { id: 'ws-a', name: 'Docs', selfFounded: true, shared: false, globalWorkspaceId: 'gw-1' },
    { id: 'ws-b', name: 'Other Space', selfFounded: false, shared: false, globalWorkspaceId: 'gw-2' },
    { id: 'ws-legacy', name: 'Legacy', selfFounded: true, shared: false, globalWorkspaceId: null },
    { id: 'ws-shared', name: 'Shared Space', selfFounded: false, shared: true, globalWorkspaceId: 'gw-1' },
  ];

  it('mySpacesForActiveWorkspace returns only non-shared entries matching the active global id, plus null-scope legacy fallback', () => {
    useWorkspace.setState({ activeId: 'gw-1' });
    useE2ee.setState({ workspaces });

    const mine = useE2ee.getState().mySpacesForActiveWorkspace();

    expect(mine.map((w) => w.id).sort()).toEqual(['ws-a', 'ws-legacy'].sort());
  });

  it('mySpacesForActiveWorkspace excludes a non-shared Space scoped to a DIFFERENT global workspace', () => {
    useWorkspace.setState({ activeId: 'gw-2' });
    useE2ee.setState({ workspaces });

    const mine = useE2ee.getState().mySpacesForActiveWorkspace();

    expect(mine.map((w) => w.id).sort()).toEqual(['ws-b', 'ws-legacy'].sort());
  });

  it('sharedSpaces returns every shared:true entry regardless of the active global workspace', () => {
    useWorkspace.setState({ activeId: 'gw-2' });
    useE2ee.setState({ workspaces });

    const shared = useE2ee.getState().sharedSpaces();

    expect(shared.map((w) => w.id)).toEqual(['ws-shared']);
  });
});

describe('useE2ee: openWorkspace (store action)', () => {
  it('passes the KnownWorkspace\'s stored selfFounded:true through to the engine', async () => {
    let seen: { id: string; selfFounded: boolean } | null = null;
    useE2ee.setState({
      workspaces: [{ id: 'ws-mine', name: 'Docs', selfFounded: true, shared: false, globalWorkspaceId: 'gw-1' }],
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
      workspaces: [
        { id: 'ws-shared', name: 'Shared workspace', selfFounded: false, shared: true, globalWorkspaceId: 'gw-1' },
      ],
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
    { userId: 'u1', email: 'a@example.com', ed25519Pub: 'ed-a', x25519Pub: 'x-a' },
    { userId: 'u2', email: 'b@example.com', ed25519Pub: 'ed-b', x25519Pub: 'x-b' },
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
        listMembers: async () => [{ userId: 'u1', email: 'a@example.com', ed25519Pub: 'ed-a', x25519Pub: 'x-a' }],
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

  it('a transient error leaves hasIdentity=null (never false) and sets error - regression guard: showing Setup on a network blip lets setupIdentity silently overwrite real keys', async () => {
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
  it('partialize excludes session/engine/members (secrets/in-memory-only) and persists only workspaces (with selfFounded/globalWorkspaceId/shared - all non-secret)', () => {
    const partialize = useE2ee.persist.getOptions().partialize;
    expect(partialize).toBeTypeOf('function');

    const knownWorkspaces: KnownWorkspace[] = [
      { id: 'w1', name: 'Docs', selfFounded: true, shared: false, globalWorkspaceId: 'gw-1' },
      { id: 'w2', name: 'Shared workspace', selfFounded: false, shared: true, globalWorkspaceId: 'gw-1' },
    ];
    // Simulate a state object carrying secret-shaped fields (as if someone
    // accidentally added them to the store) to prove partialize is an
    // ALLOWLIST that drops them regardless - not a denylist that could miss one.
    const stateWithSecrets = {
      ...useE2ee.getState(),
      workspaces: knownWorkspaces,
      session: { kek: new Uint8Array(32), identity: {} },
      recoveryKeyOnce: 'should-not-persist',
      members: [{ userId: 'u1', email: 'a@example.com', ed25519Pub: 'ed-a', x25519Pub: 'x-a' }],
    };

    const persisted = partialize!(stateWithSecrets) as Record<string, unknown>;

    expect(persisted).not.toHaveProperty('session');
    expect(persisted).not.toHaveProperty('engine');
    expect(persisted).not.toHaveProperty('recoveryKeyOnce');
    expect(persisted).not.toHaveProperty('members');
    expect(persisted.workspaces).toEqual(knownWorkspaces);
  });
});
