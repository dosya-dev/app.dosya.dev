// apps/web/src/components/billing/family-card.test.tsx
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const getFamily = vi.fn();
const inviteFamilyMember = vi.fn();
const leaveFamily = vi.fn();
const removeFamilyMember = vi.fn();
const revokeFamilyInvite = vi.fn();
vi.mock('@/api/family', () => ({
  getFamily: () => getFamily(),
  inviteFamilyMember: (e: string) => inviteFamilyMember(e),
  revokeFamilyInvite: (id: string) => revokeFamilyInvite(id), removeFamilyMember: (id: string) => removeFamilyMember(id),
  leaveFamily: () => leaveFamily(),
}));

vi.mock('./family-places-dialog', () => ({ FamilyPlacesDialog: ({ open }: { open: boolean }) => open ? <div data-testid="places-dialog">dialog</div> : null }));
import type { BillingStatus } from '@/api/billing';
const billing = { interval: 'month', plan: { id: 'pro' }, usage: { limit_bytes: 2 }, items: [{ kind: 'plan', ref_id: 'pro', quantity: 1 }] } as unknown as BillingStatus;

import { FamilyCard } from './family-card';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; getFamily.mockReset(); inviteFamilyMember.mockReset(); leaveFamily.mockReset(); removeFamilyMember.mockReset(); revokeFamilyInvite.mockReset(); });

async function render(onChanged = vi.fn(), b: BillingStatus = billing) {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<MemoryRouter><FamilyCard onChanged={onChanged} billing={b} /></MemoryRouter>); });
  await act(async () => { await Promise.resolve(); });
  return container!;
}

const pool = { used_bytes: 1, limit_bytes: 2, used_label: '300 GB', limit_label: '1 TB' };

