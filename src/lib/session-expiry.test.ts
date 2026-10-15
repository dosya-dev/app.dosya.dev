import { describe, it, expect, vi, afterEach } from 'vitest';
import { notifyUnauthorized, broadcastLogout, watchSessionExpiry } from './session-expiry';

const flush = () => new Promise((r) => setTimeout(r, 0));

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

function watch(status: number | (() => Promise<number>)) {
  const verify = vi.fn(typeof status === 'number' ? async () => status : status);
  const onExpired = vi.fn();
  stop = watchSessionExpiry({ verify, onExpired });
  return { verify, onExpired };
}

describe('session expiry', () => {
  it('redirects when a 401 is confirmed by /api/me', async () => {
    const { verify, onExpired } = watch(401);
    notifyUnauthorized('/api/files?workspace_id=ws_1');
    await flush();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  // The API answers 401 for a wrong share code or password too; the session
  // is still alive, so the page keeps its own error handling.
  it('stays put when /api/me says the session is alive', async () => {
    const { onExpired } = watch(200);
    notifyUnauthorized('/api/share/abc/verify');
    await flush();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('ignores 401s from the sign-in endpoints without asking', async () => {
    const { verify } = watch(401);
    notifyUnauthorized('/api/auth/login');
    await flush();
    expect(verify).not.toHaveBeenCalled();
  });

  it('shares one check across a burst of 401s and expires once', async () => {
    let resolve!: (s: number) => void;
    const { verify, onExpired } = watch(() => new Promise<number>((r) => { resolve = r; }));
    notifyUnauthorized('/api/files');
    notifyUnauthorized('/api/workspaces');
    notifyUnauthorized('/api/notifications');
    resolve(401);
    await flush();
    notifyUnauthorized('/api/files');
    await flush();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('asks again after a network failure', async () => {
    const verify = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(401);
    const onExpired = vi.fn();
    stop = watchSessionExpiry({ verify, onExpired });
    notifyUnauthorized('/api/files');
    await flush();
    expect(onExpired).not.toHaveBeenCalled();
    notifyUnauthorized('/api/files');
    await flush();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('does nothing once the watch is stopped', async () => {
    const { verify } = watch(401);
    stop!();
    stop = null;
    notifyUnauthorized('/api/files');
    await flush();
    expect(verify).not.toHaveBeenCalled();
  });

  it('checks when another tab broadcasts a logout', async () => {
    const { onExpired } = watch(401);
    broadcastLogout();
    await vi.waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1));
  });
});
