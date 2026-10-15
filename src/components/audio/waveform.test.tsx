import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Waveform } from './waveform';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let el: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); el?.remove(); root = null; });

it('draws a marker per entry at its ratio, dims old ones, and click reports the id without seeking', () => {
  const onSeek = vi.fn(); const onMarker = vi.fn();
  el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  act(() => root!.render(createElement(Waveform, {
    peaks: new Float32Array(100).fill(0.5), position: 0, duration: 100, loop: null, onSeek, onMarker,
    markers: [
      { id: 'a', ratio: 0.25, dim: false, initial: 'A', excerpt: 'first' },
      { id: 'b', ratio: 1, dim: true, initial: 'B', excerpt: 'second' },
    ],
  })));
  const ms = el.querySelectorAll<HTMLButtonElement>('[data-testid="waveform-marker"]');
  expect(ms).toHaveLength(2);
  expect(ms[0].style.left).toBe('25%');
  expect(ms[1].style.opacity).toBe('0.45');
  act(() => ms[0].click());
  expect(onMarker).toHaveBeenCalledWith('a');
  expect(onSeek).not.toHaveBeenCalled();
});
