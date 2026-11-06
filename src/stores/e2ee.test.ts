import { describe, it, expect, beforeEach, vi } from 'vitest';

const wipePersonasDevice = vi.fn(async (_u: string | null) => {});
const stopPersonas = vi.fn();
vi.mock('@/lib/personas-device/teardown', () => ({ stopPersonas: () => stopPersonas() }));
vi.mock('@/lib/personas-device/wipe', () => ({ wipePersonasDevice: (u: string | null) => wipePersonasDevice(u) }));
import { useE2ee, type E2eeEngine, type EncryptedEntry, type KnownWorkspace } from './e2ee';
import { useWorkspace } from '@/stores/workspace';
import { ApiError } from '@/api/client';

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
    readWorkspaceName: async () => null,
    readWorkspaceNameById: async () => null,
    renameWorkspace: async () => {},
    setWorkspaceScope: async () => {},
    openWorkspace: async () => {},
    listFolder: async () => [],
    uploadFile: async () => {},
    downloadFile: async () => new Uint8Array(),
    listMembers: async () => [],
    inviteMember: async () => {},
    revokeMember: async () => {},
    listMyWorkspaces: async () => [],
    unlockWithRecoveryKey: async () => {},
    destroyIdentity: async () => {},
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

/**
 * A Space's name lives in the Space now, sealed under its own key. This
 * browser's list is a cache of it, and opening a Space is where the two are
 * made to agree.
 */
