import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const api = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => api(...args) };
});
vi.mock('@/lib/theme', () => ({ withThemeSweep: (fn: () => void) => fn() }));

import { ApiError } from '@/api/client';
import { PublicNav } from './public-nav';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  api.mockReset();
});

async function render(cta: 'login' | 'signup' = 'login') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<PublicNav cta={cta} />); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('PublicNav session probe', () => {
  it('shows Open dashboard linking to the app root when a session exists', async () => {
    api.mockResolvedValueOnce({ ok: true, user: { id: 'usr_1' } });
    await render();
    expect(api).toHaveBeenCalledWith('/api/me');
    const link = [...container!.querySelectorAll('a')].find((a) => a.textContent?.includes('Open dashboard'))!;
    expect(link.getAttribute('href')).toBe('/');
    expect(container!.textContent).not.toContain('Sign in');
  });

  it('keeps Sign in when the probe is rejected', async () => {
    api.mockRejectedValueOnce(new ApiError(401, '{"error":"Not authenticated"}'));
    await render();
    expect(container!.textContent).toContain('Sign in');
    expect(container!.textContent).not.toContain('Open dashboard');
  });

  it('keeps Sign up for the signup variant when signed out', async () => {
    api.mockRejectedValueOnce(new Error('offline'));
    await render('signup');
    expect(container!.textContent).toContain('Sign up');
  });

  it('trusts the account the page already probed instead of fetching again', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<PublicNav cta="signup" account={{ status: 'in', user: null }} />);
      await Promise.resolve();
    });
    expect(api).not.toHaveBeenCalled();
    expect(container!.textContent).toContain('Open dashboard');
  });

  it('reserves the slot while the probe is pending', async () => {
    api.mockReturnValueOnce(new Promise(() => {}));
    await render();
    expect(container!.textContent).not.toContain('Sign in');
    expect(container!.textContent).not.toContain('Open dashboard');
    expect(container!.querySelector('[data-session-probe="pending"]')).not.toBeNull();
  });
});

describe('PublicNav language picker', () => {
  it('shows the language menu next to the theme toggle', async () => {
    api.mockRejectedValueOnce(new ApiError(401, '{"error":"Not authenticated"}'));
    await render();
    expect(container!.querySelector('[data-testid=language-menu-button]')).not.toBeNull();
  });

  it('keeps the actions on screen at 360 px: tight gaps, non-shrinking group, icon-only Open dashboard with a name', async () => {
    api.mockResolvedValueOnce({ ok: true, user: { id: 'usr_1' } });
    await render();
    const nav = container!.querySelector('nav')!;
    expect(nav.querySelector('a[aria-label="dosya.dev"] span')!.className).toContain('hidden');
    expect(nav.className).toContain('px-3');
    expect(nav.className).toContain('sm:px-6');
    const group = container!.querySelector('[data-testid=language-menu-button]')!.parentElement!.parentElement!;
    expect(group.className).toContain('shrink-0');
    expect(group.className).toContain('sm:gap-6');
    const link = container!.querySelector('a[aria-label="Open dashboard"]')!;
    expect(link.querySelector('span')!.className).toContain('hidden sm:inline');
    expect(container!.querySelector('button[aria-label]:not([data-testid])')).not.toBeNull();
  });
});
