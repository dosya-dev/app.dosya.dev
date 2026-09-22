import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * The statement layout: the subscription on the left, and a ledger on the right
 * with one line per thing that adds storage. The ledger is the part worth
 * testing - it is assembled from four different sources (plan, add-on items,
 * redeemed packages, referral bonus) and its total is the enforced limit, not
 * the sum of the lines, so a lagging line can never overstate what you have.
 */

const getBillingStatus = vi.fn();
const syncBilling = vi.fn();
const createPortalSession = vi.fn();
const resumeSubscription = vi.fn();
const api = vi.fn();

vi.mock('@/api/billing', () => ({
  getBillingStatus: () => getBillingStatus(),
  syncBilling: () => syncBilling(),
  createPortalSession: () => createPortalSession(),
  resumeSubscription: () => resumeSubscription(),
}));

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => api(...args) };
});

vi.mock('@/components/billing/plan-chooser', () => ({
  PlanChooser: ({ mode }: { mode?: string }) => <div data-testid="plan-chooser" data-mode={mode ?? 'plan'}>PlanChooser</div>,
}));

vi.mock('@/components/billing/cancel-dialog', () => ({
  CancelSubscriptionDialog: () => <div>Cancel dialog</div>,
}));

import BillingPage from './billing';

const GB = 1024 ** 3;
const TB = 1024 ** 4;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  getBillingStatus.mockReset();
  syncBilling.mockReset();
  createPortalSession.mockReset();
  resumeSubscription.mockReset();
  api.mockReset();
  window.history.replaceState({}, '', '/billing');
});

function status(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    plan: { id: 'pro', name: 'Pro', storage_bytes: 2 * TB, storage_label: '2 TB', price_monthly: 2499, price_yearly: null },
    usage: { used_bytes: 612 * GB, used_label: '612 GB', limit_bytes: 3 * TB + 5 * GB, limit_label: '3 TB', pct: 20 },
    subscription: {
      status: 'active', current_period_end: 1_800_000_000, has_subscription: true,
      cancel_at_period_end: false, grace_period_end: null,
    },
    interval: 'month',
    items: [
      { kind: 'plan', ref_id: 'pro', quantity: 1, storage_bytes: 2 * TB, total_bytes: 2 * TB, total_label: '2 TB', interval: 'month' },
      { kind: 'addon', ref_id: 'storage-1tb', quantity: 1, storage_bytes: TB, total_bytes: TB, total_label: '1 TB', interval: 'month' },
    ],
    referral_bonus_bytes: 10 * GB,
    license_grants: [{
      id: 'lic_1', provider: 'gumroad', package_name: '2 TB package', storage_bytes: 5 * GB, storage_label: '5 GB',
      interval: 'year', status: 'active', linked_at: 1_700_000_000, provider_end_at: null,
      contribution_bytes: 5 * GB, ends_at: null, renews_at: null,
    }],
    invoices: [
      { id: 'upcoming', period_start: 1_797_000_000, period_end: 1_800_000_000, amount: 2499, status: 'upcoming', pdf_url: null },
      { id: 'in_1', period_start: 1_794_000_000, period_end: 1_797_000_000, amount: 2499, status: 'paid', pdf_url: 'https://stripe.test/i.pdf' },
    ],
    ...overrides,
  };
}

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={['/billing']}><BillingPage /></MemoryRouter>);
  });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

