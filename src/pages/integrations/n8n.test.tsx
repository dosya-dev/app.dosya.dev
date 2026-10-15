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
import { N8N_NODE_PUBLISHED } from '@/lib/integrations';
const { default: N8nSetup, keyStatus, isN8nKey } = await import('./n8n');

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
  id, name: 'n8n', scope: 'full', key_prefix: 'abcd1234', created_at: NOW - 86400, last_used_at: NOW - 7200,
  expires_at: null, s3_access_key_id: null, surfaces: null, workspace_id: null, root_folder_id: null,
  allowed_ips: null, active_hours: null, ...over,
});

function route(opts: { keys?: unknown[]; keysError?: unknown; createError?: unknown }) {
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === '/api/me/api-keys' && (!init || !init.method)) {
      if (opts.keysError) throw opts.keysError;
      return { keys: opts.keys ?? [] };
    }
    if (path === '/api/me/api-keys' && init?.method === 'POST') {
      if (opts.createError) throw opts.createError;
      return { key: { plain_key: 'dos_live_secret_value' } };
    }
    if (path === '/api/workspaces') return { workspaces: [{ id: 'ws_1', name: 'Studio' }] };
    if (/^\/api\/me\/api-keys\/[^/]+$/.test(path) && init?.method === 'DELETE') return { ok: true };
    throw new Error('unexpected ' + path);
  });
}

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><N8nSetup /></MemoryRouter>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const text = () => document.body.textContent ?? '';
const rows = () => [...container!.querySelectorAll('[data-testid="n8n-key-row"]')] as HTMLElement[];
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

beforeEach(() => { apiMock.mockReset(); });

describe('N8nSetup', () => {
  it('shows the empty state with a create button and the three steps', async () => {
    route({ keys: [key('other', { name: 'backup script' })] });
    await render();
    expect(text()).toContain('No n8n key yet.');
    expect(button('Create a key for n8n')).toBeTruthy();
    expect(text()).toContain('Set up n8n');
    for (const s of ['Install', 'Connect', 'Automate']) expect(text()).toContain(s);
    // The install step follows the published flag: install instructions once
    // the package is on npm, and never before.
    if (N8N_NODE_PUBLISHED) {
      expect(text()).toContain('Settings › Community Nodes, choose Install and enter');
      expect(text()).not.toContain('Once it is out');
    } else {
      expect(text()).toContain('Once it is out');
    }
    expect(rows()).toHaveLength(0);
  });

  it('lists only keys named for n8n, with reach and status', async () => {
    route({
      keys: [
        key('a'),
        key('b', { name: 'n8n production', workspace_id: 'ws_1', last_used_at: null }),
        key('c', { name: 'n8n read', scope: 'read' }),
        key('d', { name: 'zapier' }),
      ],
    });
    await render();
    const [a, b, c] = rows();
    expect(rows()).toHaveLength(3);
    expect(a.textContent).toContain('Connected');
    expect(a.textContent).toContain('Every workspace');
    expect(b.textContent).toContain('Studio');
    expect(b.textContent).toContain('Ready, not used yet');
    expect(c.textContent).toContain('Read only, uploads will fail');
    expect(text()).toContain('Set up another workflow');
  });

  it('creates a full-access key named n8n and shows it once', async () => {
    route({ keys: [] });
    await render();
    await act(async () => { button('Create a key for n8n')!.click(); });
    await act(async () => { button('Create key')!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const post = apiMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(post![1].body)).toEqual({ name: 'n8n', scope: 'full' });
    expect(document.querySelector('[data-testid="n8n-plain-key"]')?.textContent).toBe('dos_live_secret_value');
    expect(text()).toContain('This is the only time the key is shown.');
  });

  it('revokes a key after confirmation', async () => {
    route({ keys: [key('a')] });
    await render();
    await act(async () => {
      (container!.querySelector('button[aria-label="Actions for n8n"]') as HTMLElement).click();
    });
    const revokeItem = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('Revoke')) as HTMLElement;
    await act(async () => { revokeItem.click(); });
    expect(text()).toContain('Workflows using this key stop working immediately.');
    const confirm = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Revoke').pop()!;
    await act(async () => { confirm.click(); confirm.click(); });
    const deletes = apiMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toBe('/api/me/api-keys/a');
  });

  it('shows the server sentence when keys cannot load', async () => {
    route({ keysError: new ApiError(500, JSON.stringify({ ok: false, error: 'Database busy' })) });
    await render();
    expect(container!.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });
});

describe('keyStatus', () => {
  it('names each way a key breaks the node, worst first', () => {
    expect(keyStatus(key('x', { expires_at: NOW - 1, scope: 'read' }), NOW).text).toMatch(/Expired/);
    expect(keyStatus(key('x', { root_folder_id: 'fld_1' }), NOW).text).toMatch(/Folder-anchored/);
    expect(keyStatus(key('x', { scope: 'upload' }), NOW).text).toMatch(/needs full access/);
    expect(keyStatus(key('x'), NOW)).toEqual({ text: 'Connected', tone: 'green' });
  });

  it('matches n8n as a word in the key name', () => {
    expect(isN8nKey({ name: 'n8n' })).toBe(true);
    expect(isN8nKey({ name: 'N8N prod' })).toBe(true);
    expect(isN8nKey({ name: 'zapier' })).toBe(false);
  });
});
