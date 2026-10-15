// apps/web/src/pages/connect/extension.test.tsx
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * /connect/extension: the Allow page the browser extension opens. One button
 * posts the PKCE fields to the authorize route and navigates to the exact
 * callback the API returns; a signed-out visitor is sent through login and
 * comes back here (lib/post-auth-path.ts).
 */
const apiMock = vi.fn();
const navigate = vi.fn();
const assign = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/api/client', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  API_BASE: '',
  api: (...args: unknown[]) => apiMock(...args),
}));
vi.mock('@/components/public-nav', () => ({ PublicNav: () => <nav /> }));

import { ApiError } from '@/api/client';
import ConnectExtensionPage from './extension';

const QUERY = '?client=chrome&code_challenge=' + 'C'.repeat(43) + '&state=' + 's'.repeat(32) + '&redirect_uri=' + encodeURIComponent('https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/callback');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
});

describe('connect/extension page', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    apiMock.mockReset(); navigate.mockReset(); assign.mockReset(); sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  const mount = async (query = QUERY) => {
    root = createRoot(container!);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[`/connect/extension${query}`]}>
          <ConnectExtensionPage />
        </MemoryRouter>,
      );
    });
  };
  const click = async (label: string) => {
    const button = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
    expect(button, label).toBeTruthy();
    await act(async () => { button!.click(); });
  };

  it('names the browser and what the extension may do', async () => {
    await mount();
    expect(container!.textContent).toContain('Chrome');
    expect(container!.textContent).toContain('Save files');
    expect(container!.textContent).toContain('cannot delete');
  });

  it('names Safari when the Safari build asks, not Chrome', async () => {
    // Safari runs the Chromium build, so it identified itself as chrome until
    // 2026-10-08 and this page greeted a Safari user with the word Chrome.
    await mount(QUERY.replace('client=chrome', 'client=safari'));
    expect(container!.textContent).toContain('Safari');
    expect(container!.textContent).not.toContain('for Chrome');
  });

  it('Allow posts the four fields and navigates to the callback the API returns', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, redirect: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/callback?code=dmoc_1&state=' + 's'.repeat(32) });
    await mount();
    await click('Allow');
    expect(apiMock).toHaveBeenCalledWith('/api/auth/extension/authorize', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((apiMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({
      client: 'chrome',
      code_challenge: 'C'.repeat(43),
      state: 's'.repeat(32),
      redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/callback',
    });
    expect(assign).toHaveBeenCalledWith('https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/callback?code=dmoc_1&state=' + 's'.repeat(32));
  });

  it('does not follow a callback that is not the redirect_uri it asked for', async () => {
    // The API derives the callback from the redirect_uri this page sent and
    // refuses any uri not listed exactly, so a redirect pointing somewhere else
    // cannot have come from this request - following it would turn the consent
    // page into an open redirector carrying a live one-time code.
    apiMock.mockResolvedValueOnce({ ok: true, redirect: 'https://evil.example/callback?code=dmoc_1&state=' + 's'.repeat(32) });
    await mount();
    await click('Allow');
    expect(assign).not.toHaveBeenCalled();
    expect(container!.textContent).toContain('The server returned an unexpected callback');
  });

  it('a signed-out visitor is remembered and sent to login', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(401, 'Sign in required'));
    await mount();
    await click('Allow');
    expect(sessionStorage.getItem('dosya.postAuthPath')).toBe(`/connect/extension${QUERY}`);
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('shows the API refusal inline', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(400, 'redirect_uri is not an allowed callback'));
    await mount();
    await click('Allow');
    expect(container!.textContent).toContain('redirect_uri is not an allowed callback');
    expect(assign).not.toHaveBeenCalled();
  });

  it('refuses to render Allow when a field is missing', async () => {
    await mount('?client=chrome');
    expect(container!.textContent).toContain('This link is incomplete');
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent?.includes('Allow'))).toBe(false);
  });
});
