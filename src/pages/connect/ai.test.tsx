// apps/web/src/pages/connect/ai.test.tsx
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * /connect/ai: the consent page for connecting an AI app. It shows who is
 * asking and where access goes, posts the person's decision, and follows
 * only a redirect to the host it displayed.
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
  API_BASE: 'https://api.dosya.dev',
  api: (...args: unknown[]) => apiMock(...args),
}));
// The base-ui Select renders its list in a portal on demand; a native
// select stands in so the tests can pick a workspace directly.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, disabled, items }: { value: string | null; onValueChange: (v: string | null) => void; disabled?: boolean; items: { value: string; label: string }[] }) => (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onValueChange(e.target.value || null)}>
      <option value="">Choose a workspace</option>
      {items.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
    </select>
  ),
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: () => null, SelectItem: () => null,
}));

import { ApiError } from '@/api/client';
import ConnectAiPage from './ai';

/** Mirrors the page's ConsentView: domain is null for an unverified app. */
interface View {
  client: { name: string; domain: string | null; redirectHost: string; redirectIsLoopback: boolean; brand?: string | null; by?: string | null };
  scopes: { id: string; required: boolean }[];
  workspaces: { id: string; name: string }[];
}
const VIEW: View = {
  client: { name: 'Claude', domain: null, redirectHost: 'claude.ai', redirectIsLoopback: false, brand: 'claude', by: 'Anthropic' },
  scopes: [{ id: 'files.read', required: true }, { id: 'account.read', required: false }],
  workspaces: [{ id: 'ws_1', name: 'Acme' }, { id: 'ws_2', name: 'Side project' }],
};
const consentRes = (over: Partial<View> = {}) => ({ ok: true, consent: { ...VIEW, ...over }, account: { email: 'firat@example.com' } });

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
});

