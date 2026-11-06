import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Name search goes through `api`; content search through fetch (it needs the
// status and Retry-After). Both are faked separately.
const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

// The engine is not under test here (people are covered in global-search.persons.test.tsx).
vi.mock('@/lib/personas-device/engine-host', () => import('@/lib/personas-device/__fixtures__/fake-host'));
const { GlobalSearch } = await import('./global-search');
const { useWorkspace } = await import('@/stores/workspace');
const { useSession } = await import('@/stores/session');
const { resetContentSearchState } = await import('@/lib/ai-search');

const FILES = { ok: true, files: [{ id: 'f1', name: 'lease-2026.pdf', size_bytes: 10, extension: 'pdf', folder_id: 'd1', uploader_name: 'Ada' }], folders: [], shared: [], file_requests: [] };
const HIT = {
  id: 'f9', name: 'tenancy.pdf', size_bytes: 10, mime_type: 'application/pdf', extension: 'pdf', region: 'eu',
  folder_id: 'd2', uploaded_by: 'u1', created_at: 1, lock_mode: null, uploader_name: 'Ada',
  score: 0.8, snippet: 'the lease ends in March', page: 4, source: 'both',
};

function routeApi(path: string) {
  if (path.startsWith('/api/me/permissions')) return Promise.resolve({ ok: true, permissions: { access_files: true, access_settings: true } });
  if (path === '/api/help/index') return Promise.resolve({ ok: true, articles: [] });
  if (path.startsWith('/api/search')) return Promise.resolve(FILES);
  return Promise.resolve({ ok: true });
}

let fetchMock: ReturnType<typeof vi.fn>;
let root: Root | null = null;
let container: HTMLDivElement;

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = createRoot(container);
    root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/files']}><GlobalSearch /></MemoryRouter></QueryClientProvider>);
  });
}

const input = () => container.querySelector('input[role="combobox"]') as HTMLInputElement;
const headers = () => [...container.querySelectorAll('[data-search-group]')].map((h) => h.getAttribute('data-search-group'));
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function focus() { await act(async () => { input().focus(); input().dispatchEvent(new FocusEvent('focus')); }); }
async function flush(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
const contentCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/search/content'));
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  resetContentSearchState();
  apiMock.mockImplementation(routeApi);
  fetchMock = vi.fn();
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

describe('GlobalSearch content results', () => {
  it('shows the content group only after its own request resolves, beside the name group', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => { release = r; }));
    await mount();
    await focus();
    await type('lease');
    await flush(250);
    // Names are in; content has not been asked yet (400 ms debounce).
    expect(headers()).toContain('files');
    expect(contentCalls()).toHaveLength(0);
    await flush(150);
    expect(contentCalls()).toHaveLength(1);
    expect(String(contentCalls()[0][0])).toContain('workspace_id=ws_1');
    expect(String(contentCalls()[0][0])).toContain('q=lease');
    expect(headers()).not.toContain('content');

    await act(async () => { release(json(200, { ok: true, files: [HIT], partial: false, took_ms: 9 })); });
    await flush(0);
    expect(headers()).toEqual(expect.arrayContaining(['files', 'content']));
    expect(container.textContent).toContain('In file contents');
    expect(container.textContent).toContain('tenancy.pdf');
    expect(container.textContent).toContain('the lease ends in March');
    expect(container.textContent).toContain('p. 4');
  });

  it('typing fast fires one content request for the last text', async () => {
    fetchMock.mockImplementation(async () => json(200, { ok: true, files: [], partial: false }));
    await mount();
    await focus();
    await type('le');
    await flush(200);
    await type('lea');
    await flush(200);
    await type('lease');
    await flush(400);
    expect(contentCalls()).toHaveLength(1);
    expect(String(contentCalls()[0][0])).toContain('q=lease');
  });

  it('a 429 on content leaves the name group alone and shows the busy state, then retries once', async () => {
    fetchMock
      .mockResolvedValueOnce(json(429, { ok: false, error: 'rate_limited', retryable: true }, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json(200, { ok: true, files: [HIT], partial: false }));
    await mount();
    await focus();
    await type('lease');
    await flush(400);
    expect(headers()).toContain('files');
    expect(container.textContent).toContain('lease-2026.pdf');
    expect(container.textContent).toContain('Content search is busy, retrying');
    expect(container.textContent).not.toContain('No content matches');
    expect(headers()).not.toContain('content');

    await flush(2000);
    expect(contentCalls()).toHaveLength(2);
    expect(container.textContent).not.toContain('Content search is busy, retrying');
    expect(headers()).toContain('content');
    expect(container.textContent).toContain('lease-2026.pdf');
  });

  it('a workspace without AI search hides the group silently', async () => {
    fetchMock.mockResolvedValue(json(409, { ok: false, error: 'ai_search_off' }));
    await mount();
    await focus();
    await type('lease');
    await flush(400);
    expect(headers()).toContain('files');
    expect(headers()).not.toContain('content');
    expect(container.textContent).not.toContain('Content search is busy');
  });
});
