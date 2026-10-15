import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SealLoader } from './seal-loader';

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
});

function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

describe('SealLoader', () => {
  it('is a status region with a readable label and a decorative mark', () => {
    const c = mount(<SealLoader />);
    const status = c.querySelector('[role="status"]')!;
    expect(status).not.toBeNull();
    expect(status.textContent).toBe('Loading');
    const svg = c.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    // The folder outline plus the seal and its ping: the mark, not a generic ring.
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    expect(svg.querySelector('.seal-loader-dot')).not.toBeNull();
    expect(svg.querySelector('.seal-loader-ping')).not.toBeNull();
  });

  it('takes a custom label for the context it sits in', () => {
    const c = mount(<SealLoader label="Loading files" />);
    expect(c.querySelector('[role="status"]')!.textContent).toBe('Loading files');
  });

  it('sizes the mark by name and defaults to md', () => {
    const c = mount(<SealLoader />);
    expect(c.querySelector('[data-slot="seal-loader"]')!.getAttribute('data-size')).toBe('md');
    expect(c.querySelector('svg')!.classList.contains('size-5')).toBe(true);
    act(() => root!.render(<SealLoader size="xl" />));
    expect(c.querySelector('svg')!.classList.contains('size-10')).toBe(true);
  });

  it('only carries the delay class when asked, so inline waits show at once', () => {
    const c = mount(<SealLoader />);
    expect(c.querySelector('.seal-loader-delayed')).toBeNull();
    act(() => root!.render(<SealLoader delay />));
    expect(c.querySelector('.seal-loader-delayed')).not.toBeNull();
  });
});
