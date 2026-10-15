import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  beginLoading,
  isLoadingPending,
  subscribeLoading,
  resetLoadingForTests,
  useLoadingBar,
  useLoadingPending,
} from './loading-bar';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => resetLoadingForTests());

describe('loading counter', () => {
  it('is pending while any begin is unmatched', () => {
    expect(isLoadingPending()).toBe(false);
    const endA = beginLoading();
    const endB = beginLoading();
    expect(isLoadingPending()).toBe(true);
    endA();
    expect(isLoadingPending()).toBe(true);
    endB();
    expect(isLoadingPending()).toBe(false);
  });

  it('ignores a second call to the same end, so the count never goes negative', () => {
    const end = beginLoading();
    end();
    end();
    expect(isLoadingPending()).toBe(false);
    const again = beginLoading();
    expect(isLoadingPending()).toBe(true);
    again();
    expect(isLoadingPending()).toBe(false);
  });

  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const fn = vi.fn();
    const off = subscribeLoading(fn);
    const end = beginLoading();
    end();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    beginLoading();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('hooks', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function mount(node: React.ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(node));
  }

  function Probe() {
    const pending = useLoadingPending();
    return <span data-testid="pending">{pending ? 'yes' : 'no'}</span>;
  }

  it('useLoadingPending re-renders when the counter changes', () => {
    mount(<Probe />);
    expect(container!.textContent).toBe('no');
    let end: () => void = () => {};
    act(() => {
      end = beginLoading();
    });
    expect(container!.textContent).toBe('yes');
    act(() => end());
    expect(container!.textContent).toBe('no');
  });

  function Page({ loading }: { loading: boolean }) {
    useLoadingBar(loading);
    return null;
  }

  it('useLoadingBar holds the line while active and releases it on false or unmount', () => {
    mount(<Page loading={false} />);
    expect(isLoadingPending()).toBe(false);
    act(() => root!.render(<Page loading={true} />));
    expect(isLoadingPending()).toBe(true);
    act(() => root!.render(<Page loading={false} />));
    expect(isLoadingPending()).toBe(false);
    act(() => root!.render(<Page loading={true} />));
    expect(isLoadingPending()).toBe(true);
    act(() => root!.unmount());
    root = null;
    expect(isLoadingPending()).toBe(false);
  });
});
