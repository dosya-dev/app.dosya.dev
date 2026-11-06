import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CatalogAddon, CatalogPlan } from '@/api/billing';
import { PlanSelector } from './plan-selector';
import { IncludedFeatures } from './included-features';
import { AddonBlock } from './addon-row';
import { StorageComposition } from './storage-composition';

const GB = 1024 ** 3;
const plan = (o: Partial<CatalogPlan>): CatalogPlan => ({
  id: 'plus', name: 'Plus', storage_bytes: 500 * GB, storage_label: '500 GB', price_monthly: 999, price_yearly: 9990,
  price_monthly_label: '$9.99', price_yearly_label: '$99.90', features: [], has_monthly: true, has_yearly: true, ...o,
});
const PLANS: CatalogPlan[] = [
  plan({ id: 'free', name: 'Free', storage_bytes: 5 * GB, storage_label: '5 GB', price_monthly: 0, price_yearly: null }),
  plan({ id: 'starter', name: 'Starter', storage_bytes: 100 * GB, storage_label: '100 GB', price_monthly: 399, price_yearly: 3990, ai_images_max: 10000, ai_documents_max: 2000 }),
  plan({ ai_images_max: 50000, ai_documents_max: 10000 }),
  plan({ id: 'pro', name: 'Pro', storage_bytes: 1024 * GB, storage_label: '1 TB', price_monthly: 1999, price_yearly: null, has_yearly: false }),
  plan({ id: 'custom-9', name: 'Custom', storage_bytes: 3 * 1024 * GB, storage_label: '3 TB', price_monthly: 5999, price_yearly: 59990 }),
];
const ADDON: CatalogAddon = { id: 'addon_100gb', name: '+100 GB', kind: 'storage', storage_bytes: 100 * GB, storage_label: '100 GB', price_monthly: 200, price_yearly: 2000, price_monthly_label: '$2', price_yearly_label: '$20', max_quantity: 50, has_monthly: true, has_yearly: true };

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; });
async function render(ui: React.ReactElement) {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root!.render(ui); });
  return container;
}
const cell = (id: string) => container!.querySelector<HTMLButtonElement>(`[data-plan-id="${id}"]`);

