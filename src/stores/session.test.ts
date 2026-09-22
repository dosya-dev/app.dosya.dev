import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { useSession } = await import('./session');

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const user = { id: 'u1', name: 'Ada', email: 'ada@example.test', avatar_url: null, deletion_scheduled_for: null };

describe('session store', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useSession.setState({ user: null, workspaces: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    apiMock.mockReset();
  });

  it('fetchMe stores the user and hands the boot gate the parsed body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, user }));
    const res = await useSession.getState().fetchMe();
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true, user });
    expect(useSession.getState().user).toEqual(user);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetchMe clears the user on a 401 and reports ok:false', async () => {
    useSession.setState({ user });
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Not authenticated' }));
    const res = await useSession.getState().fetchMe();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(useSession.getState().user).toBeNull();
  });

  it('fetchMe survives a non-JSON body without touching the stored user', async () => {
    useSession.setState({ user });
    fetchMock.mockResolvedValue(new Response('<html>gateway</html>', { status: 502 }));
    const res = await useSession.getState().fetchMe();
    expect(res.ok).toBe(false);
    expect(await res.json()).toBeNull();
    expect(useSession.getState().user).toEqual(user);
  });

  it('fetchWorkspaces stores the list and shares one request between concurrent callers', async () => {
    let resolve!: (v: unknown) => void;
    apiMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const a = useSession.getState().fetchWorkspaces();
    const b = useSession.getState().fetchWorkspaces();
    resolve({ ok: true, workspaces: [{ id: 'ws1' }, { id: 'ws2' }] });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(useSession.getState().workspaces?.map((w) => w.id)).toEqual(['ws1', 'ws2']);

    // The next call after settlement is a fresh request, not the stale promise.
    apiMock.mockResolvedValue({ ok: true, workspaces: [{ id: 'ws3' }] });
    await useSession.getState().fetchWorkspaces();
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(useSession.getState().workspaces?.map((w) => w.id)).toEqual(['ws3']);
  });

  it('fetchWorkspaces leaves the stored list alone when the API says ok:false or throws', async () => {
    useSession.setState({ workspaces: [{ id: 'kept' } as never] });
    apiMock.mockResolvedValue({ ok: false, workspaces: [] });
    await useSession.getState().fetchWorkspaces();
    expect(useSession.getState().workspaces?.map((w) => w.id)).toEqual(['kept']);

    apiMock.mockRejectedValue(new Error('network'));
    await expect(useSession.getState().fetchWorkspaces()).rejects.toThrow('network');
    expect(useSession.getState().workspaces?.map((w) => w.id)).toEqual(['kept']);
  });
});
