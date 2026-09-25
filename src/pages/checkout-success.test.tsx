import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const api = vi.fn();

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => api(...args) };
});

import { ApiError } from '@/api/client';
import { rememberPlanChange, rememberStorageBeforePurchase } from '@/lib/checkout-return';
import CheckoutSuccessPage from './checkout-success';

const TB = 1024 ** 4;
const GB = 1024 ** 3;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let currentLocation = '';

function LocationProbe() {
  const location = useLocation();
  useEffect(() => { currentLocation = `${location.pathname}${location.search}`; }, [location.pathname, location.search]);
  return null;
}

function status(overrides: { limit?: number; hasSubscription?: boolean } = {}) {
  return {
    ok: true,
    plan: { id: 'pro', name: 'Pro', storage_bytes: 2 * TB, storage_label: '2 TB', price_monthly: 1299, price_yearly: null },
    usage: { used_bytes: 0, used_label: '0 B', limit_bytes: overrides.limit ?? 2 * TB + 5 * GB, limit_label: '2 TB', pct: 0 },
    subscription: { status: 'active', current_period_end: null, has_subscription: overrides.hasSubscription ?? true, cancel_at_period_end: false, grace_period_end: null },
    interval: 'month',
    items: [],
    referral_bonus_bytes: 0,
    invoices: [],
    license_grants: [],
  };
}

function script(routes: Record<string, unknown>) {
  api.mockImplementation(async (path: string) => {
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    if (!key) throw new Error(`unexpected ${path}`);
    const value = routes[key];
    if (value instanceof Error) throw value;
    return typeof value === 'function' ? (value as () => unknown)() : value;
  });
}

async function render(entry: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/checkout/success" element={<><LocationProbe /><CheckoutSuccessPage /></>} />
          <Route path="/billing" element={<><LocationProbe /><p>billing page</p></>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

beforeEach(() => { api.mockReset(); });

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  sessionStorage.clear();
  vi.useRealTimers();
});