describe('billing statement', () => {
  it('lists every source of storage and totals the enforced limit', async () => {
    getBillingStatus.mockResolvedValue(status());
    api.mockResolvedValue({ card: { brand: 'visa', last4: '4242' } });

    await render();
    const text = container!.textContent!;

    expect(text).toContain('$24.99');
    expect(text).toContain('Pro plan · renews');
    expect(text).toContain('Visa •••• 4242');
    expect(text).toContain('Next invoice $24.99');
    // One line per source, in gigabytes.
    expect(text).toContain('2,048 GB');   // Pro plan
    expect(text).toContain('1,024 GB');   // add-on
    expect(text).toContain('storage-1tb × 1');
    expect(text).toContain('2 TB package');
    expect(text).toContain('Referral bonus');
    expect(text).toContain('Total limit');
    expect(text).toContain('3,077 GB');   // the enforced limit
    expect(text).toContain('612 GB used');
  });

  it('opens the chooser without plan cards from Add storage, and with them from Change plan', async () => {
    getBillingStatus.mockResolvedValue(status());
    api.mockResolvedValue({ card: null });

    await render();
    const add = [...container!.querySelectorAll('button')].find((b) => b.textContent === 'Add storage');
    expect(add, 'no Add storage button').toBeDefined();
    await act(async () => { add!.click(); });
    expect(container!.querySelector('[data-testid="plan-chooser"]')?.getAttribute('data-mode')).toBe('addons');

    const change = [...container!.querySelectorAll('button')].find((b) => b.textContent === 'Change plan');
    expect(change, 'no Change plan button').toBeDefined();
    await act(async () => { change!.click(); });
    expect(container!.querySelector('[data-testid="plan-chooser"]')?.getAttribute('data-mode')).toBe('plan');
  });

  it('leaves out the payment line when the card cannot be read', async () => {
    getBillingStatus.mockResolvedValue(status());
    api.mockRejectedValue(new Error('stripe down'));

    await render();

    expect(container!.textContent).not.toContain('••••');
    expect(container!.textContent).toContain('Storage ledger');
  });

  it('leads with the number when the account is over its limit', async () => {
    getBillingStatus.mockResolvedValue(status({
      usage: { used_bytes: 3 * TB + 89 * GB, used_label: '3.1 TB', limit_bytes: 3 * TB + 5 * GB, limit_label: '3 TB', pct: 103 },
    }));
    api.mockResolvedValue({ card: null });

    await render();
    const text = container!.textContent!;

    expect(text).toContain('Over the limit');
    expect(text).toContain('3,161 GB');
    expect(text).toContain('84 GB over');
    expect(text).toContain('Uploads are paused across every workspace. Nothing has been deleted.');
    expect([...container!.querySelectorAll('button')].some((b) => b.textContent === 'Add storage')).toBe(true);
  });

  it('says what a cancellation costs and offers the way back', async () => {
    getBillingStatus.mockResolvedValue(status({
      subscription: {
        status: 'active', current_period_end: 1_800_000_000, has_subscription: true,
        cancel_at_period_end: true, grace_period_end: null,
      },
    }));
    api.mockResolvedValue({ card: null });

    await render();
    const text = container!.textContent!;

    expect(text).toContain('Ends January 15, 2027');
    expect(text).toContain('3,077 GB');
    expect(text).toContain('until then');
    expect(text).toContain('14 more days');
    const resume = [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes('Resume subscription'));
    expect(resume).toBeDefined();

    await act(async () => {
      resumeSubscription.mockResolvedValue({ ok: true });
      resume!.click();
      await Promise.resolve();
    });
    expect(resumeSubscription).toHaveBeenCalled();
  });

  it('asks a free account to choose a plan, and never asks Stripe for a card', async () => {
    getBillingStatus.mockResolvedValue(status({
      plan: { id: 'free', name: 'Free', storage_bytes: 5 * GB, storage_label: '5 GB', price_monthly: 0, price_yearly: null },
      usage: { used_bytes: 2 * GB, used_label: '2 GB', limit_bytes: 5 * GB, limit_label: '5 GB', pct: 40 },
      subscription: { status: null, current_period_end: null, has_subscription: false, cancel_at_period_end: false, grace_period_end: null },
      items: [], referral_bonus_bytes: 0, license_grants: [], invoices: [],
    }));

    await render();
    const text = container!.textContent!;

    expect(text).toContain('Choose a plan');
    expect(text).toContain('No invoices yet');
    expect(text).not.toContain('Cancel subscription');
    expect(api).not.toHaveBeenCalled();
  });
});
