import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const getBillingStatus = vi.fn();
const api = vi.fn();

vi.mock('@/api/family', () => ({
  getFamily: vi.fn(async () => ({ ok: true, role: 'payer', limit: 5, eligible: true, pool: { used_bytes: 0, limit_bytes: 1, used_label: '0 B', limit_label: '5 GB' }, plan: { id: 'family', name: 'Family' }, payer: null, members: [] })),
  inviteFamilyMember: vi.fn(), revokeFamilyInvite: vi.fn(), removeFamilyMember: vi.fn(), leaveFamily: vi.fn(),
}));
vi.mock('@/api/billing', () => ({
  getBillingStatus: () => getBillingStatus(),
  syncBilling: vi.fn(), createPortalSession: vi.fn(), resumeSubscription: vi.fn(),
}));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => api(...args) };
});
vi.mock('@/components/billing/plan-chooser', () => ({ PlanChooser: () => <div data-testid="plan-chooser">PlanChooser</div> }));
vi.mock('@/components/billing/family-card', () => ({ FamilyCard: () => <div data-testid="family-card">FamilyCard</div> }));
vi.mock('@/components/billing/cancel-dialog', () => ({ CancelSubscriptionDialog: () => <div>Cancel dialog</div> }));

import BillingPage from './billing';

const GB = 1024 ** 3;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove(); root = null; container = null;
  getBillingStatus.mockReset(); api.mockReset();
  window.history.replaceState({}, '', '/billing');
});

const store = (o: Record<string, unknown> = {}) => ({
  provider: 'apple', plan_id: 'pro', product_id: 'p', expires_at: 1_800_000_000, grace_until: null,
  will_renew: true, period_type: 'normal', environment: 'production', conflict: false,
  manage_url: 'https://apps.apple.com/account/subscriptions', ...o,
});
const noSub = { subscription: { status: null, current_period_end: null, has_subscription: false, cancel_at_period_end: false, grace_period_end: null, trial_end: null } };
function status(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    plan: { id: 'pro', name: 'Pro', storage_bytes: 1024 * GB, storage_label: '1 TB', price_monthly: 999, price_yearly: 9990 },
    usage: { used_bytes: GB, used_label: '1 GB', limit_bytes: 1024 * GB, limit_label: '1 TB', pct: 1 },
    subscription: { status: 'active', current_period_end: 1_800_000_000, has_subscription: true, cancel_at_period_end: false, grace_period_end: null, trial_end: null },
    trial_eligible: false, interval: 'month',
    items: [{ kind: 'plan', ref_id: 'pro', quantity: 1, unit_amount: 999, storage_bytes: 1024 * GB, total_bytes: 1024 * GB, total_label: '1 TB', interval: 'month' }],
    referral_bonus_bytes: 0,
    license_grants: [],
    invoices: [{ id: 'in1', period_start: 1_700_000_000, period_end: 1_702_000_000, amount: 999, status: 'paid', pdf_url: null }],
    family: { role: 'payer' },
    refund: { eligible: true },
    ...overrides,
  };
}
async function render(s: Record<string, unknown>) {
  getBillingStatus.mockResolvedValue(s);
  api.mockResolvedValue({ card: null });
  window.history.replaceState({}, '', '/billing?upgrade=1');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<MemoryRouter initialEntries={['/billing?upgrade=1']}><BillingPage /></MemoryRouter>); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  return container.textContent!;
}

describe('billing for store-paid plans', () => {
  it('locked: shows the store card and hides chooser, family, invoices and prices', async () => {
    const text = await render(status({ ...noSub, store: store() }));
    expect(text).toContain('Managed in App Store');
    expect(text).toContain('Renews on ');
    expect(container!.querySelector('[data-testid="plan-chooser"]')).toBeNull();
    expect(container!.querySelector('[data-testid="family-card"]')).toBeNull();
    expect(text).not.toContain('Invoices');
    expect(text).not.toContain('Change plan');
    expect(text).not.toContain('Cancel subscription');
    expect(text).not.toContain('$9.99');
  });

  it('locked: keeps the usage composition', async () => {
    const text = await render(status({ ...noSub, store: store() }));
    expect(container!.querySelector('[data-testid="store-usage"]')).not.toBeNull();
    expect(text).toContain('Storage ledger');
    expect(container!.querySelector('[role="img"]')).not.toBeNull();
  });

  it('locked: a store plan that will not renew says Ends on', async () => {
    const text = await render(status({ ...noSub, store: store({ will_renew: false }) }));
    expect(text).toContain('Ends on ');
    expect(text).not.toContain('Renews on');
  });

  it('locked: an open conflict without a web subscription stays locked with one pending line', async () => {
    const text = await render(status({
      store: store({ conflict: true }),
      subscription: { status: null, current_period_end: null, has_subscription: false, cancel_at_period_end: false, grace_period_end: null, trial_end: null },
    }));
    expect(container!.querySelector('[data-testid="store-usage"]')).not.toBeNull();
    expect(text).toContain("We're sorting out a billing issue on this account. Nothing is needed from you right now.");
    expect(text).not.toContain('Two subscriptions');
    expect(text).not.toContain('Invoices');
    expect(text).not.toContain('Cancel subscription');
    expect(text).not.toContain('Request refund');
    expect(text).not.toContain('Change plan');
  });

  it('two subscriptions without an open conflict: side by side, quiet copy, Stripe controls kept', async () => {
    const text = await render(status({ store: store({ conflict: false }) }));
    expect(text).toContain('Two subscriptions on this account');
    expect(text).not.toContain('Two subscriptions are active');
    expect(text).not.toContain('sorting out a billing issue');
    expect(text).toContain('Invoices');
    expect(text).toContain('Cancel subscription');
    expect(text).toContain('Request refund');
    expect(text).toContain('Managed in App Store');
    expect(text).not.toContain('Change plan');
    expect(text).not.toContain('Add storage');
    expect(container!.querySelector('[data-testid="plan-chooser"]')).toBeNull();
    expect(container!.querySelector('[data-testid="family-card"]')).toBeNull();
  });

  it('conflict: warns, keeps invoices, cancel and refund, hides the chooser triggers', async () => {
    const text = await render(status({ store: store({ conflict: true }) }));
    expect(text).toContain('Two subscriptions are active');
    expect(text).toContain('Invoices');
    expect(text).toContain('Cancel subscription');
    expect(text).toContain('Request refund');
    expect(text).not.toContain('Change plan');
    expect(text).not.toContain('Add storage');
    expect(container!.querySelector('[data-testid="plan-chooser"]')).toBeNull();
    expect(container!.querySelector('[data-testid="family-card"]')).toBeNull();
    expect(text).toContain('Managed in App Store');
    expect(text).toContain('Renews on ');
  });

  it('no store: the normal page', async () => {
    const text = await render(status());
    expect(text).toContain('Change plan');
    expect(text).toContain('Invoices');
    expect(container!.querySelector('[data-testid="plan-chooser"]')).not.toBeNull();
  });
});
