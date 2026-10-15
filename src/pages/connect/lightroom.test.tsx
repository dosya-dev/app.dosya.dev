import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
const navigate = vi.fn();
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
import { useWorkspace } from '@/stores/workspace';
import ConnectLightroomPage from './lightroom';

const NOW = Math.floor(Date.now() / 1000);
const WORKSPACES = [{ id: 'ws_1', name: 'Personal' }, { id: 'ws_2', name: 'Studio' }];
const req = (over: Record<string, unknown> = {}) => ({
  device_name: 'Anna MacBook', plugin_version: '0.1.0', created_at: NOW, expires_at: NOW + 600, status: 'pending', ...over,
});

function route(over: { request?: unknown; requestError?: unknown; decide?: () => unknown } = {}) {
  apiMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/lightroom/connect/request')) {
      if (over.requestError) throw over.requestError;
      return { ok: true, request: over.request ?? req() };
    }
    if (path === '/api/workspaces') return { ok: true, workspaces: WORKSPACES };
    if (path === '/api/lightroom/connect/decide') return over.decide ? over.decide() : { ok: true };
    throw new Error('unexpected ' + path);
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('connect/lightroom page', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    apiMock.mockReset(); navigate.mockReset(); sessionStorage.clear();
    useWorkspace.setState({ activeId: 'ws_2' });
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { act(() => root?.unmount()); container?.remove(); });

  const mount = async (query = '?code=ABCD-2345') => {
    root = createRoot(container!);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[`/connect/lightroom${query}`]}>
          <ConnectLightroomPage />
        </MemoryRouter>,
      );
    });
    await act(async () => { await Promise.resolve(); });
  };
  const btn = (label: string) => Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
  const text = () => container!.textContent ?? '';

  it('shows device, version, the code and the workspace picker', async () => {
    route();
    await mount();
    expect(text()).toContain('Anna MacBook');
    expect(text()).toContain('plug-in 0.1.0');
    expect(container!.querySelector('[data-testid="lr-code"]')?.textContent).toBe('ABCD-2345');
    const select = container!.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('ws_2');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Personal', 'Studio']);
  });

  it('says what the key can do in the chosen workspace and warns against links from someone else', async () => {
    route();
    await mount();
    const scope = container!.querySelector('[data-testid="lr-scope"]')!.textContent;
    expect(scope).toBe("It can upload, read, change, delete and share files in Studio, and change that workspace's settings that your role allows.");
    expect(container!.querySelector('[data-testid="lr-warning"]')!.textContent).toBe(
      'Only allow this if you just chose Connect in Lightroom Classic on your own computer. If someone sent you this link, choose Deny.',
    );
    const select = container!.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'ws_1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container!.querySelector('[data-testid="lr-scope"]')!.textContent).toContain('files in Personal,');
  });

  it('posts the allow decision with the chosen workspace and shows the return state', async () => {
    route();
    await mount();
    const select = container!.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'ws_1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { btn('Allow')!.click(); });
    await act(async () => { await Promise.resolve(); });
    const call = apiMock.mock.calls.find(([p]) => p === '/api/lightroom/connect/decide')!;
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ code: 'ABCD-2345', workspace_id: 'ws_1', decision: 'allow' });
    expect(text()).toContain('Return to Lightroom Classic');
    expect(text()).toContain('Personal');
  });

  it('posts deny and shows the denied state', async () => {
    route();
    await mount();
    await act(async () => { btn('Deny')!.click(); });
    await act(async () => { await Promise.resolve(); });
    const call = apiMock.mock.calls.find(([p]) => p === '/api/lightroom/connect/decide')!;
    expect(JSON.parse(call[1].body).decision).toBe('deny');
    expect(text()).toContain('Connection denied');
  });

  it('shows expired and already-used requests without the form', async () => {
    route({ request: req({ expires_at: NOW - 5 }) });
    await mount();
    expect(text()).toContain('This request has expired.');
    expect(btn('Allow')).toBeUndefined();
    act(() => root!.unmount());
    route({ request: req({ status: 'approved' }) });
    await mount();
    expect(text()).toContain('This request was already used.');
  });

  it('treats a 404 for the code as expired', async () => {
    route({ requestError: new ApiError(404, JSON.stringify({ ok: false, error: 'Not found' })) });
    await mount();
    expect(text()).toContain('This request has expired.');
  });

  it('sends a signed-out visitor to log in and remembers the way back', async () => {
    route({ requestError: new ApiError(401, JSON.stringify({ ok: false, error: 'Not authenticated' })) });
    await mount();
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('shows the server sentence when the decision is refused and stays on the form', async () => {
    route({ decide: () => { throw new ApiError(403, JSON.stringify({ ok: false, error: 'You cannot upload to this workspace' })); } });
    await mount();
    await act(async () => { btn('Allow')!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(container!.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(btn('Allow')).toBeTruthy();
  });

  it('refuses a link without a code', async () => {
    route();
    await mount('');
    expect(text()).toContain('incomplete');
    expect(apiMock).not.toHaveBeenCalled();
  });
});
