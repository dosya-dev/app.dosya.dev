import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  setupIdentity,
  unlock as engineUnlock,
  createWorkspace as engineCreateWorkspace,
  openWorkspace as engineOpenWorkspace,
  listFolder as engineListFolder,
  uploadFile as engineUploadFile,
  downloadFile as engineDownloadFile,
  type Session,
  type Workspace,
  type FileDeps,
} from '@dosya-dev/e2ee-client';
import { toHex } from '@dosya-dev/e2ee-core';
import { buildE2eeClient } from '@/lib/e2ee/client';
import { saveBytes } from '@/lib/e2ee/save';
import { toast } from '@/lib/toast';

export type E2eeStatus = 'locked' | 'unlocking' | 'unlocked';
export type EncryptedEntry = { id: string; name: string; kind: 'file' | 'folder' };
export type KnownWorkspace = { id: string; name: string };

/**
 * Crypto boundary: everything that touches keys/Session/Workspace lives
 * behind this facade. The store and components only ever see the methods
 * below — never a raw KEK, private key, recovery key, or Session/Workspace
 * value.
 */
export interface E2eeEngine {
  hasIdentity(): Promise<boolean>;
  /** first-time setup; returns the recovery key as hex to show ONCE. */
  setup(passphrase: string): Promise<{ recoveryKeyHex: string }>;
  unlock(passphrase: string): Promise<void>;
  lock(): void;
  createWorkspace(id: string): Promise<void>;
  openWorkspace(id: string): Promise<void>;
  listFolder(folderId: string): Promise<EncryptedEntry[]>;
  uploadFile(folderId: string, name: string, bytes: Uint8Array): Promise<void>;
  downloadFile(folderId: string, entryId: string): Promise<Uint8Array>;
}

/**
 * The real engine: wraps `buildE2eeClient()` and holds the in-memory
 * `Session`/`Workspace` in closure — neither is ever exposed to callers.
 */
export function defaultEngine(): E2eeEngine {
  const { api, transport } = buildE2eeClient();
  let session: Session | null = null;
  let ws: Workspace | null = null;

  /** Builds a fresh `FileDeps` for a single call, after asserting we're unlocked with an open workspace. */
  function fileDeps(): FileDeps {
    if (!session || !ws) throw new Error('e2ee: no active workspace');
    return { api, transport, session, ws };
  }

  return {
    async hasIdentity() {
      return (await api.getUserKeys()) !== null;
    },

    async setup(passphrase) {
      const { session: s, recoveryKey } = await setupIdentity(api, passphrase);
      session = s;
      return { recoveryKeyHex: toHex(recoveryKey) };
    },

    async unlock(passphrase) {
      session = await engineUnlock(api, passphrase);
    },

    lock() {
      session = null;
      ws = null;
    },

    async createWorkspace(id) {
      if (!session) throw new Error('e2ee: locked');
      ws = await engineCreateWorkspace(api, session, id);
    },

    async openWorkspace(id) {
      if (!session) throw new Error('e2ee: locked');
      // e2ee-core (P2b-log Task 2 fix): `selfFounded` must come from OUR OWN
      // persisted state, never from anything the server returns while
      // opening — see workspace.ts's `openWorkspace` doc comment for why a
      // server-derived value is a forge vector. Every id in the store's
      // `workspaces` list got there via `createWorkspace` (this account
      // created it), so it's always safe/correct to assert founder status
      // here.
      // TODO(P2c): shared workspaces pass selfFounded:false
      ws = await engineOpenWorkspace(api, session, id, { selfFounded: true });
    },

    async listFolder(folderId) {
      if (!session || !ws) throw new Error('e2ee: no active workspace');
      const state = await engineListFolder(api, session, ws, folderId);
      return [...state.values()].map((e) => ({ id: e.id, name: e.name, kind: e.kind }));
    },

    async uploadFile(folderId, name, bytes) {
      await engineUploadFile(fileDeps(), folderId, name, bytes);
    },

    async downloadFile(folderId, entryId) {
      return await engineDownloadFile(fileDeps(), folderId, entryId);
    },
  };
}

interface E2eeState {
  status: E2eeStatus;
  error: string | null;
  engine: E2eeEngine;
  hasIdentity: boolean | null;
  workspaces: KnownWorkspace[];
  activeWorkspaceId: string | null;
  entries: EncryptedEntry[];
  busy: boolean;
  /** The recovery key, shown ONCE right after setup. Never persisted. */
  recoveryKeyOnce: string | null;
  /** Where `downloadEntry` hands decrypted bytes off to trigger a save. Swappable in tests (no DOM). */
  saver: (name: string, bytes: Uint8Array) => void;

