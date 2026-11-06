import { describe, it, expect, vi } from 'vitest';

vi.mock('./upload-runner', () => ({ cancelAll: () => {} }));
vi.mock('./personas-device/teardown', () => ({ teardownPersonas: () => {} }));
const wipe = vi.fn(async (_u: string | null) => {});
vi.mock('./personas-device/wipe', () => ({ wipePersonasDevice: (u: string | null) => wipe(u) }));

describe('clearClientSession user fallback', () => {
  it('still wipes a user who was signed in before logout.ts loaded, after a 401 cleared the session', async () => {
    const { useSession } = await import('@/stores/session');
    useSession.setState({ user: { id: 'u_early' } as never });
    const { clearClientSession } = await import('./logout');
    useSession.setState({ user: null });
    await clearClientSession();
    expect(wipe).toHaveBeenCalledWith('u_early');
  });
});
