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

const NAMES = {
  ok: true, files: [{ id: 'f1', name: 'lease-2026.pdf', size_bytes: 10, mime_type: 'application/pdf', extension: 'pdf', region: 'eu', folder_id: null, uploaded_by: 'u', created_at: 1, uploader_name: 'Ada' }],
  folders: [], shared: [], file_requests: [], pagination: { total_files: 1, total_folders: 0, total_shares: 0, total_requests: 0 },
};
const HIT = {
  id: 'f9', name: 'tenancy.pdf', size_bytes: 10, mime_type: 'application/pdf', extension: 'pdf', region: 'eu',
  folder_id: 'd2', uploaded_by: 'u1', created_at: 1, lock_mode: null, uploader_name: 'Ada',
  score: 0.8, snippet: 'the lease ends in March', page: 4, source: 'both',
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
let root: Root | null = null;
let container: HTMLDivElement;

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetContentSearchState();
  apiMock.mockImplementation(async (path: string) => (path.startsWith('/api/search') ? NAMES : { ok: true }));
  fetchMock = vi.fn();
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

async function mount(q = 'lease') {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<MemoryRouter initialEntries={[`/search?q=${q}`]}><SearchPage /></MemoryRouter>);
  });
}
async function flush(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
const text = () => container.textContent ?? '';

describe('SearchPage content results', () => {
  it('shows a loading line, then snippets with the page', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => { release = r; }));
    await mount();
    await flush();
    expect(text()).toContain('lease-2026.pdf');
    expect(text()).toContain('In file contents');
    expect(text()).toContain('Searching file contents');
    await act(async () => { release(json(200, { ok: true, files: [HIT], partial: false })); });
    await flush();
    expect(text()).toContain('tenancy.pdf');
    expect(text()).toContain('the lease ends in March');
    expect(text()).toContain('p. 4');
    expect(text()).not.toContain('No content matches');
  });

  it('says "No content matches" only on a successful empty answer', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, files: [], partial: false }));
    await mount();
    await flush();
    expect(text()).toContain('No content matches');
  });

  it('a 429 shows the busy line (not "no matches") and retries once', async () => {
    fetchMock
      .mockResolvedValueOnce(json(429, { ok: false, error: 'rate_limited', retryable: true }, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(json(200, { ok: true, files: [HIT], partial: false }));
    await mount();
    await flush();
    expect(text()).toContain('Content search is busy, retrying');
    expect(text()).not.toContain('No content matches');
    expect(text()).toContain('lease-2026.pdf');
    await flush(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text()).toContain('tenancy.pdf');
    expect(text()).not.toContain('Content search is busy');
  });

  it('a partial empty answer (paused or degraded) shows nothing rather than "No content matches"', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, files: [], partial: true }));
    await mount();
    await flush();
    expect(text()).not.toContain('No content matches');
    expect(text()).not.toContain('In file contents');
    expect(text()).toContain('lease-2026.pdf');
  });

  it('a partial answer with hits still lists them', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, files: [HIT], partial: true }));
    await mount();
    await flush();
    expect(text()).toContain('tenancy.pdf');
  });

  it('hides the section when the workspace has no AI search', async () => {
    fetchMock.mockResolvedValue(json(402, { ok: false, error: 'ai_search_not_in_plan' }));
    await mount();
    await flush();
    expect(text()).not.toContain('In file contents');
    expect(text()).toContain('lease-2026.pdf');
  });
});

const IMAGE_HIT = {
  ...HIT, id: 'f10', name: 'IMG_0001.HEIC', mime_type: 'image/heic', extension: 'heic',
  snippet: 'No text is present in the image.', page: null, source: 'vector',
};

describe('SearchPage result layout', () => {
  afterEach(() => { localStorage.removeItem('dosya_search_view'); });

  it('shows no text under an image hit, but keeps the snippet under a document', async () => {
    // The second image has no extension: the indexer went by its MIME type, so the page must too.
    const bareImage = { ...IMAGE_HIT, id: 'f11', name: 'scan_0042', extension: '', mime_type: 'image/png', snippet: 'No text in image.' };
    fetchMock.mockResolvedValue(json(200, { ok: true, files: [HIT, IMAGE_HIT, bareImage], partial: false }));
    await mount();
    await flush();
    expect(text()).toContain('IMG_0001.HEIC');
    expect(text()).toContain('scan_0042');
    expect(text()).not.toContain('No text is present');
    expect(text()).not.toContain('No text in image');
    expect(text()).toContain('the lease ends in March');
  });

  it('starts as a list, switches to square tiles on the Grid button, and remembers the choice', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, files: [HIT], partial: false }));
    await mount();
    await flush();
    expect(container.querySelectorAll('[data-testid="file-row"]').length).toBe(2);
    expect(container.querySelector('[data-testid="file-tile"]')).toBeNull();
    const grid = container.querySelector<HTMLButtonElement>('button[aria-label="Grid"]')!;
    expect(grid.getAttribute('aria-pressed')).toBe('false');
    await act(async () => { grid.click(); });
    expect(grid.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('[data-testid="file-tile"]').length).toBe(2);
    expect(container.querySelector('[data-testid="file-row"]')).toBeNull();
    expect(localStorage.getItem('dosya_search_view')).toBe('grid');
    // A fresh mount reads the saved choice back. (The name results are enough
    // to prove it: the content search dedupes a repeat of the same query.)
    act(() => root!.unmount()); root = null; container.remove();
    await mount();
    await flush();
    expect(container.querySelectorAll('[data-testid="file-tile"]').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('[data-testid="file-row"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="List"]')!.getAttribute('aria-pressed')).toBe('false');
  });
});
