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

  // Router transitions mount and unmount these pages repeatedly. Leaking a
  // widget per visit eventually breaks rendering.
  it('removes its widget on unmount', async () => {
    await mount(<TurnstileWidget action="login" />);
    await act(async () => root!.unmount());
    root = null; // stop afterEach unmounting a second time
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  });
});
