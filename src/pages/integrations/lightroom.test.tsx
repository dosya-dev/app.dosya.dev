import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  API_BASE: '',
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
const { default: LightroomSetup, linkState, isLightroomKey, deviceOf } = await import('./lightroom');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
});

const NOW = Math.floor(Date.now() / 1000);
const key = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: 'Lightroom Classic: Anna MacBook', created_at: NOW - 86400, last_used_at: NOW - 7200, expires_at: null, ...over,
});
const gallery = (id: string, over: Record<string, unknown> = {}, share: Record<string, unknown> = {}) => ({
  id, title: `Wedding ${id}`, item_count: 120, client_count: 2, selection_count: 14, selections_enabled: true,
  share: { url: `https://dosya.dev/s/${id}`, expires_at: null, is_password_protected: false, is_revoked: false, ...share },
  ...over,
});

function route(opts: { keys?: unknown[]; keysError?: unknown; galleries?: unknown[]; galleriesError?: unknown }) {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/api/me/api-keys' && !init?.method) {
      if (opts.keysError) throw opts.keysError;
      return { keys: opts.keys ?? [] };
    }
    if (path.startsWith('/api/galleries?')) {
      if (opts.galleriesError) throw opts.galleriesError;
      return { ok: true, galleries: opts.galleries ?? [] };
    }
    if (/^\/api\/me\/api-keys\/[^/]+$/.test(path) && init?.method === 'DELETE') return { ok: true };
    throw new Error('unexpected ' + path);
  });
}

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><LightroomSetup /></MemoryRouter>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const text = () => document.body.textContent ?? '';
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

beforeEach(() => {
  apiMock.mockReset();
  useWorkspace.setState({ activeId: 'ws_1' });
});

describe('LightroomSetup', () => {
  it('shows the empty states and the three setup steps with the plug-in download', async () => {
    route({ keys: [key('o', { name: 'backup script' })] });
    await render();
    expect(text()).toContain('No catalog is connected yet.');
    expect(text()).toContain('No galleries yet.');
    for (const s of ['Download', 'Add it', 'Connect']) expect(text()).toContain(s);
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes('Download plug-in'))!;
    expect(link.getAttribute('href')).toBe('https://dosya.dev/downloads/lightroom/dosya-lightroom.zip');
    const exchange = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes('Adobe Exchange'))!;
    expect(exchange.getAttribute('href')).toBe('https://exchange.adobe.com/apps/cc/206096');
    expect(exchange.getAttribute('target')).toBe('_blank');
    expect(exchange.getAttribute('rel')).toContain('noopener');
    expect(container!.querySelectorAll('[data-testid="lr-key-row"]')).toHaveLength(0);
  });

  it('lists only Lightroom Classic keys and the galleries of the active workspace', async () => {
    route({
      keys: [key('a'), key('b', { name: 'Lightroom Classic: Studio iMac', last_used_at: null }), key('c', { name: 'n8n' })],
      galleries: [gallery('g1'), gallery('g2', { selections_enabled: false, item_count: 1 }, { is_revoked: true })],
    });
    await render();
    const keyRows = [...container!.querySelectorAll('[data-testid="lr-key-row"]')];
    expect(keyRows).toHaveLength(2);
    expect(keyRows[0].textContent).toContain('Anna MacBook');
    expect(keyRows[1].textContent).toContain('Never');
    expect(apiMock.mock.calls.some(([p]) => p === '/api/galleries?workspace_id=ws_1')).toBe(true);
    const rows = [...container!.querySelectorAll('[data-testid="lr-gallery-row"]')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('120 photos');
    expect(rows[0].textContent).toContain('2 clients');
    expect(rows[0].textContent).toContain('14 selections');
    expect(rows[1].textContent).toContain('1 photo');
    expect(rows[1].textContent).toContain('Selections off');
    expect(rows[1].textContent).toContain('Link revoked');
    expect(rows[0].querySelector('a')!.getAttribute('href')).toBe('https://dosya.dev/s/g1');
  });

  it('a gallery whose link is gone (share: null) reads "Link removed" with nothing to copy or open', async () => {
    route({ galleries: [gallery('g1'), { ...gallery('g2'), share: null }] });
    await render();
    const rows = [...container!.querySelectorAll('[data-testid="lr-gallery-row"]')];
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain('Wedding g2');
    expect(rows[1].textContent).toContain('Link removed');
    expect(rows[1].querySelector('a')).toBeNull();
    expect(rows[1].querySelector('button')).toBeNull();
    expect(rows[0].querySelector('button[aria-label="Copy link for Wedding g1"]')).not.toBeNull();
  });

  it('copies a gallery link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    route({ galleries: [gallery('g1')] });
    await render();
    await act(async () => { (container!.querySelector('button[aria-label="Copy link for Wedding g1"]') as HTMLElement).click(); });
    expect(writeText).toHaveBeenCalledWith('https://dosya.dev/s/g1');
  });

  it('revokes a connection after confirmation, once', async () => {
    route({ keys: [key('a')] });
    await render();
    await act(async () => {
      (container!.querySelector('button[aria-label^="Actions for Lightroom Classic"]') as HTMLElement).click();
    });
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('Revoke')) as HTMLElement;
    await act(async () => { item.click(); });
    expect(text()).toContain('is signed out and can no longer publish');
    const confirm = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Revoke').pop()!;
    await act(async () => { confirm.click(); confirm.click(); });
    const deletes = apiMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toBe('/api/me/api-keys/a');
  });

  it('shows the server sentence when galleries or keys cannot load', async () => {
    route({
      keysError: new ApiError(500, JSON.stringify({ ok: false, error: 'Database busy' })),
      galleriesError: new ApiError(403, JSON.stringify({ ok: false, error: 'No access' })),
    });
    await render();
    expect(container!.querySelectorAll('[role="alert"]')).toHaveLength(2);
  });
});

describe('helpers', () => {
  it('names the link state, worst first', () => {
    const g = (share: Record<string, unknown>) => gallery('x', {}, share) as never;
    expect(linkState(g({ is_revoked: true, expires_at: NOW - 1 }), NOW).text).toBe('Link revoked');
    expect(linkState(g({ expires_at: NOW - 1 }), NOW).text).toBe('Link expired');
    expect(linkState(g({ is_password_protected: true }), NOW).text).toBe('Password protected');
    expect(linkState(g({}), NOW)).toEqual({ text: 'Live', tone: 'green' });
    expect(linkState({ ...gallery('x'), share: null } as never, NOW)).toEqual({ text: 'Link removed', tone: 'grey' });
  });

  it('finds keys by the connect-flow prefix', () => {
    expect(isLightroomKey({ name: 'Lightroom Classic: Mac' })).toBe(true);
    expect(isLightroomKey({ name: 'my Lightroom Classic: x' })).toBe(false);
    expect(deviceOf({ name: 'Lightroom Classic: Mac' })).toBe('Mac');
    expect(deviceOf({ name: 'Lightroom Classic:' })).toBe('Lightroom Classic');
  });
});
