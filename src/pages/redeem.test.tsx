import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const api = vi.fn();
// The review step also reads /api/billing/status for the storage panel; keep it
// off the ordered redemption mock so each test only scripts the claim calls.
const billingApi = vi.fn();
// PublicNav probes /api/me on mount; keep it off the ordered redemption mock.
const meApi = vi.fn();

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    api: (...args: unknown[]) =>
      args[0] === '/api/billing/status' ? billingApi(...args)
        : args[0] === '/api/me' ? meApi(...args)
          : api(...args),
  };
});

import { ApiError } from '@/api/client';
import { REDEMPTION_CLAIM_KEY, rememberRedemptionProvider } from '@/lib/redemption-claim';
import RedeemPage from './redeem';

const CLAIM = 'R'.repeat(40);
const CODE = 'AAAA-BBBB-CCCC-DDDD';
const CLAIM_PATH = `/api/licenses/redemption-claims/${CLAIM}`;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let currentLocation: string | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  currentLocation = null;
  api.mockReset();
  billingApi.mockReset();
  meApi.mockReset();
  sessionStorage.clear();
  document.querySelector('meta[name="referrer"][data-redemption-page]')?.remove();
});

function preview(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    state: 'ready',
    provider: 'gumroad',
    packageName: '1 TB package',
    storageBytes: 1024 ** 4,
    storageLabel: '1 TB',
    interval: 'month',
    accountEmail: 'account@example.test',
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  useEffect(() => {
    currentLocation = `${location.pathname}${location.search}`;
  }, [location.pathname, location.search]);
  return null;
}

async function render(entry = '/redeem') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/redeem" element={<><LocationProbe /><RedeemPage /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInput(value: string) {
  const input = container!.querySelector<HTMLInputElement>('input[name="license-code"]')!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  billingApi.mockRejectedValue(new ApiError(503, JSON.stringify({ error: 'Unavailable' })));
  meApi.mockRejectedValue(new ApiError(401, JSON.stringify({ error: 'Not authenticated' })));
});

