import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApiError } from '@/api/client';

const setFamilyReservation = vi.fn();
vi.mock('@/api/family', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/family')>()),
  setFamilyReservation: (id: string, gb: number | null) => setFamilyReservation(id, gb),
}));

import { FamilyReservationDialog, type ReservationPerson } from './family-reservation-dialog';
import type { FamilyMemberView } from '@/api/family';

const GB = 1024 ** 3;

// The example family on a 1000 GB pool: Emma has 200 GB reserved, Sam 150 GB.
const people: ReservationPerson[] = [
  { key: 'alex', name: 'Alex', color: '#15803d', used: 310 * GB, reserved: null },
  { key: 'emma', name: 'Emma', color: '#0f766e', used: 184 * GB, reserved: 200 * GB },
  { key: 'sam', name: 'Sam', color: '#1d4ed8', used: 96 * GB, reserved: 150 * GB },
  { key: 'mia', name: 'Mia', color: '#6d28d9', used: 72 * GB, reserved: null },
  { key: 'leo', name: 'Leo', color: '#be185d', used: 41 * GB, reserved: null },
];
const mia: FamilyMemberView = { id: 'fm_m', email: 'mia@example.com', name: 'Mia', status: 'active', joined_at: 1, expires_at: null, reserved_bytes: null, used_bytes: 72 * GB, max_reservable_bytes: 299 * GB };
const emma: FamilyMemberView = { id: 'fm_e', email: 'emma@example.com', name: 'Emma', status: 'active', joined_at: 1, expires_at: null, reserved_bytes: 200 * GB, used_bytes: 184 * GB, max_reservable_bytes: 427 * GB };

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; setFamilyReservation.mockReset(); });

async function render(member: FamilyMemberView, personKey: string, extra: { onSaved?: () => void; onClose?: () => void } = {}) {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<FamilyReservationDialog open member={member} personKey={personKey} people={people} poolLimit={1000 * GB}
      onClose={extra.onClose ?? (() => {})} onSaved={extra.onSaved ?? (() => {})} />);
  });
}

const dialog = () => document.body.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement;
const buttons = () => [...dialog().querySelectorAll('button')];
const byText = (t: string) => buttons().find((b) => b.textContent?.trim() === t);
const input = () => dialog().querySelector('input') as HTMLInputElement;
async function type(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = async (el: Element | undefined) => { expect(el).toBeDefined(); await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); }); };

describe('FamilyReservationDialog', () => {
  it('new reservation: title, quick picks up to the max, and what it means', async () => {
    await render(mia, 'mia');
    expect(dialog().textContent).toContain('Reserve storage for Mia');
    expect(dialog().textContent).toContain('This space is held for Mia and is also their limit. Nobody else in the family can use it.');
    for (const pick of ['50', '100', '200', 'Max 299']) expect(byText(pick), pick).toBeDefined();
    expect(input().value).toBe('100');
    expect(dialog().textContent).toContain('Mia uses 72 GB now. You can reserve up to 299 GB for them.');
    expect(byText('Reserve 100 GB')?.disabled).toBe(false);
  });

  it('more than is free: says how much is free and disables the primary button', async () => {
    await render(mia, 'mia');
    await type('400');
    expect(dialog().textContent).toContain('Only 299 GB is free to reserve for Mia. Lower someone else’s reservation to free more.');
    expect(byText('Reserve 400 GB')?.disabled).toBe(true);
    expect(dialog().textContent).toContain('Still free 0 GB');
  });

  it('Max picks the most that fits and saving sends whole GB', async () => {
    setFamilyReservation.mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    await render(mia, 'mia', { onSaved });
    await click(byText('Max 299'));
    expect(input().value).toBe('299');
    await click(byText('Reserve 299 GB'));
    expect(setFamilyReservation).toHaveBeenCalledWith('fm_m', 299);
    expect(onSaved).toHaveBeenCalled();
  });

  it('a zero, empty or fractional amount cannot be saved', async () => {
    await render(mia, 'mia');
    await type('0');
    expect(buttons().find((b) => b.textContent?.startsWith('Reserve'))?.disabled).toBe(true);
    await type('2.5');
    expect(buttons().find((b) => b.textContent?.startsWith('Reserve'))?.disabled).toBe(true);
  });

  it('the server refusing shows its own max', async () => {
    setFamilyReservation.mockRejectedValue(new ApiError(409, JSON.stringify({ ok: false, error: 'You can reserve up to 250 GB for this person', code: 'reservation_too_large', max_gb: 250 })));
    await render(mia, 'mia');
    await type('280');
    await click(byText('Reserve 280 GB'));
    expect(dialog().textContent).toContain('Only 250 GB is free to reserve for Mia. Lower someone else’s reservation to free more.');
    expect(byText('Reserve 280 GB')?.disabled).toBe(true);
  });

  it('change below what they use: amber warning, still allowed', async () => {
    await render(emma, 'emma');
    expect(dialog().textContent).toContain('Change Emma’s reservation');
    expect(dialog().textContent).toContain('Emma has 200 GB reserved and uses 184 GB.');
    expect(input().value).toBe('200');
    await type('100');
    const warn = [...dialog().querySelectorAll('[data-tone="warn"]')].map((n) => n.textContent).join('');
    expect(warn).toContain('Emma already uses 184 GB. With 100 GB their uploads stop until they are under 100 GB. Nothing is deleted.');
    expect(byText('Save 100 GB')?.disabled).toBe(false);
  });

  it('Remove reservation asks first, then removes it', async () => {
    setFamilyReservation.mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    await render(emma, 'emma', { onSaved });
    await click(byText('Remove reservation'));
    expect(setFamilyReservation).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain('Are you sure?');
    expect(dialog().textContent).toContain('You are ending Emma’s 200 GB reservation. Their files stay. They share the free space in the pool again.');
    await click(byText('Remove reservation'));
    expect(setFamilyReservation).toHaveBeenCalledWith('fm_e', null);
    expect(onSaved).toHaveBeenCalled();
  });

  it('an overbooked pool still lets the payer lower a reservation', async () => {
    await render({ ...emma, max_reservable_bytes: 0 }, 'emma');
    await type('150');
    expect(byText('Save 150 GB')?.disabled).toBe(false);
    await type('250');
    expect(byText('Save 250 GB')?.disabled).toBe(true);
  });

  it('the + stepper stops at the most that fits', async () => {
    await render(mia, 'mia');
    const plus = () => dialog().querySelector('button[aria-label="More"]') as HTMLButtonElement;
    await type('295');
    expect(plus().disabled).toBe(false);
    await click(plus());
    expect(input().value).toBe('299');
    expect(plus().disabled).toBe(true);
    await type('400');
    expect(plus().disabled).toBe(true);
  });
});