describe('useE2ee: the name this browser shows for a Space', () => {
  it("takes the Space's own name over the placeholder it invented", async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({ readWorkspaceName: async () => 'Tax 2026' }));
    useE2ee.setState({
      workspaces: [
        { id: 'ws-1', name: 'Space', selfFounded: false, shared: false, globalWorkspaceId: 'gw-1', stub: true },
      ],
      activeWorkspaceId: 'ws-1',
    });

    await useE2ee.getState().reconcileWorkspaceName('ws-1');

    expect(useE2ee.getState().workspaces[0]).toMatchObject({ name: 'Tax 2026', stub: false });
  });

  it("writes THIS browser's name into a Space that has none, so an older Space gets its label with nobody retyping it", async () => {
    const renamed: (string | null)[] = [];
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        readWorkspaceName: async () => null,
        renameWorkspace: async (name) => { renamed.push(name); },
      }),
    );
    useE2ee.setState({
      workspaces: [
        { id: 'ws-old', name: 'Receipts', selfFounded: true, shared: false, globalWorkspaceId: 'gw-1' },
      ],
      activeWorkspaceId: 'ws-old',
    });

    await useE2ee.getState().reconcileWorkspaceName('ws-old');

    expect(renamed).toEqual(['Receipts']);
  });

  it('never promotes a placeholder into the Space', async () => {
    const renamed: (string | null)[] = [];
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        readWorkspaceName: async () => null,
        renameWorkspace: async (name) => { renamed.push(name); },
      }),
    );
    useE2ee.setState({
      workspaces: [
        { id: 'ws-d', name: 'Shared Space', selfFounded: false, shared: true, globalWorkspaceId: 'gw-1', stub: true },
      ],
      activeWorkspaceId: 'ws-d',
    });

    await useE2ee.getState().reconcileWorkspaceName('ws-d');

    expect(renamed).toEqual([]);
    expect(useE2ee.getState().workspaces[0]!.name).toBe('Shared Space');
  });

  it('says nothing when the Space will not answer: a label is not worth an error over a Space that opened', async () => {
    useE2ee.getState().__setEngine(
      makeFakeEngine({ readWorkspaceName: async () => { throw new Error('offline'); } }),
    );
    useE2ee.setState({
      workspaces: [{ id: 'ws-1', name: 'Receipts', selfFounded: true, shared: false, globalWorkspaceId: 'gw-1' }],
      activeWorkspaceId: 'ws-1',
      error: null,
    });

    await useE2ee.getState().reconcileWorkspaceName('ws-1');

    expect(useE2ee.getState().error).toBeNull();
    expect(useE2ee.getState().workspaces[0]!.name).toBe('Receipts');
  });

  it('fills in every placeholder label, so a list of Spaces is not a column of identical rows', async () => {
    const names: Record<string, string> = { 'ws-a': 'Photos', 'ws-b': 'Tax 2026' };
    useE2ee.getState().__setEngine(
      makeFakeEngine({ readWorkspaceNameById: async (id) => names[id] ?? null }),
    );
    useE2ee.setState({
      workspaces: [
        { id: 'ws-a', name: 'Space', selfFounded: false, shared: false, globalWorkspaceId: 'gw-1', stub: true },
        { id: 'ws-b', name: 'Space', selfFounded: false, shared: false, globalWorkspaceId: 'gw-1', stub: true },
        { id: 'ws-c', name: 'Mine', selfFounded: true, shared: false, globalWorkspaceId: 'gw-1' },
      ],
    });

    await useE2ee.getState().resolveSpaceNames();

    expect(useE2ee.getState().workspaces.map((w) => w.name)).toEqual(['Photos', 'Tax 2026', 'Mine']);
  });

  it('leaves a placeholder alone when the Space has no name of its own, and never turns one failure into an error', async () => {
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        readWorkspaceNameById: async (id) => {
          if (id === 'ws-a') throw new Error('offline');
          return null;
        },
      }),
    );
    useE2ee.setState({
      workspaces: [
        { id: 'ws-a', name: 'Space', selfFounded: false, shared: false, globalWorkspaceId: 'gw-1', stub: true },
        { id: 'ws-b', name: 'Space', selfFounded: false, shared: false, globalWorkspaceId: 'gw-1', stub: true },
      ],
      error: null,
    });

    await useE2ee.getState().resolveSpaceNames();

    expect(useE2ee.getState().workspaces.map((w) => w.name)).toEqual(['Space', 'Space']);
    expect(useE2ee.getState().workspaces.every((w) => w.stub === true)).toBe(true);
    expect(useE2ee.getState().error).toBeNull();
  });

  it('renameWorkspace writes the new name into the Space and shows it here', async () => {
    const renamed: (string | null)[] = [];
    useE2ee.getState().__setEngine(
      makeFakeEngine({ renameWorkspace: async (name) => { renamed.push(name); } }),
    );
    useE2ee.setState({
      workspaces: [{ id: 'ws-1', name: 'Old', selfFounded: true, shared: false, globalWorkspaceId: 'gw-1' }],
      activeWorkspaceId: 'ws-1',
    });

    await useE2ee.getState().renameWorkspace('ws-1', 'New');

    expect(renamed).toEqual(['New']);
    expect(useE2ee.getState().workspaces[0]).toMatchObject({ name: 'New', stub: false });
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
      // Invented here, so never written into the Space.
      stub: true,
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
      stub: true,
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
      // Invented here, so never written into the Space.
      stub: true,
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

describe('useE2ee: uploadFiles attaches an unscoped Space and retries once', () => {
  const scopeRequired = () => new Error('e2ee: chunk-upload-url request failed (412)');

  it('on a 412, attaches the open Space to the active global workspace and uploads again', async () => {
    const scopeCalls: [string, string][] = [];
    let attempts = 0;
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        uploadFile: async () => {
          attempts++;
          if (scopeCalls.length === 0) throw scopeRequired();
        },
        setWorkspaceScope: async (spaceId, gw) => {
          scopeCalls.push([spaceId, gw]);
        },
        listFolder: async () => [{ id: '1', name: 'a.txt', kind: 'file' }],
      }),
    );
    useWorkspace.setState({ activeId: 'ws_active' });
    useE2ee.setState({
      activeWorkspaceId: 'sp_legacy',
      workspaces: [{ id: 'sp_legacy', name: 'Legacy', selfFounded: true, shared: false, globalWorkspaceId: null }],
    });

    await useE2ee.getState().uploadFiles([new File(['hello'], 'a.txt', { type: 'text/plain' })]);

    expect(scopeCalls).toEqual([['sp_legacy', 'ws_active']]);
    expect(attempts).toBe(2);
    expect(useE2ee.getState().error).toBeNull();
    expect(useE2ee.getState().entries).toHaveLength(1);
    // The local record follows, so the Space now lists under ws_active.
    expect(useE2ee.getState().workspaces[0].globalWorkspaceId).toBe('ws_active');
  });

  it('retries at most once - a 412 that survives the attach is reported, not looped', async () => {
    let attempts = 0;
    let scopeCalls = 0;
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        uploadFile: async () => {
          attempts++;
          throw scopeRequired();
        },
        setWorkspaceScope: async () => {
          scopeCalls++;
        },
      }),
    );
    useWorkspace.setState({ activeId: 'ws_active' });
    useE2ee.setState({ activeWorkspaceId: 'sp_1' });

    await useE2ee.getState().uploadFiles([new File(['hello'], 'a.txt', { type: 'text/plain' })]);

    expect(attempts).toBe(2);
    expect(scopeCalls).toBe(1);
    expect(useE2ee.getState().error).not.toBeNull();
    expect(useE2ee.getState().busy).toBe(false);
  });

  it('does not attach anything for an ordinary failure, or when no global workspace is active', async () => {
    let scopeCalls = 0;
    useE2ee.getState().__setEngine(
      makeFakeEngine({
        uploadFile: async () => {
          throw new Error('e2ee: commit request failed (500)');
        },
        setWorkspaceScope: async () => {
          scopeCalls++;
        },
      }),
    );
    useWorkspace.setState({ activeId: 'ws_active' });
    useE2ee.setState({ activeWorkspaceId: 'sp_1' });
    await useE2ee.getState().uploadFiles([new File(['x'], 'x.txt')]);
    expect(scopeCalls).toBe(0);

    useE2ee.getState().__setEngine(
      makeFakeEngine({
        uploadFile: async () => {
          throw scopeRequired();
        },
        setWorkspaceScope: async () => {
          scopeCalls++;
        },
      }),
    );
    useWorkspace.setState({ activeId: '' });
    await useE2ee.getState().uploadFiles([new File(['x'], 'x.txt')]);
    expect(scopeCalls).toBe(0);
    expect(useE2ee.getState().error).not.toBeNull();
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

// F8 (field report, Contract 6): the recovery key shown once at setup is
// actually usable, and a Vault whose passphrase AND key are both gone can be
// destroyed and set up again instead of being a permanent dead end.
describe('useE2ee: unlockWithRecoveryKey', () => {
  it('hands the NORMALISED key to the engine and unlocks', async () => {
    const seen: string[] = [];
    useE2ee.getState().__setEngine(makeFakeEngine({ unlockWithRecoveryKey: async (k) => { seen.push(k); } }));
    await useE2ee.getState().unlockWithRecoveryKey('ab12-cd34 ef56\n');
    // Whitespace and dashes are the paste's, not the key's (Contract 6).
    expect(seen).toEqual(['ab12cd34ef56']);
    expect(useE2ee.getState().status).toBe('unlocked');
    expect(useE2ee.getState().hasIdentity).toBe(true);
  });

  it('failure stays locked with a generic message that never echoes the engine', async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({ unlockWithRecoveryKey: async () => { throw new Error('e2ee: unlock failed'); } }));
    await useE2ee.getState().unlockWithRecoveryKey('nope');
    expect(useE2ee.getState().status).toBe('locked');
    expect(useE2ee.getState().error).toBe('That recovery key did not unlock your Vault.');
    expect(useE2ee.getState().error).not.toContain('unlock failed');
  });
});

