import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

// The real module keeps ApiError and the error helpers; only `api` is faked.
const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { AiSearchSection } = await import('./ai-search');
const { ApiError } = await import('@/api/client');
const { toast } = await import('@/lib/toast');

const LIMITS = { vectorBudget: 22000, imagesMax: 2000, documentsMax: 1000, docChunksMax: 20000, backfillUnits: 5000, monthUnits: 1000 };
const STATUS = {
  files_total: 40, indexed: 30, pending: 6, partial: 2, unsupported: 1, capped: 0, failed: 1, images: 120, documents: 45, chunks: 300,
  limits: LIMITS as typeof LIMITS | null, backfill_units_remaining: 100, month_units_remaining: 100, month_reset_at: null,
  estimated_finish_at: null, paused: false,
};
const OFF = { ok: true, settings: { enabled: false, index_existing: true, excluded_folders: [] as string[] }, status: STATUS, can_edit: true };

let getResponse: () => unknown = () => OFF;
let putResponse: (body: Record<string, unknown>) => unknown = (body) => ({ ok: true, settings: { ...OFF.settings, ...body } });

function routeApi(path: string, init?: RequestInit) {
  if (path === '/api/workspaces/ws1/ai-search') {
    if (init?.method === 'PUT') return Promise.resolve().then(() => putResponse(JSON.parse(String(init.body))));
    return Promise.resolve().then(() => getResponse());
  }
  if (path.startsWith('/api/folders/')) return Promise.resolve({ ok: true, folder: { name: `Folder ${path.split('/').pop()}` } });
  return Promise.resolve({ ok: true });
}

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  getResponse = () => OFF;
  putResponse = (body) => ({ ok: true, settings: { ...OFF.settings, ...body } });
  apiMock.mockReset();
  apiMock.mockImplementation(routeApi);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  vi.restoreAllMocks();
});

const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<MemoryRouter><AiSearchSection wsId="ws1" /></MemoryRouter>); });
  await flush();
}

const text = () => container!.textContent ?? '';
const toggle = () => container!.querySelector<HTMLButtonElement>('button[role="switch"]')!;
const putCalls = () => apiMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); await flush(); };

describe('AI search settings section', () => {
  it('renders the switch off when the API says enabled: false', async () => {
    await mount();
    expect(text()).toContain('AI search');
    expect(text()).toContain('Search inside files and photos');
    expect(text()).toContain("Files are processed by Cloudflare Workers AI; the index stays in your workspace's region.");
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(toggle().disabled).toBe(false);
    expect(text()).toContain('Also index existing files');
    expect(text()).toContain('Exclude folders');
    expect(text()).not.toContain('AI search is available on paid plans');
    // The dashboard link only while on.
    expect(container!.querySelector('a[href="/"]')).toBeNull();
  });

  it('disables the switch with the upgrade text when the plan has no AI search (limits null)', async () => {
    getResponse = () => ({ ...OFF, status: { ...STATUS, limits: null } });
    await mount();
    expect(toggle().disabled).toBe(true);
    expect(text()).toContain('AI search is available on paid plans');
    expect(container!.querySelector('a[href="/billing"]')).toBeTruthy();
    await click(toggle());
    expect(putCalls()).toHaveLength(0);
  });

  it('still lets an owner switch OFF a workspace left on after a downgrade', async () => {
    getResponse = () => ({ ...OFF, settings: { ...OFF.settings, enabled: true }, status: { ...STATUS, limits: null } });
    await mount();
    expect(toggle().disabled).toBe(false);
    await click(toggle());
    expect(JSON.parse(String((putCalls()[0][1] as RequestInit).body))).toEqual({ enabled: false });
  });

  it('toggling calls PUT with enabled: true and shows the new state', async () => {
    const success = vi.spyOn(toast, 'success').mockImplementation(() => {});
    await mount();
    getResponse = () => ({ ...OFF, settings: { ...OFF.settings, enabled: true } });
    await click(toggle());
    expect(putCalls()).toHaveLength(1);
    const [path, init] = putCalls()[0] as [string, RequestInit];
    expect(path).toBe('/api/workspaces/ws1/ai-search');
    expect(JSON.parse(String(init.body))).toEqual({ enabled: true });
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(success).toHaveBeenCalled();
  });

  it('a member without change_ai_search sees the controls disabled with the reason', async () => {
    getResponse = () => ({ ...OFF, can_edit: false });
    await mount();
    expect(toggle().disabled).toBe(true);
    expect(text()).toContain("You don't have permission to change AI search");
  });

  it('shows no status card while on, only a link to the dashboard', async () => {
    getResponse = () => ({ ...OFF, settings: { ...OFF.settings, enabled: true }, status: { ...STATUS, capped: 4, paused: true } });
    await mount();
    for (const label of ['Indexed', 'Waiting', 'Partial', 'Not supported', 'Paused', 'Images', 'Documents', '120 of 2000']) expect(text()).not.toContain(label);
    expect(container!.querySelector('[role="progressbar"]')).toBeNull();
    expect(container!.querySelector('[role="status"]')).toBeNull();
    const link = container!.querySelector<HTMLAnchorElement>('a[href="/"]');
    expect(link?.textContent).toBe('See indexing status on the dashboard');
  });

  it('lists excluded folders by name and removes one with PUT', async () => {
    getResponse = () => ({ ...OFF, settings: { ...OFF.settings, excluded_folders: ['d1', 'd2'] } });
    await mount();
    expect(text()).toContain('Folder d1');
    expect(text()).toContain('Folder d2');
    const remove = container!.querySelectorAll<HTMLButtonElement>('button[aria-label="Remove"]')[0];
    await click(remove);
    expect(JSON.parse(String((putCalls()[0][1] as RequestInit).body))).toEqual({ excluded_folders: ['d2'] });
  });

  it('opens the shared folder picker from Add folder', async () => {
    await mount();
    const add = [...container!.querySelectorAll('button')].find((b) => /Add folder/.test(b.textContent ?? ''))!;
    await click(add);
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Exclude folders');
  });

  it('a refused enable says why and keeps the switch off', async () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => {});
    putResponse = () => { throw new ApiError(402, JSON.stringify({ ok: false, error: 'ai_search_not_in_plan' })); };
    await mount();
    await click(toggle());
    expect(error).toHaveBeenCalledWith(expect.any(String), 'AI search is available on paid plans');
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });
});