describe('FamilyCard', () => {
  it('payer: lists members and invites, shows the counter and an invite form', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null,
      members: [{ id: 'a', email: 'a@x.test', name: 'Ada', status: 'active', joined_at: 1, expires_at: null }, { id: 'b', email: 'b@x.test', name: null, status: 'invited', joined_at: null, expires_at: 9 }] });
    const c = await render();
    expect(c.textContent).toContain('Ada');
    expect(c.textContent).toContain('b@x.test');
    expect(c.textContent).toContain('2 of 5');
    expect(c.querySelector('input[type="email"]')).not.toBeNull();
    expect(c.textContent).toContain('300 GB');
  });

  it('member: names the payer, shows the pool, offers Leave and no invite form', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'member', limit: 5, eligible: false, ineligible_reason: 'is_member', pool, plan: { id: 'pro', name: 'Pro' }, payer: { name: 'Ayşe' }, members: null });
    const c = await render();
    expect(c.textContent).toContain("Ayşe");
    expect(c.textContent).toContain('Leave');
    expect(c.querySelector('input[type="email"]')).toBeNull();
    expect(c.textContent).toContain('5 GB'); // the warning about what leaving means
  });

  it('free user: one-line pitch, no form', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'none', limit: 5, eligible: false, ineligible_reason: 'free_plan', pool, plan: { id: 'free', name: 'Free' }, payer: null, members: [] });
    const c = await render();
    expect(c.textContent).toMatch(/paid plan/i);
    expect(c.querySelector('input[type="email"]')).toBeNull();
  });

  it('submitting the form calls inviteFamilyMember and reloads', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'none', limit: 5, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null, members: [] });
    inviteFamilyMember.mockResolvedValue({ ok: true, invite: { id: 'n', email: 'n@x.test', name: null, status: 'invited', joined_at: null, expires_at: 9 } });
    const c = await render();
    const input = c.querySelector('input[type="email"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'n@x.test');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { (c.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(inviteFamilyMember).toHaveBeenCalledWith('n@x.test');
    expect(getFamily).toHaveBeenCalledTimes(2);
  });

  it('lapsed payer with members still sees the list and Remove, but no invite form', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, eligible: false, ineligible_reason: 'free_plan', pool, plan: { id: 'free', name: 'Free' }, payer: null,
      members: [{ id: 'a', email: 'a@x.test', name: 'Ada', status: 'active', joined_at: 1, expires_at: null }, { id: 'b', email: 'b@x.test', name: null, status: 'invited', joined_at: null, expires_at: 9 }] });
    const c = await render();
    expect(c.textContent).toContain('Ada');
    expect(c.textContent).toContain('b@x.test');
    expect(c.querySelector('button[title="Remove from family"]')).not.toBeNull();
    expect(c.querySelector('button[title="Revoke invitation"]')).not.toBeNull();
    expect(c.querySelector('input[type="email"]')).toBeNull();
    expect(c.textContent).toContain('subscribe again');
  });

  it('free user with no family sees the pitch and no pool line', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'none', limit: 5, eligible: false, ineligible_reason: 'free_plan', pool, plan: { id: 'free', name: 'Free' }, payer: null, members: [] });
    const c = await render();
    expect(c.textContent).not.toContain('across the family');
    expect(c.textContent).toMatch(/paid plan/i);
  });

  const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };
  const byText = (c: HTMLElement, t: string) => [...c.querySelectorAll('button')].find((b) => b.textContent === t);

  it('removing an active member asks first, warning when they store more than 5 GB', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null,
      members: [{ id: 'a', email: 'a@x.test', name: 'Ada', status: 'active', joined_at: 1, expires_at: null, over_free: true }] });
    removeFamilyMember.mockResolvedValue({ ok: true });
    const c = await render();
    await click(c.querySelector('button[title="Remove from family"]'));
    expect(removeFamilyMember).not.toHaveBeenCalled();
    // The question opens in a modal, which portals into document.body.
    const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain('Remove Ada from your family plan?');
    expect(dialog!.textContent).toContain('They currently store more than 5 GB, so their uploads will pause until they free space or choose a plan.');
    await click([...dialog!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Remove') ?? null);
    expect(removeFamilyMember).toHaveBeenCalledWith('a');
  });

  it('revoking a pending invitation asks first, then calls revokeFamilyInvite', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null,
      members: [{ id: 'b', email: 'b@x.test', name: null, status: 'invited', joined_at: null, expires_at: 9 }] });
    revokeFamilyInvite.mockResolvedValue({ ok: true });
    const c = await render();
    await click(c.querySelector('button[title="Revoke invitation"]'));
    expect(revokeFamilyInvite).not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain('Revoke the invitation to b@x.test?');
    await click([...dialog!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Revoke') ?? null);
    expect(revokeFamilyInvite).toHaveBeenCalledWith('b');
  });

  it('the Usage tab shows the pool ring and a ranked list of people with their own totals', async () => {
    const GBn = 1024 ** 3;
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, eligible: true, ineligible_reason: null,
      pool: { used_bytes: 594 * GBn, limit_bytes: 1024 * GBn, used_label: '594 GB', limit_label: '1 TB' },
      plan: { id: 'pro', name: 'Pro' }, payer: null,
      members: [{ id: 'a', email: 'a@x.test', name: 'Ayşe', status: 'active', joined_at: 1, expires_at: null, over_free: true }],
      usage: [
        { id: 'me', name: 'Firat', is_you: true, is_payer: true, used_bytes: 310 * GBn, used_label: '310 GB' },
        { id: 'a', name: 'Ayşe', is_you: false, is_payer: false, used_bytes: 184 * GBn, used_label: '184 GB' },
      ] });
    const c = await render();
    const tabs = [...c.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Members', 'Usage']);
    expect(c.querySelector('input[type="email"]')).not.toBeNull();
    await click(tabs[1] as HTMLElement);
    expect(c.querySelector('input[type="email"]')).toBeNull();
    expect(c.textContent).toContain('58%');
    expect(c.textContent).toContain('594 GB used');
    expect(c.textContent).toContain('You');
    expect(c.textContent).toContain('pays the plan');
    expect(c.textContent).toContain('Ayşe');
    expect(c.textContent).toContain('310 GB');
    expect(c.textContent).toContain('184 GB');
    expect(c.textContent).toContain('Free in the pool');
    expect(c.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('58 percent of the family pool used');
    await click(tabs[0] as HTMLElement);
    expect(c.querySelector('input[type="email"]')).not.toBeNull();
  });

  it('without a usage list (older API) the card has no tabs', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null,
      members: [{ id: 'a', email: 'a@x.test', name: 'Ada', status: 'active', joined_at: 1, expires_at: null }] });
    const c = await render();
    expect(c.querySelector('[role="tab"]')).toBeNull();
  });

  it('resending a pending invitation asks first, then calls inviteFamilyMember with the address', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null,
      members: [{ id: 'b', email: 'b@x.test', name: null, status: 'invited', joined_at: null, expires_at: 9 }] });
    inviteFamilyMember.mockResolvedValue({ ok: true, invite: { id: 'b', email: 'b@x.test', name: null, status: 'invited', joined_at: null, expires_at: 9 } });
    const c = await render();
    await click(c.querySelector('button[title="Send the invitation again"]'));
    expect(inviteFamilyMember).not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain('Send the invitation to b@x.test again?');
    await click([...dialog!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Send again') ?? null);
    expect(inviteFamilyMember).toHaveBeenCalledWith('b@x.test');
  });

  it('removal confirmation omits the warning for a member under 5 GB', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null,
      members: [{ id: 'a', email: 'a@x.test', name: 'Ada', status: 'active', joined_at: 1, expires_at: null, over_free: false }] });
    const c = await render();
    await click(c.querySelector('button[title="Remove from family"]'));
    const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain('Remove Ada from your family plan?');
    expect(dialog!.textContent).not.toContain('They currently store more than 5 GB');
  });

  it('leave confirmation says what the member currently stores', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'member', limit: 5, eligible: false, ineligible_reason: 'is_member', pool, plan: { id: 'pro', name: 'Pro' }, payer: { name: 'Ayşe' }, members: null, own_used_bytes: 7, own_used_label: '7 GB' });
    const c = await render();
    await click(byText(c, 'Leave family plan'));
    expect(c.textContent).toContain('You currently store 7 GB. The free plan holds 5 GB.');
  });

  it('payer with a subscription: shows included and extra places and the Purchase more family spots button in the header row', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 7, included: 5, extra_places: 2, can_buy_places: true, over_capacity: false, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null, members: [] });
    const c = await render();
    expect(c.textContent).toContain('0 of 7 places used');
    expect(c.textContent).toContain('5 included, 2 extra');
    const add = [...c.querySelectorAll('button')].find((b) => b.textContent?.includes('Purchase more family spots'))!;
    expect(add).toBeDefined();
    const heading = [...c.querySelectorAll('h2')].find((h) => h.textContent?.includes('Family plan'))!;
    expect(heading.parentElement!.parentElement!.contains(add)).toBe(true);
    await act(async () => { add.click(); });
    expect(c.querySelector('[data-testid="places-dialog"]')).not.toBeNull();
  });

  it('payer without a Stripe subscription: no Purchase more family spots button', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, included: 5, extra_places: 0, can_buy_places: false, over_capacity: false, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null, members: [] });
    const c = await render();
    expect([...c.querySelectorAll('button')].some((b) => b.textContent?.includes('Purchase more family spots'))).toBe(false);
  });

  it('payer whose subscription has no plan item: no Purchase more family spots button', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, included: 5, extra_places: 0, can_buy_places: true, over_capacity: false, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null, members: [] });
    const custom = { ...billing, items: [{ kind: 'custom', ref_id: 'pkg_1', quantity: 1 }] } as unknown as BillingStatus;
    const c = await render(vi.fn(), custom);
    expect([...c.querySelectorAll('button')].some((b) => b.textContent?.includes('Purchase more family spots'))).toBe(false);
  });

  it('over capacity without the buy control: does not offer adding places', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, included: 5, extra_places: 0, can_buy_places: false, over_capacity: true, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null,
      members: Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, email: `m${i}@x.test`, name: `M${i}`, status: 'active', joined_at: 1, expires_at: null })) });
    const c = await render();
    expect(c.textContent).toContain('more people than places');
    expect(c.textContent).not.toContain('or you add places');
  });

  it('over capacity: says so, keeps everyone listed, and disables the invite form', async () => {
    getFamily.mockResolvedValue({ ok: true, role: 'payer', limit: 5, included: 5, extra_places: 0, can_buy_places: true, over_capacity: true, eligible: true, ineligible_reason: null, pool, plan: { id: 'pro', name: 'Pro' }, payer: null,
      members: Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, email: `m${i}@x.test`, name: `M${i}`, status: 'active', joined_at: 1, expires_at: null })) });
    const c = await render();
    expect(c.textContent).toContain('6 of 5 places used');
    expect(c.textContent).toContain('more people than places');
    expect(c.textContent).toContain('or you add places');
    expect(c.querySelector('input[type="email"]')?.hasAttribute('disabled')).toBe(true);
  });
});
