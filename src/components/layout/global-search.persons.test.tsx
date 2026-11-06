import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Name search and the persona list go through `api`; content search through fetch.
const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

vi.mock('@/lib/personas-device/engine-host', () => import('@/lib/personas-device/__fixtures__/fake-host'));

const { GlobalSearch } = await import('./global-search');
const { useWorkspace } = await import('@/stores/workspace');
const { useSession } = await import('@/stores/session');
const { resetContentSearchState } = await import('@/lib/ai-search');
const { fakeHost, card } = await import('@/lib/personas-device/__fixtures__/fake-host');

const HIT = {
  id: 'f9', name: 'IMG_4821.jpg', size_bytes: 10, mime_type: 'image/jpeg', extension: 'jpg', region: 'eu',
  folder_id: 'd2', uploaded_by: 'u1', created_at: 1, lock_mode: null, uploader_name: 'Alex Walker',
  score: 0.8, snippet: 'sandy beach, waves', page: null, source: 'vector',
};

function routeApi(path: string) {
  if (path.startsWith('/api/me/permissions')) return Promise.resolve({ ok: true, permissions: { access_files: true, access_settings: true } });
  if (path === '/api/help/index') return Promise.resolve({ ok: true, articles: [] });
  if (path.startsWith('/api/search')) return Promise.resolve({ ok: true, files: [], folders: [] });
  return Promise.resolve({ ok: true });
}

let fetchMock: ReturnType<typeof vi.fn>;
let root: Root | null = null;
let container: HTMLDivElement;

let here = '';
function Where() {
  const l = useLocation();
  useEffect(() => { here = l.pathname + l.search; }, [l]);
  return null;
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = createRoot(container);
    root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/files']}><GlobalSearch /><Where /></MemoryRouter></QueryClientProvider>);
  });
}

const input = () => container.querySelector('input[role="combobox"]') as HTMLInputElement;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function focus() { await act(async () => { input().focus(); input().dispatchEvent(new FocusEvent('focus')); }); }
async function flush(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const option = (label: string) => [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.includes(label));

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  resetContentSearchState();
  fakeHost.reset();
  fakeHost.engine.personas = [card('p1', 'Emma', { photo_count: 412 }), card('p2', null)];
  apiMock.mockImplementation(routeApi);
  fetchMock = vi.fn(async () => json(200, { ok: true, files: [HIT], partial: false }));
  vi.stubGlobal('fetch', fetchMock);
  useWorkspace.setState({ activeId: 'ws_1' });
  useSession.setState({ user: { id: 'u_1' } } as never);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container.remove();
  root = null;
  apiMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const personasCalls = () => [...apiMock.mock.calls.map(([p]) => String(p)), ...fetchMock.mock.calls.map(([u]) => String(u))]
  .filter((u) => /personas|\/people|person=/.test(u));

// Personas settings are each member's own: the Go to row opens /personas/settings.
describe('GlobalSearch Personas settings row', () => {
  it('shows for a member who may see files and opens /personas/settings', async () => {
    await mount();
    await focus();
    await type('Personas settings');
    await flush(250);
    const row = option('Personas settings');
    expect(row).toBeTruthy();
    expect(row!.textContent).not.toContain('Workspace settings');
    await act(async () => { row!.click(); });
    expect(here).toBe('/personas/settings');
  });
});

describe('GlobalSearch people', () => {
  it('typing "Em" offers Emma under People, found on this device', async () => {
    await mount();
    await focus();
    await type('Em');
    await flush(250);
    expect(fakeHost.engine.findByName).toHaveBeenCalledWith('Em', 5);
    expect(container.querySelector('[data-search-group="people"]')!.textContent).toContain('People');
    expect(option('Emma')!.textContent).toContain('Go to person');
    expect(personasCalls()).toEqual([]);
  });

  it('choosing Emma goes to her persona page and sends no person content search', async () => {
    await mount();
    await focus();
    await type('Em');
    await flush(250);
    await act(async () => { option('Emma')!.click(); });
    await flush(400);
    expect(here).toBe('/personas/p1');
    expect(container.querySelector('[data-person-chip]')).toBeNull();
    expect(personasCalls()).toEqual([]);
  });

  it('offers nobody while Personas is off or locked on this device', async () => {
    fakeHost.set({ status: { state: 'off' } });
    await mount();
    await focus();
    await type('Em');
    await flush(250);
    expect(fakeHost.engine.findByName).not.toHaveBeenCalled();
    expect(container.querySelector('[data-search-group="people"]')).toBeNull();
  });

  it('a failing engine hides People silently', async () => {
    fakeHost.engine.status.mockRejectedValue(new Error('offline'));
    await mount();
    await focus();
    await type('Em');
    await flush(250);
    expect(container.querySelector('[data-search-group="people"]')).toBeNull();
  });
});
