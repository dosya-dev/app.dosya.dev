import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatLicenseDate } from '@/lib/license-timeline';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const getBillingStatus = vi.fn();
const syncBilling = vi.fn();
const createPortalSession = vi.fn();
const resumeSubscription = vi.fn();

vi.mock('@/api/billing', () => ({
  getBillingStatus: () => getBillingStatus(),
  syncBilling: () => syncBilling(),
  createPortalSession: () => createPortalSession(),
  resumeSubscription: () => resumeSubscription(),
}));

vi.mock('@/components/billing/plan-chooser', () => ({
  PlanChooser: () => <div data-testid="plan-chooser">PlanChooser</div>,
}));

vi.mock('@/components/billing/cancel-dialog', () => ({
  CancelSubscriptionDialog: () => <div>Cancel dialog</div>,
}));

import BillingPage from './billing';

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
  window.history.replaceState({}, '', '/billing');
});

function billingStatus() {
  return {
    ok: true,
    plan: { id: 'pro', name: 'Pro', storage_bytes: 1024 ** 4, storage_label: '1 TB', price_monthly: 1999, price_yearly: null },
    usage: { used_bytes: 920 * 1024 ** 3, used_label: '920 GB', limit_bytes: 1024 ** 4, limit_label: '1 TB', pct: 90 },
    subscription: {
      status: 'active',
      current_period_end: 1_800_000_000,
      has_subscription: true,
      cancel_at_period_end: true,
      grace_period_end: null,
    },
    interval: 'month',
    items: [{ kind: 'plan', ref_id: 'pro', quantity: 1, storage_bytes: 1024 ** 4, total_bytes: 1024 ** 4, total_label: '1 TB', interval: 'month' }],
    referral_bonus_bytes: 0,
    license_grants: [],
    invoices: [
      { id: 'in_1', period_start: 1_700_000_000, period_end: 1_702_592_000, amount: 1999, status: 'paid', pdf_url: 'https://stripe.test/invoice.pdf' },
    ],
  };
}

async function render(entry = '/billing') {
  window.history.replaceState({}, '', entry);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={[entry]}><BillingPage /></MemoryRouter>);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('Billing license grants', () => {
  it('shows every redeemed Gumroad package and only counts active storage', async () => {
    getBillingStatus.mockResolvedValueOnce({
      ...billingStatus(),
      usage: { used_bytes: 0, used_label: '0 B', limit_bytes: 4 * 1024 ** 4, limit_label: '4 TB', pct: 0 },
      license_grants: [
        {
          id: 'grant_2tb', provider: 'gumroad', package_name: '2 TB package',
          storage_bytes: 2 * 1024 ** 4, storage_label: '2 TB', interval: 'year',
          status: 'active', linked_at: 1_700_000_000, provider_end_at: null,
          contribution_bytes: 2 * 1024 ** 4, ends_at: null, renews_at: 1_794_744_000,
        },
        {
          id: 'grant_1tb', provider: 'gumroad', package_name: '1 TB package',
          storage_bytes: 1024 ** 4, storage_label: '1 TB', interval: 'month',
          status: 'ended', linked_at: 1_690_000_000, provider_end_at: 1_710_000_000,
          contribution_bytes: 0, ends_at: 1_710_000_000, renews_at: null,
        },
      ],
    });

    await render();

    const text = container!.textContent ?? '';
    expect(text).toContain('Redeemed packages');
    expect(text).toContain('2 TB package');
    expect(text).toContain('Yearly');
    expect(text).toContain('Active');
    expect(text).toContain('1 TB package');
    expect(text).toContain('Monthly');
    expect(text).toContain('Ended');
    expect(text).toContain('Adds 2 TB');
    expect(text).toContain('Adds 0 MB');
    // Rendered in the runner's time zone, like the page; noon-UTC fixtures keep the day stable.
    expect(text).toContain('Renews around Nov 15, 2026');
    expect(text).toContain(`Ended ${formatLicenseDate(1_710_000_000)}`);
    expect(container!.querySelector('a[href="https://app.gumroad.com/library"]')).not.toBeNull();
  });
});
