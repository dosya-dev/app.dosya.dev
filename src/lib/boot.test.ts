import { describe, expect, test } from 'vitest';
import { bootDashboard } from './boot';

type MeBody = Record<string, unknown>;

const okRes = (body: MeBody) => ({ ok: true, json: async () => body });
const unauthorizedRes = () => ({ ok: false, json: async () => ({ error: 'Not authenticated' }) });
const nonJsonRes = () => ({ ok: true, json: async () => { throw new SyntaxError('not json'); } });

const workspaces = (ids: string[]) => async () => ({ ok: true, workspaces: ids.map((id) => ({ id })) });

describe('bootDashboard', () => {
  test('starts the workspaces request before /api/me resolves', async () => {
    let workspacesStarted = false;
    let resolveMe!: (v: ReturnType<typeof okRes>) => void;
    const me = new Promise<ReturnType<typeof okRes>>((r) => { resolveMe = r; });

    const result = bootDashboard({
      fetchMe: () => me,
      fetchWorkspaces: () => {
        workspacesStarted = true;
        return Promise.resolve({ ok: true, workspaces: [{ id: 'ws1' }] });
      },
      currentActiveId: 'ws1',
    });

    expect(workspacesStarted).toBe(true);

    resolveMe(okRes({ ok: true, user: null }));
    await expect(result).resolves.toMatchObject({ authed: true });
  });

  test('unauthenticated user is sent to /login even if the workspaces request fails', async () => {
    const result = await bootDashboard({
      fetchMe: async () => unauthorizedRes(),
      fetchWorkspaces: () => Promise.reject(new Error('401')),
      currentActiveId: '',
    });
    expect(result).toEqual({ authed: false, redirect: '/login', themePref: null, activeWorkspaceId: null });
  });

  test('network failure on /api/me is treated as logged out', async () => {
    const result = await bootDashboard({
      fetchMe: () => Promise.reject(new TypeError('fetch failed')),
      fetchWorkspaces: workspaces(['ws1']),
      currentActiveId: 'ws1',
    });
    expect(result.authed).toBe(false);
    expect(result.redirect).toBe('/login');
  });

  test('valid saved theme preference is returned', async () => {
    const result = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: { ui_theme: 'default', ui_mode: 'dark' } }),
      fetchWorkspaces: workspaces(['ws1']),
      currentActiveId: 'ws1',
    });
    expect(result.themePref).toEqual({ theme: 'default', mode: 'dark' });
  });

  test('unknown theme values fall back to defaults', async () => {
    const result = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: { ui_theme: 'neon-zebra', ui_mode: 'blink' } }),
      fetchWorkspaces: workspaces(['ws1']),
      currentActiveId: 'ws1',
    });
    expect(result.themePref).toEqual({ theme: 'default', mode: 'system' });
  });

  test('non-JSON /api/me body still authenticates, without a theme pref', async () => {
    const result = await bootDashboard({
      fetchMe: async () => nonJsonRes(),
      fetchWorkspaces: workspaces(['ws1']),
      currentActiveId: 'ws1',
    });
    expect(result.authed).toBe(true);
    expect(result.themePref).toBeNull();
    expect(result.redirect).toBeNull();
  });

  test('a user with zero workspaces is sent to /create-workspace', async () => {
    const result = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: null }),
      fetchWorkspaces: workspaces([]),
      currentActiveId: '',
    });
    expect(result.redirect).toBe('/create-workspace');
  });

  test('stale active workspace heals to the first workspace', async () => {
    const result = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: null }),
      fetchWorkspaces: workspaces(['ws1', 'ws2']),
      currentActiveId: 'gone',
    });
    expect(result.activeWorkspaceId).toBe('ws1');
  });

  test('valid active workspace is left untouched', async () => {
    const result = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: null }),
      fetchWorkspaces: workspaces(['ws1', 'ws2']),
      currentActiveId: 'ws2',
    });
    expect(result.activeWorkspaceId).toBeNull();
  });

  test('workspaces API failure does not lock an authed user out', async () => {
    const result = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: null }),
      fetchWorkspaces: () => Promise.reject(new Error('500')),
      currentActiveId: 'ws1',
    });
    expect(result.authed).toBe(true);
    expect(result.redirect).toBeNull();
    expect(result.activeWorkspaceId).toBeNull();
  });

  test('workspaces ok:false response proceeds without healing', async () => {
    const result = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: null }),
      fetchWorkspaces: async () => ({ ok: false, workspaces: [] }),
      currentActiveId: 'ws1',
    });
    expect(result.authed).toBe(true);
    expect(result.redirect).toBeNull();
    expect(result.activeWorkspaceId).toBeNull();
  });
});
