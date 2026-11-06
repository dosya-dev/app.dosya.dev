import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import IntegrationsPage from './integrations';

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

function render(): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <IntegrationsPage />
      </MemoryRouter>,
    );
  });
  return container;
}

// jsdom has no layout, so these assert the classes that keep long translated
// labels (German "Dokumentation lesen", Finnish, Greek, Hungarian...) from
// wrapping inside the pill and the docs button.
describe('IntegrationsPage long-label layout', () => {
  it('lets the card footer row wrap and keeps the docs button on one line', () => {
    const el = render();
    const docs = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'));
    expect(docs.length).toBeGreaterThan(0);
    for (const a of docs) {
      expect(a.className).toContain('whitespace-nowrap');
      expect(a.className).toContain('shrink-0');
      expect(a.parentElement!.className).toContain('flex-wrap');
      expect(a.parentElement!.className).toContain('gap-y-2');
    }
  });

  it('truncates tag pills with the full text in a title', () => {
    const el = render();
    const pills = Array.from(el.querySelectorAll<HTMLElement>('span.rounded-full'));
    expect(pills.length).toBeGreaterThan(0);
    for (const p of pills) {
      expect(p.className).toContain('truncate');
      expect(p.className).toContain('whitespace-nowrap');
      expect(p.className).toContain('max-w-full');
      expect(p.getAttribute('title')).toBe(p.textContent);
    }
  });
});