describe('checkout thank-you page', () => {
  it('shows what a new checkout added, with the Stripe receipt, and drops the session id from the URL', async () => {
    rememberStorageBeforePurchase(5 * GB);
    script({
      '/api/billing/sync': { ok: true },
      '/api/billing/status': status(),
      '/api/billing/receipt': {
        ok: true, kind: 'checkout', paid: true, amount: 1299, currency: 'usd',
        invoice_number: 'DOSYA-0042', invoice_url: 'https://invoice.stripe.com/i/x', paid_at: 1_800_000_000,
        email: 'buyer@example.test', card: { brand: 'visa', last4: '4242' },
      },
    });

    await render('/checkout/success?session_id=cs_test_abcdefghijkl');

    expect(api).toHaveBeenCalledWith('/api/billing/receipt?session_id=cs_test_abcdefghijkl', { cache: 'no-store' });
    expect(currentLocation).toBe('/checkout/success');
    const text = container!.textContent!;
    expect(text).toContain('Purchase complete');
    // Gigabytes, not "+2 TB": the point of the figure is how much was bought.
    expect(container!.querySelector('[data-testid="capacity-figure"]')!.textContent).toBe('+2,048GB');
    expect(text).toContain('Storage added');
    expect(text).toContain('DOSYA-0042');
    expect(text).toContain('$12.99');
    expect(text).toContain('Visa •••• 4242');
    expect(text).toContain('Pro · monthly');
    expect(text).toContain('2,053 GB total');
    // No matchMedia here, which the page reads as "do not animate".
    expect(container!.querySelector('[data-testid="fireworks"]')).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('describes a plan change with its next invoice', async () => {
    rememberPlanChange();
    script({
      '/api/billing/sync': { ok: true },
      '/api/billing/status': status({ limit: TB }),
      '/api/billing/receipt': {
        ok: true, kind: 'change', next_amount: 850, currency: 'usd', next_invoice_at: 1_802_000_000,
        email: 'me@example.test', card: null,
      },
    });

    await render('/checkout/success?change=1');

    expect(api).toHaveBeenCalledWith('/api/billing/receipt', { cache: 'no-store' });
    const text = container!.textContent!;
    expect(text).toContain('Plan updated');
    expect(text).toContain('Plan change · Stripe');
    expect(text).toContain('$8.50');
    expect(text).toContain('Stripe adds the prorated difference to your next invoice.');
  });

  it('still reads as a thank-you when Stripe itself cannot be reached', async () => {
    script({
      '/api/billing/sync': { ok: true },
      '/api/billing/status': status(),
      '/api/billing/receipt': new ApiError(502, '{"error":"Could not load the receipt from Stripe"}'),
    });

    await render('/checkout/success?session_id=cs_test_abcdefghijkl');

    expect(container!.textContent).toContain('The receipt details could not be loaded from Stripe.');
    expect(container!.textContent).toContain('Storage added');
  });

  it('offers the ways to fill the new storage, the apps, and answers', async () => {
    script({
      '/api/billing/sync': { ok: true },
      '/api/billing/status': status(),
      '/api/billing/receipt': {
        ok: true, kind: 'checkout', paid: true, amount: 1299, currency: 'usd',
        invoice_number: null, invoice_url: null, paid_at: 1_800_000_000, email: 'buyer@example.test', card: null,
      },
    });

    await render('/checkout/success?session_id=cs_test_abcdefghijkl');

    const hrefs = [...container!.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    // Set-up pages in the app, guides on the marketing site (trailing slash, or
    // the site answers with a redirect).
    for (const path of ['/integrations/desktop', '/integrations/cli', '/integrations/webdav', '/integrations/s3', '/integrations/rclone']) {
      expect(hrefs).toContain(path);
    }
    for (const url of [
      'https://dosya.dev/developer/webdav/',
      'https://dosya.dev/developer/cli/',
      'https://dosya.dev/developer/s3/',
      'https://dosya.dev/developer/rclone/',
      'https://dosya.dev/desktop/',
      'https://dosya.dev/mobile/',
    ]) {
      expect(hrefs).toContain(url);
    }
    // The Microsoft badge is no longer an <img>: it is the official
    // <ms-store-badge> web component, which renders its artwork inside a shadow
    // root that jsdom never populates (the script is never fetched here). Assert
    // the element and its product id instead.
    expect([...container!.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      '/badges/appstore.svg', '/badges/googleplay.svg', '/badges/mac-appstore.svg',
    ]);
    const msBadge = container!.querySelector('ms-store-badge');
    expect(msBadge).not.toBeNull();
    expect(msBadge!.getAttribute('productid')).toBe('9p1q4pm856st');
    // Every answer is in the page at rest, so find-in-page reaches it.
    expect(container!.querySelectorAll('details').length).toBe(8);
    expect(container!.textContent).toContain('When does my new storage appear?');
    expect(container!.textContent).toContain('14-day money-back guarantee');
  });

  it('counts the figure up from the storage they had, once the tab is visible', async () => {
    // jsdom has no matchMedia, and the page treats that as "do not animate", so
    // the animation only exists for a test that provides one.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    rememberStorageBeforePurchase(5 * GB);
    script({
      '/api/billing/sync': { ok: true },
      '/api/billing/status': status(),
      '/api/billing/receipt': {
        ok: true, kind: 'checkout', paid: true, amount: 1299, currency: 'usd',
        invoice_number: null, invoice_url: null, paid_at: 1_800_000_000, email: 'buyer@example.test', card: null,
      },
    });

    await render('/checkout/success?session_id=cs_test_abcdefghijkl');
    const figure = () => container!.querySelector('[data-testid="capacity-figure"]')!.textContent;

    // It starts at what they had, not at the number it is heading for.
    expect(figure()).toBe('+5GB');
    // The fireworks ride the same gate as the count-up.
    expect(container!.querySelector('[data-testid="fireworks"]')).not.toBeNull();

    await act(async () => { frames.shift()!(0); });
    await act(async () => { frames.shift()!(200); });
    expect(figure()).not.toBe('+5GB');
    expect(figure()).not.toBe('+2,048GB');

    // Past the duration it settles exactly on the purchased figure.
    await act(async () => { frames.shift()!(5000); });
    expect(figure()).toBe('+2,048GB');

    vi.unstubAllGlobals();
  });

  it('sends a visit without a purchase to billing', async () => {
    script({});
    await render('/checkout/success');
    expect(currentLocation).toBe('/billing');
    expect(api).not.toHaveBeenCalled();
  });

  it('refuses a made-up session id', async () => {
    script({
      '/api/billing/sync': { ok: true },
      '/api/billing/status': status(),
      '/api/billing/receipt': new ApiError(404, '{"error":"Receipt not found"}'),
    });

    await render('/checkout/success?session_id=cs_test_somebodyelsessession');

    expect(currentLocation).toBe('/billing');
    expect(container!.textContent).not.toContain('Purchase complete');
  });

  it('refuses ?change=1 when this tab did not just change a plan', async () => {
    script({});
    await render('/checkout/success?change=1');
    expect(currentLocation).toBe('/billing');
    expect(api).not.toHaveBeenCalled();
  });

  it('lets a plan change through only once', async () => {
    rememberPlanChange();
    script({
      '/api/billing/sync': { ok: true },
      '/api/billing/status': status({ limit: TB }),
      '/api/billing/receipt': {
        ok: true, kind: 'change', next_amount: 850, currency: 'usd', next_invoice_at: 1_802_000_000,
        email: 'me@example.test', card: null,
      },
    });

    await render('/checkout/success?change=1');
    expect(container!.textContent).toContain('Plan updated');

    if (root) act(() => root!.unmount());
    container?.remove();
    // Reloading the same URL is a fresh visit, and the marker is spent.
    await render('/checkout/success?change=1');
    expect(currentLocation).toBe('/billing');
  });
});