describe('useE2ee: destroyIdentity', () => {
  it('clears the cached personas key once the server confirms, not when it refuses', async () => {
    const { useSession } = await import('@/stores/session');
    useSession.setState({ user: { id: 'u_9' } as never });
    wipePersonasDevice.mockClear();
    stopPersonas.mockClear();
    useE2ee.getState().__setEngine(makeFakeEngine({ destroyIdentity: async () => { throw new ApiError(401, 'Wrong password'); } }));
    expect(await useE2ee.getState().destroyIdentity('bad')).toBe(false);
    expect(wipePersonasDevice).not.toHaveBeenCalled();
    expect(stopPersonas).not.toHaveBeenCalled();
    useE2ee.getState().__setEngine(makeFakeEngine());
    expect(await useE2ee.getState().destroyIdentity('good')).toBe(true);
    expect(wipePersonasDevice).toHaveBeenCalledWith('u_9');
    // Running engines stop first, so nothing re-persists the key.
    expect(stopPersonas).toHaveBeenCalledTimes(1);
    expect(stopPersonas.mock.invocationCallOrder[0]).toBeLessThan(wipePersonasDevice.mock.invocationCallOrder.at(-1)!);
  });

  it('passes password and code to the engine, then returns the user to setup', async () => {
    const calls: [unknown, string | undefined][] = [];
    useE2ee.getState().__setEngine(makeFakeEngine({ destroyIdentity: async (pw, code) => { calls.push([pw, code]); } }));
    useE2ee.setState({ hasIdentity: true, status: 'locked', workspaces: [{ id: 'w', name: 'S', selfFounded: true, shared: false, globalWorkspaceId: null }] });
    const ok = await useE2ee.getState().destroyIdentity('hunter22', '123456');
    expect(ok).toBe(true);
    expect(calls).toEqual([['hunter22', '123456']]);
    expect(useE2ee.getState().hasIdentity).toBe(false);
    expect(useE2ee.getState().status).toBe('locked');
    // The Spaces list described keys that no longer exist.
    expect(useE2ee.getState().workspaces).toEqual([]);
    expect(useE2ee.getState().error).toBeNull();
  });

  // Fix round 1, MINOR (c): the API answers 400 {"error":"2fa_required"},
  // a CODE. Rendering it verbatim showed the user the literal string
  // "2fa_required"; the code is the contract, the sentence is presentation
  // (see api/error-copy.ts).
  it('turns the 2fa_required code into a sentence a person can act on', async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({
      destroyIdentity: async () => { throw new ApiError(400, JSON.stringify({ error: '2fa_required' })); },
    }));
    useE2ee.setState({ hasIdentity: true });
    const ok = await useE2ee.getState().destroyIdentity('hunter22');
    expect(ok).toBe(false);
    expect(useE2ee.getState().error).not.toContain('2fa_required');
    expect(useE2ee.getState().error).toMatch(/two-factor/i);
  });

  it('surfaces the server\'s refusal and keeps the identity', async () => {
    useE2ee.getState().__setEngine(makeFakeEngine({ destroyIdentity: async () => { throw new Error('Incorrect password'); } }));
    useE2ee.setState({ hasIdentity: true });
    const ok = await useE2ee.getState().destroyIdentity('wrong');
    expect(ok).toBe(false);
    expect(useE2ee.getState().hasIdentity).toBe(true);
    expect(useE2ee.getState().error).toBe('Incorrect password');
  });
});
