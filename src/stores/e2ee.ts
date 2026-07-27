import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  setupIdentity,
  unlock as engineUnlock,
  createWorkspace as engineCreateWorkspace,
  openWorkspace as engineOpenWorkspace,
  listFolder as engineListFolder,
  type Session,
  type Workspace,
} from '@dosya-dev/e2ee-client';
import { toHex } from '@dosya-dev/e2ee-core';
import { buildE2eeClient } from '@/lib/e2ee/client';

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
}

/**
 * The real engine: wraps `buildE2eeClient()` and holds the in-memory
 * `Session`/`Workspace` in closure — neither is ever exposed to callers.
 */
export function defaultEngine(): E2eeEngine {
  const { api } = buildE2eeClient();
  let session: Session | null = null;
  let ws: Workspace | null = null;

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
      ws = await engineOpenWorkspace(api, session, id);
    },

    async listFolder(folderId) {
      if (!session || !ws) throw new Error('e2ee: no active workspace');
      const state = await engineListFolder(api, session, ws, folderId);
      return [...state.values()].map((e) => ({ id: e.id, name: e.name, kind: e.kind }));
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

  checkIdentity(): Promise<void>;
  setup(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  lock(): void;
  createWorkspace(name: string): Promise<void>;
  openWorkspace(id: string): Promise<void>;
  refreshFolder(folderId?: string): Promise<void>;
  dismissRecoveryKey(): void;
  /** Test seam: swap in a fake `E2eeEngine`. */
  __setEngine(engine: E2eeEngine): void;
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

      async checkIdentity() {
        try {
          const hasIdentity = await get().engine.hasIdentity();
          set({ hasIdentity });
        } catch {
          set({ hasIdentity: false });
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

      dismissRecoveryKey() {
        set({ recoveryKeyOnce: null });
      },

      __setEngine(engine) {
        set({ engine });
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
