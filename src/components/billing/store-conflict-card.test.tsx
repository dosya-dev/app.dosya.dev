import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BillingStatus } from '@/api/billing';
import { StoreConflictCard } from './store-conflict-card';

const store = {
  provider: 'google' as const, plan_id: 'pro', product_id: 'p', expires_at: 1_800_000_000, grace_until: null,
  will_renew: true, period_type: 'normal', environment: 'production' as const, conflict: true,
  manage_url: 'https://play.google.com/store/account/subscriptions',
};
const billing = (o: Record<string, unknown> = {}) => ({
  plan: { id: 'pro', name: 'Pro', storage_label: '1 TB' },
  subscription: { has_subscription: true, cancel_at_period_end: false, current_period_end: 1_900_000_000 }, refund: { eligible: true }, ...o,
}) as unknown as BillingStatus;

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; });
function mount(b: BillingStatus, fns = { onCancel: vi.fn(), onRefund: vi.fn(), openPortal: vi.fn() }, st: typeof store = store) {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<StoreConflictCard store={st} billing={b} {...fns} />));
  return { c: container, fns };
}
const button = (c: HTMLElement, label: string) => [...c.querySelectorAll('button')].find((b) => b.textContent === label)!;

describe('StoreConflictCard', () => {
  it('explains the conflict and links to the store', () => {
    const { c } = mount(billing());
    expect(c.textContent).toContain('Two subscriptions are active');
    expect(c.textContent).toContain('We found a Google Play subscription and a web subscription');
    expect(c.querySelector('a')!.getAttribute('href')).toBe(store.manage_url);
  });
  it('shows both subscriptions side by side', () => {
    const { c } = mount(billing());
    expect(c.textContent).toContain('Managed in Google Play');
    expect(c.textContent).toContain('Renews on '); // the store line
    expect(c.textContent).toContain('Web subscription');
    expect(c.textContent).toContain('Pro');
    expect(c.querySelectorAll('section')).toHaveLength(2);
  });
  it('wires cancel, refund and portal', () => {
    const { c, fns } = mount(billing());
    act(() => button(c, 'Cancel subscription').click());
    act(() => button(c, 'Request refund').click());
    act(() => button(c, 'Manage payment method').click());
    expect(fns.onCancel).toHaveBeenCalledOnce();
    expect(fns.onRefund).toHaveBeenCalledOnce();
    expect(fns.openPortal).toHaveBeenCalledOnce();
  });
  it('hides cancel when already cancelling and refund when ineligible', () => {
    const { c } = mount(billing({ subscription: { has_subscription: true, cancel_at_period_end: true, current_period_end: 1_900_000_000 }, refund: { eligible: false } }));
    expect(c.textContent).not.toContain('Cancel subscription');
    expect(c.textContent).not.toContain('Request refund');
  });
  it('without an open conflict, uses the quieter two-subscriptions copy', () => {
    const { c } = mount(billing(), undefined, { ...store, conflict: false });
    expect(c.textContent).toContain('Two subscriptions on this account');
    expect(c.textContent).toContain('This account has a Google Play subscription and a web subscription. Your web subscription provides your plan while both run.');
    expect(c.textContent).not.toContain('Two subscriptions are active');
    expect(c.querySelectorAll('section')).toHaveLength(2);
  });
});
