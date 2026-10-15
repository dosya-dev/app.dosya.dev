import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { BillingStatus } from '@/api/billing';

const previewSubscription = vi.fn<(c?: unknown) => Promise<{ amount_due: number; currency: string }>>(async () => ({ amount_due: 150, currency: 'usd' }));
const updateSubscription = vi.fn<(c?: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
const navigate = vi.fn();
vi.mock('@/api/billing', () => ({
  getCatalog: async () => ({ plans: [], addons: [
    { id: 'addon_1tb', name: '+1 TB', kind: 'storage', storage_bytes: 1, storage_label: '1 TB', price_monthly: 500, price_yearly: 5000, price_monthly_label: '$5', price_yearly_label: '$50', max_quantity: 10, has_monthly: true, has_yearly: true },
    { id: 'family_places', name: 'Extra family places', kind: 'family_places', storage_bytes: 0, storage_label: '0 B', price_monthly: 100, price_yearly: 1000, price_monthly_label: '$1', price_yearly_label: '$10', max_quantity: 10, has_monthly: true, has_yearly: true },
  ] }),
  previewSubscription: (c: unknown) => previewSubscription(c as never),
  updateSubscription: (c: unknown) => updateSubscription(c as never),
}));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

import { FamilyPlacesDialog } from './family-places-dialog';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; previewSubscription.mockClear(); updateSubscription.mockClear(); navigate.mockClear(); sessionStorage.clear(); });

const PERIOD_END = 1795000000;
const mk = (interval: 'month' | 'year') => ({
  interval, plan: { id: 'other' }, usage: { limit_bytes: 2 }, subscription: { current_period_end: PERIOD_END },
  items: [
    { kind: 'plan', ref_id: 'pro', quantity: 1, unit_amount: 999 },
    { kind: 'addon', ref_id: 'addon_1tb', quantity: 1, addon_kind: 'storage', unit_amount: 500 },
    { kind: 'addon', ref_id: 'family_places', quantity: 1, addon_kind: 'family_places', unit_amount: 100 },
  ],
} as unknown as BillingStatus);
const billing = mk('month');
const dateLabel = new Date(PERIOD_END * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

async function render(props: Partial<Parameters<typeof FamilyPlacesDialog>[0]> = {}) {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><FamilyPlacesDialog open onClose={() => {}} billing={props.billing ?? billing} current={1} included={5} max={10} {...props} /></MemoryRouter>);
  });
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
}
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

describe('FamilyPlacesDialog', () => {
  it('titles the dialog and states the included people and unit price (monthly)', async () => {
    await render();
    const text = document.body.textContent!;
    expect(text).toContain('Purchase more family spots');
    expect(text).toContain('Your plan includes 5 people besides you. Each extra spot is $1 a month.');
    expect(text).toContain('Extra spots');
  });

  it('states the yearly unit price', async () => {
    await render({ billing: mk('year') });
    expect(document.body.textContent).toContain('Each extra spot is $10 a year.');
    expect(document.body.textContent).toContain('Yearly price before discounts');
  });

  it('receipt: unchanged shows only the current bill', async () => {
    await render();
    const dl = document.querySelector('dl')!;
    expect(dl.textContent).toContain('People who can join you');
    expect(dl.textContent).toContain('6');
    expect(dl.textContent).toContain('Monthly price before discounts');
    expect(dl.textContent).toContain('$15.99');
    expect(dl.querySelector('s, del, .line-through')).toBeNull();
  });

  it('steps, strikes the old bill, shows the new one, and the next invoice with its note', async () => {
    await render();
    await act(async () => { button('Add a spot').click(); }); await flush();
    const dl = document.querySelector('dl')!;
    expect(dl.textContent).toContain('7');
    expect(dl.querySelector('s, del, .line-through')!.textContent).toBe('$15.99');
    expect(dl.textContent).toContain('$16.99');
    expect(dl.textContent).toContain('Working out');
    await new Promise((r) => setTimeout(r, 450)); await flush();
    expect(previewSubscription).toHaveBeenLastCalledWith({ interval: 'month', plan_id: 'pro', addons: [{ id: 'addon_1tb', qty: 1 }, { id: 'family_places', qty: 2 }] });
    expect(dl.textContent).toContain(`Next invoice, ${dateLabel}`);
    expect(dl.textContent).toContain('$1.50');
    expect(document.body.textContent).toContain('Includes the prorated difference for the rest of this period. Nothing is charged today.');
    expect(button('Add 1 spot')).toBeDefined();
    for (let i = 0; i < 12; i++) { await act(async () => { button('Add a spot').click(); }); }
    await flush();
    expect(document.querySelector('dl')!.textContent).toContain('15');
    expect(button('Add a spot').hasAttribute('disabled')).toBe(true);
  });

  it('confirm label counts spots and the cart keeps other add-ons, then goes to the thank-you page', async () => {
    await render();
    await act(async () => { button('Remove a spot').click(); }); await flush();
    expect(button('Remove 1 spot')).toBeDefined();
    await act(async () => { button('Remove 1 spot').click(); }); await flush();
    expect(updateSubscription).toHaveBeenCalledWith({ interval: 'month', plan_id: 'pro', addons: [{ id: 'addon_1tb', qty: 1 }] });
    expect(sessionStorage.getItem('dosya_plan_change_at')).not.toBeNull();
    expect(navigate).toHaveBeenCalledWith('/checkout/success?change=1');
  });

  it('with an unknown price it shows the change, never a bill', async () => {
    const b = mk('month');
    (b.items[1] as { unit_amount: number | null }).unit_amount = null;
    await render({ billing: b });
    await act(async () => { button('Add a spot').click(); }); await act(async () => { button('Add a spot').click(); });
    const dl = document.querySelector('dl')!;
    expect(dl.textContent).not.toContain('Monthly price before discounts');
    expect(dl.textContent).toContain('Change to your bill');
    expect(dl.textContent).toContain('+$2 a month');
  });

  it('plural label when adding two', async () => {
    await render();
    await act(async () => { button('Add a spot').click(); }); await act(async () => { button('Add a spot').click(); });
    expect(button('Add 2 spots')).toBeDefined();
  });

  it('says so when the price preview fails', async () => {
    previewSubscription.mockRejectedValueOnce(new Error('no'));
    await render();
    await act(async () => { button('Add a spot').click(); }); await flush();
    await new Promise((r) => setTimeout(r, 450)); await flush();
    expect(document.body.textContent).toContain('Could not price this change');
  });

  it('the confirm button reads No change and stays off while the quantity is unchanged', async () => {
    await render();
    expect(button('No change').hasAttribute('disabled')).toBe(true);
  });
});
