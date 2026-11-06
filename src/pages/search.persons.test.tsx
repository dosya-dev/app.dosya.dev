import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const SearchPage = (await import('./search')).default;
const { useWorkspace } = await import('@/stores/workspace');
const { resetContentSearchState } = await import('@/lib/ai-search');

const HIT = {
  id: 'h1', name: 'IMG_4821.jpg', size_bytes: 10, mime_type: 'image/jpeg', extension: 'jpg', region: 'eu',
  folder_id: 'd2', uploaded_by: 'u1', created_at: 1, lock_mode: null, uploader_name: 'Alex Walker',
  score: 0.8, snippet: 'sandy beach, waves', page: null, source: 'vector',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
let root: Root | null = null;
let container: HTMLDivElement;

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetContentSearchState();
  apiMock.mockImplementation(async () => ({ ok: true, files: [], folders: [] }));
  fetchMock = vi.fn(async () => json(200, { ok: true, files: [HIT], partial: false }));
  vi.stubGlobal('fetch', fetchMock);
  useWorkspace.setState({ activeId: 'ws_1' });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container.remove();
  root = null;
  apiMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(path: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<MemoryRouter initialEntries={[path]}><SearchPage /></MemoryRouter>);
  });
  await flush();
}
async function flush(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
const text = () => container.textContent ?? '';
const lastContent = () => new URL(String(fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/search/content')).at(-1)![0]), 'https://x');

// The server person filter is gone: people are found on the device and opened
// on their persona page (global search "Go to person"). An old /search?person=
// link is a plain search for its words.
describe('/search with an old person= link', () => {
  it('runs the plain search for the words and sends no person to the server', async () => {
    await mount('/search?person=p1&q=beach');
    await flush(400);
    expect(text()).not.toContain('Photos of');
    const content = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/search/content'));
    expect(content.length).toBeGreaterThan(0);
    expect(lastContent().searchParams.getAll('person')).toEqual([]);
    expect(lastContent().searchParams.get('q')).toBe('beach');
    expect(apiMock.mock.calls.filter(([p]) => String(p).includes('personas'))).toEqual([]);
  });
});
