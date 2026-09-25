import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * A promotion code can be limited to one billing period. The chooser asks the
 * validate endpoint with the cart's interval so a refusal shows on Apply, and
 * it drops an applied code when the customer switches to a period the code
 * does not cover, so the total on screen never promises a discount checkout
 * would refuse.
 */
const validateCoupon = vi.fn();

vi.mock('@/api/billing', () => ({
  getCatalog: async () => ({
    plans: [
      { id: 'pro', name: 'Pro', storage_bytes: 1024 ** 4, storage_label: '1 TB', price_monthly: 1999, price_yearly: 19990, has_monthly: true, has_yearly: true },
    ],
    addons: [],
  }),
  startCheckout: async () => ({ ok: true, url: 'https://checkout.stripe.com/c/cs_1' }),
  updateSubscription: async () => ({ ok: true }),
  previewSubscription: async () => ({ amount_due: 0, currency: 'usd' }),
  validateCoupon: (...a: unknown[]) => validateCoupon(...a),
}));

import { ApiError } from '@/api/client';
import { PlanChooser } from './plan-chooser';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  validateCoupon.mockReset();
});

async function render(interval: 'month' | 'year' = 'year') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <PlanChooser
        hasSubscription={false}
        usedBytes={0}
        initial={{ interval, planId: 'pro', addonQty: {} }}
        onUpdated={() => {}}
        onClose={() => {}}
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

async function applyCode(code: string) {
  const input = container!.querySelector<HTMLInputElement>('input[placeholder="Enter code"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, code);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Apply');
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

const YEARLY_ONLY = { code: 'YEAR60', type: 'percent', value: 60, currency: null, duration: 'once', duration_in_months: null, intervals: ['year'] };

describe('plan chooser promo code billing interval', () => {
  it('validates the code against the cart interval and shows the discount', async () => {
    validateCoupon.mockResolvedValue(YEARLY_ONLY);
    await render('year');
    await applyCode('YEAR60');

    expect(validateCoupon).toHaveBeenCalledWith('YEAR60', 'year');
    expect(container!.textContent).toContain('Code YEAR60 applied');
    expect(container!.textContent).toContain('Discount');
  });

  it('shows the refusal the API gives for the wrong period', async () => {
    validateCoupon.mockRejectedValue(new ApiError(400, JSON.stringify({ error: 'This code is for yearly billing only.' })));
    await render('month');
    await applyCode('YEAR60');

    expect(validateCoupon).toHaveBeenCalledWith('YEAR60', 'month');
    expect(container!.textContent).toContain('This code is for yearly billing only.');
    expect(container!.textContent).not.toContain('applied');
  });

  it('drops a yearly-only code when the customer switches to monthly, and says why', async () => {
    validateCoupon.mockResolvedValue(YEARLY_ONLY);
    await render('year');
    await applyCode('YEAR60');
    expect(container!.textContent).toContain('Code YEAR60 applied');

    await click('Monthly');

    expect(container!.textContent).not.toContain('Code YEAR60 applied');
    expect(container!.textContent).toContain('Code YEAR60 removed: it is for yearly billing only.');
    expect(container!.textContent).not.toContain('Discount');
  });

  it('keeps an unrestricted code across the switch', async () => {
    validateCoupon.mockResolvedValue({ ...YEARLY_ONLY, code: 'ANY10', value: 10, intervals: null });
    await render('year');
    await applyCode('ANY10');
    await click('Monthly');

    expect(container!.textContent).toContain('Code ANY10 applied');
  });
});
