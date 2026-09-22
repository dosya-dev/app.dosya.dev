import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * The plan cards are labelled by size, and a 100 GB plan sits next to a 100 GB
 * add-on. On 2026-09-16 a customer meaning "add 100 GB" clicked the Starter
 * card and lost 400 GB with no warning. A smaller plan must now be named as a
 * replacement and confirmed before anything is sent.
 */

const startCheckout = vi.fn();
const updateSubscription = vi.fn(async (_cart?: Record<string, unknown>) => ({ ok: true }));

vi.mock('@/api/billing', () => ({
  getCatalog: async () => ({
    plans: [
      { id: 'starter', name: 'Starter', storage_bytes: 100 * 1024 ** 3, storage_label: '100 GB', price_monthly: 399, price_yearly: null, has_monthly: true, has_yearly: false },
      { id: 'plus', name: 'Plus', storage_bytes: 500 * 1024 ** 3, storage_label: '500 GB', price_monthly: 999, price_yearly: null, has_monthly: true, has_yearly: false },
    ],
    addons: [{ id: 'addon_100gb', name: '100 GB', storage_bytes: 100 * 1024 ** 3, price_monthly: 199, price_yearly: null, has_monthly: true, has_yearly: false }],
  }),
  startCheckout: (...a: unknown[]) => startCheckout(...a),
  updateSubscription: (cart: unknown) => updateSubscription(cart as Record<string, unknown>),
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

describe('plan chooser downgrade guard', () => {
  it('names what a smaller plan replaces and refuses to submit until confirmed', async () => {
    await render();
    await click('Starter');

    expect(container!.textContent).toContain('This replaces your Plus plan');
    expect(container!.textContent).toContain('Plus gives 500 GB');
    expect(container!.textContent).toContain('Starter gives 100 GB');
    expect(button('Update subscription')!.disabled).toBe(true);

    await click('Update subscription');
    expect(updateSubscription).not.toHaveBeenCalled();

    const confirm = container!.querySelector<HTMLInputElement>('#confirm-downgrade')!;
    await act(async () => { confirm.click(); await Promise.resolve(); });
    await click('Update subscription');

    expect(updateSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: 'starter', confirm_downgrade: true }),
    );
  });

  it('forgets the confirmation when the plan pick changes again', async () => {
    await render();
    await click('Starter');
    const confirm = container!.querySelector<HTMLInputElement>('#confirm-downgrade')!;
    await act(async () => { confirm.click(); await Promise.resolve(); });
    expect(button('Update subscription')!.disabled).toBe(false);

    await click('Plus');
    await click('Starter');

    expect(container!.querySelector<HTMLInputElement>('#confirm-downgrade')!.checked).toBe(false);
    expect(button('Update subscription')!.disabled).toBe(true);
  });

  it('adds storage on the current plan without any confirmation', async () => {
    await render();

    expect(container!.querySelector('#confirm-downgrade')).toBeNull();
    await click('Update subscription');

    expect(updateSubscription).toHaveBeenCalledWith(expect.objectContaining({ plan_id: 'plus' }));
    expect(updateSubscription.mock.calls[0][0]).not.toHaveProperty('confirm_downgrade');
  });

  it('hides the plan cards when opened from Add storage', async () => {
    await render({ mode: 'addons' });

    expect(container!.textContent).toContain('Add storage to your Plus plan');
    expect(button('Starter')).toBeUndefined();
    expect(container!.textContent).not.toContain('Picking a plan replaces your current one');
  });

  it('explains that picking a plan replaces the current one', async () => {
    await render();
    expect(container!.textContent).toContain('Picking a plan replaces your current one');
  });
});
