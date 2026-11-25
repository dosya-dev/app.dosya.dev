import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApiError } from '@/api/client';

/**
 * A plan paid through a store (or a store plus Stripe conflict) cannot be bought
 * or changed here: the API answers 409 with a code, and the chooser hands the
 * user to /billing, which renders the locked or conflict layout.
 */

const startCheckout = vi.fn();
const updateSubscription = vi.fn(async (): Promise<unknown> => ({ ok: true }));

vi.mock('@/api/billing', () => ({
  getCatalog: async () => ({
    plans: [
      { id: 'starter', name: 'Starter', storage_bytes: 100 * 1024 ** 3, storage_label: '100 GB', price_monthly: 399, price_yearly: null, has_monthly: true, has_yearly: false },
      { id: 'plus', name: 'Plus', storage_bytes: 500 * 1024 ** 3, storage_label: '500 GB', price_monthly: 999, price_yearly: null, has_monthly: true, has_yearly: false },
    ],
    addons: [{ id: 'addon_100gb', name: '100 GB', storage_bytes: 100 * 1024 ** 3, price_monthly: 199, price_yearly: null, has_monthly: true, has_yearly: false }],
  }),
  startCheckout: (...a: unknown[]) => startCheckout(...a),
  updateSubscription: () => updateSubscription(),
  previewSubscription: async () => ({ amount_due: 0, currency: 'usd' }),
  validateCoupon: async () => { throw new Error('no'); },
}));

import { PlanChooser } from './plan-chooser';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

const realLocation = window.location;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  startCheckout.mockReset(); updateSubscription.mockReset();
  sessionStorage.clear();
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true });
});

async function render(props: Record<string, unknown> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <PlanChooser
        hasSubscription
        currentPlanId="plus"
        usedBytes={10 * 1024 ** 3}
        limitBytes={600 * 1024 ** 3}
        initial={{ interval: 'month', planId: 'plus', addonQty: { addon_100gb: 1 } }}
        onUpdated={() => {}}
        onClose={() => {}}
        onEditReservations={() => {}}
        {...props}
      />,
    );
  });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

function button(text: string) {
  return [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
}

async function click(text: string) {
  const el = button(text);
  expect(el, `no button matching ${text}`).toBeDefined();
  await act(async () => { el!.click(); await Promise.resolve(); });
}

const refusal = (code: string) => new ApiError(409, JSON.stringify({ ok: false, error: 'Your plan is managed in the store.', code }));

describe.each(['store_subscription_active', 'billing_conflict'])('plan chooser 409 %s', (code) => {
  it('closes and sends the browser to /billing without an inline error', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...realLocation, assign }, configurable: true });
    updateSubscription.mockRejectedValue(refusal(code));
    const onClose = vi.fn();
    await render({ onClose });
    await click('Update subscription');
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(onClose).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/billing');
    expect(container!.textContent).not.toContain('managed in the store');
  });
});
