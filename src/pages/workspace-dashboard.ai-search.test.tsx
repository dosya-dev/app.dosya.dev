import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * The account workspace dashboard (/workspaces) shows AI search usage: the
 * account pool card in the right column and, per owned workspace, an AI index
 * line under the storage line. Both come from one GET /api/me/ai-search.
 */

const api = vi.fn();

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => api(...args) };
});

import WorkspaceDashboardPage from './workspace-dashboard';
import { AiIndexDonut } from '@/components/workspaces/ai-index-donut';

const GB = 1024 ** 3;
const LIMITS = { vectorBudget: 250000, imagesMax: 150000, documentsMax: 20000, docChunksMax: 100000, backfillUnits: 375000, monthUnits: 50000 };

const DASHBOARD = {
  ok: true,
  total: { limit_bytes: 100 * GB, used_bytes: 30 * GB, free_bytes: 70 * GB },
  sources: [{ kind: 'plan', label: 'Pro plan', bytes: 100 * GB, meta: {} }],
  owned: [
    { id: 'ws_a', name: 'Studio', icon_initials: 'ST', icon_color: '#123456', icon_image_url: null, used_bytes: 20 * GB, share_pct: 67 },
    { id: 'ws_b', name: 'Personal', icon_initials: 'PE', icon_color: '#654321', icon_image_url: null, used_bytes: 10 * GB, share_pct: 33 },
  ],
  shared: [],
};

function account(overrides: { pool?: Record<string, unknown>; studio?: Record<string, unknown> } = {}) {
  return {
    ok: true,
    pool: {
      limits: LIMITS, backfill_units_remaining: 300000, backfill_units_total: 375000,
      month_units_remaining: 38000, month_units_total: 50000, month_reset_at: 1_793_318_400,
      payer_is_family: false, paused: false, ...overrides.pool,
    },
    workspaces: [
      { id: 'ws_a', name: 'Studio', enabled: true, indexed: 900, pending: 12, images: 1200, documents: 30, images_max: 150000, documents_max: 20000, paused_reason: null, ...overrides.studio },
      { id: 'ws_b', name: 'Personal', enabled: false, indexed: 0, pending: 0, images: 0, documents: 0, images_max: 150000, documents_max: 20000, paused_reason: null },
    ],
  };
}

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  api.mockReset();
});

async function mount(ai: unknown) {
  api.mockImplementation((path: string) => {
    if (path === '/api/workspace-dashboard') return Promise.resolve(DASHBOARD);
    if (path === '/api/me/ai-search') return ai === 'reject' ? Promise.reject(new Error('boom')) : Promise.resolve(ai);
    return Promise.resolve({ ok: true });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<MemoryRouter><WorkspaceDashboardPage /></MemoryRouter>); });
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
}

const card = () => container!.querySelector<HTMLElement>('[data-testid="workspaces-ai-search"]');
const lines = () => [...container!.querySelectorAll<HTMLElement>('[data-testid="ws-ai-line"]')];
const rowOf = (name: string) => [...container!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(name))!;

describe('workspace dashboard AI search', () => {
  it('fetches the account AI usage once for the page', async () => {
    await mount(account());
    expect(api.mock.calls.filter(([p]) => p === '/api/me/ai-search')).toHaveLength(1);
  });

  it('shows the pool card: backfill remaining, this month with the reset date', async () => {
    await mount(account());
    const c = card()!;
    expect(c).toBeTruthy();
    expect(c.textContent).toContain('AI search');
    expect(c.textContent).toContain('Backfill remaining');
    expect(c.textContent).toContain('300,000 of 375,000');
    expect(c.textContent).toContain('This month');
    expect(c.textContent).toContain('12,000 of 50,000');
    expect(c.textContent).toMatch(/Resets \w+ \d+, \d{4}/);
    expect(c.textContent).not.toContain('Family pool');
    expect(c.textContent).not.toContain('Paused by dosya');
  });

  it('adds an AI line under each owned workspace, joined by id', async () => {
    await mount(account());
    expect(lines()).toHaveLength(2);
    const studio = rowOf('Studio').querySelector('[data-testid="ws-ai-line"]')!;
    expect(studio.textContent).toContain('AI index: 1,200 images · 30 documents');
    expect(studio.querySelector('[data-testid="ws-ai-state"]')!.textContent).toBe('Indexing');
    const personal = rowOf('Personal').querySelector('[data-testid="ws-ai-line"]')!;
    expect(personal.textContent).toBe('AI search off');
    expect(personal.querySelector('[data-testid="ws-ai-state"]')).toBeNull();
  });

  it('uses the singular for one image and one document', async () => {
    await mount(account({ studio: { images: 1, documents: 1 } }));
    expect(rowOf('Studio').textContent).toContain('AI index: 1 image · 1 document');
  });

  it('pills a workspace paused at a limit', async () => {
    await mount(account({ studio: { paused_reason: 'limit' } }));
    expect(rowOf('Studio').querySelector('[data-testid="ws-ai-state"]')!.textContent).toBe('Paused: limit reached');
  });

  it('shows Paused by dosya on the card and every enabled row when the platform pauses', async () => {
    await mount(account({ pool: { paused: true } }));
    expect(card()!.textContent).toContain('Paused by dosya');
    expect(rowOf('Studio').querySelector('[data-testid="ws-ai-state"]')!.textContent).toBe('Paused by dosya');
    expect(rowOf('Personal').textContent).toContain('AI search off');
  });

  it('marks a family member pool', async () => {
    await mount(account({ pool: { payer_is_family: true } }));
    expect(card()!.textContent).toContain('Family pool');
  });

  it('hides the card and every AI line when the plan has no AI search (limits null)', async () => {
    await mount(account({ pool: { limits: null } }));
    expect(container!.textContent).toContain('Workspaces you own');
    expect(card()).toBeNull();
    expect(lines()).toHaveLength(0);
  });

  it('hides the card and the lines when the request fails', async () => {
    await mount('reject');
    expect(container!.textContent).toContain('Studio');
    expect(card()).toBeNull();
    expect(lines()).toHaveLength(0);
  });
});

