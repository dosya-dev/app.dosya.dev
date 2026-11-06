/**
 * RTL sweep of src/pages: screens rendered in Arabic carry no physical-direction
 * class, English keeps its text, and the page sources hold only the findings
 * that belong to Tasks 6 and 7 (charts, the usage bar, the map, directional icons).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { physicalClassesIn, renderInLocale, type Rendered } from '../../../tests/helpers/i18n-sweep';
// @ts-expect-error plain .mjs script without types
import { gateFindings } from '../../../scripts/rtl-codemod.mjs';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, API_BASE: '', api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/components/turnstile-widget', () => ({ TurnstileWidget: () => <div data-testid="turnstile" /> }));
vi.mock('@/lib/upload-runner', () => ({ cancelAll: () => {} }));
vi.mock('@/lib/logout', () => ({ logoutAndRedirect: () => {}, logoutAndRedirectTo: () => {} }));
const getBillingStatus = vi.fn();
vi.mock('@/api/family', () => ({
  getFamily: vi.fn().mockResolvedValue({ ok: true, role: 'none', limit: 5, eligible: false, ineligible_reason: 'free_plan', pool: { used_bytes: 0, limit_bytes: 1, used_label: '0 B', limit_label: '5 GB' }, plan: { id: 'free', name: 'Free' }, payer: null, members: [] }),
  inviteFamilyMember: vi.fn(), revokeFamilyInvite: vi.fn(), removeFamilyMember: vi.fn(), leaveFamily: vi.fn(),
  previewFamilyJoin: vi.fn(), acceptFamilyJoin: vi.fn(),
}));
vi.mock('@/api/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/billing')>();
  return { ...actual, getBillingStatus: () => getBillingStatus(), getCatalog: vi.fn().mockResolvedValue(null) };
});

const LoginPage = (await import('@/pages/login')).default;
const Login2faPage = (await import('@/pages/login-2fa')).default;
const SignUpPage = (await import('@/pages/sign-up')).default;
const ForgotPasswordPage = (await import('@/pages/forgot-password')).default;
const ResetPasswordPage = (await import('@/pages/reset-password')).default;
const VerifyPage = (await import('@/pages/verify')).default;
const RedeemPage = (await import('@/pages/redeem')).default;
const CreateWorkspacePage = (await import('@/pages/create-workspace')).default;
const BillingPage = (await import('@/pages/billing')).default;

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  getBillingStatus.mockReset();
  sessionStorage.clear();
  localStorage.clear();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function show(ui: React.ReactElement, locale: 'ar' | 'en', entry = '/') {
  apiMock.mockResolvedValue({ ok: false });
  shown = await renderInLocale(<MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter>, locale);
  for (let i = 0; i < 4; i++) await flush();
  return shown;
}

const GB = 1024 ** 3;
const TB = 1024 ** 4;
const BILLING = {
  ok: true,
  plan: { id: 'pro', name: 'Pro', storage_bytes: 2 * TB, storage_label: '2 TB', price_monthly: 2499, price_yearly: null },
  usage: { used_bytes: 612 * GB, used_label: '612 GB', limit_bytes: 3 * TB, limit_label: '3 TB', pct: 20 },
  subscription: { status: 'active', current_period_end: 1_800_000_000, has_subscription: true, cancel_at_period_end: false, grace_period_end: null },
  interval: 'month',
  items: [{ kind: 'plan', ref_id: 'pro', quantity: 1, storage_bytes: 2 * TB, total_bytes: 2 * TB, total_label: '2 TB', interval: 'month' }],
  referral_bonus_bytes: 10 * GB,
  license_grants: [{ id: 'lic_1', provider: 'gumroad', package_name: 'Big package', storage_bytes: 5 * GB, storage_label: '5 GB', interval: 'year', status: 'active', linked_at: 1_700_000_000, provider_end_at: null, contribution_bytes: 5 * GB, ends_at: null, renews_at: 1_790_000_000 }],
  invoices: [{ id: 'in_1', period_start: 1_794_000_000, period_end: 1_797_000_000, amount: 2499, status: 'paid', pdf_url: 'https://stripe.test/i.pdf' }],
};

const SIGNED_OUT: Array<[string, () => React.ReactElement, string]> = [
  ['sign in', () => <LoginPage />, '/login'],
  ['two-factor', () => <Login2faPage />, '/login/2fa'],
  ['sign up', () => <SignUpPage />, '/sign-up'],
  ['forgot password', () => <ForgotPasswordPage />, '/forgot-password'],
  ['reset password', () => <ResetPasswordPage />, '/reset-password?token=t'],
  ['verify', () => <VerifyPage />, '/verify'],
  ['redeem', () => <RedeemPage />, '/redeem'],
  ['create workspace', () => <CreateWorkspacePage />, '/create-workspace'],
];

describe('pages in Arabic carry no physical-direction class', () => {
  for (const [name, ui, entry] of SIGNED_OUT) {
    it(name, async () => {
      await show(ui(), 'ar', entry);
      expect(shown!.container.textContent?.trim().length).toBeGreaterThan(0);
      expect(physicalClassesIn(document.body)).toEqual([]);
    });
  }

  it('billing', async () => {
    getBillingStatus.mockResolvedValue(BILLING);
    await show(<BillingPage />, 'ar', '/billing');
    expect(document.body.textContent).toContain('Pro');
    expect(physicalClassesIn(document.body)).toEqual([]);
  });
});

describe('English renders the same layout classes as before', () => {
  it('sign in keeps start-aligned text and its show-password button on the end side', async () => {
    await show(<LoginPage />, 'en', '/login');
    expect(shown!.container.textContent).toContain('Welcome back');
    expect(document.documentElement.dir).toBe('ltr');
    expect(physicalClassesIn(document.body)).toEqual([]);
    const toggle = shown!.container.querySelector('button.absolute');
    expect(toggle).not.toBeNull();
    expect(toggle!.className).toContain('inset-e-0');
  });

  it('billing keeps its section text', async () => {
    getBillingStatus.mockResolvedValue(BILLING);
    await show(<BillingPage />, 'en', '/billing');
    expect(document.body.textContent).toContain('Invoices');
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe('page sources', () => {
  it('hold no unmarked physical direction', () => {
    const root = resolve(__dirname, '../../pages');
    const left: string[] = [];
    for (const file of walk(root)) {
      const rel = relative(root, file);
      const findings = gateFindings(readFileSync(file, 'utf8')) as Array<{ token: string; line: number }>;
      for (const f of findings) {
        left.push(`${rel}:${f.line} ${f.token}`);
      }
    }
    expect(left).toEqual([]);
  });
});
