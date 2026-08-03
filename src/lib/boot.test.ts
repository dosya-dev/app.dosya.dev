import { afterEach, describe, expect, test } from 'vitest';
import { bootDashboard, TOUR_DONE_KEY } from './boot';

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

describe('bootDashboard - welcome tour', () => {
  test('sends a user who has not seen the tour to /welcome', async () => {
    const boot = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: { tour_completed: false } }),
      fetchWorkspaces: workspaces(['ws1']),
      currentActiveId: 'ws1',
    });
    expect(boot.redirect).toBe('/welcome');
  });

  test('does not redirect a user who has finished the tour', async () => {
    const boot = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: { tour_completed: true } }),
      fetchWorkspaces: workspaces(['ws1']),
      currentActiveId: 'ws1',
    });
    expect(boot.redirect).toBeNull();
  });

  // apps/web and apps/api deploy separately and web often goes live first. If
  // a missing flag meant "not seen", every user would be redirected to a tour
  // the API cannot yet mark finished - an infinite loop. Absent means done.
  test('treats a missing tour_completed as already completed', async () => {
    const boot = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: {} }),
      fetchWorkspaces: workspaces(['ws1']),
      currentActiveId: 'ws1',
    });
    expect(boot.redirect).toBeNull();
  });

  // A user with no workspace has a problem to fix before a tour.
  test('prefers the create-workspace redirect over the tour', async () => {
    const boot = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: { tour_completed: false } }),
      fetchWorkspaces: workspaces([]),
      currentActiveId: '',
    });
    expect(boot.redirect).toBe('/create-workspace');
  });

  // Healing a stale selection and showing the tour are independent. Taking the
  // tour branch must not drop the healed id, or the user comes back to a
  // selection that still points at a workspace they cannot see.
  test('still heals a stale workspace selection while redirecting to the tour', async () => {
    const boot = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: { tour_completed: false } }),
      fetchWorkspaces: workspaces(['ws9']),
      currentActiveId: 'ws_gone',
    });
    expect(boot.redirect).toBe('/welcome');
    expect(boot.activeWorkspaceId).toBe('ws9');
  });

  test('still shows the tour when the workspaces request failed', async () => {
    const boot = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: { tour_completed: false } }),
      fetchWorkspaces: () => Promise.reject(new Error('offline')),
      currentActiveId: 'ws1',
    });
    expect(boot.redirect).toBe('/welcome');
  });
});

describe('bootDashboard - local tour-done escape hatch', () => {
  afterEach(() => {
    sessionStorage.removeItem(TOUR_DONE_KEY);
  });

  // A persistently failing PATCH would otherwise mean /api/me keeps saying
  // tour_completed:false forever, ping-ponging the user between / and
  // /welcome with no way into the app. welcome.tsx's finish() sets this flag
  // before navigating regardless of PATCH outcome; boot.ts must honor it.
  test('does not redirect to /welcome when the local flag is set, even though the API says incomplete', async () => {
    sessionStorage.setItem(TOUR_DONE_KEY, '1');
    const boot = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: { tour_completed: false } }),
      fetchWorkspaces: workspaces(['ws1']),
      currentActiveId: 'ws1',
    });
    expect(boot.redirect).toBeNull();
  });

  test('still redirects to /welcome when the local flag is absent', async () => {
    const boot = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: { tour_completed: false } }),
      fetchWorkspaces: workspaces(['ws1']),
      currentActiveId: 'ws1',
    });
    expect(boot.redirect).toBe('/welcome');
  });

  test('the local flag does not override create-workspace', async () => {
    sessionStorage.setItem(TOUR_DONE_KEY, '1');
    const boot = await bootDashboard({
      fetchMe: async () => okRes({ ok: true, user: { tour_completed: false } }),
      fetchWorkspaces: workspaces([]),
      currentActiveId: '',
    });
    expect(boot.redirect).toBe('/create-workspace');
  });
});
