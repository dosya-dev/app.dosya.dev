import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as e2eeClient from '@dosya-dev/e2ee-client';
import {
  setupIdentity,
  unlock as engineUnlock,
  createWorkspace as engineCreateWorkspace,
  openWorkspace as engineOpenWorkspace,
  listFolder as engineListFolder,
  uploadFile as engineUploadFile,
  downloadFile as engineDownloadFile,
  grantAccess as engineGrantAccess,
  revokeAccess as engineRevokeAccess,
  listMembers as engineListMembers,
  type ApiClient,
  type Session,
  type Workspace,
  type FileDeps,
} from '@dosya-dev/e2ee-client';
import { toHex } from '@dosya-dev/e2ee-core';
import { api as restApi, apiErrorMessage } from '@/api/client';
import { buildE2eeClient, normalizeRecoveryKey } from '@/lib/e2ee/client';
import { saveBytes } from '@/lib/e2ee/save';
import { toast } from '@/lib/toast';
import { useWorkspace } from '@/stores/workspace';

export type E2eeStatus = 'locked' | 'unlocking' | 'unlocked';
export type EncryptedEntry = { id: string; name: string; kind: 'file' | 'folder' };
/**
 * `globalWorkspaceId` (P2e) is the active global storage workspace this Space
 * was scoped to at creation (or `null` for a legacy/unscoped Space) and
 * `shared` is whether this Space was DISCOVERED (shared with us) rather than
 * created by us - BOTH are DISPLAY-ONLY (server-sourced, for Vault grouping).
 * `selfFounded` remains the security-critical, CLIENT-SOURCED anchor - its
 * semantics are UNCHANGED by P2e (see `E2eeEngine.openWorkspace`'s doc
 * comment and `createWorkspace`/`refreshMyWorkspaces` below).
 */
export type KnownWorkspace = {
  id: string;
  name: string;
  selfFounded: boolean;
  globalWorkspaceId: string | null;
  shared: boolean;
};
export type WorkspaceMember = { userId: string; email: string; ed25519Pub: string; x25519Pub: string };

/**
 * Crypto boundary: everything that touches keys/Session/Workspace lives
 * behind this facade. The store and components only ever see the methods
 * below - never a raw KEK, private key, recovery key, or Session/Workspace
 * value.
 */
export interface E2eeEngine {
  hasIdentity(): Promise<boolean>;
  /** first-time setup; returns the recovery key as hex to show ONCE. */
  setup(passphrase: string): Promise<{ recoveryKeyHex: string }>;
  unlock(passphrase: string): Promise<void>;
  /**
   * Unlock with the recovery key shown once at setup (the hex string
   * `setup()` returned; whitespace and dashes are ignored). Contract 6 of the
   * 2026-09-02 field report: `unlockWithRecoveryKey` in @dosya-dev/e2ee-client.
   */
  unlockWithRecoveryKey(recoveryKey: string): Promise<void>;
  /**
   * Destroy this account's Vault identity, grants and index rows so setup can
   * run again - `DELETE /api/e2ee/user-keys` (Contract 6). Everything
   * encrypted under the old identity becomes unreadable; the caller confirms
   * that with the user first. `totpCode` is required when the account has
   * 2FA (the server answers 400 `2fa_required` otherwise).
   */
  destroyIdentity(password: string, totpCode?: string): Promise<void>;
  lock(): void;
  createWorkspace(id: string): Promise<void>;
  /**
   * P2e: records that `workspaceId` belongs to `globalWorkspaceId` (the
   * active global storage workspace at creation time) via
   * `PUT /api/e2ee/workspace-scope` - plaintext metadata, not crypto, purely
   * for per-workspace Vault UI grouping. Called right after `createWorkspace`.
   */
  setWorkspaceScope(workspaceId: string, globalWorkspaceId: string): Promise<void>;
  /**
   * `selfFounded` is CALLER-supplied (never derived here from anything the
   * server returns) - see `Workspace.selfFounded`'s doc comment in
   * `workspace.ts`. The store sources this from the caller's OWN persisted
   * `KnownWorkspace.selfFounded`, never from the server's `my-workspaces`.
   */
  openWorkspace(id: string, selfFounded: boolean): Promise<void>;
  listFolder(folderId: string): Promise<EncryptedEntry[]>;
  uploadFile(folderId: string, name: string, bytes: Uint8Array): Promise<void>;
  downloadFile(folderId: string, entryId: string): Promise<Uint8Array>;
  /** The currently-open workspace's members (email + ed25519 signing pubkey for display/revoke). */
  listMembers(): Promise<WorkspaceMember[]>;
  /** Invite a dosya user (by email) into the currently-open workspace. */
  inviteMember(email: string): Promise<void>;
  /**
   * Revoke a member's access to the currently-open workspace. `ed25519Pub` is
   * their signing pubkey (from `listMembers`). P2d Task 3: this now ROTATES
   * the workspace key (re-keying every file/folder and re-sealing to every
   * remaining member) rather than merely dropping the membership row - it
   * can take noticeably longer on a large workspace, so callers should show
   * `busy` state for the duration.
   */
  revokeMember(userId: string, ed25519Pub: string): Promise<void>;
  /**
   * Discovery (P2c), extended by P2e: every workspace id the caller is
   * currently a member of, per the server, plus the DISPLAY-ONLY
   * `globalWorkspaceId`/`createdByMe` scope hints (see `putWorkspaceScope`'s
   * doc comment - never wired into `selfFounded`).
   */
  listMyWorkspaces(): Promise<{ workspaceId: string; globalWorkspaceId: string | null; createdByMe: boolean }[]>;
}

