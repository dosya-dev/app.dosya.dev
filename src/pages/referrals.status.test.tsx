import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ReferralsPage from './referrals';
import { friendStatusLabel } from '@/api/referrals';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const PAYLOAD = {
  ok: true,
  code: 'abc123',
  link: 'https://app.dosya.dev/sign-up?ref=abc123',
  credited_count: 1,
  max_rewards: 5,
  bonus_bytes: 5368709120,
  bonus_label: '5 GB',
  friends: [
    { email_masked: 'f***@guerrillamailblock.com', status: 'blocked', joined_at: 1787600000 },
    { email_masked: 'a***@example.com', status: 'credited', joined_at: 1787600001 },
    { email_masked: 'b***@example.com', status: 'pending', joined_at: 1787600002 },
    { email_masked: 'c***@example.com', status: 'held', joined_at: 1787600003 },
  ],
};

describe('ReferralsPage - friend status labels', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null; container = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<ReferralsPage />);
      await Promise.resolve();
    });
  }

  it('labels blocked, credited, pending and held referrals distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => PAYLOAD })));
    await render();

    expect(container!.textContent).toContain('Not eligible');
    expect(container!.textContent).toContain('Counted');
    expect(container!.textContent).toContain('Waiting for activity');
    expect(container!.textContent).toContain('Under review');
    expect(container!.textContent).toContain('uploaded at least 50');
  });

  it('never tells the inviter which rule ended a referral', () => {
    for (const status of ['blocked', 'expired', 'revoked', 'something-new']) {
      expect(friendStatusLabel(status)).toBe('Not eligible');
    }
  });
});