describe('connect/ai page', () => {
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

  const mount = async (query: string) => {
    root = createRoot(container!);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[`/connect/ai${query}`]}>
          <ConnectAiPage />
        </MemoryRouter>,
      );
    });
  };
  const button = (label: string) => Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;
  const click = async (label: string) => {
    const b = button(label);
    expect(b, label).toBeTruthy();
    await act(async () => { b!.click(); });
  };
  const choose = async (value: string) => {
    const select = container!.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const text = () => container!.textContent ?? '';

  it('shows a verified app by name and mark, its verified host and the signed-in account', async () => {
    apiMock.mockResolvedValueOnce(consentRes());
    await mount('?handle=h1');
    expect(apiMock).toHaveBeenCalledWith('/api/oauth/consent?handle=h1');
    expect(text()).toContain('Claude wants to read your dosya files');
    expect(text()).toContain('Verified: claude.ai');
    expect(text()).toContain('by Anthropic');
    expect(text()).toContain('Access goes to claude.ai');
    expect(text()).toContain('Signed in as firat@example.com');
    expect(text()).not.toContain('app on your computer');
    // The Claude mark comes from dosya's own bundle.
    expect(container!.querySelector('path[fill="#ffffff"]')).not.toBeNull();
  });

  it('quotes an unverified name, shows no brand mark, and warns about a local app', async () => {
    apiMock.mockResolvedValueOnce(consentRes({ client: { name: 'Local thing', domain: null, redirectHost: '127.0.0.1', redirectIsLoopback: true, brand: null, by: null } }));
    await mount('?handle=h1');
    expect(text()).toContain('\u201cLocal thing\u201d wants to read your dosya files');
    expect(text()).toContain('Not verified');
    expect(text()).toContain('This sends access to an app on your computer');
    expect(container!.querySelector('path[fill="#ffffff"]')).toBeNull();
  });

  // Dynamic registration lets anyone call themselves Claude. Only the
  // API's brand verdict (from the callback host) may put Claude's mark up.
  it('never shows a brand for an app that only calls itself Claude', async () => {
    apiMock.mockResolvedValueOnce(consentRes({ client: { name: 'Claude', domain: null, redirectHost: 'claude-files.example.net', redirectIsLoopback: false, brand: null, by: null } }));
    await mount('?handle=h1');
    expect(text()).toContain('\u201cClaude\u201d wants to read');
    expect(text()).toContain('Not verified');
    expect(text()).not.toContain('Verified:');
    expect(container!.querySelector('path[fill="#ffffff"]')).toBeNull();
  });

  it('ignores a brand value it does not know', async () => {
    apiMock.mockResolvedValueOnce(consentRes({ client: { ...VIEW.client, brand: 'evilcorp' } }));
    await mount('?handle=h1');
    expect(text()).not.toContain('Verified:');
  });

  it('never renders an image the app supplied', async () => {
    apiMock.mockResolvedValueOnce(consentRes());
    await mount('?handle=h1');
    expect(container!.querySelector('img')).toBeNull();
  });

  it('renders a hostile client name as text, never markup', async () => {
    apiMock.mockResolvedValueOnce(consentRes({ client: { ...VIEW.client, name: '<img src=x onerror=alert(1)>', brand: null, by: null } }));
    await mount('?handle=h1');
    expect(container!.querySelector('img')).toBeNull();
    expect(text()).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps Allow disabled until a workspace is chosen when there are several', async () => {
    apiMock.mockResolvedValueOnce(consentRes());
    await mount('?handle=h1');
    expect(button('Allow')!.disabled).toBe(true);
    await choose('ws_2');
    expect(button('Allow')!.disabled).toBe(false);
  });

  it('preselects the only workspace', async () => {
    apiMock.mockResolvedValueOnce(consentRes({ workspaces: [{ id: 'ws_1', name: 'Acme' }] }));
    await mount('?handle=h1');
    expect(button('Allow')!.disabled).toBe(false);
  });

  it('posts the chosen workspace and kept scopes, then follows the redirect', async () => {
    apiMock.mockResolvedValueOnce(consentRes());
    await mount('?handle=h1');
    await choose('ws_2');
    apiMock.mockResolvedValueOnce({ ok: true, redirect: 'https://claude.ai/api/mcp/auth_callback?code=c&state=s&iss=https%3A%2F%2Fapi.dosya.dev' });
    await click('Allow');
    expect(apiMock).toHaveBeenLastCalledWith('/api/oauth/consent', {
      method: 'POST',
      body: JSON.stringify({ handle: 'h1', decision: 'approve', workspace_id: 'ws_2', scopes: ['account.read'] }),
    });
    expect(assign).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=c&state=s&iss=https%3A%2F%2Fapi.dosya.dev');
  });

  it('drops an optional scope the person unticked', async () => {
    apiMock.mockResolvedValueOnce(consentRes({ workspaces: [{ id: 'ws_1', name: 'Acme' }] }));
    await mount('?handle=h1');
    const optionalBox = Array.from(container!.querySelectorAll('input[type=checkbox]')).find((i) => !(i as HTMLInputElement).disabled) as HTMLInputElement;
    await act(async () => { optionalBox.click(); });
    apiMock.mockResolvedValueOnce({ ok: true, redirect: 'https://claude.ai/cb?code=c' });
    await click('Allow');
    expect(JSON.parse((apiMock.mock.lastCall![1] as { body: string }).body).scopes).toEqual([]);
  });

  it('refuses to follow a redirect to a host it did not show', async () => {
    apiMock.mockResolvedValueOnce(consentRes({ workspaces: [{ id: 'ws_1', name: 'Acme' }] }));
    await mount('?handle=h1');
    apiMock.mockResolvedValueOnce({ ok: true, redirect: 'https://evil.example/cb?code=c' });
    await click('Allow');
    expect(assign).not.toHaveBeenCalled();
    expect(text()).toContain('unexpected destination');
  });

  it('posts deny and follows the error redirect back to the app', async () => {
    apiMock.mockResolvedValueOnce(consentRes());
    await mount('?handle=h1');
    apiMock.mockResolvedValueOnce({ ok: true, redirect: 'https://claude.ai/cb?error=access_denied&state=s' });
    await click('Deny');
    expect(JSON.parse((apiMock.mock.lastCall![1] as { body: string }).body)).toEqual({ handle: 'h1', decision: 'deny' });
    expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?error=access_denied&state=s');
  });

  it('explains an expired request', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(410, '{"ok":false,"error":"expired"}'));
    await mount('?handle=old');
    expect(text()).toContain('This request expired');
  });

  it('sends a signed-out person through login and remembers where to come back', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(401, '{"ok":false,"error":"Not authenticated"}'));
    await mount('?resume=' + encodeURIComponent('https://api.dosya.dev/authorize?client_id=c&state=s'));
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(sessionStorage.getItem('dosya.postAuthPath')).toContain('/connect/ai?resume=');
  });

  it('resumes the authorization once signed in', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, user: {} });
    const target = 'https://api.dosya.dev/authorize?client_id=c&state=s';
    await mount('?resume=' + encodeURIComponent(target));
    expect(assign).toHaveBeenCalledWith(target);
  });

  it('refuses to resume to anything but our own /authorize', async () => {
    for (const bad of ['https://evil.example/authorize?x=1', 'https://api.dosya.dev/api/me', 'javascript:alert(1)']) {
      apiMock.mockReset(); assign.mockReset();
      act(() => root?.unmount());
      await mount('?resume=' + encodeURIComponent(bad));
      expect(assign, bad).not.toHaveBeenCalled();
      expect(text(), bad).toContain('That link is not valid');
    }
  });

  // The library reports redirectHost as a hostname (no port); a local MCP
  // client's callback always has one.
  it('follows a loopback callback that carries a port', async () => {
    apiMock.mockResolvedValueOnce(consentRes({
      client: { name: 'Local thing', domain: null, redirectHost: '127.0.0.1', redirectIsLoopback: true },
      workspaces: [{ id: 'ws_1', name: 'Acme' }],
    }));
    await mount('?handle=h1');
    apiMock.mockResolvedValueOnce({ ok: true, redirect: 'http://127.0.0.1:8976/oauth/callback?code=c&state=s' });
    await click('Allow');
    expect(assign).toHaveBeenCalledWith('http://127.0.0.1:8976/oauth/callback?code=c&state=s');
  });
});