// ── AI index by workspace donut ───────────────────────────

function wsRow(id: string, name: string, images: number, documents: number, enabled = true) {
  return { id, name, enabled, indexed: images + documents, pending: 0, images, documents, images_max: 150000, documents_max: 20000, paused_reason: null };
}

function withWorkspaces(workspaces: unknown[]) {
  return { ...account(), workspaces };
}

const donut = () => card()!.querySelector<HTMLElement>('[data-testid="ai-index-donut"]')!;
const slices = () => [...donut().querySelectorAll<SVGElement>('[data-testid="ai-donut-slice"]')];
const legendRows = () => [...donut().querySelectorAll<HTMLElement>('[data-testid="ai-donut-legend-row"]')];
const tooltip = () => donut().querySelector<HTMLElement>('[data-testid="ai-donut-tooltip"]');

describe('workspace dashboard AI index donut', () => {
  it('draws one slice per workspace with its share of indexed items, largest first, above the pool meters', async () => {
    await mount(withWorkspaces([wsRow('ws_c', 'Clients', 80, 20), wsRow('ws_a', 'Studio', 500, 100), wsRow('ws_b', 'Personal', 250, 50)]));
    const c = card()!;
    expect(c.textContent!.indexOf('1,000')).toBeLessThan(c.textContent!.indexOf('Backfill remaining'));
    expect(slices().map((s) => [s.getAttribute('data-key'), s.getAttribute('data-share')])).toEqual([
      ['ws_a', '0.6000'], ['ws_b', '0.3000'], ['ws_c', '0.1000'],
    ]);
    expect(donut().querySelector('[data-testid="ai-donut-total"]')!.textContent).toBe('1,000');
    expect(donut().textContent).toContain('indexed');
    expect(legendRows().map((r) => r.textContent)).toEqual(['Studio600', 'Personal300', 'Clients100']);
    // Each slice keeps a distinct colour slot.
    const colours = slices().map((s) => s.style.getPropertyValue('--slice-l'));
    expect(new Set(colours).size).toBe(3);
  });

  it('leaves out a workspace with nothing indexed, enabled or not', async () => {
    await mount(withWorkspaces([wsRow('ws_a', 'Studio', 10, 0), wsRow('ws_b', 'Personal', 0, 0, false), wsRow('ws_c', 'Empty', 0, 0)]));
    expect(slices()).toHaveLength(1);
    expect(legendRows().map((r) => r.textContent)).toEqual(['Studio10']);
  });

  it('folds everything after the six largest into a grey Other slice', async () => {
    const rows = Array.from({ length: 9 }, (_, i) => wsRow(`ws_${i}`, `W${i}`, 100 - i * 10, 0));
    await mount(withWorkspaces(rows));
    const keys = slices().map((s) => s.getAttribute('data-key'));
    expect(keys).toHaveLength(7);
    expect(keys.slice(0, 6)).toEqual(['ws_0', 'ws_1', 'ws_2', 'ws_3', 'ws_4', 'ws_5']);
    expect(keys[6]).toBe('__other');
    expect(legendRows()).toHaveLength(7);
    expect(legendRows()[6].textContent).toBe('Other' + String(40 + 30 + 20));
    expect(slices()[6].style.getPropertyValue('--slice-l')).toBe('#71717a');
    // Six named hues, none repeated, none grey.
    const named = slices().slice(0, 6).map((s) => s.style.getPropertyValue('--slice-l'));
    expect(new Set(named).size).toBe(6);
    expect(named).not.toContain('#71717a');
  });

  it('shows the workspace images, documents and share on hover, and highlights from the legend', async () => {
    await mount(withWorkspaces([wsRow('ws_a', 'Studio', 1200, 30), wsRow('ws_b', 'Personal', 1, 1)]));
    expect(tooltip()).toBeNull();
    const restWidth = Number(slices()[0].getAttribute('stroke-width'));
    await act(async () => { slices()[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    const tip = tooltip()!;
    expect(tip.textContent).toContain('Studio');
    expect(tip.textContent).toContain('1,200 images');
    expect(tip.textContent).toContain('30 documents');
    expect(tip.textContent).toContain('100% of the AI index');
    expect(Number(slices()[0].getAttribute('stroke-width'))).toBe(restWidth + 2);
    await act(async () => { slices()[0].dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
    expect(tooltip()).toBeNull();

    await act(async () => { legendRows()[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(tooltip()!.textContent).toContain('Personal');
    expect(tooltip()!.textContent).toContain('1 image');
    expect(tooltip()!.textContent).toContain('1 document');
    expect(Number(slices()[1].getAttribute('stroke-width'))).toBe(restWidth + 2);
    expect(Number(slices()[0].getAttribute('stroke-width'))).toBe(restWidth);
  });

  it('shows the same tooltip when a slice takes keyboard focus', async () => {
    await mount(withWorkspaces([wsRow('ws_a', 'Studio', 30, 10), wsRow('ws_b', 'Personal', 5, 5)]));
    const second = slices()[1];
    expect(second.getAttribute('tabindex')).toBe('0');
    await act(async () => { second.focus(); });
    expect(tooltip()!.textContent).toContain('Personal');
    expect(tooltip()!.textContent).toContain('5 images');
    expect(tooltip()!.textContent).toContain('5 documents');
    expect(tooltip()!.textContent).toContain('20% of the AI index');
    await act(async () => { second.blur(); });
    expect(tooltip()).toBeNull();
  });

  it('labels the chart as a group and every slice as its own named img', async () => {
    await mount(withWorkspaces([wsRow('ws_a', 'Studio', 60, 0), wsRow('ws_b', 'Personal', 0, 40)]));
    const svg = donut().querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('group');
    expect(svg.getAttribute('aria-label')).toBe('AI index by workspace: Studio 60%, Personal 40%');
    expect(slices().map((s) => [s.getAttribute('role'), s.getAttribute('tabindex'), s.getAttribute('aria-label')])).toEqual([
      ['img', '0', 'Studio, 60 images, 0 documents, 60% of the AI index'],
      ['img', '0', 'Personal, 0 images, 40 documents, 40% of the AI index'],
    ]);
  });

  it('keeps a tiny slice visible: minimum arc, no gap eaten, still 360 degrees', async () => {
    await mount(withWorkspaces([wsRow('ws_a', 'Big', 980, 0), wsRow('ws_b', 'Mid', 15, 0), wsRow('ws_c', 'Tiny', 5, 0)]));
    const paths = slices();
    expect(paths.map((p) => p.tagName.toLowerCase())).toEqual(['path', 'path', 'path']);
    const R = 61;
    const painted = paths.map((p) => {
      const n = p.getAttribute('d')!.split(' ');
      const [x0, y0, large, x1, y1] = [Number(n[1]), Number(n[2]), n[7], Number(n[9]), Number(n[10])];
      const half = Math.asin(Math.min(1, Math.hypot(x1 - x0, y1 - y0) / (2 * R)));
      return R * (large === '1' ? 2 * Math.PI - 2 * half : 2 * half);
    });
    // Every painted arc is at least the 3 px minimum (the tiny one is not trimmed by the gap).
    for (const len of painted) expect(len).toBeGreaterThanOrEqual(2.99);
    expect(painted[2]).toBeCloseTo(3, 1);
    const sweeps = paths.map((p) => Number(p.getAttribute('data-sweep')));
    expect(sweeps.reduce((a, b) => a + b, 0)).toBeCloseTo(2 * Math.PI, 5);
    // The tiny slice was raised to the minimum; its true share is unchanged.
    expect(paths[2].getAttribute('data-share')).toBe('0.0050');
    expect(sweeps[2]).toBeCloseTo(3 / R, 5);
  });

  it('draws a single workspace as a full circle', async () => {
    await mount(withWorkspaces([wsRow('ws_a', 'Studio', 7, 3)]));
    expect(slices()).toHaveLength(1);
    expect(slices()[0].tagName.toLowerCase()).toBe('circle');
    expect(slices()[0].getAttribute('aria-label')).toBe('Studio, 7 images, 3 documents, 100% of the AI index');
  });

  it('closes a hover tooltip on Escape and bounds it under the ring', async () => {
    await mount(withWorkspaces([wsRow('ws_a', 'A very long workspace name that goes on and on', 30, 10), wsRow('ws_b', 'Personal', 5, 5)]));
    await act(async () => { slices()[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    const tip = tooltip()!;
    expect(tip.className).toContain('max-w-[220px]');
    expect(tip.querySelector('[data-testid="ai-donut-tooltip-name"]')!.className).toContain('truncate');
    expect(tip.style.top).toBe('146px');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(tooltip()).toBeNull();
  });

  it('draws a focus ring under a slice focused from the keyboard', async () => {
    await mount(withWorkspaces([wsRow('ws_a', 'Studio', 30, 10), wsRow('ws_b', 'Personal', 5, 5)]));
    expect(donut().querySelector('[data-testid="ai-donut-focus-ring"]')).toBeNull();
    await act(async () => { slices()[1].focus(); });
    const ring = donut().querySelector('[data-testid="ai-donut-focus-ring"]')!;
    expect(ring).not.toBeNull();
    expect(ring.getAttribute('d')).toBe(slices()[1].getAttribute('d'));
    await act(async () => { slices()[1].blur(); });
    expect(donut().querySelector('[data-testid="ai-donut-focus-ring"]')).toBeNull();
  });

  it('shows an empty muted ring with "Nothing indexed yet" when nothing is indexed', async () => {
    await mount(withWorkspaces([wsRow('ws_a', 'Studio', 0, 0), wsRow('ws_b', 'Personal', 0, 0, false)]));
    expect(slices()).toHaveLength(0);
    expect(donut().querySelector('[data-testid="ai-donut-empty-ring"]')).not.toBeNull();
    expect(donut().querySelector('[data-testid="ai-donut-empty"]')!.textContent).toBe('Nothing indexed yet');
    expect(donut().querySelector('[data-testid="ai-donut-legend"]')).toBeNull();
    expect(donut().querySelector('svg')!.getAttribute('aria-label')).toBe('Nothing indexed yet');
  });
});

describe('AI index donut colour stability', () => {
  type Row = ReturnType<typeof wsRow>;
  async function renderDonut(rows: Row[]) {
    if (!root) {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    }
    await act(async () => { root!.render(<AiIndexDonut workspaces={rows} />); });
  }
  const colourByKey = () => Object.fromEntries(
    [...container!.querySelectorAll<SVGElement>('[data-testid="ai-donut-slice"]')].map((s) => [s.getAttribute('data-key'), s.style.getPropertyValue('--slice-l')]),
  );
  const unmount = () => { act(() => root!.unmount()); container!.remove(); root = null; container = null; };

  it('keeps every workspace colour when the values change on a re-render', async () => {
    await renderDonut([wsRow('ws_a', 'A', 50, 0), wsRow('ws_b', 'B', 30, 0), wsRow('ws_c', 'C', 20, 0)]);
    const before = colourByKey();
    await renderDonut([wsRow('ws_a', 'A', 5, 0), wsRow('ws_b', 'B', 300, 0), wsRow('ws_c', 'C', 90, 0)]);
    expect(container!.querySelector('[data-testid="ai-donut-slice"]')!.getAttribute('data-key')).toBe('ws_b');
    expect(colourByKey()).toEqual(before);
  });

  it('gives the same colours on a fresh mount where the ranks are swapped (slots follow id order)', async () => {
    await renderDonut([wsRow('ws_a', 'A', 50, 0), wsRow('ws_b', 'B', 30, 0), wsRow('ws_c', 'C', 20, 0)]);
    const first = colourByKey();
    unmount();
    await renderDonut([wsRow('ws_c', 'C', 500, 0), wsRow('ws_b', 'B', 300, 0), wsRow('ws_a', 'A', 1, 0)]);
    expect(colourByKey()).toEqual(first);
    // id order: ws_a -> slot 0, ws_b -> slot 1, ws_c -> slot 2.
    expect(first).toEqual({ ws_a: '#06b6d4', ws_b: '#be185d', ws_c: '#6d28d9' });
  });
});
