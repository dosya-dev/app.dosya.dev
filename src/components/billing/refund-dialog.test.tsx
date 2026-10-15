import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const requestRefund = vi.fn();
vi.mock('@/api/billing', () => ({ requestRefund: (ids: string[]) => requestRefund(ids) }));
vi.mock('@/api/client', async (importOriginal) => importOriginal<typeof import('@/api/client')>());

import { RefundDialog } from './refund-dialog';
import { ApiError } from '@/api/client';
import type { BillingStatus } from '@/api/billing';

const GB = 1024 ** 3;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove(); root = null; container = null;
  requestRefund.mockReset();
});

function data(used = 1 * GB): BillingStatus {
  return {
    plan: { id: 'pro', name: 'Pro' },
    usage: { used_bytes: used },
    refund: {
      eligible: true, reason: 'ok', amount: 1099, currency: 'usd', window_ends_at: 1_800_000_000,
      charges: [{ id: 'ch_1', amount: 1099, created: 1_790_000_000, description: 'Pro plan' }],
    },
  } as unknown as BillingStatus;
}

async function render(props: Partial<Parameters<typeof RefundDialog>[0]> = {}) {
  const onClose = vi.fn(); const onRefunded = vi.fn(); const onStale = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RefundDialog data={data()} familyMembers={0} onClose={onClose} onRefunded={onRefunded} onStale={onStale} {...props} />);
  });
  return { onClose, onRefunded, onStale };
}
const text = () => document.body.textContent ?? '';
const btn = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

describe('RefundDialog', () => {
  it('titles with the amount and lists each charge', async () => {
    await render();
    expect(text()).toContain('Refund $10.99 and end your plan?');
    expect(text()).toContain('Pro plan');
    expect(text()).toContain('$10.99');
    expect(text()).toContain('September');
  });

  it('explains the consequences', async () => {
    await render();
    expect(text()).toContain('Your plan ends now and your account goes back to 5 GB.');
    expect(text()).not.toContain('Nothing is deleted.');
    expect(text()).toContain('Your files are not deleted. Items in Trash older than 7 days are removed, as on the free plan.');
    expect(text()).toContain('The money returns to your original payment method in 5 to 10 business days.');
    expect(text()).toContain('You can use a self-serve refund once.');
    expect(text()).not.toContain('Uploads pause');
    expect(text()).not.toContain('family member');
  });

  it('warns about usage over the free limit and family members', async () => {
    await render({ data: data(8 * GB), familyMembers: 2 });
    expect(text()).toContain('You store 8 GB. Uploads pause until you are under 5 GB.');
    expect(text()).toContain('2 family members go back to the free plan.');
  });

  it('Keep my plan closes without refunding', async () => {
    const { onClose } = await render();
    await act(async () => { btn('Keep my plan')!.click(); });
    expect(onClose).toHaveBeenCalled();
    expect(requestRefund).not.toHaveBeenCalled();
  });

  it('refunds once, disables buttons while pending, then calls onRefunded', async () => {
    let resolve!: (v: unknown) => void;
    requestRefund.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { onRefunded } = await render();
    await act(async () => { btn('Refund $10.99')!.click(); });
    expect(requestRefund).toHaveBeenCalledTimes(1);
    expect(requestRefund).toHaveBeenCalledWith(['ch_1']);
    expect(btn('Keep my plan')!.disabled).toBe(true);
    expect(btn('Refund $10.99')!.disabled).toBe(true);
    await act(async () => { resolve({ ok: true, amount: 1099, currency: 'usd' }); });
    expect(onRefunded).toHaveBeenCalled();
  });

  it('shows the server message and stays open on failure', async () => {
    requestRefund.mockRejectedValue(new ApiError(409, JSON.stringify({ error: 'Already refunded once.', code: 'already_used' })));
    const { onClose, onRefunded, onStale } = await render();
    await act(async () => { btn('Refund $10.99')!.click(); });
    expect(text()).toContain('Already refunded once.');
    expect(onClose).not.toHaveBeenCalled();
    expect(onRefunded).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
    expect(btn('Refund $10.99')!.disabled).toBe(false);
  });

  it('reloads the status when the refund went through but the plan did not end', async () => {
    requestRefund.mockRejectedValue(new ApiError(502, JSON.stringify({ error: 'Your refund of $10.99 went through, but we could not end your plan automatically.', code: 'cancel_failed' })));
    const { onStale } = await render();
    await act(async () => { btn('Refund $10.99')!.click(); });
    expect(text()).toContain('went through');
    expect(onStale).toHaveBeenCalled();
  });

  it('a partial refund reloads the status and keeps the confirm button off', async () => {
    requestRefund.mockRejectedValue(new ApiError(502, JSON.stringify({ error: 'Part of your refund could not be processed.', code: 'partial', amount: 0 })));
    const { onStale, onClose } = await render();
    await act(async () => { btn('Refund $10.99')!.click(); });
    expect(text()).toContain('Part of your refund could not be processed.');
    expect(onStale).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(btn('Refund $10.99')!.disabled).toBe(true);
    expect(btn('Keep my plan')!.disabled).toBe(false);
  });

  it('cancel_failed also keeps the confirm button off', async () => {
    requestRefund.mockRejectedValue(new ApiError(502, JSON.stringify({ error: 'went through', code: 'cancel_failed' })));
    await render();
    await act(async () => { btn('Refund $10.99')!.click(); });
    expect(btn('Refund $10.99')!.disabled).toBe(true);
  });

  it('a plain error (no code) leaves the confirm button on and does not reload', async () => {
    requestRefund.mockRejectedValue(new ApiError(500, JSON.stringify({ error: 'Something went wrong.' })));
    const { onStale } = await render();
    await act(async () => { btn('Refund $10.99')!.click(); });
    expect(text()).toContain('Something went wrong.');
    expect(onStale).not.toHaveBeenCalled();
    expect(btn('Refund $10.99')!.disabled).toBe(false);
  });

  it('amount_changed shows the message and reloads the status', async () => {
    requestRefund.mockRejectedValue(new ApiError(409, JSON.stringify({
      error: 'The amount changed since you opened this. Close and reopen to see the new total.', code: 'amount_changed',
    })));
    const { onStale } = await render();
    await act(async () => { btn('Refund $10.99')!.click(); });
    expect(text()).toContain('The amount changed since you opened this. Close and reopen to see the new total.');
    expect(onStale).toHaveBeenCalled();
  });
});
