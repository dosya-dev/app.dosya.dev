import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
const logoutMock = vi.fn();
vi.mock('@/lib/logout', () => ({ logoutAndRedirect: () => logoutMock() }));
const openReportMock = vi.fn();
vi.mock('@/stores/report-problem', () => ({ openReport: (...args: unknown[]) => openReportMock(...args) }));

const { ProfileMenu } = await import('./profile-menu');
const { useSession } = await import('@/stores/session');
const { useWorkspace } = await import('@/stores/workspace');
type SessionWorkspace = import('@/stores/session').SessionWorkspace;

const GB = 1024 ** 3;

const USER = {
  id: 'u1', name: 'Firat Kaya', email: 'firat@dosya.dev', avatar_url: null,
  deletion_scheduled_for: null, plan: { id: 'pro', name: 'Pro' },
};
const WS: SessionWorkspace = {
  id: 'ws_1', name: 'dosya', slug: 'dosya', icon_initials: 'D', icon_color: '#000', icon_image_url: null,
  owner_id: 'u1', role_id: 'owner',
  storage: { used: 10 * GB, total: 50 * GB, account_used_bytes: 38 * GB, account_limit_bytes: 100 * GB },
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  } as unknown as MediaQueryList));
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
  logoutMock.mockReset();
  openReportMock.mockReset();
  document.documentElement.classList.remove('dark');
  localStorage.clear();
});

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function mount(opts: { user?: typeof USER | null; workspaces?: SessionWorkspace[] | null } = {}) {
  useSession.setState({ user: opts.user === undefined ? USER : opts.user, workspaces: opts.workspaces === undefined ? [WS] : opts.workspaces });
  useWorkspace.setState({ activeId: 'ws_1' });
  apiMock.mockResolvedValue({ ok: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(MemoryRouter, null, createElement(ProfileMenu)));
    await flush();
  });
}

async function click(el: HTMLElement | null) {
  expect(el, 'expected element to click').toBeTruthy();
  await act(async () => { el!.click(); await flush(); });
}

async function open() {
  await click(container!.querySelector<HTMLElement>('[aria-label="Account menu"]'));
}

const menu = () => document.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
const item = (text: string) => items().find((el) => el.textContent?.trim().startsWith(text)) ?? null;

describe('ProfileMenu', () => {
  it('shows who you are, your plan and your account storage in the header card', async () => {
    await mount();
    await open();
    const m = menu();
    expect(m).toBeTruthy();
    expect(m!.textContent).toContain('Firat Kaya');
    expect(m!.textContent).toContain('firat@dosya.dev');
    expect(m!.querySelector('[data-slot="plan-chip"]')?.textContent).toBe('Pro');
    // Account-wide figures, not the active workspace's own slice.
    expect(m!.textContent).toContain('38 GB of 100 GB used');
    const manage = m!.querySelector<HTMLAnchorElement>('a[href="/billing"]');
    expect(manage?.textContent).toContain('Manage');
  });

  it('lists Profile, Billing, Appearance, Refer friends, Get help, Report a bug and Log out, and nothing workspace-level', async () => {
    await mount();
    await open();
    const labels = items().map((el) => el.textContent?.trim().split('\n')[0] ?? '');
    expect(labels.some((l) => l.startsWith('Profile'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Appearance'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Refer friends'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Get help'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Report a bug'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Log out'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Settings'))).toBe(false);
    expect(labels.some((l) => l.startsWith('Billing'))).toBe(true);
  });

  it('renders the navigation rows as real links, so cmd-click and middle-click work', async () => {
    await mount();
    await open();
    expect(item('Profile')?.tagName).toBe('A');
    expect(item('Profile')?.getAttribute('href')).toBe('/profile');
    expect(item('Billing')?.getAttribute('href')).toBe('/billing');
    expect(item('Appearance')?.getAttribute('href')).toBe('/profile/appearance');
    expect(item('Refer friends')?.getAttribute('href')).toBe('/referrals');
    expect(item('Get help')?.getAttribute('href')).toBe('/support');
  });

  it('flips light and dark from the Appearance row, saves it, and keeps the menu open', async () => {
    await mount();
    await open();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    await click(document.querySelector<HTMLElement>('[aria-label="Dark mode"]'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(apiMock).toHaveBeenCalledWith('/api/me/appearance', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"mode":"dark"') }));
    expect(menu(), 'menu should stay open after toggling the mode').toBeTruthy();
    await click(document.querySelector<HTMLElement>('[aria-label="Light mode"]'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('Report a bug opens the report dialog and Log out tears the session down', async () => {
    await mount();
    await open();
    await click(item('Report a bug'));
    expect(openReportMock).toHaveBeenCalledTimes(1);
    await open();
    await click(item('Log out'));
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('leaves the plan chip and storage line out when the session has neither yet', async () => {
    await mount({ user: { ...USER, plan: undefined as never }, workspaces: null });
    await open();
    const m = menu();
    expect(m!.textContent).toContain('Firat Kaya');
    expect(m!.querySelector('[data-slot="plan-chip"]')).toBeNull();
    expect(m!.textContent).not.toContain('used');
    // The storage card's Manage shortcut is gone, but the Billing row below
    // the divider is always there.
    expect(m!.textContent).not.toContain('Manage');
    expect(m!.querySelector('a[href="/billing"]')?.textContent).toContain('Billing');
  });

  it('falls back to the workspace slice when the account figures are missing', async () => {
    await mount({ workspaces: [{ ...WS, storage: { used: 10 * GB, total: 50 * GB } }] });
    await open();
    expect(menu()!.textContent).toContain('10 GB of 50 GB used');
  });
});
