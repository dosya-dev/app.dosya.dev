import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * Edit reservations in the plan chooser closes the chooser and scrolls to the
 * Family card. The chooser sits above the card, so the scroll must wait until
 * the chooser is gone or a smooth scroll lands past the card.
 */

const getBillingStatus = vi.fn();
const syncBilling = vi.fn();
const createPortalSession = vi.fn();
const resumeSubscription = vi.fn();
const api = vi.fn();

vi.mock('@/api/family', () => ({
  getFamily: vi.fn(async () => ({ ok: true, role: 'none', limit: 5, eligible: false, ineligible_reason: 'free_plan', pool: { used_bytes: 0, limit_bytes: 1, used_label: '0 B', limit_label: '5 GB' }, plan: { id: 'free', name: 'Free' }, payer: null, members: [] })),
  inviteFamilyMember: vi.fn(), revokeFamilyInvite: vi.fn(), removeFamilyMember: vi.fn(), leaveFamily: vi.fn(),
}));

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
  PlanChooser: ({ onEditReservations }: { onEditReservations?: () => void }) => (
    <div data-testid="plan-chooser"><button type="button" onClick={() => onEditReservations?.()}>Edit reservations</button></div>
  ),
}));

vi.mock('@/components/billing/cancel-dialog', () => ({
  CancelSubscriptionDialog: () => <div>Cancel dialog</div>,
}));

import BillingPage from './billing';
import { useSession } from '@/stores/session';

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
  useSession.setState({ user: null });
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
    currency: 'usd',
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

describe('billing page: Edit reservations', () => {
  it('scrolls to the Family card only after the chooser is gone', async () => {
    getBillingStatus.mockResolvedValue(status());
    api.mockResolvedValue({ card: { brand: 'visa', last4: '4242' } });
    const seen: { id: string; chooserPresent: boolean }[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      seen.push({ id: this.id, chooserPresent: !!document.querySelector('[data-testid="plan-chooser"]') });
    };
    try {
      await render();
      const change = [...container!.querySelectorAll('button')].find((b) => b.textContent === 'Change plan');
      await act(async () => { change!.click(); });
      const edit = [...container!.querySelectorAll('button')].find((b) => b.textContent === 'Edit reservations');
      await act(async () => { edit!.click(); });
      expect(seen).toEqual([{ id: 'family-plan', chooserPresent: false }]);
      expect(container!.querySelector('[data-testid="plan-chooser"]')).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
