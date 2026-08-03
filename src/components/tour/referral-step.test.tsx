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
  // the ability to finish onboarding - so this path must render nothing at
  // all, not a placeholder. A placeholder like "Check back later" would still
  // pass a check for the missing testid and for absent error text, so this
  // asserts the container is fully empty rather than just error-free.
  it('renders nothing rather than an error when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await render();
    expect(container!.querySelector('[data-testid="referral-link"]')).toBeNull();
    expect(container!.textContent).not.toContain('error');
    expect(container!.innerHTML).toBe('');
  });

  // The mount fetch above already guards against setting state after unmount
  // with its `cancelled` flag. The copy-confirmation timer needs the same
  // guard: click Copy, then navigate away inside the 2s window, and the
  // pending setCopied(false) fires on an unmounted component. React 18 does
  // not warn about this, so nothing else surfaces it.
  it('clears the pending copy-confirmation timer on unmount', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => PAYLOAD })));
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await render();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="referral-copy"]')!.click();
      await Promise.resolve();
    });

    // The id the "Copied" reset was scheduled under - the timer clearing on
    // unmount must clear this exact one, not just any timer.
    const copyTimerResult = setTimeoutSpy.mock.results[setTimeoutSpy.mock.results.length - 1];
    const copyTimerId = copyTimerResult!.value as ReturnType<typeof setTimeout>;

    act(() => { root!.unmount(); });
    root = null;

    expect(clearTimeoutSpy).toHaveBeenCalledWith(copyTimerId);
  });
});
