import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LoadingEscape, LOADING_ESCAPE_AFTER_MS } from './loading-escape';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

describe('LoadingEscape', () => {
  it('stays hidden while the wait is still normal', () => {
    vi.useFakeTimers();
    const c = mount(<LoadingEscape />);
    act(() => vi.advanceTimersByTime(LOADING_ESCAPE_AFTER_MS - 1));
    expect(c.querySelector('[data-slot="loading-escape"]')).toBeNull();
  });

  it('offers a Reload button once the wait runs long, and it reloads the page', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const c = mount(<LoadingEscape />);
    act(() => vi.advanceTimersByTime(LOADING_ESCAPE_AFTER_MS));
    const button = c.querySelector('button')!;
    expect(button.textContent).toBe('Reload');
    act(() => button.click());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never appears if the loader is gone before the deadline', () => {
    vi.useFakeTimers();
    const c = mount(<LoadingEscape />);
    act(() => root!.render(null));
    act(() => vi.advanceTimersByTime(LOADING_ESCAPE_AFTER_MS * 2));
    expect(c.querySelector('[data-slot="loading-escape"]')).toBeNull();
  });
});
