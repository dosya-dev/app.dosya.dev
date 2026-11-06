import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FamilyMemberView } from '@/api/family';

/**
 * The reservation dialog stays on screen while it animates out after a save,
 * and the save reloads the family. The dialog must keep the member it was
 * opened with, or its title flips from "Reserve storage for Mia" to "Change
 * Mia’s reservation" mid-fade. The dialog is stubbed to show what it was given.
 */

const getFamily = vi.fn();
vi.mock('@/api/family', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/family')>()),
  getFamily: () => getFamily(),
}));
vi.mock('./family-reservation-dialog', () => ({
  FamilyReservationDialog: ({ open, member, onSaved }: { open: boolean; member: FamilyMemberView; onSaved: () => void }) => (
    <div data-testid="res-dialog" data-open={String(open)} data-reserved={String(member.reserved_bytes)}>
      <button type="button" onClick={onSaved}>saved</button>
    </div>
  ),
}));

import { FamilyCard } from './family-card';

const GB = 1024 ** 3;
const mia = (reserved: number | null): FamilyMemberView => ({
  id: 'fm_m', email: 'mia@example.com', name: 'Mia', status: 'active', joined_at: 1, expires_at: null,
  reserved_bytes: reserved, used_bytes: 72 * GB, max_reservable_bytes: 299 * GB, user_id: 'mia',
});
const view = (reserved: number | null) => ({
  ok: true, role: 'payer', limit: 5, included: 5, extra_places: 0, can_buy_places: false, over_capacity: false, eligible: true, ineligible_reason: null,
  pool: { used_bytes: 382 * GB, limit_bytes: 1000 * GB, used_label: '382 GB', limit_label: '1 TB', reserved_bytes: reserved ?? 0, held_bytes: 0, free_bytes: 618 * GB },
  plan: { id: 'pro', name: 'Pro' }, payer: null,
  members: [mia(reserved)],
  usage: [
    { id: 'alex', name: 'Alex', is_you: true, is_payer: true, used_bytes: 310 * GB, used_label: '310 GB', reserved_bytes: null },
    { id: 'mia', name: 'Mia', is_you: false, is_payer: false, used_bytes: 72 * GB, used_label: '72 GB', reserved_bytes: reserved },
  ],
});

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; getFamily.mockReset(); });

describe('FamilyCard reservation dialog', () => {
  it('keeps the member it opened with while closing after a save reloads the family', async () => {
    getFamily.mockResolvedValueOnce(view(null)).mockResolvedValue(view(100 * GB));
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<FamilyCard />); });
    await act(async () => { await Promise.resolve(); });
    const reserve = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reserve')!;
    await act(async () => { reserve.click(); });
    const dialog = () => container!.querySelector('[data-testid="res-dialog"]') as HTMLElement;
    expect(dialog().dataset.reserved).toBe('null');
    await act(async () => { (dialog().querySelector('button') as HTMLButtonElement).click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(getFamily).toHaveBeenCalledTimes(2);
    expect(dialog().dataset.open).toBe('false');
    expect(dialog().dataset.reserved).toBe('null');
  });
});
