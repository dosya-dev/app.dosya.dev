/**
 * The Vault (unlock gate, setup, recovery key, destroy dialog, Spaces, members)
 * and the AI-apps connect pages in Turkish: no English left. Keys, passphrases,
 * recovery codes, names, emails and hosts are values and stay as sent.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';
import { LOCALES } from '@/i18n/locales';
import { loadMessages } from '@/lib/i18n';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, API_BASE: 'https://api.dosya.dev', api: (...args: unknown[]) => apiMock(...args) };
});

const { ApiError } = await import('@/api/client');
const { UnlockGate, RecoveryKeyDialog } = await import('@/components/e2ee/unlock-gate');
const { EncryptedBrowser } = await import('@/components/e2ee/encrypted-browser');
const { MembersPanel } = await import('@/components/e2ee/members-panel');
const { useE2ee } = await import('@/stores/e2ee');
const { useWorkspace } = await import('@/stores/workspace');
const { toast } = await import('@/lib/toast');
const ConnectAiPage = (await import('@/pages/connect/ai')).default;
const ConnectExtensionPage = (await import('@/pages/connect/extension')).default;
const ConnectExtensionDonePage = (await import('@/pages/connect/extension-done')).default;
const ConnectLightroomPage = (await import('@/pages/connect/lightroom')).default;
const ConnectWordPressPage = (await import('@/pages/connect/wordpress')).default;
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;
const en = (await import('@/i18n/messages/en.json')).default as Record<string, string>;
type E2eeEngine = import('@/stores/e2ee').E2eeEngine;

let shown: Rendered | null = null;
vi.setConfig({ testTimeout: 20_000 });
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useWorkspace.setState({ activeId: 'gw1' });
  // The public nav asks who is signed in; a signed-out answer keeps it quiet.
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/me') throw new ApiError(401, '{}');
    return { ok: true };
  });
  useE2ee.setState({
    status: 'locked', error: null, errorKey: null, hasIdentity: null, workspaces: [], activeWorkspaceId: null,
    entries: [], members: [], busy: false, recoveryKeyOnce: null,
  });
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function show(ui: React.ReactElement, url = '/') {
  shown = await renderInLocale(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>, 'tr');
  await flush(); await flush(); await flush();
  return shown;
}
const text = () => document.body.textContent ?? '';
function clickText(label: string) {
  const matches = [...document.querySelectorAll<HTMLElement>('button, a')].filter((n) => n.textContent?.trim() === label);
  const el = matches.pop();
  expect(el, `no button/link "${label}"`).toBeDefined();
  return act(async () => { el!.click(); });
}
async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** jsdom's File has no arrayBuffer(); the store reads it. */
const fileWithBytes = (name: string) => Object.assign(new File(['x'], name), { arrayBuffer: async () => new ArrayBuffer(1) });

function fakeEngine(overrides: Partial<E2eeEngine> = {}): E2eeEngine {
  return {
    hasIdentity: async () => true,
    setup: async () => ({ recoveryKeyHex: 'ab12cd34ef56' }), // gitleaks:allow - fake recovery key
    unlock: async () => {},
    unlockWithRecoveryKey: async () => {},
    destroyIdentity: async () => {},
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
    ...overrides,
  };
}

// ── The unlock gate ─────────────────────────────────────────────────

