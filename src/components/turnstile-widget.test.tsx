import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TurnstileWidget, type TurnstileHandle } from './turnstile-widget';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// Typed params so mock.calls[0][1] is the options object, not `unknown`.
const api = {
  render: vi.fn((_el: HTMLElement, _opts: Record<string, unknown>) => 'widget-1'),
  reset: vi.fn((_id: string) => {}),
  remove: vi.fn((_id: string) => {}),
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Async act so the component's loadScript().then() microtask flushes. */
async function mount(ui: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(ui); });
}

function renderOpts() {
  return api.render.mock.calls[0][1] as {
    callback: (t: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  };
}

beforeEach(() => {
  api.render.mockClear();
  api.reset.mockClear();
  api.remove.mockClear();
  (window as unknown as { turnstile: typeof api }).turnstile = api;
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  delete (window as unknown as { turnstile?: typeof api }).turnstile;
});

describe('TurnstileWidget', () => {
  it('renders one widget with the given action', async () => {
    await mount(<TurnstileWidget action="login" />);
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(api.render.mock.calls[0][1]).toMatchObject({ action: 'login' });
  });

  it('exposes the token captured from the success callback', async () => {
    const ref = createRef<TurnstileHandle>();
    await mount(<TurnstileWidget action="login" ref={ref} />);
    act(() => renderOpts().callback('tok-abc'));
    expect(ref.current?.getToken()).toBe('tok-abc');
  });

  // Tokens are single-use. A user who mistypes their password and retries
  // must get a fresh token, or the second attempt fails verification.
  it('clears the cached token when reset is called', async () => {
    const ref = createRef<TurnstileHandle>();
    await mount(<TurnstileWidget action="login" ref={ref} />);
    act(() => renderOpts().callback('tok-abc'));
    act(() => ref.current!.reset());
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    expect(ref.current?.getToken()).toBe('');
  });

  it('clears the cached token when the token expires', async () => {
    const ref = createRef<TurnstileHandle>();
    await mount(<TurnstileWidget action="login" ref={ref} />);
    act(() => renderOpts().callback('tok-abc'));
    act(() => renderOpts()['expired-callback']());
    expect(ref.current?.getToken()).toBe('');
  });

  // The bug this exists for: a user who types a 6-digit code and hits Enter
  // beats the challenge, getToken() returns '', and an enforcing route 403s a
  // legitimate person. waitForToken() has to park until the callback lands.
  it('resolves waitForToken with a token that only arrives after the call', async () => {
    const ref = createRef<TurnstileHandle>();
    await mount(<TurnstileWidget action="verify" ref={ref} />);

    let resolved: string | undefined;
    const pending = ref.current!.waitForToken().then((t) => { resolved = t; });
    expect(resolved).toBeUndefined();
    expect(ref.current?.status()).toBe('waiting');

    await act(async () => { renderOpts().callback('tok-late'); await pending; });
    expect(resolved).toBe('tok-late');
    expect(ref.current?.status()).toBe('ready');
  });

  it('resolves waitForToken immediately when a token is already held', async () => {
    const ref = createRef<TurnstileHandle>();
    await mount(<TurnstileWidget action="login" ref={ref} />);
    act(() => renderOpts().callback('tok-early'));
    await expect(ref.current!.waitForToken()).resolves.toBe('tok-early');
  });

  // Turnstile reporting an error means no token is ever coming. Waiting out
  // the full 8s before telling the user would be its own bug.
  it('releases waiters at once when Turnstile errors, and reports unavailable', async () => {
    const ref = createRef<TurnstileHandle>();
    await mount(<TurnstileWidget action="login" ref={ref} />);

    const pending = ref.current!.waitForToken();
    await act(async () => { renderOpts()['error-callback'](); });
    await expect(pending).resolves.toBe('');
    expect(ref.current?.status()).toBe('unavailable');
    // And a later caller must not park for a token that cannot arrive.
    await expect(ref.current!.waitForToken()).resolves.toBe('');
  });

  it('gives up on waitForToken after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<TurnstileHandle>();
      await mount(<TurnstileWidget action="login" ref={ref} />);
      const pending = ref.current!.waitForToken(500);
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      await expect(pending).resolves.toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  // Router transitions mount and unmount these pages repeatedly. Leaking a
  // widget per visit eventually breaks rendering.
  it('removes its widget on unmount', async () => {
    await mount(<TurnstileWidget action="login" />);
    await act(async () => root!.unmount());
    root = null; // stop afterEach unmounting a second time
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  });
});
