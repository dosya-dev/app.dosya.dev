import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApiError } from '@/api/client';

/**
 * A payer who reserved family storage cannot change to a plan smaller than the
 * reservations: the API answers 409 family_reservations_exceed_plan and the
 * chooser explains it, offering to edit the reservations or keep the plan.
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  startCheckout.mockReset(); updateSubscription.mockReset();
  sessionStorage.clear();
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

const GBn = 1024 ** 3;
const refusal = () => new ApiError(409, JSON.stringify({
  ok: false, error: 'You have reserved 350 GB for your family, and this change leaves 100 GB. Lower the reservations first.',
  code: 'family_reservations_exceed_plan', reserved_bytes: 350 * GBn, new_storage_bytes: 100 * GBn,
}));
const dialogEl = () => document.body.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement | null;

describe('plan chooser and family reservations', () => {
  async function refuse(props: Record<string, unknown> = {}) {
    updateSubscription.mockRejectedValue(refusal());
    await render(props);
    await click('Starter');
    await act(async () => { container!.querySelector<HTMLInputElement>('#confirm-downgrade')!.click(); await Promise.resolve(); });
    await click('Update subscription');
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
  }

  it('a plan smaller than the reservations opens Reservations don’t fit', async () => {
    await refuse();
    const d = dialogEl();
    expect(d).not.toBeNull();
    expect(d!.textContent).toContain('Reservations don’t fit');
    expect(d!.textContent).toContain('Your family has 350 GB reserved, which is more than the 100 GB on Starter. Lower or remove reservations, then change plan.');
    const labels = [...d!.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toContain('Edit reservations');
    expect(labels).toContain('Keep Plus');
    // The refusal is explained by the dialog, not repeated as an inline error.
    expect(container!.textContent).not.toContain('Lower the reservations first.');
  });

  it('Edit reservations hands over to the Family card', async () => {
    const onEditReservations = vi.fn();
    await refuse({ onEditReservations });
    await act(async () => { [...dialogEl()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Edit reservations')!.click(); });
    expect(onEditReservations).toHaveBeenCalled();
  });

  it('Keep Plus closes the chooser without changing anything', async () => {
    const onClose = vi.fn();
    await refuse({ onClose });
    await act(async () => { [...dialogEl()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Keep Plus')!.click(); });
    expect(onClose).toHaveBeenCalled();
    expect(updateSubscription).toHaveBeenCalledTimes(1);
  });

  it('any other refusal still shows inline', async () => {
    updateSubscription.mockRejectedValue(new ApiError(400, JSON.stringify({ ok: false, error: 'Something else' })));
    await render();
    await click('Update subscription');
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(dialogEl()).toBeNull();
    expect(container!.textContent).toContain('Something else');
  });
});
