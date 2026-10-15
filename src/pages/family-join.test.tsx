import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@/api/client';

const previewFamilyJoin = vi.fn();
const acceptFamilyJoin = vi.fn();
vi.mock('@/api/family', () => ({ previewFamilyJoin: (t: string) => previewFamilyJoin(t), acceptFamilyJoin: (t: string) => acceptFamilyJoin(t) }));
vi.mock('@/components/public-nav', () => ({ PublicNav: () => <nav /> }));

import FamilyJoinPage from './family-join';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; previewFamilyJoin.mockReset(); acceptFamilyJoin.mockReset(); });

async function render() {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={['/family/join/tok']}><Routes><Route path="/family/join/:token" element={<FamilyJoinPage />} /></Routes></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); });
  return container!;
}

const base = { ok: true, payer: { name: 'Ayşe' }, plan: { id: 'pro', name: 'Pro' }, pool_label: '1 TB', invited_email: 'me@x.test' };

describe('FamilyJoinPage', () => {
  it('ready: shows payer, plan, pool and an Accept button that calls accept', async () => {
    previewFamilyJoin.mockResolvedValue({ ...base, state: 'ready' });
    acceptFamilyJoin.mockResolvedValue({ ok: true, plan: { id: 'pro', name: 'Pro' } });
    const c = await render();
    expect(c.textContent).toContain('Ayşe');
    expect(c.textContent).toContain('1 TB');
    const btn = [...c.querySelectorAll('button')].find((b) => /accept/i.test(b.textContent ?? ''))!;
    await act(async () => { btn.click(); });
    expect(acceptFamilyJoin).toHaveBeenCalledWith('tok');
    expect(c.textContent).toMatch(/you are now on/i);
  });

  it('blocked: shows the reason and no Accept button', async () => {
    previewFamilyJoin.mockResolvedValue({ ...base, state: 'blocked', block: { code: 'has_subscription', message: 'You have a plan of your own. It ends on 1 November.' } });
    const c = await render();
    expect(c.textContent).toContain('ends on 1 November');
    expect([...c.querySelectorAll('button')].some((b) => /accept/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('expired: says so', async () => {
    previewFamilyJoin.mockResolvedValue({ ...base, state: 'expired' });
    const c = await render();
    expect(c.textContent).toMatch(/expired/i);
  });

  it('signed out (401): offers sign in', async () => {
    previewFamilyJoin.mockRejectedValue(new ApiError(401, '{"error":"Not authenticated"}'));
    const c = await render();
    expect(c.querySelector('a[href^="/login"]')).not.toBeNull();
  });
});
