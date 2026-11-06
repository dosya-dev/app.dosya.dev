import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/api/billing', () => ({
  getCatalog: async () => ({
    plans: [
      { id: 'starter', name: 'Starter', storage_bytes: 100 * 1024 ** 3, storage_label: '100 GB', price_monthly: 399, price_yearly: 3990, has_monthly: true, has_yearly: true },
    ],
    addons: [],
  }),
  startCheckout: async () => ({ ok: true, url: 'https://checkout.stripe.com/c/cs_1', trial: true }),
  updateSubscription: async () => ({ ok: true }),
  previewSubscription: async () => ({ amount_due: 0, currency: 'usd' }),
  validateCoupon: vi.fn(),
}));

import { PlanChooser } from './plan-chooser';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
});

async function render(props: { trialEligible?: boolean; hasSubscription?: boolean; interval?: 'month' | 'year' }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <PlanChooser
        hasSubscription={props.hasSubscription ?? false}
        trialEligible={props.trialEligible}
        usedBytes={0}
        initial={{ interval: props.interval ?? 'month', planId: 'starter', addonQty: {} }}
        onUpdated={() => {}}
        onClose={() => {}}
      />,
    );
  });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

const buttons = () => [...container!.querySelectorAll('button')].map((b) => b.textContent);

describe('plan chooser trial', () => {
  it('offers the free trial to an eligible account, with the charge date', async () => {
    await render({ trialEligible: true });
    const date = new Date(Date.now() + 7 * 86400 * 1000)
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    expect(buttons()).toContain('Start 7-day free trial');
    expect(buttons()).not.toContain('Continue to payment');
    expect(container!.textContent).toContain(`Free for 7 days, then $3.99 a month. Cancel any time before ${date} and you won't be charged.`);
  });

  it('names the yearly price on the annual interval', async () => {
    await render({ trialEligible: true, interval: 'year' });
    expect(container!.textContent).toContain('Free for 7 days, then $39.90 a year.');
  });

  it('keeps Continue to payment when the account is not eligible', async () => {
    await render({ trialEligible: false });
    expect(buttons()).toContain('Continue to payment');
    expect(container!.textContent).not.toContain('Free for 7 days');
  });

  it('never offers a trial to an existing subscriber', async () => {
    await render({ trialEligible: true, hasSubscription: true });
    expect(buttons()).toContain('Update subscription');
    expect(container!.textContent).not.toContain('Free for 7 days');
  });
});
