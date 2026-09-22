import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

// The web builds against the VENDORED e2ee bundle, which does not export
// `unlockWithRecoveryKey` until Group C's package is re-vendored. Mocking the
// module lets the engine's own handling (normalisation, session lifetime) be
// tested against Contract 6 now rather than after that lands.
const recoveryUnlock = vi.fn();
const passphraseUnlock = vi.fn();
const createWorkspace = vi.fn();
vi.mock('@dosya-dev/e2ee-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    unlock: (...a: unknown[]) => passphraseUnlock(...a),
    createWorkspace: (...a: unknown[]) => createWorkspace(...a),
    unlockWithRecoveryKey: (...a: unknown[]) => recoveryUnlock(...a),
  };
});

const { defaultEngine } = await import('./e2ee');

const SESSION = { kek: new Uint8Array(1), identity: {} } as never;

beforeEach(() => {
  apiMock.mockReset();
  recoveryUnlock.mockReset();
  passphraseUnlock.mockReset();
  createWorkspace.mockReset();
  recoveryUnlock.mockResolvedValue(SESSION);
  passphraseUnlock.mockResolvedValue(SESSION);
  createWorkspace.mockResolvedValue({} as never);
});

// Contract 6: the key is displayed as one hex string, but people paste it back
// with whatever spacing or dashes their password manager put in.
describe('defaultEngine.unlockWithRecoveryKey', () => {
  it('strips whitespace and dashes before handing the key to the library', async () => {
    await defaultEngine().unlockWithRecoveryKey('  ab12-cd34 ef56\n');
    expect(recoveryUnlock).toHaveBeenCalledTimes(1);
    expect(recoveryUnlock.mock.calls[0][1]).toBe('ab12cd34ef56');
  });
});

// F8 (field report, Contract 6): the real engine's destroy path is a plain
// authenticated DELETE with the password (and code) in the body.
describe('defaultEngine.destroyIdentity', () => {
  it('DELETEs /api/e2ee/user-keys with password and totp_code', async () => {
    apiMock.mockResolvedValue(undefined);
    await defaultEngine().destroyIdentity('hunter22', '123456');
    expect(apiMock).toHaveBeenCalledTimes(1);
    const [path, init] = apiMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/e2ee/user-keys');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ password: 'hunter22', totp_code: '123456' });
  });

  it('omits totp_code when none was given', async () => {
    apiMock.mockResolvedValue(undefined);
    await defaultEngine().destroyIdentity('hunter22');
    const [, init] = apiMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ password: 'hunter22' });
  });
});

// Fix round 1, MINOR (d): the in-memory session was dropped BEFORE the DELETE
// resolved, so a refused destroy (wrong password, missing 2FA code) locked the
// user out of a Vault that still exists and forced a re-unlock.
describe('defaultEngine.destroyIdentity failure', () => {
  it('keeps the unlocked session when the server refuses', async () => {
    const engine = defaultEngine();
    await engine.unlock('passphrase');
    apiMock.mockRejectedValueOnce(new Error('Incorrect password'));

    await expect(engine.destroyIdentity('wrong')).rejects.toThrow('Incorrect password');

    // Still unlocked: an operation that asserts a session must not complain.
    await expect(engine.createWorkspace('ws_1')).resolves.toBeUndefined();
  });

  it('drops the session once the destroy succeeds', async () => {
    const engine = defaultEngine();
    await engine.unlock('passphrase');
    apiMock.mockResolvedValueOnce(undefined);

    await engine.destroyIdentity('hunter22');

    await expect(engine.createWorkspace('ws_1')).rejects.toThrow(/locked/);
  });
});
