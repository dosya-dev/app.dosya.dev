import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BillingStatus, StoreStatus } from '@/api/billing';
import { StorePlanCard, storeDate, storeLayout } from './store-plan-card';

type Store = NonNullable<StoreStatus>;
const store = (o: Partial<Store> = {}): Store => ({
  provider: 'apple', plan_id: 'pro', product_id: 'p', expires_at: 1_800_000_000, grace_until: null,
  will_renew: true, period_type: 'normal', environment: 'production', conflict: false,
  manage_url: 'https://apps.apple.com/account/subscriptions', ...o,
});
const plan = { id: 'pro', name: 'Pro', storage_bytes: 1, storage_label: '1 TB', price_monthly: 1, price_yearly: null };

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; });
function mount(el: React.ReactElement) {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); act(() => root!.render(el));
  return container;
}

describe('storeLayout', () => {
  const s = (st: StoreStatus | undefined, has_subscription = false) =>
    ({ store: st, subscription: { has_subscription } }) as unknown as BillingStatus;
  it('is none without a store', () => { expect(storeLayout(s(undefined))).toBe('none'); expect(storeLayout(s(null))).toBe('none'); });
  it('is locked for a store plan with no web subscription', () => { expect(storeLayout(s(store()))).toBe('locked'); });
  it('is locked when a conflict row is open but no web subscription is active', () => {
    expect(storeLayout(s(store({ conflict: true }), false))).toBe('locked');
  });
  it('is conflict when a web subscription is also active, flagged or not', () => {
    expect(storeLayout(s(store({ conflict: true }), true))).toBe('conflict');
    expect(storeLayout(s(store({ conflict: false }), true))).toBe('conflict');
  });
});

describe('StorePlanCard', () => {
  it('says Renews on when it will renew', () => {
    const c = mount(<StorePlanCard store={store()} plan={plan} />);
    expect(c.textContent).toContain('Renews on ');
    expect(c.textContent).toContain('Managed in App Store');
    expect(c.textContent).not.toContain('Ends on');
  });
  it('says Ends on when it will not renew', () => {
    const c = mount(<StorePlanCard store={store({ will_renew: false })} plan={plan} />);
    expect(c.textContent).toContain('Ends on ');
    expect(c.textContent).not.toContain('Renews on');
  });
  it('links to the store and names Google Play', () => {
    const c = mount(<StorePlanCard store={store({ provider: 'google', manage_url: 'https://play.google.com/store/account/subscriptions' })} plan={plan} />);
    const a = c.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://play.google.com/store/account/subscriptions');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noreferrer');
    expect(a.textContent).toContain('Manage in Google Play');
  });
  it('flags sandbox purchases only', () => {
    expect(mount(<StorePlanCard store={store({ environment: 'sandbox' })} plan={plan} />).textContent).toContain('Test purchase');
    act(() => root!.unmount()); container!.remove();
    expect(mount(<StorePlanCard store={store()} plan={plan} />).textContent).not.toContain('Test purchase');
  });
  it('says nothing about a billing issue without an open conflict', () => {
    expect(mount(<StorePlanCard store={store()} plan={plan} />).textContent).not.toContain('sorting out a billing issue');
  });
  it('adds one neutral line when a conflict is open', () => {
    const c = mount(<StorePlanCard store={store({ conflict: true })} plan={plan} />);
    expect(c.textContent).toContain("We're sorting out a billing issue on this account. Nothing is needed from you right now.");
  });
  it('in a grace period, shows the payment problem by the grace date instead of a past renewal', () => {
    const now = Math.floor(Date.now() / 1000);
    const grace = now + 5 * 86_400;
    const c = mount(<StorePlanCard store={store({ expires_at: now - 86_400, grace_until: grace })} plan={plan} />);
    const line = c.querySelector('[data-testid="store-payment-problem"]')!;
    expect(line).not.toBeNull();
    expect(line.textContent).toBe(`Payment problem: update your payment method in App Store by ${storeDate(grace)}`);
    expect(line.className).toContain('amber');
    expect(c.textContent).not.toContain('Renews on');
  });
  it('outside a grace period, keeps the renewal line', () => {
    const now = Math.floor(Date.now() / 1000);
    const c = mount(<StorePlanCard store={store({ expires_at: now + 86_400, grace_until: now + 10 * 86_400 })} plan={plan} />);
    expect(c.querySelector('[data-testid="store-payment-problem"]')).toBeNull();
    expect(c.textContent).toContain('Renews on');
  });
});
