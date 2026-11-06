import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

// The workspace dashboard's AI search card (rendered beside Storage
// breakdown in pages/dashboard.tsx). Only `api` is faked.
const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { AiSearchCard } = await import('@/components/dashboard/ai-search-card');

const LIMITS = { vectorBudget: 22000, imagesMax: 2000, documentsMax: 1000, docChunksMax: 20000, backfillUnits: 5000, monthUnits: 1000 };
const STATUS = {
  files_total: 40, indexed: 1234, pending: 6, partial: 2, unsupported: 1, capped: 0, failed: 1, images: 120, documents: 45, chunks: 300,
  limits: LIMITS as typeof LIMITS | null, backfill_units_remaining: 100, month_units_remaining: 100, month_reset_at: null,
  estimated_finish_at: null, paused: false,
};
const OFF = { ok: true, settings: { enabled: false, index_existing: true, excluded_folders: [] as string[] }, status: STATUS, can_edit: true };
const ON = { ...OFF, settings: { ...OFF.settings, enabled: true } };

let response: unknown = OFF;

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  response = OFF;
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => path === '/api/workspaces/ws1/ai-search' ? Promise.resolve(response) : Promise.reject(new Error(`unexpected ${path}`)));
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<MemoryRouter><AiSearchCard wsId="ws1" /></MemoryRouter>); });
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
}

const text = () => container!.textContent ?? '';
const card = () => container!.querySelector('[data-testid="dashboard-ai-search"]');

describe('dashboard AI search card', () => {
  it('off, for someone who can edit: the description and a Turn on link to Settings', async () => {
    await mount();
    expect(card()).toBeTruthy();
    expect(text()).toContain('AI search');
    expect(text()).toContain('Search inside documents and photos, not just file names.');
    const turnOn = [...container!.querySelectorAll('a')].find((a) => a.textContent === 'Turn on');
    expect(turnOn?.getAttribute('href')).toBe('/settings#section-ai');
    expect(text()).not.toContain('Indexed');
  });

  it('off, for someone who cannot edit: no Turn on link', async () => {
    response = { ...OFF, can_edit: false };
    await mount();
    expect(card()).toBeTruthy();
    expect(text()).not.toContain('Turn on');
  });

  it('on: indexed and waiting counts, the two bars and a link to Settings', async () => {
    response = ON;
    await mount();
    expect(text()).toContain('Indexed');
    expect(text()).toContain('1,234');
    expect(text()).toContain('Waiting');
    expect(text()).toContain('Images');
    expect(text()).toContain('120 of 2,000');
    expect(text()).toContain('Documents');
    expect(text()).toContain('45 of 1,000');
    expect(container!.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
    expect(container!.querySelector('a[href="/settings#section-ai"]')?.textContent).toBe('Manage');
    expect(container!.querySelector('[role="status"]')).toBeNull();
  });

  it('on and at a plan limit: Paused: limit reached', async () => {
    response = { ...ON, status: { ...STATUS, capped: 3 } };
    await mount();
    expect(container!.querySelector('[role="status"]')?.textContent).toBe('Paused: limit reached');
  });

  it('on and paused platform-wide: Paused by dosya', async () => {
    response = { ...ON, status: { ...STATUS, paused: true } };
    await mount();
    expect(container!.querySelector('[role="status"]')?.textContent).toBe('Paused by dosya');
  });

  it('renders nothing when the owner plan has no AI search (limits null)', async () => {
    response = { ...ON, status: { ...STATUS, limits: null } };
    await mount();
    expect(card()).toBeNull();
    expect(text()).toBe('');
  });

  it('renders nothing when the request fails', async () => {
    apiMock.mockImplementation(() => Promise.reject(new Error('boom')));
    await mount();
    expect(text()).toBe('');
  });
});