/**
 * `unlockWithRecoveryKey` from @dosya-dev/e2ee-client (Contract 6). Looked up
 * on the module namespace rather than imported by name: the web app builds
 * against the VENDORED bundle in apps/web/vendor, which is re-vendored from
 * packages/e2ee-client after that package ships the export. Until then the
 * function is absent and the recovery path reports itself unavailable
 * instead of failing the whole build.
 */
type RecoveryUnlock = (api: ApiClient, recoveryKey: string) => Promise<Session>;

/**
 * Pull `unlockWithRecoveryKey` off a module namespace, or null when the bundle
 * predates it. Exported and taking the namespace as an argument purely so it
 * can be tested: `vi.mock` cannot express "this export does not exist" - its
 * mocked-module guard throws on any access to an export the factory omitted,
 * which is the exact situation this has to survive.
 */
export function recoveryUnlockFrom(mod: unknown): RecoveryUnlock | null {
  const fn = (mod as { unlockWithRecoveryKey?: unknown } | undefined)?.unlockWithRecoveryKey;
  return typeof fn === 'function' ? (fn as RecoveryUnlock) : null;
}

function vendoredRecoveryUnlock(): RecoveryUnlock | null {
  return recoveryUnlockFrom(e2eeClient);
}

/**
 * The real engine: wraps `buildE2eeClient()` and holds the in-memory
 * `Session`/`Workspace` in closure - neither is ever exposed to callers.
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

    async unlockWithRecoveryKey(recoveryKey) {
      const recover = vendoredRecoveryUnlock();
      if (!recover) throw new Error('e2ee: recovery unlock unavailable in this build');
      // Normalised here as well as in the store action: this is the last point
      // before the key reaches the crypto library, and a future caller of the
      // engine should not have to know the rule.
      session = await recover(api, normalizeRecoveryKey(recoveryKey));
    },

    async destroyIdentity(password, totpCode) {
      const body: { password: string; totp_code?: string } = { password };
      if (totpCode) body.totp_code = totpCode;
      // `restApi` is the cookie-authed REST helper; `api` in this closure is
      // the e2ee ApiClient, which has no method for this route.
      await restApi('/api/e2ee/user-keys', { method: 'DELETE', body: JSON.stringify(body) });
      // Only AFTER the server confirms. Dropping the in-memory session first
      // meant a refused destroy (wrong password, missing 2FA code) locked the
      // user out of a Vault that still exists and made them unlock again.
      session = null;
      ws = null;
    },

    lock() {
      session = null;
      ws = null;
    },

    async createWorkspace(id) {
      if (!session) throw new Error('e2ee: locked');
      ws = await engineCreateWorkspace(api, session, id);
    },

    async setWorkspaceScope(workspaceId, globalWorkspaceId) {
      await api.putWorkspaceScope(workspaceId, globalWorkspaceId);
    },

    async openWorkspace(id, selfFounded) {
      if (!session) throw new Error('e2ee: locked');
      // e2ee-core (P2b-log Task 2 fix): `selfFounded` must come from OUR OWN
      // persisted state, never from anything the server returns while
      // opening - see workspace.ts's `openWorkspace` doc comment for why a
      // server-derived value is a forge vector. The store (never this
      // facade) decides the value: true for a workspace this account
      // created, false for one merely discovered/shared (TOFU).
      ws = await engineOpenWorkspace(api, session, id, { selfFounded });
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

    async listMembers() {
      if (!ws) throw new Error('e2ee: no active workspace');
      return await engineListMembers(api, ws);
    },

    async inviteMember(email) {
      if (!session || !ws) throw new Error('e2ee: no active workspace');
      await engineGrantAccess(api, session, ws, email);
    },

    async revokeMember(userId, ed25519Pub) {
      if (!session || !ws) throw new Error('e2ee: no active workspace');
      // P2d Task 3: revokeAccess now ROTATES the workspace key (WK_v1->v2)
      // instead of just appending a remove-entry -- it mutates `ws` IN PLACE
      // (wk/wkVersion/lastSeen) on success, so this facade's closed-over `ws`
      // reference is immediately at v2 for every subsequent call
      // (listFolder/uploadFile/downloadFile) with no re-open needed.
      await engineRevokeAccess(api, session, ws, { userId, ed25519Pub });
    },

    async listMyWorkspaces() {
      return await api.listMyWorkspaces();
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
  /** The currently-open workspace's members. In-memory only - cleared on lock, never persisted. */
  members: WorkspaceMember[];
  busy: boolean;
  /** The recovery key, shown ONCE right after setup. Never persisted. */
  recoveryKeyOnce: string | null;
  /** Where `downloadEntry` hands decrypted bytes off to trigger a save. Swappable in tests (no DOM). */
  saver: (name: string, bytes: Uint8Array) => void;

  checkIdentity(): Promise<void>;
  setup(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  /** Unlock with the recovery key from setup. A failure is reported generically, like `unlock`. */
  unlockWithRecoveryKey(recoveryKey: string): Promise<void>;
  /**
   * Destroy the Vault identity and return to first-time setup. Resolves true
   * on success; on refusal `error` carries the server's sentence (wrong
   * password, missing 2FA code) and the identity is untouched.
   */
  destroyIdentity(password: string, totpCode?: string): Promise<boolean>;
  lock(): void;
  createWorkspace(name: string): Promise<void>;
  openWorkspace(id: string): Promise<void>;
  /**
   * Discover every workspace this account is a member of (P2c), extended by
   * P2e's scope metadata, and merge any not already known - a
   * `createdByMe:false` entry as `{shared:true, selfFounded:false}`, a
   * `createdByMe:true` entry as `{shared:false, selfFounded:false}` - NEVER
   * touching an already-known entry (esp. never downgrading/upgrading its
   * `selfFounded`). `selfFounded` is `false` for EVERY discovered entry,
   * regardless of `createdByMe`: only `createWorkspace` (this client's own
   * act of creation) is allowed to set it `true` - see the CRITICAL security
   * invariant in this module's `openWorkspace`/`E2eeEngine` doc comments.
   */
  refreshMyWorkspaces(): Promise<void>;
  /**
   * This account's OWN Spaces scoped to the active global workspace
   * (`useWorkspace.getState().activeId`) - never-shared entries whose
   * `globalWorkspaceId` matches the active id, plus a legacy/unscoped
   * (`globalWorkspaceId == null`) fallback so pre-P2e Spaces don't vanish.
   */
  mySpacesForActiveWorkspace(): KnownWorkspace[];
  /** Every Space shared WITH this account (`shared:true`), regardless of the active global workspace. */
  sharedSpaces(): KnownWorkspace[];
  refreshFolder(folderId?: string): Promise<void>;
  uploadFiles(files: FileList | File[], folderId?: string): Promise<void>;
  downloadEntry(entryId: string, name: string, folderId?: string): Promise<void>;
  /** Refresh `members` from the currently-open workspace. */
  refreshMembers(): Promise<void>;
  /** Invite a dosya user (by email) into the currently-open workspace, then refresh `members`. */
  inviteMember(email: string): Promise<void>;
  /** Revoke a member's access to the currently-open workspace, then refresh `members`. */
  revokeMember(userId: string, ed25519Pub: string): Promise<void>;
  dismissRecoveryKey(): void;
  /** Test seam: swap in a fake `E2eeEngine`. */
  __setEngine(engine: E2eeEngine): void;
  /** Test seam: swap in a fake saver (production default is the real `saveBytes`, DOM-dependent). */
  __setSaver(saver: (name: string, bytes: Uint8Array) => void): void;
}

