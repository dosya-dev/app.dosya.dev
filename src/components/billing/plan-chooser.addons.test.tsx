import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Add-ons grouped by what they sell: storage, family places and Smart Search
 * room. The Smart Search group follows the selected plan's limits and is
 * absent on a plan without them.
 */
const GB = 1024 ** 3;
const updateSubscription = vi.fn(async (_cart?: Record<string, unknown>) => ({ ok: true }));
const plan = (id: string, name: string, bytes: number, monthly: number, ai: [number, number] | null) => ({
  id, name, storage_bytes: bytes, storage_label: `${bytes / GB} GB`, price_monthly: monthly, price_yearly: monthly * 10,
  has_monthly: true, has_yearly: true, features: [], ai_images_max: ai?.[0] ?? null, ai_documents_max: ai?.[1] ?? null,
});
const addon = (id: string, name: string, kind: string, extra: Record<string, unknown>) => ({
  id, name, kind, storage_bytes: 0, storage_label: '0 MB', price_monthly: 200, price_yearly: 2000, max_quantity: 10, has_monthly: true, has_yearly: true, ...extra,
});
vi.mock('@/api/billing', () => ({
  getCatalog: async () => ({
    currency: 'usd', currencies: ['usd'],
    plans: [plan('starter', 'Starter', 100 * GB, 399, [10000, 2000]), plan('plus', 'Plus', 500 * GB, 999, [50000, 10000]), plan('legacy', 'Legacy', 300 * GB, 799, null)],
    addons: [
      addon('addon_100gb', '+100 GB', 'storage', { storage_bytes: 100 * GB, storage_label: '100 GB', max_quantity: 50 }),
      addon('family_places', 'Extra family places', 'family_places', { price_monthly: 100, price_yearly: 1000 }),
      addon('ai_photos', '+10,000 photos', 'ai_photos', { ai_units: 10000 }),
      addon('ai_documents', '+2,000 documents', 'ai_documents', { ai_units: 2000 }),
    ],
  }),
  startCheckout: vi.fn(),
  updateSubscription: (cart: unknown) => updateSubscription(cart as Record<string, unknown>),
  previewSubscription: async () => ({ amount_due: 0, currency: 'usd' }),
  validateCoupon: async () => { throw new Error('no'); },
}));

import { PlanChooser } from './plan-chooser';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; updateSubscription.mockReset(); });

async function render(planId = 'plus', addonQty: Record<string, number> = {}) {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => {
    root!.render(<PlanChooser hasSubscription currentPlanId="plus" usedBytes={10 * GB} initial={{ interval: 'month', planId, addonQty }} onUpdated={() => {}} onClose={() => {}} />);
  });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}
const q = (sel: string) => container!.querySelector<HTMLElement>(sel);
const clickPlus = async (id: string) => { await act(async () => { q(`[data-addon-id="${id}"] button[aria-label^="Add"]`)!.click(); }); };

describe('add-on groups', () => {
  it('shows storage, family and Smart Search groups with the blocks named by what they add', async () => {
    await render();
    expect(q('[data-testid="addon-group-storage"]')!.textContent).toContain('+100 GB');
    expect(q('[data-testid="addon-group-family"]')!.textContent).toContain('+1 family place');
    expect(q('[data-testid="addon-group-family"]')!.textContent).toContain('up to 10 more');
    const ai = q('[data-testid="addon-group-smart-search"]')!;
    expect(ai.textContent).toContain('+10,000 photos');
    expect(ai.textContent).toContain('+2,000 documents');
    expect(ai.textContent).toContain('10,000 photos each');
    expect(q('[data-testid="smart-search-summary"]')!.textContent).toBe('Smart Search after this change: 50,000 photos · 10,000 documents per workspace');
  });

  it('adds the units to the plan limits in the summary and sends them in the cart', async () => {
    await render();
    await clickPlus('ai_photos'); await clickPlus('ai_photos'); await clickPlus('ai_documents');
    expect(q('[data-testid="smart-search-summary"]')!.textContent).toContain('70,000 photos · 12,000 documents');
    expect(q('[data-addon-id="ai_photos"]')!.textContent).toContain('20,000 photos added');
    expect(q('[data-addon-id="ai_photos"]')!.textContent).toContain('$4/mo');
    await act(async () => { [...container!.querySelectorAll('button')].find((b) => b.textContent === 'Update subscription')!.click(); });
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
    const cart = updateSubscription.mock.calls[0][0]!;
    expect(cart.addons).toEqual(expect.arrayContaining([{ id: 'ai_photos', qty: 2 }, { id: 'ai_documents', qty: 1 }]));
  });

  it('hides the Smart Search group on a plan without limits and keeps the storage bar storage-only', async () => {
    await render('legacy', { ai_photos: 1, addon_100gb: 1 });
    expect(q('[data-testid="addon-group-smart-search"]')).toBeNull();
    expect(q('[data-testid="addon-group-family"]')).not.toBeNull();
    expect(container!.querySelectorAll('[data-kind="addon"]')).toHaveLength(1);
    expect(q('[data-testid="storage-composition"]')!.textContent).toContain('400 GB total');
  });
});
