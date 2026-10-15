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
  syncBilling: vi.fn(), createPortalSession: vi.fn(), resumeSubscription: vi.fn(),
  requestRefund: vi.fn(),
}));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => api(...args) };
});
vi.mock('@/components/billing/plan-chooser', () => ({ PlanChooser: () => <div>PlanChooser</div> }));
vi.mock('@/components/billing/cancel-dialog', () => ({ CancelSubscriptionDialog: () => <div>Cancel dialog</div> }));

import BillingPage from './billing';
import { useSession } from '@/stores/session';

const GB = 1024 ** 3;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove(); root = null; container = null;
  getBillingStatus.mockReset(); api.mockReset();
  useSession.setState({ user: null });
  window.history.replaceState({}, '', '/billing');
});

function status(refund?: Record<string, unknown>, cancelAtEnd = false) {
  return {
    ok: true,
    plan: { id: 'pro', name: 'Pro', storage_bytes: 2 * GB, storage_label: '2 GB', price_monthly: 1099, price_yearly: null },
    usage: { used_bytes: GB, used_label: '1 GB', limit_bytes: 20 * GB, limit_label: '20 GB', pct: 5 },
    subscription: { status: 'active', current_period_end: 1_800_000_000, has_subscription: true, cancel_at_period_end: cancelAtEnd, grace_period_end: null },
    interval: 'month', items: [], referral_bonus_bytes: 0, license_grants: [], invoices: [],
    ...(refund ? { refund } : {}),
  };
}
const refund = (o: Record<string, unknown> = {}) => ({
  eligible: true, reason: 'ok', amount: 1099, currency: 'usd', window_ends_at: Math.floor(Date.now() / 1000) + 86400, charges: [], ...o,
});

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<MemoryRouter initialEntries={['/billing']}><BillingPage /></MemoryRouter>); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}
const btn = (label: string) => [...container!.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const link = (label: string) => [...container!.querySelectorAll('a')].find((a) => a.textContent?.trim() === label);

describe('billing refund entry point', () => {
  it('shows a destructive Request refund button beside Cancel subscription', async () => {
    getBillingStatus.mockResolvedValue(status(refund())); api.mockResolvedValue({ card: null });
    await render();
    const b = btn('Request refund');
    expect(b).toBeDefined();
    expect(b!.className).toContain('text-destructive');
    expect(btn('Cancel subscription')).toBeDefined();
  });

  it('points to support when the refund was already used inside the window', async () => {
    getBillingStatus.mockResolvedValue(status(refund({ eligible: false, reason: 'already_used' }))); api.mockResolvedValue({ card: null });
    await render();
    expect(btn('Request refund')).toBeUndefined();
    expect(link('Contact support for a refund')?.getAttribute('href')).toBe('/contact');
  });

  it('shows neither with no recent payment or no refund field', async () => {
    getBillingStatus.mockResolvedValue(status(refund({ eligible: false, reason: 'no_recent_payment' }))); api.mockResolvedValue({ card: null });
    await render();
    expect(btn('Request refund')).toBeUndefined();
    expect(link('Contact support for a refund')).toBeUndefined();
    act(() => root!.unmount()); container!.remove();
    getBillingStatus.mockResolvedValue(status());
    await render();
    expect(btn('Request refund')).toBeUndefined();
    expect(link('Contact support for a refund')).toBeUndefined();
  });

  it('still offers the refund while the plan is set to cancel', async () => {
    getBillingStatus.mockResolvedValue(status(refund(), true)); api.mockResolvedValue({ card: null });
    await render();
    expect(btn('Request refund')).toBeDefined();
    expect(btn('Cancel subscription')).toBeUndefined();
  });
});
