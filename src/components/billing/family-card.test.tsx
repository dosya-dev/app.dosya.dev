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
const setFamilyReservation = vi.fn();
vi.mock('@/api/family', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/family')>()),
  setFamilyReservation: (id: string, gb: number | null) => setFamilyReservation(id, gb),
  getFamily: () => getFamily(),
  inviteFamilyMember: (e: string) => inviteFamilyMember(e),
  revokeFamilyInvite: (id: string) => revokeFamilyInvite(id), removeFamilyMember: (id: string) => removeFamilyMember(id),
  leaveFamily: () => leaveFamily(),
}));

vi.mock('./family-places-dialog', () => ({ FamilyPlacesDialog: ({ open }: { open: boolean }) => open ? <div data-testid="places-dialog">dialog</div> : null }));
import type { BillingStatus } from '@/api/billing';
const billing = { interval: 'month', plan: { id: 'pro' }, usage: { limit_bytes: 2 }, items: [{ kind: 'plan', ref_id: 'pro', quantity: 1 }] } as unknown as BillingStatus;

import { FamilyCard } from './family-card';
import { personColor } from './family-colors';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; getFamily.mockReset(); inviteFamilyMember.mockReset(); leaveFamily.mockReset(); removeFamilyMember.mockReset(); revokeFamilyInvite.mockReset(); setFamilyReservation.mockReset(); vi.unstubAllGlobals(); });

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
    expect(c.textContent).toContain('of 1 TB');
    expect(c.textContent).toContain('You');
    expect(c.textContent).toContain('pays the plan');
    expect(c.textContent).toContain('Ayşe');
    expect(c.textContent).toContain('310 GB');
    expect(c.textContent).toContain('184 GB');
    expect(c.textContent).toContain('Free in the pool');
    expect(c.textContent).not.toContain('Held for reservations');
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

  // ---- storage reservations + the redesigned card ----
  const GBn = 1024 ** 3;
  // The example family on a 1 TB plan (1000 GB pool): Emma has 200 GB reserved, Sam 150 GB.
  const reservedFamily = (over: Record<string, unknown> = {}) => ({
    ok: true, role: 'payer', limit: 5, included: 5, extra_places: 0, can_buy_places: false, over_capacity: false, eligible: true, ineligible_reason: null,
    pool: { used_bytes: 703 * GBn, limit_bytes: 1000 * GBn, used_label: '703 GB', limit_label: '1 TB', reserved_bytes: 350 * GBn, held_bytes: 70 * GBn, free_bytes: 227 * GBn },
    reservations_exceed_pool: false,
    plan: { id: 'pro', name: 'Pro' }, payer: null,
    members: [
      { id: 'fm_e', email: 'emma@example.com', name: 'Emma', status: 'active', joined_at: 1, expires_at: null, reserved_bytes: 200 * GBn, used_bytes: 184 * GBn, max_reservable_bytes: 427 * GBn },
      { id: 'fm_s', email: 'sam@example.com', name: 'Sam', status: 'active', joined_at: 1, expires_at: null, reserved_bytes: 150 * GBn, used_bytes: 96 * GBn, max_reservable_bytes: 377 * GBn },
      { id: 'fm_m', email: 'mia@example.com', name: 'Mia', status: 'active', joined_at: 1, expires_at: null, reserved_bytes: null, used_bytes: 72 * GBn, max_reservable_bytes: 299 * GBn },
      { id: 'fm_l', email: 'leo@example.com', name: 'Leo', status: 'active', joined_at: 1, expires_at: null, reserved_bytes: null, used_bytes: 41 * GBn, max_reservable_bytes: 268 * GBn },
      { id: 'fm_a', email: 'ava@example.com', name: null, status: 'invited', joined_at: null, expires_at: 9, reserved_bytes: null },
    ],
    usage: [
      { id: 'u_alex', name: 'Alex', is_you: true, is_payer: true, used_bytes: 310 * GBn, used_label: '310 GB', reserved_bytes: null },
      { id: 'u_emma', name: 'Emma', is_you: false, is_payer: false, used_bytes: 184 * GBn, used_label: '184 GB', reserved_bytes: 200 * GBn },
      { id: 'u_sam', name: 'Sam', is_you: false, is_payer: false, used_bytes: 96 * GBn, used_label: '96 GB', reserved_bytes: 150 * GBn },
      { id: 'u_mia', name: 'Mia', is_you: false, is_payer: false, used_bytes: 72 * GBn, used_label: '72 GB', reserved_bytes: null },
      { id: 'u_leo', name: 'Leo', is_you: false, is_payer: false, used_bytes: 41 * GBn, used_label: '41 GB', reserved_bytes: null },
    ],
    ...over,
  });
  const memberView = (over: Record<string, unknown> = {}) => {
    const f = reservedFamily();
    return { ...f, role: 'member', eligible: false, ineligible_reason: 'is_member', payer: { name: 'Alex' }, members: null,
      usage: f.usage.map((u) => ({ ...u, is_you: u.name === 'Emma' })),
      own_used_bytes: 184 * GBn, own_used_label: '184 GB', own_reserved_bytes: 200 * GBn, ...over };
  };
  const rowOf = (c: HTMLElement, name: string) => [...c.querySelectorAll('li')].find((li) => li.querySelector('[data-slot="person-name"]')?.textContent === name) as HTMLElement;
  const dialogEl = () => document.body.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement | null;
  /** Make the card measure as wide (side-by-side) by answering its ResizeObserver. */
  const stubWidth = (width: number) => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(el: Element) { this.cb([{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
      unobserve() {}
      disconnect() {}
    });
  };

  it('header chips name the plan and the places; the pool line counts the reservations', async () => {
    getFamily.mockResolvedValue(reservedFamily());
    const c = await render();
    const chips = [...c.querySelectorAll('[data-slot="family-chip"]')].map((n) => n.textContent);
    expect(chips).toEqual(['Pro · 1 TB', '5 places included']);
    expect(c.textContent).toContain('703 GB of 1 TB used · 350 GB reserved for 2 people');
  });

  it('member view: the chips say Shared with you', async () => {
    getFamily.mockResolvedValue(memberView());
    const c = await render();
    const chips = [...c.querySelectorAll('[data-slot="family-chip"]')].map((n) => n.textContent);
    expect(chips).toEqual(['Pro · 1 TB', 'Shared with you']);
  });

  it('rows: the payer pays the plan, an invitation has a dashed avatar, reservations show on the row', async () => {
    getFamily.mockResolvedValue(reservedFamily());
    const c = await render();
    const alex = rowOf(c, 'Alex (you)');
    expect(alex.textContent).toContain('Pays the plan');
    const ava = rowOf(c, 'ava@example.com');
    expect(ava.textContent).toContain('Invited');
    expect(ava.querySelector('[data-slot="avatar"]')?.className).toContain('border-dashed');
    const emma = rowOf(c, 'Emma');
    expect(emma.textContent).toContain('184 of 200 GB reserved');
    expect([...emma.querySelectorAll('button')].some((b) => b.textContent === '200 GB')).toBe(true);
    const mia = rowOf(c, 'Mia');
    expect(mia.textContent).toContain('72 GB · shares the pool');
    expect([...mia.querySelectorAll('button')].some((b) => b.textContent === 'Reserve')).toBe(true);
  });

  it('+ Reserve opens the dialog for that person with the max the server allows', async () => {
    getFamily.mockResolvedValue(reservedFamily());
    const c = await render();
    await click([...rowOf(c, 'Mia').querySelectorAll('button')].find((b) => b.textContent === 'Reserve'));
    const d = dialogEl()!;
    expect(d.textContent).toContain('Reserve storage for Mia');
    for (const pick of ['50', '100', '200', 'Max 299']) expect([...d.querySelectorAll('button')].some((b) => b.textContent === pick), pick).toBe(true);
  });

  it('saving a reservation reloads the card', async () => {
    getFamily.mockResolvedValue(reservedFamily());
    setFamilyReservation.mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    const c = await render(onChanged);
    await click([...rowOf(c, 'Mia').querySelectorAll('button')].find((b) => b.textContent === 'Reserve'));
    await click([...dialogEl()!.querySelectorAll('button')].find((b) => b.textContent === 'Reserve 100 GB'));
    expect(setFamilyReservation).toHaveBeenCalledWith('fm_m', 100);
    expect(getFamily).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalled();
  });

  it('the reservation button opens the change dialog, and Remove asks Are you sure?', async () => {
    getFamily.mockResolvedValue(reservedFamily());
    const c = await render();
    await click([...rowOf(c, 'Emma').querySelectorAll('button')].find((b) => b.textContent === '200 GB'));
    expect(dialogEl()!.textContent).toContain('Change Emma’s reservation');
    await click([...dialogEl()!.querySelectorAll('button')].find((b) => b.textContent === 'Remove reservation'));
    expect(dialogEl()!.textContent).toContain('Are you sure?');
    expect(dialogEl()!.textContent).toContain('You are ending Emma’s 200 GB reservation. Their files stay. They share the free space in the pool again.');
  });

  it('a lapsed payer gets no reservation controls', async () => {
    getFamily.mockResolvedValue(reservedFamily({ eligible: false, ineligible_reason: 'free_plan', plan: { id: 'free', name: 'Free' } }));
    const c = await render();
    expect([...c.querySelectorAll('button')].some((b) => b.textContent === 'Reserve' || b.textContent === '200 GB')).toBe(false);
  });

  it('member view: the reserved member sees their own reservation', async () => {
    getFamily.mockResolvedValue(memberView());
    const c = await render();
    expect(c.textContent).toContain('Reserved for you by Alex');
    expect(c.textContent).toContain('184 of 200 GB');
    expect(c.textContent).toContain('This space is yours alone. Uploads stop at 200 GB.');
    expect(rowOf(c, 'Emma (you)')).toBeDefined();
    expect(rowOf(c, 'Alex').textContent).toContain('Pays the plan');
    expect(c.textContent).toContain('Leave family plan');
    expect([...c.querySelectorAll('button')].some((b) => b.textContent === 'Reserve')).toBe(false);
  });

  it('member without a reservation sees no reservation box', async () => {
    getFamily.mockResolvedValue(memberView({ own_reserved_bytes: null, usage: reservedFamily().usage.map((u) => ({ ...u, is_you: u.name === 'Mia' })) }));
    const c = await render();
    expect(c.textContent).not.toContain('Reserved for you by');
  });

  it('reservations over the pool: the payer is told to lower them', async () => {
    getFamily.mockResolvedValue(reservedFamily({ reservations_exceed_pool: true }));
    const c = await render();
    expect(c.textContent).toContain('Reservations add up to more than your plan. Lower them so everyone can upload.');
  });

  it('usage legend splits what is free to share from what is held for reservations', async () => {
    getFamily.mockResolvedValue(reservedFamily());
    const c = await render();
    await click([...c.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Usage'));
    const legend = c.querySelector('[data-slot="family-legend"]') as HTMLElement;
    const free = [...legend.querySelectorAll('li')].find((l) => l.textContent?.includes('Free to share'))!;
    expect(free.textContent).toContain('227 GB');
    const held = [...legend.querySelectorAll('li')].find((l) => l.textContent?.includes('Held for reservations'))!;
    expect(held.textContent).toContain('70 GB');
    expect(legend.textContent).toContain('184 of 200 GB');
    expect(c.textContent).toContain('350 GB reserved');
  });

  it('narrow: Members and Usage sit behind the toggle', async () => {
    stubWidth(360);
    getFamily.mockResolvedValue(reservedFamily());
    const c = await render();
    expect([...c.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Members', 'Usage']);
    expect(c.querySelector('[data-slot="family-legend"]')).toBeNull();
  });

  it('wide: Members and Usage sit side by side, no toggle', async () => {
    stubWidth(960);
    getFamily.mockResolvedValue(reservedFamily());
    const c = await render();
    expect(c.querySelector('[role="tab"]')).toBeNull();
    expect(c.querySelector('[data-slot="family-legend"]')).not.toBeNull();
    expect(c.querySelector('input[type="email"]')).not.toBeNull();
    expect(c.querySelector('[data-slot="family-columns"]')).not.toBeNull();
  });

  it('two members with the same name keep their own colours: rows match usage by user id', async () => {
    const f = reservedFamily();
    // Both called Sam. The usage list ranks the second Sam (sam_b, 96 GB) above the first (sam_a, 10 GB).
    const members = [
      { id: 'fm_a', email: 'sam.a@example.com', name: 'Sam', status: 'active', joined_at: 1, expires_at: null, reserved_bytes: null, used_bytes: 10 * GBn, max_reservable_bytes: 100 * GBn, user_id: 'sam_a' },
      { id: 'fm_b', email: 'sam.b@example.com', name: 'Sam', status: 'active', joined_at: 1, expires_at: null, reserved_bytes: null, used_bytes: 96 * GBn, max_reservable_bytes: 100 * GBn, user_id: 'sam_b' },
    ];
    const usage = [
      { id: 'u_alex', name: 'Alex', is_you: true, is_payer: true, used_bytes: 310 * GBn, used_label: '310 GB', reserved_bytes: null },
      { id: 'sam_b', name: 'Sam', is_you: false, is_payer: false, used_bytes: 96 * GBn, used_label: '96 GB', reserved_bytes: null },
      { id: 'sam_a', name: 'Sam', is_you: false, is_payer: false, used_bytes: 10 * GBn, used_label: '10 GB', reserved_bytes: null },
    ];
    getFamily.mockResolvedValue({ ...f, members, usage, pool: { ...f.pool, reserved_bytes: 0, held_bytes: 0 } });
    const c = await render();
    const norm = (color: string) => { const el = document.createElement('span'); el.style.background = color; return el.style.background; };
    const avatarOf = (email: string) => ([...c.querySelectorAll('li')].find((li) => li.querySelector('[title]')?.getAttribute('title') === email)!
      .querySelector('[data-slot="avatar"]') as HTMLElement).style.background;
    // usage rank 1 (sam_b) and 2 (sam_a) take swatches 1 and 2.
    expect(avatarOf('sam.b@example.com')).toBe(norm(personColor(1, false)));
    expect(avatarOf('sam.a@example.com')).toBe(norm(personColor(2, false)));
  });

  it('person colours follow a theme switch without a reload', async () => {
    const { applyTheme } = await import('@/lib/theme');
    const { DEFAULT_THEME } = await import('@/lib/themes');
    document.documentElement.classList.remove('dark');
    try {
      getFamily.mockResolvedValue(reservedFamily());
      const c = await render();
      const norm = (color: string) => { const el = document.createElement('span'); el.style.background = color; return el.style.background; };
      const avatars = () => [...c.querySelectorAll('[data-slot="avatar"]')].map((a) => (a as HTMLElement).style.background).filter(Boolean);
      expect(avatars()).toContain(norm(personColor(0, false)));
      expect(norm(personColor(0, false))).not.toBe(norm(personColor(0, true)));
      await act(async () => { applyTheme({ theme: DEFAULT_THEME, mode: 'dark' }); });
      expect(avatars()).toContain(norm(personColor(0, true)));
      expect(avatars()).not.toContain(norm(personColor(0, false)));
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });

  it('a reservation line uses one number format on both sides (whole GB, grouped like formatGigabytes)', async () => {
    const f = reservedFamily();
    getFamily.mockResolvedValue({ ...f, members: f.members.map((m) => m.id === 'fm_e' ? { ...m, used_bytes: 1234.4 * GBn, reserved_bytes: 2000 * GBn } : m.id === 'fm_s' ? { ...m, used_bytes: 7.6 * GBn } : m) });
    const c = await render();
    expect(rowOf(c, 'Emma').textContent).toContain('1,234 of 2,000 GB reserved');
    expect(rowOf(c, 'Sam').textContent).toContain('8 of 150 GB reserved');
  });
});

