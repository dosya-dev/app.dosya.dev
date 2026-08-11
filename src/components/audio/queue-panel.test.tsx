import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FileItem } from '@/lib/file-types';

const { QueuePanel } = await import('./queue-panel');

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

const mk = (id: string, name: string, size = 1000) =>
  ({ id, name, size_bytes: size } as unknown as FileItem);

const queue = [
  mk('a', '01 Approach Lights.mp3', 1_258_291),
  mk('b', '02 Coastal Road.mp3'),
  mk('c', 'bonus-take.mp3'),
];

function renderQueue(props: Partial<Parameters<typeof QueuePanel>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(QueuePanel, {
        queue,
        activeIndex: 1,
        playing: true,
        folder: '',
        onPick: () => {},
        ...props,
      }),
    );
  });
  return container!;
}

const rows = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('button[data-track]'));

describe('QueuePanel', () => {
  it('lists every track by name without its extension', () => {
    const el = renderQueue();
    const text = el.textContent ?? '';
    expect(text).toContain('01 Approach Lights');
    expect(text).toContain('02 Coastal Road');
    expect(text).toContain('bonus-take');
    expect(text).not.toContain('.mp3');
  });

  it('marks the playing row for assistive tech, not with colour alone', () => {
    const el = renderQueue();
    expect(rows(el)[1].getAttribute('aria-current')).toBe('true');
    expect(rows(el)[0].hasAttribute('aria-current')).toBe(false);
  });

  it('reports the picked index so the player can load that track', () => {
    const onPick = vi.fn();
    const el = renderQueue({ onPick, activeIndex: 0 });
    act(() => { rows(el)[2].click(); });
    expect(onPick).toHaveBeenCalledWith(2);
  });

  it('shows each track size, which it knows, rather than a duration it would have to download to learn', () => {
    const el = renderQueue();
    expect(el.textContent).toContain('1.2 MB');
  });

  it('shows the folder as a subtitle only when the caller knows one', () => {
    const withFolder = renderQueue({ folder: 'Recordings / March' });
    expect(withFolder.textContent).toContain('Recordings / March');
    act(() => root!.unmount());
    container!.remove();

    const without = renderQueue({ folder: '' });
    expect(without.querySelector('[data-subtitle]')).toBeNull();
  });

  it('renders rows only - the player owns the tab header above them', () => {
    const el = renderQueue();
    expect(el.textContent).not.toContain('Up next');
    expect(rows(el)).toHaveLength(3);
  });
});
