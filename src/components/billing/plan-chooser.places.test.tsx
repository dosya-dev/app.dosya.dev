import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Extra family places are an add-on in the same catalog as storage, but they
 * are bought from the Family card, not here. The chooser must neither list
 * them nor drop them: a plan change sends the cart it was opened with, and
 * losing the places line would cancel what the customer pays for.
 */
const updateSubscription = vi.fn(async (_cart?: Record<string, unknown>) => ({ ok: true }));
vi.mock('@/api/billing', () => ({
  getCatalog: async () => ({
    plans: [
      { id: 'starter', name: 'Starter', storage_bytes: 100 * 1024 ** 3, storage_label: '100 GB', price_monthly: 399, price_yearly: null, has_monthly: true, has_yearly: false },
      { id: 'plus', name: 'Plus', storage_bytes: 500 * 1024 ** 3, storage_label: '500 GB', price_monthly: 999, price_yearly: null, has_monthly: true, has_yearly: false },
    ],
    addons: [
      { id: 'addon_100gb', name: '100 GB', kind: 'storage', storage_bytes: 100 * 1024 ** 3, storage_label: '100 GB', price_monthly: 199, price_yearly: null, max_quantity: 10, has_monthly: true, has_yearly: false },
      { id: 'family_places', name: 'Extra family places', kind: 'family_places', storage_bytes: 0, storage_label: '0 B', price_monthly: 100, price_yearly: null, max_quantity: 10, has_monthly: true, has_yearly: false },
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
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; updateSubscription.mockReset(); sessionStorage.clear(); });

async function render() {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<PlanChooser hasSubscription currentPlanId="starter" usedBytes={1} limitBytes={100 * 1024 ** 3}
      initial={{ interval: 'month', planId: 'starter', addonQty: { family_places: 2 } }} onUpdated={() => {}} onClose={() => {}} />);
  });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}
const button = (text: string) => [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('PlanChooser and family places', () => {
  it('does not list the places add-on', async () => {
    await render();
    expect(container!.textContent).toContain('100 GB');
    // No picker row for places ("$1/mo each"). The order summary still itemises
    // the bought places, because they are part of the total the plan change bills.
    expect(container!.textContent).not.toContain('$1/mo each');
  });

  it('keeps the bought places in the cart it sends on a plan change', async () => {
    await render();
    await act(async () => { button('Plus')!.click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    await act(async () => { button('Update subscription')!.click(); });
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
    expect(updateSubscription).toHaveBeenCalledTimes(1);
    const cart = updateSubscription.mock.calls[0][0]!;
    expect(cart.plan_id).toBe('plus');
    expect(cart.addons).toEqual(expect.arrayContaining([{ id: 'family_places', qty: 2 }]));
  });
});
