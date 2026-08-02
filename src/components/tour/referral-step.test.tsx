import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReferralStep } from './referral-step';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const PAYLOAD = {
  ok: true,
  code: 'abc123',
  link: 'https://app.dosya.dev/sign-up?ref=abc123',
  credited_count: 0,
  max_rewards: 5,
  bonus_label: '0 B',
};

describe('ReferralStep', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null; container = null;
    vi.restoreAllMocks();
  });

  async function render() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<ReferralStep />);
      await Promise.resolve();
    });
  }

  it('shows the referral link once loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => PAYLOAD })));
    await render();
    const input = container!.querySelector<HTMLInputElement>('[data-testid="referral-link"]');
    expect(input).not.toBeNull();
    expect(input!.value).toBe(PAYLOAD.link);
  });

  it('copies the link to the clipboard', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => PAYLOAD })));
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await render();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="referral-copy"]')!.click();
    });
    expect(writeText).toHaveBeenCalledWith(PAYLOAD.link);
  });

  // The tour must never trap anyone. A referral outage costs the link, not
  // the ability to finish onboarding.
  it('renders nothing rather than an error when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await render();
    expect(container!.querySelector('[data-testid="referral-link"]')).toBeNull();
    expect(container!.textContent).not.toContain('error');
  });
});