describe('Redemption page', () => {
  it('captures provider/code, strips the secret URL, and stores only the opaque claim', async () => {
    api.mockResolvedValueOnce({ ok: true, claim: CLAIM });
    api.mockRejectedValueOnce(new ApiError(401, JSON.stringify({ error: 'Authentication required.' })));

    await render(`/redeem?provider=gumroad&code=${encodeURIComponent(CODE)}&next=https%3A%2F%2Fevil.test`);

    expect(currentLocation).toBe('/redeem');
    expect(api).toHaveBeenNthCalledWith(1, '/api/licenses/redemption-intents', {
      method: 'POST',
      body: JSON.stringify({ provider: 'gumroad', code: CODE }),
    });
    expect(api).toHaveBeenNthCalledWith(2, CLAIM_PATH);
    expect(sessionStorage.getItem(REDEMPTION_CLAIM_KEY)).toBe(CLAIM);
    expect([...Array(sessionStorage.length)].map((_, index) => sessionStorage.getItem(sessionStorage.key(index)!)))
      .not.toContain(CODE);
    expect(container!.textContent).toContain('Sign in to continue');
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
  });

  it('asks for the source first, then offers Gumroad code entry', async () => {
    await render();
    expect(container!.textContent).toContain('Where did you get your code?');
    expect(api).not.toHaveBeenCalled();
    const gumroad = [...container!.querySelectorAll('button')].find((button) => button.textContent?.includes('Gumroad'))!;
    await act(async () => { gumroad.click(); });
    expect(container!.textContent).toContain('Enter your Gumroad license code');

    api.mockResolvedValueOnce({ ok: true, claim: CLAIM });
    api.mockRejectedValueOnce(new ApiError(401, JSON.stringify({ error: 'Authentication required.' })));
    setInput(CODE);
    const submit = [...container!.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Continue'))!;
    await act(async () => {
      submit.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api).toHaveBeenCalledWith('/api/licenses/redemption-intents', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ provider: 'gumroad', code: CODE }),
    }));
    expect(container!.textContent).toContain('Sign in to continue');
  });

  it('shows sign-in and account creation actions without losing the claim', async () => {
    sessionStorage.setItem(REDEMPTION_CLAIM_KEY, CLAIM);
    api.mockRejectedValueOnce(new ApiError(401, JSON.stringify({ error: 'Authentication required.' })));

    await render();

    const links = [...container!.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toContainEqual(['Sign in', '/login']);
    expect(links).toContainEqual(['Create account', '/sign-up']);
    expect(sessionStorage.getItem(REDEMPTION_CLAIM_KEY)).toBe(CLAIM);
  });

  it('shows the verified package, recurrence, account, and explicit accept action', async () => {
    sessionStorage.setItem(REDEMPTION_CLAIM_KEY, CLAIM);
    api.mockResolvedValueOnce(preview());

    await render();

    expect(container!.textContent).toContain('1 TB package');
    expect(container!.textContent).toContain('1 TB');
    expect(container!.textContent).toContain('Monthly');
    expect(container!.textContent).toContain('account@example.test');
    expect([...container!.querySelectorAll('button')].some((button) => button.textContent?.includes('Accept package'))).toBe(true);
  });

  it('activates the exact claim, shows the stacked total, and clears continuation state', async () => {
    sessionStorage.setItem(REDEMPTION_CLAIM_KEY, CLAIM);
    api.mockResolvedValueOnce(preview());
    api.mockResolvedValueOnce({
      ok: true,
      grantId: 'lic_1',
      provider: 'gumroad',
      packageName: '1 TB package',
      storageBytes: 1024 ** 4,
      contributionBytes: 1024 ** 4,
      totalStorageBytes: 3 * 1024 ** 4,
      interval: 'month',
      alreadyActive: false,
    });
    await render();

    const button = [...container!.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.includes('Accept package'))!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(api).toHaveBeenLastCalledWith(`${CLAIM_PATH}/activate`, { method: 'POST' });
    expect(container!.textContent).toContain('Package added');
    expect(container!.textContent).toContain('3 TB total storage');
    expect(sessionStorage.getItem(REDEMPTION_CLAIM_KEY)).toBeNull();
  });

  it('keeps retryable claims and clears terminal claims', async () => {
    sessionStorage.setItem(REDEMPTION_CLAIM_KEY, CLAIM);
    api.mockRejectedValueOnce(new ApiError(502, JSON.stringify({
      error: 'We could not verify this license right now. Please try again.',
      retryable: true,
    })));
    await render();
    expect(container!.textContent).toContain('Try again');
    expect(sessionStorage.getItem(REDEMPTION_CLAIM_KEY)).toBe(CLAIM);

    api.mockRejectedValueOnce(new ApiError(410, JSON.stringify({
      error: 'This redemption link has expired.', code: 'claim_expired', retryable: false,
    })));
    const retry = [...container!.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Try again'))!;
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('link has expired');
    expect(sessionStorage.getItem(REDEMPTION_CLAIM_KEY)).toBeNull();
  });

  it('projects the new total from current storage before the package is accepted', async () => {
    sessionStorage.setItem(REDEMPTION_CLAIM_KEY, CLAIM);
    api.mockResolvedValueOnce(preview());
    billingApi.mockReset();
    billingApi.mockResolvedValueOnce({
      ok: true,
      usage: { used_bytes: 0, used_label: '200 GB', limit_bytes: 2 * 1024 ** 4, limit_label: '2 TB', pct: 0 },
      license_grants: [{ id: 'lic_0', provider: 'gumroad', package_name: 'Older package', storage_bytes: 1024 ** 4,
        storage_label: '1 TB', interval: 'year', status: 'active', linked_at: 1, provider_end_at: null, contribution_bytes: 1024 ** 4 }],
    });

    await render();
    await act(async () => { await Promise.resolve(); });

    expect(billingApi).toHaveBeenCalledWith('/api/billing/status', { cache: 'no-store' });
    expect(container!.textContent).toContain('After you accept');
    expect(container!.textContent).toContain('3 TB');
    expect(container!.textContent).toContain('Up from 2 TB');
    expect(container!.textContent).toContain('Redeemed packages (1)');
  });

  it('marks the current step in the progress rail', async () => {
    await render();
    expect(container!.querySelector('[aria-current="step"]')?.textContent).toContain('Source');

    const gumroad = [...container!.querySelectorAll('button')].find((button) => button.textContent?.includes('Gumroad'))!;
    await act(async () => { gumroad.click(); });
    expect(container!.querySelector('[aria-current="step"]')?.textContent).toContain('Code');
  });

  it('lists the three sources and hands dosya.dev buyers to Billing', async () => {
    await render();
    const rows = [...container!.querySelectorAll('[data-source]')];
    expect(rows.map((row) => row.getAttribute('data-source'))).toEqual(['gumroad', 'voucher', 'billing']);
    const billing = container!.querySelector('a[data-source="billing"]')!;
    expect(billing.getAttribute('href')).toBe('/billing');
  });

  it('collects a coupon code and sends it as the voucher provider', async () => {
    await render();
    const coupon = [...container!.querySelectorAll('button')].find((button) => button.textContent?.includes('Coupon code'))!;
    await act(async () => { coupon.click(); });
    expect(container!.textContent).toContain('Enter your coupon code');
    expect(container!.querySelector<HTMLInputElement>('input[name="license-code"]')!.placeholder).toBe('DOSYA-XXXX-XXXX-XXXX');

    api.mockResolvedValueOnce({ ok: true, claim: CLAIM });
    api.mockRejectedValueOnce(new ApiError(401, JSON.stringify({ error: 'Authentication required.' })));
    setInput('dosya-ab2c-def3-ghj4');
    const submit = [...container!.querySelectorAll('button')].find((button) => button.textContent?.includes('Continue'))!;
    await act(async () => {
      submit.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api).toHaveBeenCalledWith('/api/licenses/redemption-intents', expect.objectContaining({
      body: JSON.stringify({ provider: 'voucher', code: 'dosya-ab2c-def3-ghj4' }),
    }));
    expect(container!.textContent).toContain('Coupon code');
    expect(container!.textContent).toContain('Held in this tab');
  });

  it('drops a half-typed code when the source changes', async () => {
    await render();
    const pick = (name: string) => [...container!.querySelectorAll('button')].find((button) => button.textContent?.includes(name))!;
    await act(async () => { pick('Gumroad').click(); });
    setInput(CODE);
    expect(container!.querySelector<HTMLInputElement>('input[name="license-code"]')!.value).toBe(CODE);

    const back = [...container!.querySelectorAll('button')].find((button) => button.textContent?.includes('Back'))!;
    await act(async () => { back.click(); });
    await act(async () => { pick('Coupon code').click(); });

    expect(container!.querySelector<HTMLInputElement>('input[name="license-code"]')!.value).toBe('');
    expect(api).not.toHaveBeenCalled();
  });

  it('remembers the coupon source for a claim picked up after sign-in', async () => {
    sessionStorage.setItem(REDEMPTION_CLAIM_KEY, CLAIM);
    rememberRedemptionProvider('voucher');
    api.mockRejectedValueOnce(new ApiError(401, JSON.stringify({ error: 'Authentication required.' })));

    await render();

    expect(container!.textContent).toContain('Sign in to continue');
    expect(container!.textContent).toContain('Coupon code');
    expect(container!.textContent).not.toContain('Gumroad license');
  });

  it('captures a voucher link and skips the source step', async () => {
    api.mockResolvedValueOnce({ ok: true, claim: CLAIM });
    api.mockRejectedValueOnce(new ApiError(401, JSON.stringify({ error: 'Authentication required.' })));

    await render('/redeem?provider=voucher&code=DOSYA-AB2C-DEF3-GHJ4');

    expect(currentLocation).toBe('/redeem');
    expect(api).toHaveBeenNthCalledWith(1, '/api/licenses/redemption-intents', {
      method: 'POST',
      body: JSON.stringify({ provider: 'voucher', code: 'DOSYA-AB2C-DEF3-GHJ4' }),
    });
    expect(container!.textContent).toContain('Sign in to continue');
  });

  it('reviews a voucher with its end date and no interval', async () => {
    const endsAt = 1_800_000_000;
    const endsLabel = new Date(endsAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    sessionStorage.setItem(REDEMPTION_CLAIM_KEY, CLAIM);
    api.mockResolvedValueOnce(preview({
      provider: 'voucher',
      packageName: '3-month test drive',
      storageBytes: 2 * 1024 ** 4,
      storageLabel: '2 TB',
      interval: null,
      endsAt,
    }));

    await render();

    expect(container!.textContent).toContain('Add 3-month test drive?');
    expect(container!.textContent).toContain('Coupon code');
    expect(container!.textContent).toContain(`Ends ${endsLabel}`);
    expect(container!.textContent).not.toContain('Monthly');
    expect(container!.textContent).not.toContain('Gumroad');
  });

  it('explains a used coupon code and offers another code', async () => {
    sessionStorage.setItem(REDEMPTION_CLAIM_KEY, CLAIM);
    api.mockRejectedValueOnce(new ApiError(409, JSON.stringify({
      error: 'This coupon code was already used.', code: 'voucher_used',
    })));

    await render();

    expect(container!.textContent).toContain('This code was already used');
    expect(sessionStorage.getItem(REDEMPTION_CLAIM_KEY)).toBeNull();
    const again = [...container!.querySelectorAll('button')].find((button) => button.textContent?.includes('Enter another code'))!;
    await act(async () => { again.click(); });
    expect(container!.textContent).toContain('Where did you get your code?');
  });

  it('keeps the held code and asks the user to wait when coupon attempts are locked', async () => {
    sessionStorage.setItem(REDEMPTION_CLAIM_KEY, CLAIM);
    api.mockRejectedValueOnce(new ApiError(429, JSON.stringify({
      error: 'Too many coupon code attempts. Try again in 15 minutes.', code: 'redeem_locked', retry_after: 1_900_000_000,
    })));

    await render();

    expect(container!.textContent).toContain('Too many attempts');
    expect(container!.textContent).toContain('Try again in 15 minutes');
    expect(container!.textContent).toContain('still held in this tab');
    expect(sessionStorage.getItem(REDEMPTION_CLAIM_KEY)).toBe(CLAIM);
    expect([...container!.querySelectorAll('button')].some((button) => button.textContent?.includes('Try again'))).toBe(true);
  });
});
