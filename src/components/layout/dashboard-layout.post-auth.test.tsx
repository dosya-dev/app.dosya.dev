import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom';

/**
 * The boot gate's post-auth handoff. A signed-out visitor to a dashboard
 * page (/save/:token, a /files deep link) is remembered and sent to /login;
 * login, verify and the tour all end on /, and the boot there sends them on.
 * The remembered page is a child of THIS layout, so the layout stays mounted
 * across that navigation and must open its gate afterwards, and a tour or a
 * first workspace that has to come first must not lose the path.
 */
const boot = vi.fn();
vi.mock('@/lib/boot', () => ({ bootDashboard: (...a: unknown[]) => boot(...a) }));
vi.mock('@/lib/dashboard-query', () => ({ prefetchDashboard: vi.fn() }));
vi.mock('@/lib/session-expiry', () => ({ watchSessionExpiry: () => () => {}, notifyUnauthorized: vi.fn() }));
vi.mock('./dashboard-sidebar', () => ({ DashboardSidebar: () => null }));
vi.mock('./dashboard-topbar', () => ({ DashboardTopbar: () => null }));
vi.mock('@/components/deletion-banner', () => ({ DeletionBanner: () => null }));
vi.mock('@/components/uploads/upload-dock', () => ({ default: () => null }));
vi.mock('../notifications/notification-poller', () => ({ NotificationPoller: () => null }));
vi.mock('@/components/support/report-problem-dialog', () => ({ ReportProblemDialog: () => null }));
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { DashboardLayout } from './dashboard-layout';
import { rememberPostAuthPath, consumePostAuthPath } from '@/lib/post-auth-path';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}{l.search}</span>;
}

const authed = (redirect: string | null = null) => ({ authed: true, redirect, themePref: null, activeWorkspaceId: null, maintenance: null });

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
beforeEach(() => { sessionStorage.clear(); boot.mockReset(); });
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; });

async function render(path: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // A data router, as in router.tsx: its navigate() is stable across
  // navigations, so the boot effect does NOT run again after the handoff. A
  // plain MemoryRouter re-runs it and hides a gate that never opens.
  const router = createMemoryRouter([{
    element: <><Outlet /><Where /></>,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { path: '/', element: <p>dashboard page</p> },
          { path: '/save/:token', element: <p>save page</p> },
        ],
      },
      { path: '/welcome', element: <p>tour</p> },
      { path: '/login', element: <p>login</p> },
    ],
  }], { initialEntries: [path] });
  await act(async () => { root!.render(<RouterProvider router={router} />); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  expect(boot).toHaveBeenCalledTimes(1);
  return container!;
}

describe('DashboardLayout post-auth handoff', () => {
  it('a remembered dashboard path opens with the gate open, not stuck on the loader', async () => {
    boot.mockResolvedValue(authed());
    rememberPostAuthPath('/save/tok');
    const c = await render('/');
    expect(c.querySelector('[data-testid="where"]')?.textContent).toBe('/save/tok');
    expect(c.textContent).toContain('save page');
    expect(c.textContent).not.toContain('dashboard page');
  });

  it('when the tour has to come first, the path survives it', async () => {
    boot.mockResolvedValue(authed('/welcome'));
    rememberPostAuthPath('/save/tok');
    const c = await render('/');
    expect(c.querySelector('[data-testid="where"]')?.textContent).toBe('/welcome');
    expect(consumePostAuthPath()).toBe('/save/tok');
  });

  it('a deep link the tour interrupts is remembered for after it', async () => {
    boot.mockResolvedValue(authed('/welcome'));
    await render('/save/tok?ids=a,b');
    expect(consumePostAuthPath()).toBe('/save/tok?ids=a,b');
  });

  it('a signed-out deep link is remembered for after login', async () => {
    boot.mockResolvedValue({ authed: false, redirect: '/login', themePref: null, activeWorkspaceId: null, maintenance: null });
    const c = await render('/save/tok');
    expect(c.querySelector('[data-testid="where"]')?.textContent).toBe('/login');
    expect(consumePostAuthPath()).toBe('/save/tok');
  });
});
