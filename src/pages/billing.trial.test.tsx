import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const getBillingStatus = vi.fn();
const api = vi.fn();

vi.mock('@/api/family', () => ({
  getFamily: vi.fn(async () => ({ ok: true, role: 'none', limit: 5, eligible: false, ineligible_reason: 'free_plan', pool: { used_bytes: 0, limit_bytes: 1, used_label: '0 B', limit_label: '5 GB' }, plan: { id: 'free', name: 'Free' }, payer: null, members: [] })),
  inviteFamilyMember: vi.fn(), revokeFamilyInvite: vi.fn(), removeFamilyMember: vi.fn(), leaveFamily: vi.fn(),
}));

vi.mock('@/api/billing', () => ({
  getBillingStatus: () => getBillingStatus(),
  syncBilling: vi.fn(),
  createPortalSession: vi.fn(),
  resumeSubscription: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => api(...args) };
});

let chooserProps: Record<string, unknown> = {};
vi.mock('@/components/billing/plan-chooser', () => ({
  PlanChooser: (props: Record<string, unknown>) => { chooserProps = props; return <div data-testid="plan-chooser">PlanChooser</div>; },
}));
vi.mock('@/components/billing/cancel-dialog', () => ({
  CancelSubscriptionDialog: () => <div>Cancel dialog</div>,
}));

import BillingPage from './billing';

const GB = 1024 ** 3;

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  getBillingStatus.mockReset();
  api.mockReset();
  chooserProps = {};
  window.history.replaceState({}, '', '/billing');
});

const longDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function status(overrides: Record<string, unknown> = {}) {
  const trialEnd = Math.floor(Date.now() / 1000) + 5 * 86400;
  return {
    ok: true,
    plan: { id: 'starter', name: 'Starter', storage_bytes: 100 * GB, storage_label: '100 GB', price_monthly: 399, price_yearly: 3990 },
    usage: { used_bytes: GB, used_label: '1 GB', limit_bytes: 100 * GB, limit_label: '100 GB', pct: 1 },
    subscription: {
      status: 'active', current_period_end: trialEnd, has_subscription: true,
      cancel_at_period_end: false, grace_period_end: null, trial_end: trialEnd,
    },
    trial_eligible: false,
    interval: 'month',
    items: [{ kind: 'plan', ref_id: 'starter', quantity: 1, unit_amount: 399, storage_bytes: 100 * GB, total_bytes: 100 * GB, total_label: '100 GB', interval: 'month' }],
    referral_bonus_bytes: 0,
    license_grants: [],
    invoices: [{ id: 'upcoming', period_start: trialEnd - 86400, period_end: trialEnd, amount: 399, status: 'upcoming', pdf_url: null }],
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

describe('billing during a trial', () => {
  it('shows the trial badge and the charge date instead of Active', async () => {
    const s = status();
    getBillingStatus.mockResolvedValue(s);
    api.mockResolvedValue({ card: null });
    await render();
    const text = container!.textContent!;
    const date = longDate(s.subscription.trial_end as number);
    expect(text).toContain(`Free trial until ${date}`);
    expect(text).toContain(`Your card will be charged $3.99 on ${date}.`);
    expect(text).not.toContain('Active');
  });

  it('leaves the amount out when there is no upcoming invoice', async () => {
    const s = status({ invoices: [] });
    getBillingStatus.mockResolvedValue(s);
    api.mockResolvedValue({ card: null });
    await render();
    const text = container!.textContent!;
    const date = longDate(s.subscription.trial_end as number);
    expect(text).toContain(`Your card will be charged on ${date}.`);
    expect(text).not.toContain('Your card will be charged $');
  });

  it('keeps the Active badge when there is no trial', async () => {
    getBillingStatus.mockResolvedValue(status({
      subscription: { status: 'active', current_period_end: 1_800_000_000, has_subscription: true, cancel_at_period_end: false, grace_period_end: null, trial_end: null },
    }));
    api.mockResolvedValue({ card: null });
    await render();
    const text = container!.textContent!;
    expect(text).toContain('Active');
    expect(text).not.toContain('Free trial until');
  });

  it('passes trial_eligible to the plan chooser', async () => {
    getBillingStatus.mockResolvedValue(status({
      trial_eligible: true,
      subscription: { status: null, current_period_end: null, has_subscription: false, cancel_at_period_end: false, grace_period_end: null, trial_end: null },
      invoices: [],
    }));
    api.mockResolvedValue({ card: null });
    window.history.replaceState({}, '', '/billing?upgrade=1');
    await render();
    expect(chooserProps.trialEligible).toBe(true);
  });
});
