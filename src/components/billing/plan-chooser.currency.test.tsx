import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Before the first subscription the chooser offers dollars or euros when the
 * catalog sells both. The pick reprices the whole cart from the catalog in that
 * currency, is remembered for the next visit, and travels with the checkout. A
 * fixed-amount code in the other currency cannot discount this cart, so it is
 * dropped with a reason rather than shown as a discount checkout would refuse.
 */
const plan = (price: number, yearly: number) => ({
  id: 'pro', name: 'Pro', storage_bytes: 1024 ** 4, storage_label: '1 TB', price_monthly: price, price_yearly: yearly, has_monthly: true, has_yearly: true,
});
const USD_CATALOG = { ok: true, currency: 'usd', currencies: ['usd', 'eur'], plans: [plan(399, 3990)], addons: [] };
const EUR_CATALOG = { ok: true, currency: 'eur', currencies: ['usd', 'eur'], plans: [plan(349, 3499)], addons: [] };

const getCatalog = vi.fn(async (c?: string) => (c === 'eur' ? EUR_CATALOG : USD_CATALOG));
const startCheckout = vi.fn<(cart: unknown) => Promise<{ ok: true; url: string }>>(async () => ({ ok: true, url: '#checkout' }));
const validateCoupon = vi.fn();

vi.mock('@/api/billing', () => ({
  getCatalog: (c?: string) => getCatalog(c),
  startCheckout: (cart: unknown) => startCheckout(cart),
  updateSubscription: async () => ({ ok: true }),
  previewSubscription: async () => ({ amount_due: 0, currency: 'usd' }),
  validateCoupon: (...a: unknown[]) => validateCoupon(...a),
}));

import { PlanChooser } from './plan-chooser';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  getCatalog.mockClear();
  startCheckout.mockClear();
  validateCoupon.mockReset();
  try { localStorage.clear(); } catch { /* ignore */ }
});

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

async function render(hasSubscription = false) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <PlanChooser
        hasSubscription={hasSubscription}
        usedBytes={0}
        initial={{ interval: 'month', planId: 'pro', addonQty: {} }}
        onUpdated={() => {}}
        onClose={() => {}}
      />,
    );
  });
  await settle();
}

function button(text: string) {
  return [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
}

async function click(text: string) {
  const el = button(text);
  expect(el, `no button matching ${text}`).toBeDefined();
  await act(async () => { el!.click(); await Promise.resolve(); });
  await settle();
}

async function applyCode(code: string) {
  const input = container!.querySelector<HTMLInputElement>('input[placeholder="Enter code"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, code);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Apply');
}

describe('plan chooser currency', () => {
  it('offers both currencies before the first subscription', async () => {
    await render();
    expect(button('USD $')).toBeDefined();
    expect(button('EUR €')).toBeDefined();
    expect(button('USD $')!.getAttribute('aria-pressed')).toBe('true');
    expect(container!.textContent).toContain('$3.99');
  });

  it('hides the toggle when the catalog sells one currency', async () => {
    getCatalog.mockImplementationOnce(async () => ({ ...USD_CATALOG, currencies: ['usd'] }));
    await render();
    expect(button('USD $')).toBeUndefined();
    expect(button('EUR €')).toBeUndefined();
  });

  it('hides the toggle for a subscriber and asks for the catalog without a currency', async () => {
    try { localStorage.setItem('dosya_currency', 'eur'); } catch { /* ignore */ }
    await render(true);
    expect(button('EUR €')).toBeUndefined();
    expect(getCatalog).toHaveBeenCalledWith(undefined);
  });

  it('starts from the remembered currency', async () => {
    try { localStorage.setItem('dosya_currency', 'eur'); } catch { /* ignore */ }
    await render();
    expect(getCatalog).toHaveBeenCalledWith('eur');
    expect(container!.textContent).toContain('€3.49');
  });

  it('reprices in euros, remembers the pick and checks out in euros', async () => {
    await render();
    await click('EUR €');

    expect(getCatalog).toHaveBeenLastCalledWith('eur');
    expect(container!.textContent).toContain('€3.49');
    expect(container!.textContent).not.toContain('$3.99');
    expect(container!.textContent).toContain('Prices include VAT.');
    expect(button('EUR €')!.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('dosya_currency')).toBe('eur');

    await click('Continue to payment');
    expect(startCheckout).toHaveBeenCalledWith(expect.objectContaining({ currency: 'eur', plan_id: 'pro' }));
  });

  it('validates a code in the cart currency', async () => {
    validateCoupon.mockResolvedValue({ code: 'TEN', type: 'percent', value: 10, currency: null, duration: 'once', duration_in_months: null });
    await render();
    await click('EUR €');
    await applyCode('TEN');
    expect(validateCoupon).toHaveBeenCalledWith('TEN', 'month', 'eur');
  });

  it('drops a dollar amount code when the customer switches to euros, and says why', async () => {
    validateCoupon.mockResolvedValue({ code: 'FIVE', type: 'amount', value: 100, currency: 'usd', duration: 'once', duration_in_months: null });
    await render();
    await applyCode('FIVE');
    expect(container!.textContent).toContain('Code FIVE applied');

    await click('EUR €');

    expect(container!.textContent).not.toContain('Code FIVE applied');
    expect(container!.textContent).toContain('That code is in US dollars, so it was removed.');
    expect(container!.textContent).not.toContain('Discount');
  });

  it('keeps a percent code across the switch', async () => {
    validateCoupon.mockResolvedValue({ code: 'TEN', type: 'percent', value: 10, currency: null, duration: 'once', duration_in_months: null });
    await render();
    await applyCode('TEN');
    await click('EUR €');
    expect(container!.textContent).toContain('Code TEN applied');
  });
});