  checkIdentity(): Promise<void>;
  setup(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  lock(): void;
  createWorkspace(name: string): Promise<void>;
  openWorkspace(id: string): Promise<void>;
  refreshFolder(folderId?: string): Promise<void>;
  uploadFiles(files: FileList | File[], folderId?: string): Promise<void>;
  downloadEntry(entryId: string, name: string, folderId?: string): Promise<void>;
  dismissRecoveryKey(): void;
  /** Test seam: swap in a fake `E2eeEngine`. */
  __setEngine(engine: E2eeEngine): void;
  /** Test seam: swap in a fake saver (production default is the real `saveBytes`, DOM-dependent). */
  __setSaver(saver: (name: string, bytes: Uint8Array) => void): void;
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export const useE2ee = create<E2eeState>()(
  persist(
    (set, get) => ({
      status: 'locked',
      error: null,
      engine: defaultEngine(),
      hasIdentity: null,
      workspaces: [],
      activeWorkspaceId: null,
      entries: [],
      busy: false,
      recoveryKeyOnce: null,
      saver: saveBytes,

      async checkIdentity() {
        try {
          const hasIdentity = await get().engine.hasIdentity();
          set({ hasIdentity, error: null });
        } catch (e) {
          // We genuinely don't know whether an identity exists — do NOT set
          // `false` here. That would route a transient network blip into the
          // first-time Setup flow, and `setup()` unconditionally upserts new
          // identity keys, silently orphaning any real encrypted workspaces.
          // Leave `hasIdentity` as `null` (unknown) and surface `error` so the
          // gate shows a retry banner instead of Setup.
          set({ hasIdentity: null, error: errorMessage(e, 'Could not check encryption status.') });
        }
      },

      async setup(passphrase) {
        set({ busy: true, error: null });
        try {
          const { recoveryKeyHex } = await get().engine.setup(passphrase);
          set({
            status: 'unlocked',
            hasIdentity: true,
            recoveryKeyOnce: recoveryKeyHex,
            busy: false,
            error: null,
          });
        } catch (e) {
          set({ busy: false, error: errorMessage(e, 'Could not set up encryption.') });
        }
      },

      async unlock(passphrase) {
        set({ status: 'unlocking', error: null, busy: true });
        try {
          await get().engine.unlock(passphrase);
          set({ status: 'unlocked', hasIdentity: true, busy: false, error: null });
        } catch {
          // The engine throws one opaque error for every failure mode (wrong
          // passphrase, no identity, corrupt record) — surface a single
          // generic message here too, never the engine's own text.
          set({
            status: 'locked',
            busy: false,
            error: 'Incorrect passphrase or no identity found.',
          });
        }
      },

      lock() {
        get().engine.lock();
        set({ status: 'locked', entries: [], activeWorkspaceId: null, error: null });
      },

      async createWorkspace(name) {
        set({ busy: true, error: null });
        const id = crypto.randomUUID();
        try {
          await get().engine.createWorkspace(id);
          set((s) => ({
            workspaces: [...s.workspaces, { id, name }],
            activeWorkspaceId: id,
            busy: false,
          }));
        } catch (e) {
          set({ busy: false, error: errorMessage(e, 'Could not create workspace.') });
        }
      },

      async openWorkspace(id) {
        set({ busy: true, error: null });
        try {
          await get().engine.openWorkspace(id);
          set({ activeWorkspaceId: id, busy: false });
        } catch (e) {
          set({ busy: false, error: errorMessage(e, 'Could not open workspace.') });
        }
      },

      async refreshFolder(folderId = '') {
        set({ busy: true, error: null });
        try {
          const entries = await get().engine.listFolder(folderId);
          set({ entries, busy: false });
        } catch (e) {
          set({ busy: false, error: errorMessage(e, 'Could not load folder.') });
        }
      },

      async uploadFiles(files, folderId = '') {
        set({ busy: true, error: null });
        try {
          for (const file of Array.from(files)) {
            const bytes = new Uint8Array(await file.arrayBuffer());
            await get().engine.uploadFile(folderId, file.name, bytes);
          }
          await get().refreshFolder(folderId);
          set({ busy: false });
          toast.success('Uploaded', files.length === 1 ? Array.from(files)[0].name : `${files.length} files`);
        } catch (e) {
          set({ busy: false, error: errorMessage(e, 'Could not upload file.') });
          toast.error('Upload failed', errorMessage(e, 'Could not upload file.'));
        }
      },

      async downloadEntry(entryId, name, folderId = '') {
        set({ busy: true, error: null });
        try {
          const bytes = await get().engine.downloadFile(folderId, entryId);
          get().saver(name, bytes);
          set({ busy: false });
          toast.success('Downloaded', name);
        } catch (e) {
          set({ busy: false, error: errorMessage(e, 'Could not download file.') });
          toast.error('Download failed', errorMessage(e, 'Could not download file.'));
        }
      },

      dismissRecoveryKey() {
        set({ recoveryKeyOnce: null });
      },

      __setEngine(engine) {
        set({ engine });
      },

      __setSaver(saver) {
        set({ saver });
      },
    }),
    {
      name: 'dosya_e2ee',
      // The KEK/Session/private keys/recovery key live in memory ONLY —
      // never write them (or the engine instance itself) to localStorage.
      // Persist ONLY the non-secret workspace id+name hints.
      partialize: (state) => ({ workspaces: state.workspaces }),
    },
  ),
);