/**
 * The API's 412 `e2ee_scope_required` as it reaches the store: e2ee-client's
 * transport throws `e2ee: <route> request failed (<status>)` for any non-2xx
 * (apart from the 409 it treats as a CAS conflict), so the status code in
 * that text is the only signal available here.
 */
function isScopeRequired(e: unknown): boolean {
  return e instanceof Error && /\(412\)/.test(e.message);
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
      members: [],
      busy: false,
      recoveryKeyOnce: null,
      saver: saveBytes,

      async checkIdentity() {
        try {
          const hasIdentity = await get().engine.hasIdentity();
          set({ hasIdentity, error: null });
        } catch (e) {
          // We genuinely don't know whether an identity exists - do NOT set
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
          // passphrase, no identity, corrupt record) - surface a single
          // generic message here too, never the engine's own text.
          set({
            status: 'locked',
            busy: false,
            error: 'Incorrect passphrase or no identity found.',
          });
        }
      },

      async unlockWithRecoveryKey(recoveryKey) {
        set({ status: 'unlocking', error: null, busy: true });
        try {
          // The spacing and dashes belong to however the key was pasted, not
          // to the key - normalised once here, at the boundary every caller
          // (the unlock gate today) goes through.
          await get().engine.unlockWithRecoveryKey(normalizeRecoveryKey(recoveryKey));
          set({ status: 'unlocked', hasIdentity: true, busy: false, error: null });
        } catch (e) {
          // Same opacity rule as `unlock`: one generic sentence, never the
          // engine's own text - except when the build has no recovery path at
          // all, which is a product state the user should be told about.
          const unavailable = e instanceof Error && e.message.includes('recovery unlock unavailable');
          set({
            status: 'locked',
            busy: false,
            error: unavailable
              ? 'Recovery key unlock is not available in this version yet. Please try again after the next update.'
              : 'That recovery key did not unlock your Vault.',
          });
        }
      },

      async destroyIdentity(password, totpCode) {
        set({ busy: true, error: null });
        try {
          await get().engine.destroyIdentity(password, totpCode);
          // Everything the old identity described is gone with it: the
          // persisted Spaces list would otherwise point at grants that no
          // longer exist. hasIdentity=false routes the gate to Setup.
          set({
            status: 'locked',
            hasIdentity: false,
            workspaces: [],
            activeWorkspaceId: null,
            entries: [],
            members: [],
            recoveryKeyOnce: null,
            busy: false,
            error: null,
          });
          return true;
        } catch (e) {
          set({ busy: false, error: apiErrorMessage(e, errorMessage(e, 'Could not destroy the Vault.')) });
          return false;
        }
      },

      lock() {
        get().engine.lock();
        set({ status: 'locked', entries: [], activeWorkspaceId: null, members: [], error: null });
      },

      async createWorkspace(name) {
        set({ busy: true, error: null });
        const gw = useWorkspace.getState().activeId;
        const id = crypto.randomUUID();
        try {
          await get().engine.createWorkspace(id);
          // P2e: record the workspace→global-workspace association right
          // after creation - plaintext metadata, not crypto (see
          // `setWorkspaceScope`'s doc comment). This is DISPLAY-ONLY: it
          // never feeds `selfFounded` below.
          await get().engine.setWorkspaceScope(id, gw);
          set((s) => ({
            // SECURITY: this account created `id` - it is hard-anchored,
            // selfFounded:true, forever (persisted below via `partialize`).
            // A later `refreshMyWorkspaces()` must never downgrade this.
            workspaces: [...s.workspaces, { id, name, selfFounded: true, shared: false, globalWorkspaceId: gw }],
            activeWorkspaceId: id,
            busy: false,
          }));
        } catch (e) {
          set({ busy: false, error: errorMessage(e, 'Could not create Space.') });
        }
      },

      async openWorkspace(id) {
        set({ busy: true, error: null });
        try {
          // SECURITY: `selfFounded` comes ONLY from our own persisted
          // `workspaces` list (client-authored - created via createWorkspace,
          // or merged in as false by refreshMyWorkspaces) - NEVER from
          // the server. Default false (safe) for an id we don't recognize at
          // all: a genuinely-shared workspace we haven't discovered yet via
          // refreshMyWorkspaces should still open as TOFU, not founder.
          const known = get().workspaces.find((w) => w.id === id);
          await get().engine.openWorkspace(id, known?.selfFounded ?? false);
          set({ activeWorkspaceId: id, members: [], busy: false });
        } catch (e) {
          set({ busy: false, error: errorMessage(e, 'Could not open Space.') });
        }
      },

      async refreshMyWorkspaces() {
        try {
          const mine = await get().engine.listMyWorkspaces();
          set((s) => {
            const known = new Set(s.workspaces.map((w) => w.id));
            // SECURITY: `selfFounded` is ALWAYS `false` here, regardless of
            // the server's `createdByMe` - a discovered entry (one this
            // client did not itself `createWorkspace`) is TOFU, never the
            // hard-anchored founder. `createdByMe`/`globalWorkspaceId` are
            // DISPLAY-ONLY (they drive `shared` + the active-workspace
            // grouping below) - see this module's top-level doc comments and
            // the CRITICAL security invariant in the P2e plan. Do NOT wire
            // `createdByMe` into `selfFounded`.
            const discovered: KnownWorkspace[] = mine
              .filter((m) => !known.has(m.workspaceId))
              .map((m) => ({
                id: m.workspaceId,
                name: m.createdByMe ? 'Space' : 'Shared Space',
                globalWorkspaceId: m.globalWorkspaceId,
                shared: !m.createdByMe,
                selfFounded: false,
              }));
            return discovered.length > 0 ? { workspaces: [...s.workspaces, ...discovered] } : {};
          });
        } catch (e) {
          set({ error: errorMessage(e, 'Could not check for shared Spaces.') });
        }
      },

      mySpacesForActiveWorkspace() {
        const activeId = useWorkspace.getState().activeId;
        return get().workspaces.filter(
          (w) => !w.shared && (w.globalWorkspaceId === activeId || w.globalWorkspaceId == null),
        );
      },

      sharedSpaces() {
        return get().workspaces.filter((w) => w.shared);
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
            try {
              await get().engine.uploadFile(folderId, file.name, bytes);
            } catch (e) {
              // A Space with no storage workspace cannot take bytes (the API
              // answers 412 `e2ee_scope_required` from chunk-upload-url or
              // commit). Pre-P2e Spaces and Spaces whose workspace was since
              // deleted are in that state; attach this one to the active
              // global workspace - where the Vault UI already lists it - and
              // retry once. e2ee-client surfaces only the status code in its
              // error text, so the status is what is matched.
              const spaceId = get().activeWorkspaceId;
              const gw = useWorkspace.getState().activeId;
              if (!isScopeRequired(e) || !spaceId || !gw) throw e;
              await get().engine.setWorkspaceScope(spaceId, gw);
              set((s) => ({
                workspaces: s.workspaces.map((w) => (w.id === spaceId ? { ...w, globalWorkspaceId: gw } : w)),
              }));
              await get().engine.uploadFile(folderId, file.name, bytes);
            }
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

      async refreshMembers() {
        set({ busy: true, error: null });
        try {
          const members = await get().engine.listMembers();
          set({ members, busy: false });
        } catch (e) {
          set({ busy: false, error: errorMessage(e, 'Could not load members.') });
        }
      },

      async inviteMember(email) {
        set({ busy: true, error: null });
        try {
          await get().engine.inviteMember(email);
          await get().refreshMembers();
          set({ busy: false });
          toast.success('Invited', email);
        } catch (e) {
          // The engine's directory-lookup failure is worded for a developer
          // ("that user has no E2EE identity"); surface a friendly,
          // user-facing message instead of leaking that phrasing verbatim.
          const message =
            e instanceof Error && e.message.includes('no E2EE identity')
              ? "That user hasn't set up encryption yet"
              : errorMessage(e, 'Could not invite that user.');
          set({ busy: false, error: message });
          toast.error('Invite failed', message);
        }
      },

      async revokeMember(userId, ed25519Pub) {
        set({ busy: true, error: null });
        try {
          await get().engine.revokeMember(userId, ed25519Pub);
          await get().refreshMembers();
          set({ busy: false });
          toast.success('Access revoked');
        } catch (e) {
          set({ busy: false, error: errorMessage(e, 'Could not revoke that member.') });
          toast.error('Revoke failed', errorMessage(e, 'Could not revoke that member.'));
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
      // The KEK/Session/private keys/recovery key live in memory ONLY -
      // never write them (or the engine instance itself) to localStorage.
      // Persist ONLY the non-secret workspace id+name+selfFounded+
      // globalWorkspaceId+shared hints (selfFounded is itself the
      // client-authored anchor `openWorkspace` relies on - see its doc
      // comment above - so it MUST persist here; globalWorkspaceId/shared
      // are P2e's DISPLAY-ONLY grouping hints, equally non-secret - plain
      // ids, no key material). `members` is likewise in-memory only (cleared
      // on lock/workspace switch) and deliberately excluded: this is an
      // ALLOWLIST, so it drops anything not named here regardless.
      partialize: (state) => ({ workspaces: state.workspaces }),
    },
  ),
);
