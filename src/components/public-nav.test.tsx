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
    expect(container!.textContent).not.toContain('Login');
  });

  it('keeps Login when the probe is rejected', async () => {
    api.mockRejectedValueOnce(new ApiError(401, '{"error":"Not authenticated"}'));
    await render();
    expect(container!.textContent).toContain('Login');
    expect(container!.textContent).not.toContain('Open dashboard');
  });

  it('keeps Sign Up for the signup variant when signed out', async () => {
    api.mockRejectedValueOnce(new Error('offline'));
    await render('signup');
    expect(container!.textContent).toContain('Sign Up');
  });

  it('reserves the slot while the probe is pending', async () => {
    api.mockReturnValueOnce(new Promise(() => {}));
    await render();
    expect(container!.textContent).not.toContain('Login');
    expect(container!.textContent).not.toContain('Open dashboard');
    expect(container!.querySelector('[data-session-probe="pending"]')).not.toBeNull();
  });
});