describe('Vault unlock gate in Turkish', () => {
  it('first-time setup card', async () => {
    useE2ee.getState().__setEngine(fakeEngine({ hasIdentity: async () => false }));
    const r = await show(<UnlockGate />);
    expect(r.leftover()).toEqual([]);
    expect(text()).toContain(tr['vault.heading.setUpEncryption']);
    expect(document.querySelector(`input[placeholder="${tr['vault.placeholder.enterAStrongPassphrase']}"]`)).not.toBeNull();
    // The warning keeps "and" emphasised.
    expect(document.querySelector('strong')?.textContent).toBeTruthy();
  });

  it('the passphrase mismatch line', async () => {
    useE2ee.getState().__setEngine(fakeEngine({ hasIdentity: async () => false }));
    const r = await show(<UnlockGate />);
    const pass = document.getElementById('e2ee-setup-pass') as HTMLInputElement;
    const confirm = document.getElementById('e2ee-setup-pass-confirm') as HTMLInputElement;
    await typeInto(pass, 'one');
    await typeInto(confirm, 'two');
    await act(async () => { confirm.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(text()).toContain(tr['vault.error.passphrasesDoNotMatch']);
    expect(r.leftover()).toEqual([]);
  });

  it('a failed check offers Retry in Turkish and keeps the English field', async () => {
    useE2ee.getState().__setEngine(fakeEngine({ hasIdentity: async () => { throw new Error(''); } }));
    const r = await show(<UnlockGate />);
    expect(text()).toContain(tr['vault.error.couldNotCheckEncryptionStatus']);
    expect(text()).toContain(tr['common.retry']);
    expect(r.leftover()).toEqual([]);
    // The store holds a key; the old field still reads English.
    expect(useE2ee.getState().errorKey).toBe('vault.error.couldNotCheckEncryptionStatus');
    expect(useE2ee.getState().error).toBe('Could not check encryption status.');
  });

  it('the unlock card, the recovery key mode and a wrong passphrase', async () => {
    useE2ee.getState().__setEngine(fakeEngine({ unlock: async () => { throw new Error('boom'); } }));
    const r = await show(<UnlockGate />);
    expect(r.leftover()).toEqual([]);
    await typeInto(document.getElementById('e2ee-unlock-pass') as HTMLInputElement, 'nope');
    await clickText(tr['common.action.unlock']);
    await flush();
    expect(text()).toContain(tr['vault.error.incorrectPassphraseOrNoIdentityFound']);
    expect(useE2ee.getState().error).toBe('Incorrect passphrase or no identity found.');
    expect(r.leftover()).toEqual([]);
    await clickText(tr['vault.action.useRecoveryKey']);
    expect(text()).toContain(tr['vault.heading.unlockWithRecoveryKey']);
    expect(text()).toContain(tr['vault.description.pasteTheRecoveryKeyYouSavedWhenYouSet']);
    expect(r.leftover()).toEqual([]);
  });

  it('a recovery key that does not unlock', async () => {
    useE2ee.getState().__setEngine(fakeEngine({ unlockWithRecoveryKey: async () => { throw new Error('bad'); } }));
    const r = await show(<UnlockGate />);
    await clickText(tr['vault.action.useRecoveryKey']);
    await typeInto(document.getElementById('e2ee-recovery-key') as HTMLInputElement, 'deadbeef');
    await clickText(tr['common.action.unlock']);
    await flush();
    expect(text()).toContain(tr['vault.description.thatRecoveryKeyDidNotUnlockYourVault']);
    expect(r.leftover()).toEqual([]);
  });

  it('the destroy dialog with the two-factor field', async () => {
    apiMock.mockResolvedValue({ ok: true, method: 'totp' });
    const r = await show(<UnlockGate />);
    await clickText(tr['vault.action.destroyVaultAndStartOver']);
    await flush();
    expect(text()).toContain(tr['vault.description.thisDeletesYourVaultIdentityEveryFileInEverySpaceYou']);
    expect(text()).toContain(tr['vault.label.twoFactorCode']);
    expect(document.querySelector(`input[placeholder="${tr['common.placeholder.6DigitCode']}"]`)).not.toBeNull();
    expect(text()).toContain(tr['vault.error.iUnderstandMyEncryptedFilesCannotBeRecoveredAfterThis']);
    expect(text()).toContain(tr['vault.action.destroyMyVault']);
    expect(r.leftover()).toEqual([]);
  });

  it('a refused destroy shows the server sentence as sent, a local failure a Turkish one', async () => {
    apiMock.mockResolvedValue({ ok: true, method: null });
    useE2ee.getState().__setEngine(fakeEngine({ destroyIdentity: async () => { throw new Error('plain'); } }));
    const r = await show(<UnlockGate />);
    await clickText(tr['vault.action.destroyVaultAndStartOver']);
    await flush();
    await typeInto(document.getElementById('e2ee-destroy-password') as HTMLInputElement, 'pw');
    await act(async () => { (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await clickText(tr['vault.action.destroyMyVault']);
    await flush();
    expect(text()).toContain('plain');
    expect(r.leftover()).toEqual([]);
  });

  it('destroying the vault toasts in Turkish', async () => {
    apiMock.mockResolvedValue({ ok: true, method: null });
    const ok = vi.spyOn(toast, 'success').mockImplementation(() => undefined as never);
    useE2ee.getState().__setEngine(fakeEngine());
    await show(<UnlockGate />);
    await clickText(tr['vault.action.destroyVaultAndStartOver']);
    await flush();
    await typeInto(document.getElementById('e2ee-destroy-password') as HTMLInputElement, 'pw');
    await act(async () => { (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await clickText(tr['vault.action.destroyMyVault']);
    await flush();
    expect(ok).toHaveBeenCalledWith(tr['vault.feedback.vaultDestroyed'], tr['vault.feedback.setUpEncryptionAgainWheneverYouAreReady']);
  });
});

describe('Recovery key dialog in Turkish', () => {
  it('shows the key untouched and copies with a Turkish toast', async () => {
    useE2ee.setState({ recoveryKeyOnce: 'ab12-CD34-ef56' }); // gitleaks:allow - fake recovery key
    const ok = vi.spyOn(toast, 'success').mockImplementation(() => undefined as never);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    const r = await show(<RecoveryKeyDialog />);
    expect(document.body.textContent).toContain('ab12-CD34-ef56');
    expect(text()).toContain(tr['vault.heading.saveYourRecoveryKey']);
    expect(text()).toContain(tr['vault.action.iVeSavedIt']);
    expect(r.leftover()).toEqual([]);
    const copy = document.querySelector<HTMLElement>(`button[title="${tr['vault.action.copyRecoveryKey']}"]`);
    expect(copy).not.toBeNull();
    await act(async () => { copy!.click(); });
    await flush();
    expect(ok).toHaveBeenCalledWith(tr['common.feedback.copied'], tr['vault.feedback.recoveryKeyCopiedToClipboard']);
    expect(text()).toContain(tr['common.description.copiedToClipboard']);
    expect(r.leftover()).toEqual([]);
  });
});

// ── Spaces, members, files ──────────────────────────────────────────

const SPACES = [
  { id: 's1', name: 'Personal', selfFounded: true, globalWorkspaceId: 'gw1', shared: false },
  { id: 's2', name: 'Team notes', selfFounded: false, globalWorkspaceId: null, shared: true },
  { id: 's3', name: 'Space', selfFounded: false, globalWorkspaceId: 'gw1', shared: false, stub: true },
  { id: 's4', name: 'Shared Space', selfFounded: false, globalWorkspaceId: null, shared: true, stub: true },
];

describe('Vault browser in Turkish', () => {
  it('with no open Space', async () => {
    useE2ee.setState({ status: 'unlocked', workspaces: SPACES });
    useE2ee.getState().__setEngine(fakeEngine());
    const r = await show(<EncryptedBrowser />);
    expect(text()).toContain(tr['vault.description.selectOrCreateASpaceToGetStarted']);
    expect(text()).toContain(tr['vault.status.endToEndEncrypted']);
    expect(text()).toContain(tr['vault.label.mySpaces']);
    expect(text()).toContain(tr['vault.label.sharedWithMe']);
    expect(r.leftover()).toEqual([]);
    // Placeholder names are shown in the language; real names as typed.
    expect(text()).toContain('Personal');
    expect(text()).toContain(tr['common.label.space']);
    expect(text()).toContain(tr['vault.status.sharedSpace']);
    // The persisted placeholder names stay as the store holds them.
    expect(useE2ee.getState().workspaces.find((w) => w.id === 's3')?.name).toBe('Space');
  });

  it('an open Space with a folder and a file, the empty state and the new Space dialog', async () => {
    useE2ee.setState({
      status: 'unlocked', workspaces: SPACES, activeWorkspaceId: 's1',
      entries: [{ id: 'f1', name: 'Taxes', kind: 'folder' }, { id: 'f2', name: 'notes.pdf', kind: 'file' }, { id: 'f3', name: 'README', kind: 'file' }],
    });
    useE2ee.getState().__setEngine(fakeEngine());
    const r = await show(<EncryptedBrowser />);
    expect(text()).toContain(tr['vault.label.encryptedFolder']);
    expect(document.querySelector(`button[title="${tr['common.action.download']}"]`)).not.toBeNull();
    expect(r.leftover()).toEqual([]);
    await clickText(tr['vault.action.newSpace']);
    expect(document.querySelector(`input[placeholder="${tr['vault.placeholder.eGPersonalDocuments']}"]`)).not.toBeNull();
    expect(text()).toContain(tr['common.action.create']);
    expect(r.leftover()).toEqual([]);
  });

  it('the empty folder, a store error and the member dialog', async () => {
    useE2ee.setState({
      status: 'unlocked', workspaces: SPACES, activeWorkspaceId: 's1', entries: [],
      error: 'Could not load folder.', errorKey: 'vault.error.couldNotLoadFolder',
      members: [{ userId: 'u1', email: 'me@example.test', ed25519Pub: 'a', x25519Pub: 'b' }, { userId: 'u2', email: 'other@example.test', ed25519Pub: 'c', x25519Pub: 'd' }],
    });
    apiMock.mockResolvedValue({ user: { id: 'u1' } });
    useE2ee.getState().__setEngine(fakeEngine());
    const r = await show(<EncryptedBrowser />);
    expect(text()).toContain(tr['vault.description.noFilesYetUploadToGetStarted']);
    expect(text()).toContain(tr['vault.error.couldNotLoadFolder']);
    expect(r.leftover()).toEqual([]);
    await clickText(tr['common.action.members']);
    await flush();
    expect(text()).toContain('me@example.test');
    expect(text()).toContain(tr['common.status.you']);
    expect(text()).toContain(tr['vault.description.accessIsGrantedByTrustOnFirstUseVerify']);
    expect(document.querySelector(`input[placeholder="${tr['vault.placeholder.teammateExampleCom']}"]`)).not.toBeNull();
    expect(r.leftover()).toEqual([]);
  });

  it('a Space heading in the members title uses the placeholder label', async () => {
    useE2ee.setState({ status: 'unlocked', workspaces: SPACES, activeWorkspaceId: 's4' });
    apiMock.mockResolvedValue({ user: { id: 'u1' } });
    useE2ee.getState().__setEngine(fakeEngine());
    await show(<EncryptedBrowser />);
    await clickText(tr['common.action.members']);
    await flush();
    expect(text()).toContain(`Üyeler: ${tr['vault.status.sharedSpace']}`);
  });
});

describe('Members panel revoke dialog in Turkish', () => {
  it('names the person and the Space, quotes come from the template only', async () => {
    useE2ee.setState({
      status: 'unlocked', workspaces: SPACES, activeWorkspaceId: 's1',
      members: [{ userId: 'u2', email: 'other@example.test', ed25519Pub: 'c', x25519Pub: 'd' }],
    });
    apiMock.mockResolvedValue({ user: { id: 'u1' } });
    const r = await show(<MembersPanel open onOpenChange={() => {}} workspaceName={'A &ldquo; B'} />);
    await flush();
    const trash = document.querySelector<HTMLElement>(`button[title="${tr['vault.action.revokeAccess']}"]`);
    expect(trash).not.toBeNull();
    await act(async () => { trash!.click(); });
    expect(text()).toContain(tr['vault.heading.revokeAccess']);
    expect(text()).toContain(tr['vault.description.revokingReKeysThisSpaceSoFutureContentIs']);
    // The template's entity is decoded; a value that contains entity text is left alone.
    expect(text()).toContain('“A &ldquo; B”');
    expect(text()).not.toMatch(/&ldquo;(?! B)/);
    expect(text()).toContain('other@example.test');
    expect(r.leftover()).toEqual([]);
  });
});

// ── The store holds keys ────────────────────────────────────────────

describe('e2ee store keeps keys, not sentences', () => {
  it('every failure path has a key and the unchanged English field', async () => {
    const boom = () => { throw new Error(''); };
    useE2ee.getState().__setEngine(fakeEngine({
      setup: boom, createWorkspace: boom, openWorkspace: boom, renameWorkspace: boom, listMyWorkspaces: boom,
      listFolder: boom, uploadFile: boom, downloadFile: boom, listMembers: boom, inviteMember: boom, revokeMember: boom,
    }));
    const s = () => useE2ee.getState();
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => undefined as never);
    useE2ee.setState({ activeWorkspaceId: 's1', workspaces: SPACES });
    const cases: [() => Promise<unknown>, string, string][] = [
      [() => s().setup('p'), 'vault.error.couldNotSetUpEncryption', 'Could not set up encryption.'],
      [() => s().createWorkspace('n'), 'vault.error.couldNotCreateSpace', 'Could not create Space.'],
      [() => s().openWorkspace('s1'), 'vault.error.couldNotOpenSpace', 'Could not open Space.'],
      [() => s().renameWorkspace('s1', 'n'), 'vault.error.couldNotRenameSpace', 'Could not rename Space.'],
      [() => s().refreshMyWorkspaces(), 'vault.error.couldNotCheckForSharedSpaces', 'Could not check for shared Spaces.'],
      [() => s().refreshFolder(), 'vault.error.couldNotLoadFolder', 'Could not load folder.'],
      [() => s().uploadFiles([fileWithBytes('a.txt')]), 'vault.error.couldNotUploadFile', 'Could not upload file.'],
      [() => s().downloadEntry('e', 'a.txt'), 'vault.error.couldNotDownloadFile', 'Could not download file.'],
      [() => s().refreshMembers(), 'vault.error.couldNotLoadMembers', 'Could not load members.'],
      [() => s().inviteMember('a@b.c'), 'vault.error.couldNotInviteThatUser', 'Could not invite that user.'],
      [() => s().revokeMember('u', 'k'), 'vault.error.couldNotRevokeThatMember', 'Could not revoke that member.'],
    ];
    for (const [run, key, english] of cases) {
      useE2ee.setState({ error: null, errorKey: null });
      await run();
      expect(s().errorKey, key).toBe(key);
      expect(s().error, key).toBe(english);
      expect(en[key]).toBe(english);
    }
    expect(toastError).toHaveBeenCalled();
  });

  it('library text stays as the value with no key; internal e2ee text maps to a key', async () => {
    useE2ee.getState().__setEngine(fakeEngine({ listFolder: async () => { throw new Error('e2ee: GET /x request failed (500)'); } }));
    await useE2ee.getState().refreshFolder();
    expect(useE2ee.getState().errorKey).toBeNull();
    expect(useE2ee.getState().error).toBe('e2ee: GET /x request failed (500)');
    useE2ee.getState().__setEngine(fakeEngine({ listFolder: async () => { throw new Error('e2ee: locked'); } }));
    await useE2ee.getState().refreshFolder();
    expect(useE2ee.getState().errorKey).toBe('vault.error.e2eeLocked');
    expect(useE2ee.getState().error).toBe('e2ee: locked');
  });

  it('a stale key never overrides an error set directly', async () => {
    useE2ee.setState({ status: 'unlocked', workspaces: SPACES, activeWorkspaceId: 's1', error: 'Direct text', errorKey: 'vault.error.couldNotLoadFolder' });
    useE2ee.getState().__setEngine(fakeEngine());
    await show(<EncryptedBrowser />);
    expect(text()).toContain('Direct text');
    expect(text()).not.toContain(tr['vault.error.couldNotLoadFolder']);
  });

  it('upload and download toasts are translated at call time', async () => {
    const ok = vi.spyOn(toast, 'success').mockImplementation(() => undefined as never);
    useE2ee.getState().__setEngine(fakeEngine());
    useE2ee.getState().__setSaver(() => {});
    (await renderInLocale(<span />, 'en')).unmount();
    useE2ee.setState({ activeWorkspaceId: 's1', workspaces: SPACES });
    // English module-level locale here: the byte-identical English texts.
    await useE2ee.getState().uploadFiles([fileWithBytes('a.txt'), fileWithBytes('b.txt')]);
    expect(ok).toHaveBeenCalledWith('Uploaded', '2 files');
    await useE2ee.getState().downloadEntry('e', 'a.txt');
    expect(ok).toHaveBeenCalledWith('Downloaded', 'a.txt');
  });
});

// ── Connect pages ───────────────────────────────────────────────────

const consent = (over: Record<string, unknown> = {}, account: { email?: string } | undefined = { email: 'firat@example.com' }) => ({
  ok: true,
  consent: {
    client: { name: 'Claude', domain: null, redirectHost: 'claude.ai', redirectIsLoopback: false, brand: 'claude', by: 'Anthropic', ...over },
    scopes: [{ id: 'files.read', required: true }, { id: 'account.read', required: false }],
    workspaces: [{ id: 'ws_1', name: 'Acme' }, { id: 'ws_2', name: 'Side project' }],
  },
  account,
});

describe('connect/ai in Turkish', () => {
  it('a verified app', async () => {
    apiMock.mockResolvedValue(consent());
    const r = await show(<ConnectAiPage />, '/connect/ai?handle=h1');
    expect(r.leftover()).toEqual([]);
    expect(text()).toContain('Claude');
    expect(text()).toContain(tr['connect-ai.label.seeYourPlanAndStorage']);
    expect(text()).toContain(tr['connect-ai.label.changeShareOrDeleteAnything']);
    expect(text()).toContain(tr['connect-ai.description.openYourOtherWorkspacesOrYourVault']);
    expect(text()).toContain('Doğrulandı: claude.ai');
    expect(text()).toContain('Yayımlayan: Anthropic');
    expect(text()).toContain('İzin ver: Claude');
    expect(text()).toContain(tr['common.action.deny']);
    expect(document.querySelector(`[aria-label="${tr['connect-ai.accessibility.workspaceItCanRead']}"]`)).not.toBeNull();
  });

  it('the footer names the host first and the account second, each in its own emphasis', async () => {
    apiMock.mockResolvedValue(consent());
    await show(<ConnectAiPage />, '/connect/ai?handle=h1');
    const strongs = [...document.querySelectorAll('p strong')].map((s) => s.textContent);
    expect(strongs).toEqual(['claude.ai', 'firat@example.com']);
    expect(text()).toContain('Erişim hedefi: claude.ai. Oturum açılan hesap: firat@example.com.');
    expect(text()).not.toMatch(/ {2}/);
  });

  it('no account email: one emphasis, no doubled space', async () => {
    apiMock.mockResolvedValue(consent({}, {}));
    await show(<ConnectAiPage />, '/connect/ai?handle=h1');
    const strongs = [...document.querySelectorAll('p strong')].map((s) => s.textContent);
    expect(strongs).toEqual(['claude.ai']);
    expect(text()).not.toMatch(/ {2}/);
  });

  it('an unverified app with a domain and one without', async () => {
    apiMock.mockResolvedValue(consent({ brand: null, by: null, domain: 'acme.example' }));
    let r = await show(<ConnectAiPage />, '/connect/ai?handle=h1');
    expect(text()).toContain('Yayımlayan: acme.example. Yalnızca tanıyorsanız devam edin.');
    expect(text()).toContain('Doğrulanmadı · Gönderilecek adres: claude.ai');
    expect(r.leftover()).toEqual([]);
    r.unmount();
    apiMock.mockResolvedValue(consent({ brand: null, by: null, domain: null }));
    r = await show(<ConnectAiPage />, '/connect/ai?handle=h1');
    expect(text()).toContain(`${tr['connect-ai.description.cdomainSelectTruePublishedByEmphasis1OtherThisAppRegisteredItself'].match(/other \{([^}]*)\}/)![1].trim()} ${'Yalnızca tanıyorsanız devam edin.'}`);
    expect(text()).not.toMatch(/ {2}/);
    expect(r.leftover()).toEqual([]);
  });

  it('a loopback app and a person with no workspace', async () => {
    apiMock.mockResolvedValue({ ...consent({ redirectIsLoopback: true, brand: null }), consent: { ...consent({ redirectIsLoopback: true, brand: null }).consent, workspaces: [] } });
    const r = await show(<ConnectAiPage />, '/connect/ai?handle=h1');
    expect(text()).toContain(tr['connect-ai.description.thisSendsAccessToAnAppOnYourComputerContinueOnly']);
    expect(text()).toContain(tr['connect-ai.error.youHaveNoWorkspaceThisAppCanReadEndToEndEncryptedSpaces']);
    expect(r.leftover()).toEqual([]);
  });

  it('an invalid link, an expired request and a generic failure', async () => {
    let r = await show(<ConnectAiPage />, '/connect/ai');
    expect(text()).toContain(tr['connect-ai.error.thatLinkIsNotValid']);
    expect(text()).toContain(tr['connect-ai.description.startConnectingAgainFromYourAiApp']);
    expect(r.leftover()).toEqual([]);
    r.unmount();
    apiMock.mockRejectedValue(new ApiError(410, '{}'));
    r = await show(<ConnectAiPage />, '/connect/ai?handle=h1');
    expect(text()).toContain(tr['connect-ai.description.thisRequestExpiredGoBackToYourAiAppAndConnect']);
    r.unmount();
    apiMock.mockRejectedValue(new Error('x'));
    r = await show(<ConnectAiPage />, '/connect/ai?handle=h1');
    expect(text()).toContain(tr['connect-ai.error.couldNotConnectTheAppPleaseTryAgain']);
    r.unmount();
    apiMock.mockRejectedValue(new ApiError(502, '<html>'));
    r = await show(<ConnectAiPage />, '/connect/ai?handle=h1');
    expect(text()).toContain(tr['common.error.requestFailedErrstatusPleaseTryAgain'].replace('{errStatus}', '502'));
  });
});

describe('connect/extension in Turkish', () => {
  // The product name "Save to dosya" starts these Turkish texts ("Save to dosya
  // uzantısını bağla: Chrome"). The save-share catalog has the English
  // "Save to {name}" (a button), whose pattern reads any text opening with
  // "Save to " as English with a name. That is a false positive of the
  // matcher, not English on screen, so texts opening with the brand are
  // allowed here only.
  const extensionLeftover = (r: { leftover(): string[] }) => r.leftover().filter((t) => !t.startsWith('Save to dosya '));
  const q = '?client=chrome&code_challenge=c&state=s&redirect_uri=https%3A%2F%2Fx.example%2Fcb';
  it('the allow page', async () => {
    const r = await show(<ConnectExtensionPage />, `/connect/extension${q}`);
    expect(extensionLeftover(r)).toEqual([]);
    expect(text()).toContain(tr['connect-extension.label.saveFilesIntoYourFolders']);
    expect(text()).toContain(tr['common.label.createFolders']);
    expect(text()).toContain(tr['connect-extension.description.createAShareLinkForAFileItSaved']);
    expect(text()).toContain(tr['common.action.allow']);
    expect(text()).toContain(tr['common.cancel']);
    expect(text()).toContain('Chrome');
  });
  it('an incomplete link and the done page', async () => {
    let r = await show(<ConnectExtensionPage />, '/connect/extension');
    expect(text()).toContain(tr['connect-extension.heading.thisLinkIsIncomplete']);
    expect(text()).toContain(tr['connect-extension.description.openTheSignInFromTheSaveToDosyaExtensionSPopupNot']);
    expect(extensionLeftover(r)).toEqual([]);
    r.unmount();
    r = await show(<ConnectExtensionDonePage />, '/connect/extension/done?code=c&state=s');
    expect(text()).toContain(tr['connect-extension-done.heading.saveToDosyaIsConnected']);
    expect(text()).toContain(tr['connect-extension-done.description.youCanCloseThisTab']);
    expect(extensionLeftover(r)).toEqual([]);
  });
  it('a wrong callback and a failure', async () => {
    apiMock.mockResolvedValue({ ok: true, redirect: 'https://evil.example/cb?code=1' });
    const r = await show(<ConnectExtensionPage />, `/connect/extension${q}`);
    await clickText(tr['common.action.allow']);
    await flush();
    expect(text()).toContain(tr['connect-extension.error.theServerReturnedAnUnexpectedCallback']);
    expect(extensionLeftover(r)).toEqual([]);
    apiMock.mockRejectedValue(new Error('x'));
    await clickText(tr['common.action.allow']);
    await flush();
    expect(text()).toContain(tr['connect-extension.error.couldNotConnectTheExtensionPleaseTryAgain']);
  });
});

const LR_REQ = (over: Record<string, unknown> = {}) => ({
  ok: true, request: { device_name: 'My Mac', plugin_version: '1.2.3', created_at: 1, expires_at: 9_999_999_999, status: 'pending', ...over },
});
function lrApi(over: Record<string, unknown> = {}, workspaces = [{ id: 'ws1', name: 'Acme' }]) {
  apiMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/lightroom/connect/request')) return LR_REQ(over);
    if (path === '/api/workspaces') return { ok: true, workspaces };
    return { ok: true };
  });
}

describe('connect/lightroom in Turkish', () => {
  it('the approval page names the device and the plug-in version', async () => {
    lrApi();
    useWorkspace.setState({ activeId: 'ws1' });
    const r = await show(<ConnectLightroomPage />, '/connect/lightroom?code=abcd-1234');
    expect(r.leftover()).toEqual([]);
    expect(text()).toContain(tr['connect-lightroom.heading.connectLightroomClassicToDosya']);
    expect(text()).toContain('My Mac için dosya.dev hesabınıza galeri yayımlama izni verin (eklenti sürümü: 1.2.3).');
    expect(document.querySelector('[data-testid="lr-scope"]')?.textContent).toContain('Çalışma alanı: Acme.');
    expect(text()).toContain(tr['connect-lightroom.label.publishGalleriesToWorkspace']);
    expect(text()).toContain(tr['connect-lightroom.description.youNeedPermissionToUploadAndShareInTheWorkspaceYou']);
    expect(document.querySelector('[data-testid="lr-code"]')?.textContent).toBe('ABCD-1234');
    expect(text()).not.toMatch(/ {2}/);
  });
  it('without a plug-in version the sentence has no gap or parentheses', async () => {
    lrApi({ plugin_version: null });
    await show(<ConnectLightroomPage />, '/connect/lightroom?code=abcd');
    expect(text()).toContain('My Mac için dosya.dev hesabınıza galeri yayımlama izni verin.');
    expect(text()).not.toContain('()');
  });
  it('a workspace-less account, an expired request, denial and success', async () => {
    lrApi({}, []);
    let r = await show(<ConnectLightroomPage />, '/connect/lightroom?code=abcd');
    expect(text()).toContain(tr['connect-lightroom.description.youHaveNoWorkspaceToPublishToLink1First'].split('{link1}')[1]);
    expect(document.querySelector('[role="alert"] a')?.textContent).toBe(tr['common.action.createOneInDosya']);
    expect(r.leftover()).toEqual([]);
    r.unmount();
    lrApi({ status: 'expired' });
    r = await show(<ConnectLightroomPage />, '/connect/lightroom?code=abcd');
    expect(text()).toContain(tr['connect-lightroom.description.thisRequestHasExpired']);
    expect(text()).toContain(tr['connect-lightroom.description.chooseConnectAgainInTheDosyaPlugInInLightroomClassicTo']);
    r.unmount();
    lrApi({ status: 'denied' });
    r = await show(<ConnectLightroomPage />, '/connect/lightroom?code=abcd');
    expect(text()).toContain(tr['connect-lightroom.description.thisRequestWasAlreadyDenied']);
    r.unmount();
    lrApi({ status: 'used' });
    r = await show(<ConnectLightroomPage />, '/connect/lightroom?code=abcd');
    expect(text()).toContain(tr['connect-lightroom.description.thisRequestWasAlreadyUsed']);
    r.unmount();
    r = await show(<ConnectLightroomPage />, '/connect/lightroom');
    expect(text()).toContain(tr['common.heading.thisConnectRequestIsIncomplete']);
    expect(text()).toContain(tr['connect-lightroom.description.startTheConnectionFromTheDosyaPlugInInLightroomClassicNot']);
    expect(r.leftover()).toEqual([]);
  });
  it('allow and deny outcomes', async () => {
    lrApi();
    useWorkspace.setState({ activeId: 'ws1' });
    let r = await show(<ConnectLightroomPage />, '/connect/lightroom?code=abcd');
    await clickText(tr['common.action.allow']);
    await flush();
    expect(text()).toContain(tr['connect-lightroom.heading.returnToLightroomClassic']);
    expect(text()).toContain('My Mac bağlandı. Çalışma alanı: Acme. Eklenti bağlantıyı otomatik algılar. Bu sekmeyi kapatabilirsiniz.');
    expect(r.leftover()).toEqual([]);
    r.unmount();
    r = await show(<ConnectLightroomPage />, '/connect/lightroom?code=abcd');
    await clickText(tr['common.action.deny']);
    await flush();
    expect(text()).toContain(tr['connect-lightroom.heading.connectionDenied']);
    expect(text()).toContain(tr['connect-lightroom.description.nothingWasConnectedYouCanCloseThisTab']);
  });
});

describe('connect/wordpress in Turkish', () => {
  const q = '?site_url=https%3A%2F%2Fshop.example&home_url=https%3A%2F%2Fshop.example&name=Shop&fingerprint=f&code_challenge=c&state=s&return=https%3A%2F%2Fshop.example%2Fwp-admin%2Fadmin.php';
  function wpApi(caps: Record<string, unknown>, sites: unknown[] = [], workspaces = [{ id: 'ws1', name: 'Acme' }]) {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/workspaces') return { ok: true, workspaces };
      if (path === '/api/me') return { ok: true, user: { plan: { name: 'Pro' } } };
      if (path === '/api/wp/sites') return { sites, caps };
      return { ok: true };
    });
  }
  it('the consent page with a plan line, a count and the folder name kept together', async () => {
    wpApi({ sites_max: 3, retention_days_max: 30, immutability_hours_max: 24 }, [{ id: 'a' }]);
    const r = await show(<ConnectWordPressPage />, `/connect/wordpress${q}`);
    expect(r.leftover()).toEqual([]);
    expect(text()).toContain('Shop (shop.example) sitesinin yedeklerini');
    expect(text()).toContain('Pro planı: 3 site, 30\u00a0gün saklama, 24\u00a0saat değişiklik koruması');
    expect(text()).toContain('3 siteden 1 tanesi bağlı');
    expect(text()).toContain(tr['connect-wordpress.label.saveBackupsInWorkspace']);
    expect(document.querySelector('.whitespace-nowrap')?.textContent).toBe('WordPress Backups');
    expect(document.querySelector('h1')?.textContent).toBe("Siteyi dosya.dev'e bağla: shop.example");
  });
  it('unlimited sites, the limit message and the incomplete and refused pages', async () => {
    wpApi({ sites_max: null, retention_days_max: 30, immutability_hours_max: 24 });
    let r = await show(<ConnectWordPressPage />, `/connect/wordpress${q}`);
    expect(text()).toContain(tr['connect-wordpress.label.unlimitedSites']);
    r.unmount();
    wpApi({ sites_max: 1, retention_days_max: 30, immutability_hours_max: 24 }, [{ id: 'a' }]);
    r = await show(<ConnectWordPressPage />, `/connect/wordpress${q}`);
    expect(document.querySelector('[role="alert"] a')?.textContent).toBe(tr['common.action.seePlans']);
    expect(r.leftover()).toEqual([]);
    r.unmount();
    r = await show(<ConnectWordPressPage />, '/connect/wordpress');
    expect(text()).toContain(tr['common.heading.thisConnectRequestIsIncomplete']);
    expect(text()).toContain(tr['connect-wordpress.description.startTheConnectionFromTheDosyaBackupPageInYourWordpress']);
    r.unmount();
    r = await show(<ConnectWordPressPage />, `/connect/wordpress${q.replace('shop.example%2Fwp-admin', 'evil.example%2Fwp-admin')}`);
    expect(text()).toContain(tr['connect-wordpress.heading.thisConnectRequestWasRefused']);
    expect(r.leftover()).toEqual([]);
  });
  it('a mismatching response', async () => {
    wpApi({ sites_max: 5, retention_days_max: 30, immutability_hours_max: 24 });
    const orig = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path: string, ...rest: unknown[]) => {
      if (path === '/api/wp/connect/authorize') return { ok: true, code: 'x', state: 'other' };
      return orig(path, ...rest);
    });
    const r = await show(<ConnectWordPressPage />, `/connect/wordpress${q}`);
    await clickText(tr['common.action.allow']);
    await flush();
    expect(text()).toContain(tr['connect-wordpress.error.theConnectionResponseDidNotMatchThisRequestNothingWasConnected']);
    expect(r.leftover()).toEqual([]);
  });
});

// ── Selects that carry their value, in every language ───────────────

describe('messages whose select must carry its value, in every language', () => {
  it('the substituted value appears exactly once per placeholder and the text has no stray "true"', async () => {
    const { carriedMessage } = await import('@/pages/connect/carried-message');
    const { makeT } = await import('@/i18n/translator');
    const cases: [import('@/i18n/keys').MessageKey, string][] = [
      ['connect-ai.description.verifiedCredirecthostCbySelectTrueByCbyOther', 'cBy'],
      ['connect-lightroom.description.allowRequestdeviceNameRequestpluginVersionSelectTruePlugInRequestpluginVersionOtherTo', 'requestPlugin_version'],
      ['connect-lightroom.description.requestdeviceNamelightroomIsConnectedWorkspacenameSelectTrueToWorkspacenameOtherThe', 'workspaceName'],
    ];
    for (const locale of LOCALES) {
      const messages = await loadMessages(locale);
      const tt = makeT(locale, messages, en);
      for (const [key, carrier] of cases) {
        const withValue = carriedMessage(tt, key, carrier, true);
        expect(withValue, `${locale} ${key}`).toContain(`{${carrier}}`);
        expect(withValue, `${locale} ${key}`).not.toMatch(/\btrue\b/);
        const without = carriedMessage(tt, key, carrier, false);
        expect(without, `${locale} ${key}`).not.toContain(`{${carrier}}`);
      }
    }
  });

  it('the footer message lists the host first in every language', async () => {
    const { makeT } = await import('@/i18n/translator');
    const key = 'connect-ai.description.accessGoesToEmphasis1AccountemailSelectTrueSignedInAsEmphasis1' as const;
    for (const locale of LOCALES) {
      const tt = makeT(locale, await loadMessages(locale), en);
      const parts = tt(key, { accountEmail: 'true' }).split('{emphasis1}');
      expect(parts, locale).toHaveLength(3);
      // The part between the two slots is the signed-in label; the one before the first names the destination.
      const noEmail = tt(key, { accountEmail: '' }).split('{emphasis1}');
      expect(noEmail, locale).toHaveLength(2);
      expect(parts[0].replace(/\s+$/, ''), locale).toBe(noEmail[0].replace(/\s+$/, ''));
    }
  });
});
