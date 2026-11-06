import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * Billing's account-wide AI processing card: the unit pool (backfill and this
 * month) from GET /api/me/ai-search, plus a link to the workspace dashboard
 * where the per-workspace breakdown lives. Mounted
 * through the whole Billing page so its placement and the hidden case are
 * what a user sees.
 */

const getBillingStatus = vi.fn();
const api = vi.fn();

vi.mock('@/api/family', () => ({
  getFamily: vi.fn(async () => ({ ok: true, role: 'none', limit: 5, eligible: false, ineligible_reason: 'free_plan', pool: { used_bytes: 0, limit_bytes: 1, used_label: '0 B', limit_label: '5 GB' }, plan: { id: 'free', name: 'Free' }, payer: null, members: [] })),
  inviteFamilyMember: vi.fn(), revokeFamilyInvite: vi.fn(), removeFamilyMember: vi.fn(), leaveFamily: vi.fn(),
}));

vi.mock('@/api/billing', () => ({
  getBillingStatus: () => getBillingStatus(),
  syncBilling: vi.fn(async () => ({})),
  createPortalSession: vi.fn(),
  resumeSubscription: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => api(...args) };
});

vi.mock('@/components/billing/plan-chooser', () => ({ PlanChooser: () => null }));
vi.mock('@/components/billing/cancel-dialog', () => ({ CancelSubscriptionDialog: () => null }));

import BillingPage from './billing';

const GB = 1024 ** 3;
const TB = 1024 ** 4;
const LIMITS = { vectorBudget: 250000, imagesMax: 150000, documentsMax: 20000, docChunksMax: 100000, backfillUnits: 375000, monthUnits: 50000 };

function status() {
  return {
    ok: true,
    plan: { id: 'pro', name: 'Pro', storage_bytes: 2 * TB, storage_label: '2 TB', price_monthly: 2499, price_yearly: null },
    usage: { used_bytes: 612 * GB, used_label: '612 GB', limit_bytes: 2 * TB, limit_label: '2 TB', pct: 30 },
    subscription: { status: 'active', current_period_end: 1_800_000_000, has_subscription: true, cancel_at_period_end: false, grace_period_end: null },
    interval: 'month', items: [], invoices: [], license_grants: [], referral_bonus_bytes: 0,
  };
}

function account(overrides: { pool?: Record<string, unknown>; workspaces?: unknown[] } = {}) {
  return {
    ok: true,
    pool: {
      limits: LIMITS, backfill_units_remaining: 300000, backfill_units_total: 375000,
      month_units_remaining: 38000, month_units_total: 50000, month_reset_at: 1_793_318_400,
      payer_is_family: false, paused: false, ...overrides.pool,
    },
    workspaces: overrides.workspaces ?? [
      { id: 'ws_a', name: 'Studio', enabled: true, indexed: 900, pending: 12, images: 1200, documents: 30, images_max: 150000, documents_max: 20000, paused_reason: null },
      { id: 'ws_b', name: 'Archive', enabled: true, indexed: 10, pending: 4, images: 300, documents: 5, images_max: 150000, documents_max: 20000, paused_reason: 'limit' },
      { id: 'ws_c', name: 'Personal', enabled: false, indexed: 0, pending: 0, images: 0, documents: 0, images_max: 150000, documents_max: 20000, paused_reason: null },
    ],
  };
}

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  getBillingStatus.mockReset();
  api.mockReset();
});

async function mount(ai: unknown) {
  getBillingStatus.mockResolvedValue(status());
  api.mockImplementation((path: string) => {
    if (path === '/api/me/ai-search') return ai === 'reject' ? Promise.reject(new Error('boom')) : Promise.resolve(ai);
    if (path === '/api/billing/receipt') return Promise.resolve({ card: null });
    return Promise.resolve({ ok: true });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<MemoryRouter><BillingPage /></MemoryRouter>); });
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
}

const card = () => container!.querySelector<HTMLElement>('[data-testid="billing-ai-processing"]');

describe('billing AI processing card', () => {
  it('shows the pool: backfill remaining, this month used with the reset date', async () => {
    await mount(account());
    const c = card()!;
    expect(c).toBeTruthy();
    expect(c.textContent).toContain('AI processing');
    expect(c.textContent).toContain('Backfill remaining');
    expect(c.textContent).toContain('300,000 of 375,000');
    expect(c.textContent).toContain('This month');
    expect(c.textContent).toContain('12,000 of 50,000');
    expect(c.textContent).toMatch(/Resets \w+ \d+, \d{4}/);
    expect(c.textContent).not.toContain('Family pool');
  });

  it('has no per-workspace table and links to the workspace dashboard instead', async () => {
    await mount(account());
    const c = card()!;
    expect(c.querySelector('table')).toBeNull();
    expect(c.textContent).not.toContain('Studio');
    const link = c.querySelector<HTMLAnchorElement>('a[href="/workspaces"]')!;
    expect(link).toBeTruthy();
    expect(link.textContent).toBe('Per workspace: see the workspace dashboard');
  });

  it('shows Paused by dosya when the platform pauses AI processing', async () => {
    await mount(account({ pool: { paused: true } }));
    expect(card()!.textContent).toContain('Paused by dosya');
  });

  it('marks a family member pool', async () => {
    await mount(account({ pool: { payer_is_family: true } }));
    expect(card()!.textContent).toContain('Family pool');
  });

  it('is hidden when the plan has no AI search (limits null)', async () => {
    await mount(account({ pool: { limits: null }, workspaces: [] }));
    expect(container!.textContent).toContain('Storage ledger');
    expect(card()).toBeNull();
  });

  it('is hidden when the request fails', async () => {
    await mount('reject');
    expect(card()).toBeNull();
  });
});
