/**
 * Billing, checkout and API keys in Turkish: every heading, label, dialog,
 * tooltip and toast has no English left. Prices, plan names, card brands,
 * invoice numbers, key names and scopes, coupon codes and server messages stay
 * as sent.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';
import type { ApiKey } from '@/lib/api-keys';

const getBillingStatus = vi.fn();
const syncBilling = vi.fn();
const createPortalSession = vi.fn();
const resumeSubscription = vi.fn();
const requestRefund = vi.fn();
const cancelSubscription = vi.fn();
const getCatalog = vi.fn();
const previewSubscription = vi.fn();
const updateSubscription = vi.fn();
const startCheckout = vi.fn();
const validateCoupon = vi.fn();
const getFamily = vi.fn();
const inviteFamilyMember = vi.fn();
const api = vi.fn();

vi.mock('@/api/family', () => ({
  getFamily: () => getFamily(),
  inviteFamilyMember: (e: string) => inviteFamilyMember(e),
  revokeFamilyInvite: vi.fn(), removeFamilyMember: vi.fn(), leaveFamily: vi.fn(),
}));
vi.mock('@/api/billing', () => ({
  getBillingStatus: () => getBillingStatus(),
  syncBilling: () => syncBilling(),
  createPortalSession: () => createPortalSession(),
  resumeSubscription: () => resumeSubscription(),
  requestRefund: (ids: string[]) => requestRefund(ids),
  cancelSubscription: () => cancelSubscription(),
  getCatalog: () => getCatalog(),
  previewSubscription: (c: unknown) => previewSubscription(c),
  updateSubscription: (c: unknown) => updateSubscription(c),
  startCheckout: (c: unknown) => startCheckout(c),
  validateCoupon: (...a: unknown[]) => validateCoupon(...a),
}));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, API_BASE: '', api: (...args: unknown[]) => api(...args) };
});

const BillingPage = (await import('@/pages/billing')).default;
const CheckoutSuccessPage = (await import('@/pages/checkout-success')).default;
const { PlanChooser } = await import('@/components/billing/plan-chooser');
const { FamilyCard } = await import('@/components/billing/family-card');
const { FamilyPlacesDialog } = await import('@/components/billing/family-places-dialog');
const { ApiKeysSection } = await import('@/components/api-keys/api-keys-section');
const { useSession } = await import('@/stores/session');
const { ApiError, apiErrorMessage, responseErrorMessage } = await import('@/api/client');
const { req } = await import('@/api/req');
const { humanizeApiError } = await import('@/api/error-copy');
const { friendStatusLabel } = await import('@/api/referrals');
const { groupByDay } = await import('@/lib/notifications');
const { licenseTimeline, licenseIntervalLabel, licenseProviderLabel } = await import('@/lib/license-timeline');
const { describeDraft, emptyDraft, formatLastUsed, formatSurfaces, formatActiveHours, formatAnchor, SCOPE_LABELS, SCOPE_OPTIONS, EXPIRY_OPTIONS, DAY_OPTIONS, SURFACE_OPTIONS, keyGuards, draftGuards } = await import('@/lib/api-keys');
const { rememberStorageBeforePurchase, rememberPlanChange } = await import('@/lib/checkout-return');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;
const { t: moduleT } = await import('@/lib/i18n');

const GB = 1024 ** 3;
const TB = 1024 ** 4;
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;

let shown: Rendered | null = null;
vi.setConfig({ testTimeout: 20_000 });
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number; pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; this.pointerType = init.pointerType ?? 'mouse'; }
    }
    (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
  }
});
beforeEach(() => {
  sessionStorage.clear();
  getFamily.mockResolvedValue({ ok: true, role: 'none', limit: 5, eligible: false, ineligible_reason: 'free_plan', pool: { used_bytes: 0, limit_bytes: 1, used_label: '0 B', limit_label: '5 GB' }, plan: { id: 'free', name: 'Free' }, payer: null, members: [] });
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  for (const m of [getBillingStatus, syncBilling, createPortalSession, resumeSubscription, requestRefund, cancelSubscription, getCatalog, previewSubscription, updateSubscription, startCheckout, validateCoupon, getFamily, inviteFamilyMember, api]) m.mockReset();
  useSession.setState({ user: null });
  window.history.replaceState({}, '', '/billing');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function show(ui: React.ReactElement, url = '/') {
  shown = await renderInLocale(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>, 'tr');
  for (let i = 0; i < 5; i++) await flush();
  return shown;
}
const buttons = () => [...document.querySelectorAll<HTMLElement>('button, a, [role="tab"], summary')];
function clickText(text: string, which: 'first' | 'last' = 'last') {
  const matches = buttons().filter((n) => n.textContent?.trim() === text);
  const el = which === 'first' ? matches[0] : matches.pop();
  expect(el, `no button/link "${text}"`).toBeDefined();
  return act(async () => { el!.click(); });
}
const text = () => document.body.textContent ?? '';
async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// Server text and user content the sweep helper would otherwise flag: plan names, card brands.
const FROM_SERVER = /^(Free|Pro|Visa|Starter|Plus)$/;
const mine = (texts: string[]) => texts.filter((x) => !FROM_SERVER.test(x));

// ── Billing page ────────────────────────────────────────────────────

function status(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    plan: { id: 'pro', name: 'Pro', storage_bytes: 2 * TB, storage_label: '2 TB', price_monthly: 2499, price_yearly: null },
    usage: { used_bytes: 612 * GB, used_label: '612 GB', limit_bytes: 3 * TB + 5 * GB, limit_label: '3 TB', pct: 20 },
    subscription: { status: 'active', current_period_end: 1_800_000_000, has_subscription: true, cancel_at_period_end: false, grace_period_end: null },
    interval: 'month',
    items: [
      { kind: 'plan', ref_id: 'pro', quantity: 1, storage_bytes: 2 * TB, total_bytes: 2 * TB, total_label: '2 TB', interval: 'month' },
      { kind: 'addon', ref_id: 'storage-1tb', quantity: 1, storage_bytes: TB, total_bytes: TB, total_label: '1 TB', interval: 'month' },
      { kind: 'custom', ref_id: 'c1', quantity: 1, storage_bytes: GB, total_bytes: GB, total_label: '1 GB', interval: 'month' },
    ],
    referral_bonus_bytes: 10 * GB,
    license_grants: [
      { id: 'lic_1', provider: 'gumroad', package_name: 'Big package', storage_bytes: 5 * GB, storage_label: '5 GB', interval: 'year', status: 'active', linked_at: 1_700_000_000, provider_end_at: null, contribution_bytes: 5 * GB, ends_at: null, renews_at: 1_790_000_000 },
      { id: 'lic_2', provider: 'voucher', package_name: 'Coupon package', storage_bytes: GB, storage_label: '1 GB', interval: null, status: 'active', linked_at: 1_700_000_000, provider_end_at: null, contribution_bytes: GB, ends_at: NOW + 5 * DAY, renews_at: null },
      { id: 'lic_3', provider: 'gumroad', package_name: 'Old package', storage_bytes: GB, storage_label: '1 GB', interval: 'month', status: 'ended', linked_at: 1_700_000_000, provider_end_at: null, contribution_bytes: GB, ends_at: 1_750_000_000, renews_at: null },
      { id: 'lic_4', provider: 'other', package_name: 'Refunded package', storage_bytes: GB, storage_label: '1 GB', interval: 'quarter', status: 'revoked', linked_at: 1_700_000_000, provider_end_at: null, contribution_bytes: GB, ends_at: null, renews_at: null },
    ],
    invoices: [
      { id: 'upcoming', period_start: 1_797_000_000, period_end: 1_800_000_000, amount: 2499, status: 'upcoming', pdf_url: null },
      { id: 'in_1', period_start: 1_794_000_000, period_end: 1_797_000_000, amount: 2499, status: 'paid', pdf_url: 'https://stripe.test/i.pdf' },
    ],
    ...over,
  };
}
const refund = (o: Record<string, unknown> = {}) => ({
  eligible: true, reason: 'ok', amount: 1099, currency: 'usd', window_ends_at: NOW + DAY,
  charges: [{ id: 'ch_1', amount: 1099, created: 1_790_000_000, description: 'Subscription creation' }], ...o,
});

describe('billing page in Turkish', () => {
  it('subscription, ledger, invoices, redeemed packages and the trial notice', async () => {
    getBillingStatus.mockResolvedValue(status({ refund: refund() }));
    api.mockResolvedValue({ card: { brand: 'visa', last4: '4242' } });
    const r = await show(<BillingPage />);
    expect(text()).toContain(tr['common.heading.billing']);
    expect(text()).toContain(tr['billing.heading.invoices']);
    expect(text()).toContain(tr['billing.heading.redeemedPackages']);
    expect(text()).toContain(tr['billing.label.storageLedger']);
    // The interval sits behind a select that cannot carry it; the workaround still puts the Turkish word there.
    expect(text()).toContain(` · ${tr['common.label.yearly']} · `);
    expect(text()).not.toMatch(/\btrue\b/);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('a running trial: card charge notice and the trial badge', async () => {
    const trialEnd = NOW + 5 * DAY;
    getBillingStatus.mockResolvedValue(status({ subscription: { status: 'active', current_period_end: trialEnd, has_subscription: true, cancel_at_period_end: false, grace_period_end: null, trial_end: trialEnd }, license_grants: [] }));
    api.mockResolvedValue({ card: null });
    const r = await show(<BillingPage />);
    expect(mine(r.leftover())).toEqual([]);
    getBillingStatus.mockResolvedValue(status({ subscription: { status: 'active', current_period_end: trialEnd, has_subscription: true, cancel_at_period_end: false, grace_period_end: null, trial_end: trialEnd }, license_grants: [], invoices: [] }));
  });

  it('over the limit and cancelling: both hero cards', async () => {
    getBillingStatus.mockResolvedValue(status({
      usage: { used_bytes: 4 * TB, used_label: '4 TB', limit_bytes: 3 * TB, limit_label: '3 TB', pct: 133 },
      subscription: { status: 'active', current_period_end: 1_800_000_000, has_subscription: true, cancel_at_period_end: true, grace_period_end: null },
      refund: refund({ eligible: false, reason: 'already_used' }),
    }));
    api.mockResolvedValue({ card: { brand: 'mastercard', last4: '4444' } });
    const r = await show(<BillingPage />);
    expect(text()).toContain(tr['billing.description.uploadsArePausedAcrossEveryWorkspaceNothingHasBeenDeleted']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('a free account and a family member', async () => {
    getBillingStatus.mockResolvedValue(status({
      plan: { id: 'free', name: 'Free', storage_bytes: 5 * GB, storage_label: '5 GB', price_monthly: 0, price_yearly: null },
      usage: { used_bytes: 4.5 * GB, used_label: '4.5 GB', limit_bytes: 5 * GB, limit_label: '5 GB', pct: 90 },
      subscription: { status: null, current_period_end: null, has_subscription: false, cancel_at_period_end: false, grace_period_end: null },
      items: [], license_grants: [], invoices: [], referral_bonus_bytes: 0,
    }));
    const r = await show(<BillingPage />);
    expect(text()).toContain(tr['billing.action.chooseAPlan']);
    expect(text()).toContain(tr['billing.label.noInvoicesYet']);
    expect(mine(r.leftover())).toEqual([]);
    shown!.unmount(); shown = null;
    useSession.setState({ user: { family: { role: 'member' } } as never });
    getBillingStatus.mockResolvedValue(status());
    api.mockResolvedValue({ card: null });
    const r2 = await show(<BillingPage />);
    expect(text()).toContain(tr['billing.description.youAreOnAFamilyPlanLeaveItFromTheFamilySectionToBuyAPlanOfYourOwn'] ?? '');
    expect(mine(r2.leftover())).toEqual([]);
  });

  it('a load failure', async () => {
    getBillingStatus.mockRejectedValue(new Error('boom'));
    const r = await show(<BillingPage />);
    expect(text()).toContain(tr['billing.error.failedToLoadBillingInformation']);
    expect(r.leftover()).toEqual([]);
  });

  it('refund dialog with family members and a toast', async () => {
    getBillingStatus.mockResolvedValue(status({ refund: refund(), license_grants: [] , usage: { used_bytes: 9 * GB, used_label: '9 GB', limit_bytes: 20 * GB, limit_label: '20 GB', pct: 45 } }));
    api.mockResolvedValue({ card: null });
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, eligible: true, ineligible_reason: null, pool: { used_bytes: 1, limit_bytes: 2, used_label: '1 GB', limit_label: '2 GB' }, plan: { id: 'pro', name: 'Pro' }, payer: null, members: [{ id: 'm1', email: 'a@x.test', name: 'Ada', status: 'active', joined_at: 1, expires_at: null }, { id: 'm2', email: 'b@x.test', name: 'Bob', status: 'active', joined_at: 1, expires_at: null }] });
    const r = await show(<BillingPage />);
    await clickText(tr['billing.action.requestRefund']);
    await flush();
    expect(text()).toContain(tr['billing.description.youCanUseASelfServeRefundOnce']);
    expect(mine(r.leftover())).toEqual([]);
    expect(text()).toContain('Subscription creation');
  });

  it('cancel dialog for a subscription and for a trial', async () => {
    getBillingStatus.mockResolvedValue(status({ usage: { used_bytes: 9 * GB, used_label: '9 GB', limit_bytes: 20 * GB, limit_label: '20 GB', pct: 45 } }));
    api.mockResolvedValue({ card: null });
    const r = await show(<BillingPage />);
    await clickText(tr['billing.action.cancelSubscription'], 'first');
    expect(text()).toContain(tr['billing.description.youKeepTheOldStorageLimitFor14MoreDaysAsAGracePeriodOnceTheSubscriptionEnds'] ?? tr['billing.description.youKeepTheOldStorageLimitFor14MoreDaysAs']);
    expect(mine(r.leftover())).toEqual([]);
    shown!.unmount(); shown = null;
    const trialEnd = NOW + 4 * DAY;
    getBillingStatus.mockResolvedValue(status({ subscription: { status: 'active', current_period_end: trialEnd, has_subscription: true, cancel_at_period_end: false, grace_period_end: null, trial_end: trialEnd }, usage: { used_bytes: 9 * GB, used_label: '9 GB', limit_bytes: 20 * GB, limit_label: '20 GB', pct: 45 }, license_grants: [] }));
    const r2 = await show(<BillingPage />);
    await clickText(tr['billing.action.cancelSubscription'], 'first');
    expect(text()).toContain(tr['billing.heading.cancelYourTrial']);
    expect(mine(r2.leftover())).toEqual([]);
  });

  it('the resume failure line is Turkish', async () => {
    getBillingStatus.mockResolvedValue(status({ subscription: { status: 'active', current_period_end: 1_800_000_000, has_subscription: true, cancel_at_period_end: true, grace_period_end: null }, license_grants: [] }));
    api.mockResolvedValue({ card: null });
    resumeSubscription.mockRejectedValue('x');
    await show(<BillingPage />);
    await clickText(tr['billing.action.resumeSubscription']);
    await flush();
    expect(text()).toContain(tr['billing.error.couldNotResumeTheSubscription']);
  });
});

// ── Plan chooser ────────────────────────────────────────────────────

const CATALOG = {
  ok: true,
  plans: [
    { id: 'free', name: 'Free', storage_bytes: 5 * GB, storage_label: '5 GB', price_monthly: 0, price_yearly: null, price_monthly_label: '$0', price_yearly_label: null, features: [], has_monthly: true, has_yearly: true },
    { id: 'starter', name: 'Starter', storage_bytes: 100 * GB, storage_label: '100 GB', price_monthly: 399, price_yearly: 3999, price_monthly_label: '$3.99', price_yearly_label: '$39.99', features: [], has_monthly: true, has_yearly: true },
    { id: 'pro', name: 'Pro', storage_bytes: 2 * TB, storage_label: '2 TB', price_monthly: 2499, price_yearly: 24990, price_monthly_label: '$24.99', price_yearly_label: '$249.90', features: [], has_monthly: true, has_yearly: false },
  ],
  addons: [
    { id: 'storage-1tb', name: '1 TB add-on', kind: 'storage', storage_bytes: TB, storage_label: '1 TB', price_monthly: 999, price_yearly: null, price_monthly_label: '$9.99', price_yearly_label: null, max_quantity: 5, has_monthly: true, has_yearly: false },
  ],
};

describe('plan chooser in Turkish', () => {
  it('plan mode: intervals, add-ons, promo code, summary and the downgrade warning', async () => {
    getCatalog.mockResolvedValue(CATALOG);
    previewSubscription.mockResolvedValue({ ok: true, amount_due: 1234, currency: 'usd' });
    validateCoupon.mockResolvedValue({ ok: true, code: 'SAVE10', type: 'percent', value: 10, currency: null, duration: 'repeating', duration_in_months: 3, intervals: null });
    const r = await show(<PlanChooser hasSubscription trialEligible={false} usedBytes={50 * GB} currentPlanId="pro" initial={{ interval: 'month', planId: 'starter', addonQty: { 'storage-1tb': 1 } }} onUpdated={() => {}} onClose={() => {}} />);
    await flush();
    expect(text()).toContain(tr['billing.heading.changeYourPlan']);
    expect(text()).toContain(tr['billing.label.size']);
    expect(mine(r.leftover())).toEqual([]);
    // coupon
    await typeInto(document.querySelector<HTMLInputElement>(`input[placeholder="${tr['billing.placeholder.enterCode']}"]`)!, 'SAVE10');
    await clickText(tr['common.apply']);
    await flush();
    expect(text()).toContain('SAVE10 kodu uygulandı · 3 ay geçerlidir.');
    expect(mine(r.leftover())).toEqual([]);
    // annual interval drops the add-on and the pro plan
    // Starter: 39.99 a year against 12 x 3.99 is 16 % less (floored).
    await clickText(tr['billing.action.yearly'] + tr['billing.label.percentOff'].replace('{percent}', '16'));
    expect(mine(r.leftover())).toEqual([]);
  });

  it('add-ons mode, first purchase with a trial offer', async () => {
    getCatalog.mockResolvedValue(CATALOG);
    const r = await show(<PlanChooser hasSubscription={false} trialEligible usedBytes={1 * GB} currentPlanId="free" initial={{ interval: 'month', planId: 'starter', addonQty: {} }} onUpdated={() => {}} onClose={() => {}} />);
    await flush();
    expect(text()).toContain(tr['billing.action.start7DayFreeTrial']);
    expect(mine(r.leftover())).toEqual([]);
    shown!.unmount(); shown = null;
    const r2 = await show(<PlanChooser hasSubscription trialEligible={false} usedBytes={400 * GB} currentPlanId="starter" mode="addons" initial={{ interval: 'year', planId: 'starter', addonQty: { 'storage-1tb': 2 } }} onUpdated={() => {}} onClose={() => {}} />);
    await flush();
    expect(mine(r2.leftover())).toEqual([]);
  });

  it('an unavailable plan on the interval and a failed catalog load', async () => {
    getCatalog.mockResolvedValue(CATALOG);
    const r = await show(<PlanChooser hasSubscription={false} usedBytes={0} currentPlanId="free" initial={{ interval: 'year', planId: 'pro', addonQty: { 'storage-1tb': 1 } }} onUpdated={() => {}} onClose={() => {}} />);
    await flush();
    expect(mine(r.leftover())).toEqual([]);
    shown!.unmount(); shown = null;
    getCatalog.mockRejectedValue(new Error('x'));
    const r2 = await show(<PlanChooser hasSubscription={false} usedBytes={0} initial={{ interval: 'month', planId: 'starter', addonQty: {} }} onUpdated={() => {}} onClose={() => {}} />);
    await flush();
    expect(mine(r2.leftover())).toEqual([]);
  });

  it('a code limited to the other billing period is removed with a Turkish note', async () => {
    getCatalog.mockResolvedValue(CATALOG);
    validateCoupon.mockResolvedValue({ ok: true, code: 'YEARONLY', type: 'percent', value: 10, currency: null, duration: 'once', duration_in_months: null, intervals: ['year'] });
    const r = await show(<PlanChooser hasSubscription={false} usedBytes={0} initial={{ interval: 'year', planId: 'starter', addonQty: {} }} onUpdated={() => {}} onClose={() => {}} />);
    await flush();
    await typeInto(document.querySelector<HTMLInputElement>(`input[placeholder="${tr['billing.placeholder.enterCode']}"]`)!, 'YEARONLY');
    await clickText(tr['common.apply']);
    await flush();
    expect(mine(r.leftover())).toEqual([]);
    await clickText(tr['billing.action.monthly']);
    await flush();
    expect(text()).toContain('YEARONLY');
    expect(mine(r.leftover())).toEqual([]);
  });
});

// ── Family ──────────────────────────────────────────────────────────

const POOL = { used_bytes: 1, limit_bytes: 2, used_label: '300 GB', limit_label: '1 TB' };
const BILLING = { interval: 'month', plan: { id: 'pro' }, usage: { limit_bytes: 2 }, subscription: { current_period_end: 1_800_000_000 }, items: [{ kind: 'plan', ref_id: 'pro', quantity: 1, unit_amount: 2499 }] } as never;

describe('family plan in Turkish', () => {
  it('payer: members, pending invite, over capacity, tabs and the member action dialogs', async () => {
    getFamily.mockResolvedValue({
      ok: true, role: 'payer', limit: 3, included: 2, extra_places: 1, can_buy_places: true, over_capacity: true, eligible: true, ineligible_reason: null, pool: POOL, plan: { id: 'pro', name: 'Pro' }, payer: null,
      usage: [{ id: 'u1', name: 'Zeynep', is_you: false, is_payer: true, used_bytes: 1, used_label: '1 GB' }, { id: 'u2', name: 'Self', is_you: true, is_payer: false, used_bytes: 1, used_label: '2 GB' }],
      members: [{ id: 'a', email: 'a@x.test', name: 'Ada', status: 'active', joined_at: 1, expires_at: null, over_free: true }, { id: 'b', email: 'b@x.test', name: null, status: 'invited', joined_at: null, expires_at: 1_800_000_000 }, { id: 'c', email: 'c@x.test', name: null, status: 'invited', joined_at: null, expires_at: null }],
    });
    const r = await show(<FamilyCard billing={BILLING} />);
    expect(text()).toContain(tr['billing.action.purchaseMoreFamilySpots']);
    expect(mine(r.leftover())).toEqual([]);
    const titled = (title: string) => document.querySelector<HTMLElement>(`[title="${title}"]`)!;
    await act(async () => { titled(tr['billing.action.removeFromFamily']).click(); });
    expect(mine(r.leftover())).toEqual([]);
    await clickText(tr['family.action.keep']);
    await act(async () => { titled(tr['billing.action.sendTheInvitationAgain']).click(); });
    expect(mine(r.leftover())).toEqual([]);
    await clickText(tr['common.cancel']);
    await act(async () => { document.querySelectorAll<HTMLElement>(`[title="${tr['billing.action.revokeInvitation']}"]`)[0].click(); });
    expect(mine(r.leftover())).toEqual([]);
    await clickText(tr['family.action.keep']);
    await clickText(tr['common.label.members'] === 'x' ? '' : tr['billing.label.usage']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('member view with the leave confirmation, the free pitch, a full family and a load error', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'member', limit: 5, eligible: false, ineligible_reason: 'is_member', pool: POOL, plan: { id: 'pro', name: 'Pro' }, payer: { name: 'Ayse' }, members: null, own_used_label: '6 GB' });
    const r = await show(<FamilyCard billing={BILLING} />);
    expect(mine(r.leftover())).toEqual([]);
    await clickText(tr['family.action.leaveFamilyPlan']);
    expect(mine(r.leftover())).toEqual([]);
    shown!.unmount(); shown = null;
    getFamily.mockResolvedValue({ ok: true, role: 'none', limit: 5, eligible: false, ineligible_reason: 'free_plan', pool: POOL, plan: { id: 'free', name: 'Free' }, payer: null, members: [] });
    const r2 = await show(<FamilyCard billing={BILLING} />);
    expect(mine(r2.leftover())).toEqual([]);
    shown!.unmount(); shown = null;
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 1, eligible: false, ineligible_reason: null, pool: POOL, plan: { id: 'pro', name: 'Pro' }, payer: null, members: [{ id: 'a', email: 'a@x.test', name: 'Ada', status: 'active', joined_at: 1, expires_at: null }] });
    const r3 = await show(<FamilyCard billing={BILLING} />);
    expect(mine(r3.leftover())).toEqual([]);
    shown!.unmount(); shown = null;
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 1, eligible: true, ineligible_reason: null, pool: POOL, plan: { id: 'pro', name: 'Pro' }, payer: null, members: [{ id: 'a', email: 'a@x.test', name: 'Ada', status: 'active', joined_at: 1, expires_at: null }] });
    const r4 = await show(<FamilyCard billing={BILLING} />);
    expect(mine(r4.leftover())).toEqual([]);
    shown!.unmount(); shown = null;
    getFamily.mockRejectedValue(new Error('x'));
    const r5 = await show(<FamilyCard billing={BILLING} />);
    expect(text()).toContain(tr['billing.error.couldNotLoadFamilyPlan'].split(' ')[0]);
    expect(mine(r5.leftover())).toEqual([]);
  });

  it('the places dialog: add, remove, price and failures', async () => {
    getCatalog.mockResolvedValue({ ok: true, plans: [], addons: [{ id: 'family_places', name: 'Places', kind: 'family_places', storage_bytes: 0, storage_label: '0', price_monthly: 300, price_yearly: null, price_monthly_label: '$3', price_yearly_label: null, max_quantity: 5, has_monthly: true, has_yearly: false }] });
    previewSubscription.mockResolvedValue({ ok: true, amount_due: 300, currency: 'usd' });
    const billing = { ...BILLING as object, items: [{ kind: 'plan', ref_id: 'pro', quantity: 1, unit_amount: 2499 }, { kind: 'addon', ref_id: 'family_places', quantity: 2, unit_amount: 300 }], usage: { limit_bytes: 2 }, plan: { id: 'pro' } } as never;
    const r = await show(<FamilyPlacesDialog open onClose={() => {}} billing={billing} current={2} included={5} max={10} />);
    await flush();
    expect(text()).toContain(tr['billing.heading.purchaseMoreFamilySpots']);
    expect(mine(r.leftover())).toEqual([]);
    await act(async () => { document.querySelector<HTMLElement>(`[aria-label="${tr['billing.action.addASpot']}"]`)!.click(); });
    await flush();
    expect(mine(r.leftover())).toEqual([]);
    await act(async () => { document.querySelector<HTMLElement>(`[aria-label="${tr['billing.action.removeASpot']}"]`)!.click(); });
    await act(async () => { document.querySelector<HTMLElement>(`[aria-label="${tr['billing.action.removeASpot']}"]`)!.click(); });
    await flush();
    expect(text()).toContain(tr['billing.description.nobodyIsRemovedWhenSpotsGoDownIfMorePeopleRemain']);
    expect(mine(r.leftover())).toEqual([]);
  });
});

// ── Checkout success ────────────────────────────────────────────────

function cstatus(o: { limit?: number; hasSubscription?: boolean; trialEnd?: number | null; interval?: string } = {}) {
  return {
    ok: true,
    plan: { id: 'pro', name: 'Pro', storage_bytes: 2 * TB, storage_label: '2 TB', price_monthly: 1299, price_yearly: null },
    usage: { used_bytes: 0, used_label: '0 B', limit_bytes: o.limit ?? 2 * TB + 5 * GB, limit_label: '2 TB', pct: 0 },
    subscription: { status: 'active', current_period_end: null, has_subscription: o.hasSubscription ?? true, cancel_at_period_end: false, grace_period_end: null, trial_end: o.trialEnd ?? null },
    interval: o.interval ?? 'month', items: [], referral_bonus_bytes: 0, invoices: [], license_grants: [],
  };
}
function script(routes: Record<string, unknown>) {
  syncBilling.mockResolvedValue({ ok: true });
  getBillingStatus.mockResolvedValue(routes['/api/billing/status']);
  api.mockImplementation(async (path: string) => {
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    if (!key) throw new Error(`unexpected ${path}`);
    const value = routes[key];
    if (value instanceof Error) throw value;
    return value;
  });
}
async function showCheckout(entry: string) {
  shown = await renderInLocale(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/checkout/success" element={<CheckoutSuccessPage />} />
        <Route path="/billing" element={<p>billing page</p>} />
      </Routes>
    </MemoryRouter>, 'tr');
  for (let i = 0; i < 6; i++) await flush();
  return shown;
}
// The five connect cards take their title and description from lib/integrations.ts (outside this unit).
const INTEGRATION_CARDS = /^(Desktop apps|Download the desktop app for macOS, Windows and Linux\.|Script uploads, downloads and folder sync from your terminal with the dosya CLI\.|Mount your workspace as a network drive on macOS, Windows or Linux\.|Point any S3-compatible tool or SDK at your workspace\.|Copy, sync and mount your files from the command line with rclone\.)$/;
const checkoutMine = (texts: string[]) => mine(texts).filter((x) => !INTEGRATION_CARDS.test(x));
const PAID = { ok: true, kind: 'checkout', paid: true, amount: 1299, currency: 'usd', invoice_number: 'DOSYA-0042', invoice_url: 'https://invoice.stripe.com/i/x', paid_at: 1_800_000_000, email: 'buyer@example.test', card: { brand: 'visa', last4: '4242' } };

describe('checkout success in Turkish', () => {
  it('success: capacity band, steps, receipt, apps, connect cards, FAQ and the support line', async () => {
    rememberStorageBeforePurchase(5 * GB);
    script({ '/api/billing/sync': { ok: true }, '/api/billing/status': cstatus({ interval: 'year' }), '/api/billing/receipt': PAID });
    const r = await showCheckout('/checkout/success?session_id=cs_test_abcdefghijkl');
    expect(text()).toContain(tr['checkout-success.label.purchaseComplete']);
    expect(text()).toContain(tr['checkout-success.heading.whatHappensNext']);
    expect(text()).toContain(tr['checkout-success.heading.questionsPeopleAskAfterBuying']);
    expect(checkoutMine(r.leftover())).toEqual([]);
  });

  it('processing: payment pending', async () => {
    rememberStorageBeforePurchase(5 * GB);
    script({ '/api/billing/sync': { ok: true }, '/api/billing/status': cstatus({ hasSubscription: false }), '/api/billing/receipt': { ...PAID, paid: false } });
    const r = await showCheckout('/checkout/success?session_id=cs_test_abcdefghijkl');
    expect(text()).toContain(tr['checkout-success.tooltip.paymentProcessing']);
    expect(text()).toContain(tr['checkout-success.description.stripeIsStillConfirmingThePaymentStorageIsAddedAsSoon']);
    expect(checkoutMine(r.leftover())).toEqual([]);
  });

  it('failed: Stripe never confirms, and the receipt could not be loaded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    rememberStorageBeforePurchase(5 * GB);
    script({ '/api/billing/sync': { ok: true }, '/api/billing/status': cstatus({ hasSubscription: false }), '/api/billing/receipt': new Error('stripe down') });
    shown = await renderInLocale(
      <MemoryRouter initialEntries={['/checkout/success?session_id=cs_test_abcdefghijkl']}>
        <Routes><Route path="/checkout/success" element={<CheckoutSuccessPage />} /></Routes>
      </MemoryRouter>, 'tr');
    for (let i = 0; i < 12; i++) { await act(async () => { await vi.advanceTimersByTimeAsync(2600); }); }
    vi.useRealTimers();
    expect(text()).toContain(tr['checkout-success.description.stripeHasNotConfirmedTheSubscriptionYetItNormallyAppearsWithin']);
    expect(text()).toContain(tr['checkout-success.action.checkAgain']);
    expect(checkoutMine(shown.leftover())).toEqual([]);
  });

  it('trial started and a plan change', async () => {
    rememberStorageBeforePurchase(5 * GB);
    script({ '/api/billing/sync': { ok: true }, '/api/billing/status': cstatus({ trialEnd: NOW + 7 * DAY }), '/api/billing/receipt': { ...PAID, amount: 0 } });
    const r = await showCheckout('/checkout/success?session_id=cs_test_abcdefghijkl');
    expect(text()).toContain(tr['checkout-success.label.trialStarted']);
    expect(checkoutMine(r.leftover())).toEqual([]);
    shown!.unmount(); shown = null;
    rememberPlanChange();
    rememberStorageBeforePurchase(2 * TB + 5 * GB);
    script({ '/api/billing/sync': { ok: true }, '/api/billing/status': cstatus(), '/api/billing/receipt': { ok: true, kind: 'change', next_amount: 850, currency: 'usd', next_invoice_at: 1_802_000_000, email: 'me@example.test', card: null } });
    const r2 = await showCheckout('/checkout/success?change=1');
    expect(text()).toContain(tr['checkout-success.label.planUpdated']);
    expect(checkoutMine(r2.leftover())).toEqual([]);
  });
});

// ── API keys ────────────────────────────────────────────────────────

const key = (over: Partial<ApiKey> = {}): ApiKey => ({
  id: 'key_x', name: 'x', scope: 'full', key_prefix: 'abcd1234', created_at: NOW - DAY,
  last_used_at: null, expires_at: null, s3_access_key_id: null, surfaces: null,
  workspace_id: null, root_folder_id: null, allowed_ips: null, active_hours: null, ...over,
});
const WS = [{ id: 'ws_1', name: 'Design Studio' }];
// Key names and the key value are user content / secrets; the sweep never reports them.
const KEYS = [
  key({ id: 'k1', name: 'rclone backup', scope: 'read', surfaces: 'webdav,s3', workspace_id: 'ws_1', root_folder_id: 'f_1', allowed_ips: '10.0.0.0/8, 192.168.0.0/16', active_hours: '{"tz":"UTC","days":[1,2,3,4,5],"from":"09:00","to":"17:00"}', expires_at: NOW + 10 * DAY, last_used_at: NOW - 4 * 60 }),
  key({ id: 'k2', name: 'ci', scope: 'upload', last_used_at: NOW - 187 * DAY, expires_at: NOW - DAY }),
  key({ id: 'k3', name: 'blog', scope: 'wp_site', surfaces: 'api' }),
  key({ id: 'k4', name: 'open', s3_access_key_id: 'AKIA1' }),
  key({ id: 'k5', name: 'noS3', surfaces: 'api' }),
];

async function showKeys(keys: ApiKey[]) {
  api.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/folders/')) return { ok: true, folder: { name: 'Archive' } };
    return { ok: true };
  });
  return show(<ApiKeysSection keys={keys} workspaces={WS} onChanged={() => {}} />);
}
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });

describe('API keys in Turkish', () => {
  it('the list, its summary strip, the toolbar and the empty state', async () => {
    const r = await showKeys(KEYS);
    await flush();
    expect(text()).toContain(tr['profile.heading.apiKeys']);
    expect(mine(r.leftover())).toEqual([]);
    shown!.unmount(); shown = null;
    const r2 = await showKeys([]);
    expect(text()).toContain(tr['profile.label.noApiKeysYet']);
    expect(mine(r2.leftover())).toEqual([]);
  });

  it('expanded rows: configuration, guards, S3 states, actions and the revoke dialogs', async () => {
    const r = await showKeys(KEYS);
    await flush();
    for (const id of ['k1', 'k2', 'k3', 'k4', 'k5']) {
      await click(document.querySelector(`[data-testid="key-row"][data-key-id="${id}"] [data-testid="key-expand"]`));
      expect(mine(r.leftover())).toEqual([]);
      await click(document.querySelector(`[data-testid="key-row"][data-key-id="${id}"] [data-testid="key-expand"]`));
    }
    await click(document.querySelector(`[data-testid="key-row"][data-key-id="k4"] [data-testid="key-expand"]`));
    await click(document.querySelector('[data-testid="s3-show"]'));
    expect(text()).toContain(tr['profile.description.secretKeyIsNotRetrievableRevokeAndRecreateTheKeyToRotate'] ?? tr['profile.description.secretKeyIsNotRetrievableRevokeAndRecreateTheKey']);
    expect(mine(r.leftover())).toEqual([]);
    await clickText(tr['common.done']);
    await click(document.querySelector('[data-testid="revoke"]'));
    expect(mine(r.leftover())).toEqual([]);
    await clickText(tr['common.cancel']);
    // bulk
    for (const el of document.querySelectorAll('[data-testid="key-select"]')) { await click(el); if (document.querySelectorAll('[data-testid="key-select"][data-checked]').length > 2) break; }
    await click(document.querySelector('[data-testid="bulk-revoke"]'));
    expect(mine(r.leftover())).toEqual([]);
  });

  it('the create dialog with the scope picker, restrictions and the summary sentence', async () => {
    const r = await showKeys(KEYS);
    await click(document.querySelector('[data-testid="new-key"]'));
    await flush();
    expect(text()).toContain(tr['profile.heading.newApiKey']);
    expect(text()).toContain(tr['profile.label.readOnly']);
    expect(mine(r.leftover())).toEqual([]);
    await click(document.querySelector('[data-testid="restrictions-toggle"]'));
    expect(mine(r.leftover())).toEqual([]);
    await click(document.querySelector('[data-testid="protocols-some"] input, [data-testid="protocols-some"]'));
    for (const g of document.querySelectorAll('summary')) await click(g);
    expect(mine(r.leftover())).toEqual([]);
    // the validation error
    await click(document.querySelector('[data-testid="create-submit"]'));
    expect(text()).toContain(tr['profile.description.giveTheKeyANameSoYouCanRecogniseItLater']);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('a duplicated key opens with its restrictions and the read-back sentence', async () => {
    const r = await showKeys(KEYS);
    await click(document.querySelector(`[data-testid="key-row"][data-key-id="k1"] [data-testid="key-expand"]`));
    await click(document.querySelector('[data-testid="duplicate"]'));
    await flush();
    const summary = document.querySelector('[data-testid="create-summary"]')!.textContent!;
    expect(summary).not.toMatch(/This key will be able to/);
    expect(mine(r.leftover())).toEqual([]);
    for (const toggle of document.querySelectorAll('summary')) await click(toggle);
    expect(mine(r.leftover())).toEqual([]);
  });

  it('the new key dialog and a failed revoke toast', async () => {
    const r = await showKeys(KEYS);
    await click(document.querySelector('[data-testid="new-key"]'));
    await typeInto(document.querySelector<HTMLInputElement>('[data-testid="create-name"]')!, 'my key');
    api.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/me/api-keys' && init?.method === 'POST') return { ok: true, key: { plain_key: 'dos_secretvalue123' } };
      return { ok: true };
    });
    await click(document.querySelector('[data-testid="create-submit"]'));
    await flush();
    expect(text()).toContain('dos_secretvalue123');
    expect(text()).toContain('my key');
    expect(mine(r.leftover())).toEqual([]);
  });
});

// ── Libraries ───────────────────────────────────────────────────────

describe('libraries in Turkish', () => {
  beforeAll(async () => { (await renderInLocale(<div />, 'tr')).unmount(); });

  it('license timeline sentences, intervals and providers come from the catalog', () => {
    const END = 1_750_000_000;
    expect(licenseIntervalLabel('month')).toBe(tr['common.label.monthly']);
    expect(licenseIntervalLabel('quarter')).toBe(tr['common.label.quarterly']);
    expect(licenseIntervalLabel('half_year')).toBe(tr['common.label.every6Months']);
    expect(licenseIntervalLabel('year')).toBe(tr['common.label.yearly']);
    expect(licenseIntervalLabel('two_years')).toBe(tr['common.label.every2Years']);
    expect(licenseIntervalLabel(null)).toBe(tr['common.label.recurring']);
    expect(licenseProviderLabel('voucher')).toBe(tr['common.label.couponCode']);
    expect(licenseProviderLabel('gumroad')).toBe(tr['common.label.gumroad']);
    expect(licenseProviderLabel('x')).toBe(tr['common.label.redeemedCode']);
    expect(licenseTimeline({ status: 'revoked', provider: 'gumroad' }).badge).toBe(tr['common.status.revoked']);
    expect(licenseTimeline({ status: 'revoked', provider: 'gumroad' }).text).toBe(tr['common.label.refundedOrDisputedOnGumroad']);
    expect(licenseTimeline({ status: 'revoked', provider: 'voucher' }).text).toBe(tr['common.label.revoked']);
    expect(licenseTimeline({ status: 'revoked', provider: 'voucher', ends_at: END }).text).toMatch(/·/);
    expect(licenseTimeline({ status: 'ended', provider: 'gumroad' }).text).toBe(tr['common.label.membershipEndedOnGumroad']);
    expect(licenseTimeline({ status: 'ended', provider: 'voucher' }).text).toBe(tr['common.label.ended']);
    expect(licenseTimeline({ status: 'ended', provider: 'voucher' }).badge).toBe(tr['common.status.ended']);
    expect(licenseTimeline({ provider: 'gumroad', renews_at: END }).text).toMatch(new RegExp(tr['common.label.renewsAroundGrantrenewsAt'].split('{')[0]));
    expect(licenseTimeline({ provider: 'gumroad' }).text).toBe(tr['common.label.renewsThroughGumroad']);
    expect(licenseTimeline({ provider: 'voucher' }).text).toBe(tr['common.label.doesNotEnd']);
    expect(licenseTimeline({ provider: 'gumroad', ends_at: NOW + DAY }, NOW).badge).toBe(tr['common.status.ending']);
    expect(licenseTimeline({ provider: 'gumroad', ends_at: NOW + DAY }, NOW).text).toMatch(new RegExp(tr['common.label.endsEndsat'].split('{')[0]));
  });

  it('fallback sentences the app writes itself', async () => {
    expect(humanizeApiError('folder_locked')).toBe(tr['common.description.thisFolderIsLockedEnterItsPasswordToOpenIt']);
    expect(humanizeApiError('2fa_required')).toBe(tr['common.label.enterYourTwoFactorCodeToContinue']);
    expect(humanizeApiError('weird_code')).toBe('weird_code');
    expect(friendStatusLabel('credited')).toBe(tr['referrals.label.counted']);
    expect(friendStatusLabel('held')).toBe(tr['referrals.label.underReview']);
    expect(friendStatusLabel('nope')).toBe(tr['referrals.label.notEligible']);
    expect(apiErrorMessage(new Error('x'))).toBe(tr['common.description.networkErrorPleaseTryAgain']);
    expect(apiErrorMessage(new ApiError(502, '<html>'))).toBe(tr['common.error.requestFailedErrstatusPleaseTryAgain'].replace('{errStatus}', '502'));
    expect(apiErrorMessage(new ApiError(400, JSON.stringify({ error: 'Server says no' })))).toBe('Server says no');
    expect(apiErrorMessage(new ApiError(400, 'plain body'))).toBe('plain body');
    expect(await responseErrorMessage(new Response('{"error":"folder_locked"}'), 'x')).toBe(tr['common.description.thisFolderIsLockedEnterItsPasswordToOpenIt']);
    expect(moduleT('common.label.apiStatusBody', { status: 500, body: 'x' })).toContain('500');
    expect(new ApiError(500, 'oops').message).toBe(tr['common.label.apiStatusBody'].replace('{status}', '500').replace('{body}', 'oops'));
  });

  it('req() writes Turkish fallbacks and passes server text through', async () => {
    api.mockRejectedValueOnce(new ApiError(500, ''));
    expect((await req('/x')).error).toBe(tr['common.error.requestFailedStatus'].replace('{status}', '500'));
    api.mockRejectedValueOnce(new Error('offline'));
    expect((await req('/x')).error).toBe('offline');
    api.mockRejectedValueOnce('weird');
    expect((await req('/x')).error).toBe(tr['profile.label.networkError']);
    api.mockRejectedValueOnce(new ApiError(400, '{"ok":false,"error":"Server text"}'));
    expect((await req('/x')).error).toBe('Server text');
  });

  it('notification groups and API key formatters', () => {
    const g = groupByDay([{ id: '1', created_at: NOW } as never, { id: '2', created_at: NOW - 3 * DAY } as never], NOW);
    expect(g.map((x) => x.label)).toEqual([tr['common.label.today'], tr['common.label.earlier']]);
    expect(formatLastUsed({ last_used_at: null })).toBe(tr['common.label.never']);
    expect(formatSurfaces(null)).toBe(tr['profile.label.allProtocols']);
    expect(formatSurfaces('s3,api')).toBe(`${tr['profile.label.s3Gateway']}, ${tr['profile.label.restApi']}`);
    expect(formatAnchor({ workspace_id: null, root_folder_id: null }, [], {})).toBe(tr['profile.label.wholeAccount']);
    expect(formatAnchor({ workspace_id: 'w', root_folder_id: null }, [], {})).toBe(tr['profile.label.unknownWorkspace']);
    expect(formatActiveHours('garbage')).toBe(tr['profile.label.restrictedHours']);
    expect(formatActiveHours('{"tz":"UTC","days":[0,1,2,3,4,5,6],"from":"09:00","to":"17:00"}')).toContain(tr['profile.label.everyDay']);
    expect(formatActiveHours('{"tz":"UTC","days":[0,6],"from":"09:00","to":"17:00"}')).toContain(`${tr['common.label.sun']}, ${tr['common.label.sat']}`);
    expect(SCOPE_LABELS.read).toBe(tr['profile.label.readOnly']);
    expect(SCOPE_LABELS.upload).toBe(tr['profile.label.uploadOnly']);
    expect(SCOPE_LABELS.full).toBe(tr['profile.label.fullAccess']);
    expect(SCOPE_LABELS.wp_site).toBe(tr['profile.label.wordpressSite']);
    expect(SCOPE_OPTIONS.map((o) => o.label)).toEqual([tr['profile.label.readOnly'], tr['profile.label.uploadOnly'], tr['profile.label.fullAccess']]);
    expect(SCOPE_OPTIONS[0].blurb).toBe(tr['profile.error.listAndDownloadCannotUploadMoveOrDeleteAnything']);
    expect(EXPIRY_OPTIONS.map((o) => o.label)).toEqual([tr['profile.label.neverExpires'], tr['profile.label.expiresIn30Days'], tr['profile.label.expiresIn90Days']]);
    expect(DAY_OPTIONS.map((d) => d.label)).toEqual([tr['common.label.sun'], tr['common.label.mon'], tr['common.label.tue'], tr['common.label.wed'], tr['common.label.thu'], tr['common.label.fri'], tr['common.label.sat']]);
    expect(SURFACE_OPTIONS.map((o) => o.label).slice(2)).toEqual([tr['profile.label.s3Gateway'], tr['profile.label.restApi']]);
    expect(keyGuards(key()).map((x) => x.label)).toEqual([tr['profile.label.narrowedPermission'], tr['profile.label.narrowedReach'], tr['profile.label.ipOrHours'], tr['common.column.expiry']]);
    expect(draftGuards(emptyDraft()).length).toBe(4);
    const sentence = describeDraft(emptyDraft('UTC'), []).map((s) => s.text).join('');
    expect(sentence).not.toMatch(/This key will be able to|your whole account|every protocol|any address|at any time|never expires/);
    expect(sentence).toContain(tr['profile.label.yourWholeAccount']);
    expect(sentence).toContain(tr['profile.label.everyProtocol']);
    expect(sentence).toContain(tr['profile.label.anyAddress']);
    expect(sentence).toContain(tr['profile.label.atAnyTime']);
    expect(sentence).toContain(tr['profile.label.neverExpires.neverExpires']);
  });
});

// ── English text assembled from catalog fragments ───────────────────

async function showEn(ui: React.ReactElement, url = '/') {
  shown = await renderInLocale(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>, 'en');
  for (let i = 0; i < 5; i++) await flush();
  return shown;
}
const paras = () => [...document.querySelectorAll('p, dt, dd, div')].map((n) => n.textContent ?? '');
const longEn = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const shortEn = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const CODE = (o: Record<string, unknown>) => ({ ok: true, code: 'SAVE', type: 'percent', value: 10, currency: null, duration: 'once', duration_in_months: null, intervals: null, ...o });
const CHOOSER = (props: Record<string, unknown> = {}) => (
  <PlanChooser hasSubscription={false} usedBytes={0} initial={{ interval: 'month', planId: 'starter', addonQty: {} }} onUpdated={() => {}} onClose={() => {}} {...props} />
);
async function applyCode(code: string) {
  await typeInto(document.querySelector<HTMLInputElement>('input[placeholder="Enter code"]')!, code);
  await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent === 'Apply')!.click(); });
  await flush();
}

// ── Other languages: coupon sentence, removed-code note, just now ───

async function showIn(locale: 'de' | 'fr' | 'cs' | 'nl' | 'sv' | 'tr', ui: React.ReactElement) {
  shown?.unmount();
  shown = await renderInLocale(<MemoryRouter>{ui}</MemoryRouter>, locale);
  for (let i = 0; i < 5; i++) await flush();
}
const couponLine = () => document.querySelector('p.text-green-600, p.text-red-600')?.textContent ?? '';
async function applyAny(info: Record<string, unknown>) {
  validateCoupon.mockResolvedValue({ ok: true, code: 'SAVE', type: 'percent', value: 10, currency: null, duration: 'once', duration_in_months: null, intervals: null, ...info });
  const box = document.querySelector<HTMLInputElement>('input.h-8')!;
  await typeInto(box, 'SAVE');
  await act(async () => { box.parentElement!.parentElement!.querySelector('button')!.click(); });
  await flush();
}

describe('coupon and interval sentences in other languages', () => {
  for (const lang of ['tr', 'de', 'fr', 'cs', 'nl', 'sv'] as const) {
    it(`${lang}: a one-time code never shows the months, a repeating one never shows both sentences`, async () => {
      getCatalog.mockResolvedValue(CATALOG);
      await showIn(lang, <PlanChooser hasSubscription={false} usedBytes={0} initial={{ interval: 'month', planId: 'starter', addonQty: {} }} onUpdated={() => {}} onClose={() => {}} />);
      await flush();
      const apply = async (info: Record<string, unknown>) => { await applyAny(info); return couponLine(); };
      const none = await apply({ duration: 'forever' });
      const once = await apply({ duration: 'once' });
      const repeating = await apply({ duration: 'repeating', duration_in_months: 7 });
      expect(none).not.toMatch(/\d/);
      expect(once).not.toMatch(/\d/);
      expect(once.length).toBeGreaterThan(none.length);
      expect(repeating).toContain('7');
      expect(repeating.match(/\d/g)).toHaveLength(1);
      let p = 0;
      while (p < none.length && none[p] === once[p]) p++;
      const firstSentence = once.slice(p, once.length - 1).replace(/^[\s\-\u2013\u00b7;:,.]+/, '').trim();
      expect(firstSentence.length).toBeGreaterThan(3);
      expect(repeating).not.toContain(firstSentence);
    });
  }

  for (const lang of ['tr', 'de'] as const) {
    it(`${lang}: the removed-code note has no English interval word`, async () => {
      getCatalog.mockResolvedValue(CATALOG);
      await showIn(lang, <PlanChooser hasSubscription={false} usedBytes={0} initial={{ interval: 'year', planId: 'starter', addonQty: {} }} onUpdated={() => {}} onClose={() => {}} />);
      await flush();
      await applyAny({ intervals: ['year'] });
      await act(async () => { document.querySelector<HTMLElement>('.bg-muted button')!.click(); });
      await flush();
      const note = couponLine();
      expect(note).toContain('SAVE');
      expect(note).not.toMatch(/\b(month|year)(ly)?\b/i);
    });
  }

  it('notifications: "just now" follows the language', async () => {
    await showIn('tr', <div />);
    const { relativeTime } = await import('@/lib/notifications');
    expect(relativeTime(NOW, NOW)).toBe(tr['common.label.justNow']);
  });
});

describe('English text assembled from catalog fragments is unchanged', () => {
  it('the coupon sentence keeps each case, one space and the full stop', async () => {
    getCatalog.mockResolvedValue(CATALOG);
    await showEn(CHOOSER());
    await flush();
    validateCoupon.mockResolvedValue(CODE({ duration: 'once' }));
    await applyCode('SAVE');
    expect(paras()).toContain('Code SAVE applied - discounts your first payment only.');
    validateCoupon.mockResolvedValue(CODE({ duration: 'repeating', duration_in_months: 3 }));
    await applyCode('SAVE');
    expect(paras()).toContain('Code SAVE applied - applies for 3 months.');
    validateCoupon.mockResolvedValue(CODE({ duration: 'forever' }));
    await applyCode('SAVE');
    expect(paras()).toContain('Code SAVE applied.');
    // A code that contains the word "true" and a double space is data and stays as typed.
    validateCoupon.mockResolvedValue(CODE({ code: 'true  X', duration: 'repeating', duration_in_months: 12 }));
    await applyCode('true  X');
    expect(paras()).toContain('Code true  X applied - applies for 12 months.');
  });

  it('chooser sentences: add-on hint, dropped add-ons, removed code, trial line, downgrade', async () => {
    getCatalog.mockResolvedValue(CATALOG);
    await showEn(CHOOSER({ initial: { interval: 'month', planId: 'free', addonQty: {} } }));
    await flush();
    expect(paras()).toContain('Add storage on top (select a paid plan first)');
    shown!.unmount(); shown = null;
    await showEn(CHOOSER({ trialEligible: true, initial: { interval: 'year', planId: 'starter', addonQty: { 'storage-1tb': 1 } } }));
    await flush();
    expect(paras()).toContain('Add storage on top');
    expect(paras()).toContain("1 TB add-on isn't sold on annual billing and won't be included.");
    const trialEnds = longEn(Math.floor((Date.now() + 7 * DAY * 1000) / 1000));
    expect(paras()).toContain(`Free for 7 days, then $39.99 a year. Cancel any time before ${trialEnds} and you won't be charged.`);
    validateCoupon.mockResolvedValue(CODE({ code: 'YEARONLY', intervals: ['year'] }));
    await applyCode('YEARONLY');
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent === 'Monthly')!.click(); });
    expect(paras()).toContain('Code YEARONLY removed: it is for yearly billing only.');
    validateCoupon.mockResolvedValue(CODE({ code: 'MONTHONLY', intervals: ['month'] }));
    await applyCode('MONTHONLY');
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Yearly'))!.click(); });
    expect(paras()).toContain('Code MONTHONLY removed: it is for monthly billing only.');
    validateCoupon.mockResolvedValue(CODE({ code: 'BOTH', intervals: ['month', 'year'] }));
  });

  it('the downgrade confirmation reads as before', async () => {
    getCatalog.mockResolvedValue(CATALOG);
    previewSubscription.mockResolvedValue({ ok: true, amount_due: 100, currency: 'usd' });
    await showEn(CHOOSER({ hasSubscription: true, currentPlanId: 'pro', initial: { interval: 'month', planId: 'starter', addonQty: {} } }));
    await flush();
    const text2 = paras();
    expect(text2).toContain('This replaces your Pro plan');
    expect(text2).toContain('Pro gives 2 TB; Starter gives 100 GB. Add-ons and redeemed packages stay. Your files are never deleted.');
    expect(document.querySelector('label[for="confirm-downgrade"]')!.textContent).toBe('Yes, move me to Starter');
  });

  it('the cancel dialog bolds the date and closes the double space', async () => {
    getBillingStatus.mockResolvedValue(status({ license_grants: [], items: [], usage: { used_bytes: 3 * GB, used_label: '3 GB', limit_bytes: 20 * GB, limit_label: '20 GB', pct: 15 } }));
    api.mockResolvedValue({ card: null });
    await showEn(<BillingPage />);
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel subscription')!.click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    const first = [...dialog.querySelectorAll('p')][0];
    expect(first.textContent).toBe(`Your Pro plan and every add-on stay active until ${longEn(1_800_000_000)}. After that you move to Free (5 GB).`);
    expect(first.querySelector('.font-medium')!.textContent).toBe(longEn(1_800_000_000));
    expect([...dialog.querySelectorAll('p')][2].textContent).toBe('You are using 3 GB. That fits inside the Free limit, so nothing changes for your files.');
  });

  it('the cancel dialog without a period end says until the end of the current period', async () => {
    getBillingStatus.mockResolvedValue(status({ license_grants: [], items: [], subscription: { status: 'active', current_period_end: null, has_subscription: true, cancel_at_period_end: false, grace_period_end: null } }));
    api.mockResolvedValue({ card: null });
    await showEn(<BillingPage />);
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel subscription')!.click(); });
    const first = [...document.querySelector('[role="dialog"]')!.querySelectorAll('p')][0];
    expect(first.textContent).toBe('Your Pro plan and every add-on stay active until the end of the current period. After that you move to Free (5 GB).');
  });

  it('a redeemed package line with and without an interval', async () => {
    getBillingStatus.mockResolvedValue(status());
    api.mockResolvedValue({ card: null });
    await showEn(<BillingPage />);
    const lines = paras();
    expect(lines).toContain(`Gumroad · Yearly · Redeemed ${shortEn(1_700_000_000)}`);
    expect(lines).toContain(`Coupon code · Redeemed ${shortEn(1_700_000_000)}`);
    expect(lines).toContain('Other · Quarterly'.replace('Other', 'Redeemed code') + ` · Redeemed ${shortEn(1_700_000_000)}`);
  });

  it('the family card: invited rows, the header with an error, the member dialogs', async () => {
    getFamily.mockResolvedValue({
      ok: true, role: 'payer', limit: 5, included: 5, extra_places: 0, eligible: true, ineligible_reason: null, pool: POOL, plan: { id: 'pro', name: 'Pro' }, payer: null,
      members: [{ id: 'a', email: 'a@x.test', name: 'Ada', status: 'active', joined_at: 1, expires_at: null, over_free: true }, { id: 'b', email: 'b@x.test', name: null, status: 'invited', joined_at: null, expires_at: 1_800_000_000 }, { id: 'c', email: 'c@x.test', name: null, status: 'invited', joined_at: null, expires_at: null }],
    });
    await showEn(<FamilyCard billing={BILLING} />);
    const lines = paras();
    expect(lines).toContain(`Invited · expires ${new Date(1_800_000_000 * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' })}`);
    expect(lines).toContain('Invited · expires soon');
    expect(lines).toContain('3 of 5 places used (5 included, 0 extra). Members keep their own accounts and private files.');
    await act(async () => { document.querySelector<HTMLElement>('[title="Remove from family"]')!.click(); });
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Remove Ada from your family plan?Their account returns to the free plan with 5 GB. Nothing is deleted, and you can invite them again later. They currently store more than 5 GB, so their uploads will pause until they free space or choose a plan.');
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent === 'Keep')!.click(); });
    await act(async () => { document.querySelectorAll<HTMLElement>('[title="Revoke invitation"]')[0].click(); });
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Revoke the invitation to b@x.test?The link in their email stops working. You can invite them again at any time.');
  });

  it('the member remove dialog without the over-free sentence has no trailing space', async () => {
    getFamily.mockResolvedValue({
      ok: true, role: 'payer', limit: 5, eligible: true, ineligible_reason: null, pool: POOL, plan: { id: 'pro', name: 'Pro' }, payer: null,
      members: [{ id: 'a', email: 'a@x.test', name: 'Ada', status: 'active', joined_at: 1, expires_at: null }],
    });
    await showEn(<FamilyCard billing={BILLING} />);
    await act(async () => { document.querySelector<HTMLElement>('[title="Remove from family"]')!.click(); });
    const description = [...document.querySelectorAll('[role="dialog"] p')].map((n) => n.textContent).find((x) => x?.startsWith('Their account'));
    expect(description).toBe('Their account returns to the free plan with 5 GB. Nothing is deleted, and you can invite them again later.');
  });

  it('the family header while the plan could not load', async () => {
    getFamily.mockRejectedValue(new Error('x'));
    await showEn(<FamilyCard billing={BILLING} />);
    expect(paras()).toContain(' Family plan · Could not load family plan');
  });

  it('the places dialog: confirm labels, the extra spot price and the next invoice line', async () => {
    getCatalog.mockResolvedValue({ ok: true, plans: [], addons: [{ id: 'family_places', name: 'Places', kind: 'family_places', storage_bytes: 0, storage_label: '0', price_monthly: 300, price_yearly: null, price_monthly_label: '$3', price_yearly_label: null, max_quantity: 5, has_monthly: true, has_yearly: false }] });
    previewSubscription.mockResolvedValue({ ok: true, amount_due: 300, currency: 'usd' });
    const billing = { ...BILLING as object, items: [{ kind: 'plan', ref_id: 'pro', quantity: 1, unit_amount: 2499 }, { kind: 'addon', ref_id: 'family_places', quantity: 2, unit_amount: 300 }], usage: { limit_bytes: 2 }, plan: { id: 'pro' }, subscription: { current_period_end: 1_800_000_000 } } as never;
    await showEn(<FamilyPlacesDialog open onClose={() => {}} billing={billing} current={2} included={5} max={10} />);
    await flush();
    const dialog = () => document.querySelector('[role="dialog"]')!;
    expect(dialog().textContent).toContain('Your plan includes 5 people besides you. Each extra spot is $3 a month.');
    const confirmBtn = () => [...dialog().querySelectorAll('button')].map((b) => b.textContent ?? '').find((x) => /^(No change|Add \d|Remove \d)/.test(x));
    const step = (label: string) => act(async () => { dialog().querySelector<HTMLElement>(`[aria-label="${label}"]`)!.click(); });
    expect(confirmBtn()).toBe('No change');
    await step('Add a spot');
    expect(confirmBtn()).toBe('Add 1 spot');
    await step('Add a spot');
    expect(confirmBtn()).toBe('Add 2 spots');
    await step('Remove a spot'); await step('Remove a spot'); await step('Remove a spot');
    expect(confirmBtn()).toBe('Remove 1 spot');
    await step('Remove a spot');
    expect(confirmBtn()).toBe('Remove 2 spots');
    await flush();
    expect([...dialog().querySelectorAll('dt')].map((n) => n.textContent)).toContain(`Next invoice, ${new Date(1_800_000_000 * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`);
  });

  it('the support line keeps its bold lead-in and its optional invoice number', async () => {
    rememberStorageBeforePurchase(5 * GB);
    script({ '/api/billing/sync': { ok: true }, '/api/billing/status': cstatus(), '/api/billing/receipt': PAID });
    shown = await renderInLocale(
      <MemoryRouter initialEntries={['/checkout/success?session_id=cs_test_abcdefghijkl']}><Routes><Route path="/checkout/success" element={<CheckoutSuccessPage />} /></Routes></MemoryRouter>, 'en');
    for (let i = 0; i < 6; i++) await flush();
    const box = () => [...document.querySelectorAll('div')].find((d) => d.textContent?.startsWith('Something not right?') && d.className.includes('rounded-xl'))!;
    expect(box().textContent).toBe('Something not right? Email support@dosya.dev with invoice DOSYA-0042.');
    expect(box().querySelector('span.font-medium')!.textContent).toBe('Something not right?');
    expect(box().querySelector('a')!.getAttribute('href')).toBe('mailto:support@dosya.dev');
    shown!.unmount(); shown = null;
    script({ '/api/billing/sync': { ok: true }, '/api/billing/status': cstatus(), '/api/billing/receipt': { ...PAID, invoice_number: null } });
    shown = await renderInLocale(
      <MemoryRouter initialEntries={['/checkout/success?session_id=cs_test_abcdefghijkl']}><Routes><Route path="/checkout/success" element={<CheckoutSuccessPage />} /></Routes></MemoryRouter>, 'en');
    for (let i = 0; i < 6; i++) await flush();
    expect(box().textContent).toBe('Something not right? Email support@dosya.dev.');
  });

  it('checkout success headings and receipt keep their exact English text', async () => {
    rememberStorageBeforePurchase(5 * GB);
    script({ '/api/billing/sync': { ok: true }, '/api/billing/status': cstatus({ interval: 'year' }), '/api/billing/receipt': PAID });
    shown = await renderInLocale(
      <MemoryRouter initialEntries={['/checkout/success?session_id=cs_test_abcdefghijkl']}><Routes><Route path="/checkout/success" element={<CheckoutSuccessPage />} /></Routes></MemoryRouter>, 'en');
    for (let i = 0; i < 6; i++) await flush();
    const all = document.body.textContent!;
    expect(all).toContain('Pro · yearly');
    expect(all).toContain('Order receipt · Stripe');
    expect(all).toContain('Use the web app, or connect desktop, CLI, WebDAV or S3.');
    expect(all).toContain('Keep a folder in sync on your computer, and back up your phone automatically. Desktop · Mobile');
    expect(all).toContain('Before 5 GBAdded by this purchase');
    expect(all).toContain('Every package is covered by our 14-day money-back guarantee. View invoice');
    expect(all).toContain('Yes, from Billing, at any time. A cancellation keeps your access until the period you already paid for ends. Every package is covered by our 14-day money-back guarantee, set out in the Terms.');
    expect(all).toContain('Install the desktop app and keep a folder in sync, or script it with the CLI. For large migrations, rclone copies straight from another provider. There is also Google Drive, OneDrive and Dropbox import.');
  });
});

describe('English is unchanged', () => {
  beforeAll(async () => { (await renderInLocale(<div />, 'en')).unmount(); });
  it('plain English output of the converted libraries', () => {
    const date = new Date(1_750_000_000 * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    expect(licenseTimeline({ status: 'revoked', provider: 'voucher', ends_at: 1_750_000_000 }).text).toBe(`Revoked · Ended ${date}`);
    expect(licenseTimeline({ provider: 'gumroad', renews_at: 1_750_000_000 }).text).toBe(`Renews around ${date}`);
    expect(licenseTimeline({ provider: 'voucher' }).text).toBe('Does not end');
    expect(apiErrorMessage(new ApiError(502, '<html>'))).toBe('Request failed (502). Please try again.');
    expect(apiErrorMessage(new Error('x'))).toBe('Network error. Please try again.');
    expect(new ApiError(500, 'oops').message).toBe('API 500: oops');
    expect(describeDraft(emptyDraft('UTC'), []).map((s) => s.text).join('')).toBe('This key will be able to read, upload, move and delete anything in your whole account, over every protocol, from any address at any time, and it never expires.');
    expect(describeDraft({ ...emptyDraft('UTC'), allowedIps: '1.2.3.4, 5.6.7.8', expiry: '30', protocolMode: 'some', surfaces: new Set(['s3', 'api']) }, []).map((s) => s.text).join('')).toBe('This key will be able to read, upload, move and delete anything in your whole account, over the S3 gateway and REST API, from 2 IP ranges, any time, and it expires in 30 days.'.replace(', any time', ', at any time'));
    expect(formatActiveHours('{"tz":"UTC","days":[0,6],"from":"09:00","to":"17:00"}')).toBe('Sun, Sat 09:00–17:00 (UTC)');
  });
});
