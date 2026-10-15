import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Hairline, HAIRLINE_SETTLE_MS, HAIRLINE_GRACE_MS } from './hairline';
import { beginLoading, resetLoadingForTests } from '@/lib/loading-bar';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  resetLoadingForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Hairline />));
  return container;
}

const line = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="hairline"]');
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('Hairline', () => {
  it('renders nothing while nothing is loading', () => {
    const c = mount();
    expect(line(c)).toBeNull();
  });

  it('runs while a wait is open, completes a beat after it ends, and leaves after the fade', () => {
    const c = mount();
    let end: () => void = () => {};
    act(() => {
      end = beginLoading();
    });
    expect(line(c)!.getAttribute('data-state')).toBe('running');
    act(() => end());
    // Still running through the grace period: the counter at zero is not yet
    // the end of the wait.
    expect(line(c)!.getAttribute('data-state')).toBe('running');
    tick(HAIRLINE_GRACE_MS);
    expect(line(c)!.getAttribute('data-state')).toBe('done');
    tick(HAIRLINE_SETTLE_MS - 1);
    expect(line(c)).not.toBeNull();
    tick(1);
    expect(line(c)).toBeNull();
  });

  it('stays up across overlapping waits until the last one ends', () => {
    const c = mount();
    let endA: () => void = () => {};
    let endB: () => void = () => {};
    act(() => {
      endA = beginLoading();
      endB = beginLoading();
    });
    act(() => endA());
    tick(HAIRLINE_GRACE_MS);
    expect(line(c)!.getAttribute('data-state')).toBe('running');
    act(() => endB());
    tick(HAIRLINE_GRACE_MS);
    expect(line(c)!.getAttribute('data-state')).toBe('done');
  });

  it('bridges a gap shorter than the grace with the same line', () => {
    // A route chunk resolves, React renders the page, the page's fetch
    // begins: two waits with a render between them. One line, not two.
    const c = mount();
    let endChunk: () => void = () => {};
    act(() => {
      endChunk = beginLoading();
    });
    const running = line(c)!;
    act(() => endChunk());
    tick(HAIRLINE_GRACE_MS / 2);
    let endFetch: () => void = () => {};
    act(() => {
      endFetch = beginLoading();
    });
    tick(HAIRLINE_GRACE_MS * 2);
    expect(line(c)).toBe(running);
    expect(running.getAttribute('data-state')).toBe('running');
    act(() => endFetch());
    tick(HAIRLINE_GRACE_MS);
    expect(line(c)!.getAttribute('data-state')).toBe('done');
  });

  it('starts a fresh line from the left when a wait begins mid-fade', () => {
    const c = mount();
    let end: () => void = () => {};
    act(() => {
      end = beginLoading();
    });
    act(() => end());
    tick(HAIRLINE_GRACE_MS);
    const fading = line(c)!;
    expect(fading.getAttribute('data-state')).toBe('done');
    act(() => {
      beginLoading();
    });
    const fresh = line(c)!;
    expect(fresh.getAttribute('data-state')).toBe('running');
    // A new element, not the old one flipped back: the old one was at 100%
    // and transitioning it back would shrink the line in front of the user.
    expect(fresh).not.toBe(fading);
    tick(HAIRLINE_SETTLE_MS * 2);
    expect(line(c)!.getAttribute('data-state')).toBe('running');
  });

  it('is running from the first frame when mounted into an open wait', () => {
    beginLoading();
    const c = mount();
    expect(line(c)!.getAttribute('data-state')).toBe('running');
  });
});
