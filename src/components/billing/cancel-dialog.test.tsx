import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/api/billing', () => ({ cancelSubscription: vi.fn(async () => ({ ok: true })) }));

import { CancelSubscriptionDialog } from './cancel-dialog';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
});

const longDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function data(trialEnd: number | null, usedBytes = 1024 ** 3) {
  const end = Math.floor(Date.now() / 1000) + 5 * 86400;
  return {
    plan: { id: 'starter', name: 'Starter' },
    usage: { used_bytes: usedBytes },
    subscription: { status: 'active', current_period_end: end, has_subscription: true, cancel_at_period_end: false, grace_period_end: null, trial_end: trialEnd ? end : null },
  } as never;
}

async function render(d: never) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<CancelSubscriptionDialog data={d} onClose={() => {}} onCancelled={() => {}} />); });
}

const bodyText = () => document.body.textContent!;

describe('cancel dialog', () => {
  it('speaks about the trial while one is running', async () => {
    const d = data(1);
    await render(d);
    const date = longDate((d as { subscription: { trial_end: number } }).subscription.trial_end);
    const t = bodyText();
    expect(t).toContain('Cancel your trial?');
    expect(t).toContain(`You won't be charged. Your plan stays on until ${date} and then your account returns to the free plan with 5 GB. Nothing is deleted.`);
    expect(t).toContain('Keep my trial');
    expect(t).toContain('Cancel trial');
    expect(t).not.toContain('grace period');
  });

  it('keeps the over-limit warning in the trial copy when usage exceeds the free limit', async () => {
    await render(data(1, 8 * 1024 ** 3));
    const t = bodyText();
    expect(t).toContain('Cancel your trial?');
    expect(t).toContain('You are using 8 GB.');
    expect(t).toContain('you will not be able to upload anything new while you are over the Free limit.');
  });

  it('no over-limit warning in the trial copy when usage fits', async () => {
    await render(data(1));
    expect(bodyText()).not.toContain('over the Free limit');
  });

  it('keeps today\'s copy outside a trial', async () => {
    await render(data(null));
    const t = bodyText();
    expect(t).toContain('Cancel subscription?');
    expect(t).toContain('Keep subscription');
    expect(t).not.toContain('Cancel your trial?');
  });
});