describe('size rail', () => {
  it('renders one cell per paid plan, never Free, with the selection and the current tag', async () => {
    await render(<PlanSelector plans={PLANS} interval="month" selectedId="plus" currentPlanId="starter" onSelect={() => {}} />);
    expect(container!.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(cell('free')).toBeNull();
    expect(cell('plus')!.getAttribute('aria-checked')).toBe('true');
    expect(cell('starter')!.textContent).toContain('Current');
    expect(cell('plus')!.textContent).not.toContain('Current');
  });

  it('prices monthly with the yearly figure as a hint, and yearly as per month with the yearly charge', async () => {
    await render(<PlanSelector plans={PLANS} interval="month" selectedId="plus" onSelect={() => {}} />);
    expect(cell('plus')!.textContent).toContain('$9.99/mo');
    expect(cell('plus')!.textContent).toContain('$99.90 a year if yearly');
    await act(() => root!.unmount()); root = null; container!.remove();
    await render(<PlanSelector plans={PLANS} interval="year" selectedId="plus" onSelect={() => {}} />);
    expect(cell('plus')!.textContent).toContain('$8.33/mo');
    expect(cell('plus')!.textContent).toContain('billed $99.90 a year');
    expect(cell('pro')!.disabled).toBe(true);
  });

  it('shows Smart Search limits only when the catalog carries them, and fits only for known sizes', async () => {
    await render(<PlanSelector plans={PLANS} interval="month" selectedId="custom-9" onSelect={() => {}} />);
    expect(cell('plus')!.textContent).toContain('Smart Search 50,000 photos · 10,000 documents');
    expect(cell('pro')!.textContent).not.toContain('Smart Search');
    expect(cell('starter')!.textContent).toContain("One person's documents and phone.");
    expect(cell('custom-9')!.textContent).not.toContain('shared drive');
    expect(container!.textContent).toContain('Custom holds about 785,000 phone photos.');
    expect(container!.textContent).toContain('Need more than 20 TB?');
  });
});

describe('included band', () => {
  it('lists ten entries with the Smart Search numbers and the Free lines', async () => {
    await render(<IncludedFeatures plan={PLANS[2]} familyPlaceMonthly={100} />);
    expect(container!.querySelectorAll('li')).toHaveLength(10);
    const text = container!.textContent!;
    expect(text).toContain('Everything in Plus');
    expect(text).toContain('50,000 photos and 10,000 documents');
    expect(text).toContain('then $1 a month for each extra place');
    for (const s of ['Free: 5 links at a time.', 'Free: 10 GB a day.', 'Free: 7 days of each.', 'Free: 3 workspaces, 5 people each.', 'browser extension', 'Personas']) expect(text).toContain(s);
    expect(container!.querySelector('a')!.getAttribute('href')).toContain('dosya.dev/pricing');
  });

  it('drops the Smart Search entry without limits and the price clause without the places add-on', async () => {
    await render(<IncludedFeatures plan={PLANS[3]} familyPlaceMonthly={null} currency="eur" />);
    expect(container!.querySelectorAll('li')).toHaveLength(9);
    expect(container!.textContent).toContain('5 people share your storage.');
    expect(container!.textContent).not.toContain('extra place');
  });
});

describe('add-on block', () => {
  it('reads as a limit at zero and as a sum above zero, and stops at the maximum', async () => {
    let qty = 0;
    const c = await render(<AddonBlock addon={ADDON} interval="month" qty={0} disabled={false} onChange={(q) => { qty = q; }} />);
    expect(c.textContent).toContain('up to 50 × 100 GB');
    expect(c.querySelector<HTMLButtonElement>('[aria-label^="Remove"]')!.disabled).toBe(true);
    await act(async () => { c.querySelector<HTMLButtonElement>('[aria-label^="Add"]')!.click(); });
    expect(qty).toBe(1);
    await act(() => root!.unmount()); root = null; c.remove();
    const c2 = await render(<AddonBlock addon={ADDON} interval="year" qty={50} disabled={false} onChange={() => {}} />);
    expect(c2.textContent).toContain('4.9 TB added');
    expect(c2.textContent).toContain('$1,000/yr');
    expect(c2.querySelector('[data-active]')).not.toBeNull();
    expect(c2.querySelector<HTMLButtonElement>('[aria-label^="Add"]')!.disabled).toBe(true);
  });
});

describe('storage composition', () => {
  const widths = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-kind="plan"], [data-kind="addon"]')].map((s) => parseFloat(s.style.width));
  it('fills the bar when usage fits, with one segment per chosen add-on', async () => {
    const c = await render(<StorageComposition planBytes={500 * GB} addons={[{ id: 'a', bytes: 100 * GB, qty: 2 }, { id: 'b', bytes: 1024 * GB, qty: 0 }]} usedBytes={412 * GB} />);
    expect(widths(c).reduce((s, w) => s + w, 0)).toBeCloseTo(100, 5);
    expect(c.querySelectorAll('[data-kind="addon"]')).toHaveLength(1);
    expect(c.textContent).toContain('700 GB total · 412 GB used today');
    expect(c.querySelector<HTMLElement>('[data-kind="used"]')!.style.insetInlineStart).toBe(`${(412 / 700) * 100}%`);
  });
  it('scales to the usage when the new total is below it, and has no marker for a new customer', async () => {
    const c = await render(<StorageComposition planBytes={100 * GB} addons={[]} usedBytes={412 * GB} />);
    expect(widths(c).reduce((s, w) => s + w, 0)).toBeLessThan(100);
    expect(c.querySelector<HTMLElement>('[data-kind="used"]')!.style.insetInlineStart).toBe('100%');
    await act(() => root!.unmount()); root = null; c.remove();
    const c2 = await render(<StorageComposition planBytes={100 * GB} addons={[]} />);
    expect(c2.querySelector('[data-kind="used"]')).toBeNull();
    expect(c2.textContent).toContain('100 GB total');
  });
});
