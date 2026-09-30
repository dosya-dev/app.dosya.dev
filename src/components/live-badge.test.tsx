import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LiveBadge } from './live-badge';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; });
function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node); });
  return container;
}
const badge = (c: HTMLElement) => c.querySelector('[data-testid="live-badge"]') as HTMLElement;

describe('LiveBadge', () => {
  it('reads LIVE on a tile and is labelled for screen readers', () => {
    const c = render(<LiveBadge size="tile" />);
    expect(badge(c).textContent).toContain('LIVE');
    expect(badge(c).getAttribute('aria-label')).toBe('Live Photo');
  });
  it('is glyph-only when asked', () => {
    const c = render(<LiveBadge size="glyph" />);
    expect(badge(c).textContent).not.toContain('LIVE');
  });
  it('the pill uses the green text token, never the green fill', () => {
    const c = render(<LiveBadge size="pill" />);
    expect(badge(c).style.color).toBe('var(--brand-text)');
    expect(badge(c).className).not.toContain('bg-brand');
  });
});
