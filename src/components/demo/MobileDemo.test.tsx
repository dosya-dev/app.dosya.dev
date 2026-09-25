import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MobileDemo from './MobileDemo';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom implements no matchMedia, and the upload engine asks it whether the
  // visitor prefers reduced motion before it starts ticking
  // (engine/demoState.tsx). Without this the upload case dies inside a React
  // passive effect with "window.matchMedia is not a function" - which is what it
  // did the first time anything actually executed this file: the marketing
  // config only ever collected `*.test.ts`, so a `.tsx` test sat here unrun
  // until apps/web's jsdom suite picked up the vendored copy.
  //
  // `matches: false` is the honest default for a test asserting the ANIMATED
  // path; a reduced-motion case would stub its own.
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

// The mobile demo is a replica of apps/mobile: the same three tabs on the
// orbit tab bar, the orbit button opening the add sheet, and the Files screen
// with the app's chips and list/grid toggle. These pin the parts a visitor
// interacts with; the pixel work is checked by eye against the real app.
describe('MobileDemo', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.useRealTimers();
  });

  function render() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root!.render(<MobileDemo />); });
  }
  const q = (sel: string) => container!.querySelector<HTMLElement>(sel);
  const click = (el: Element | null) => { expect(el).not.toBeNull(); act(() => { (el as HTMLElement).click(); }); };

  it('opens on Files with the app\'s three tabs and the orbit button', () => {
    render();
    expect(q('[data-testid="orbit-tab-files"]')?.getAttribute('aria-current')).toBe('page');
    expect(q('[data-testid="orbit-tab-backup"]')).not.toBeNull();
    expect(q('[data-testid="orbit-tab-settings"]')).not.toBeNull();
    expect(q('[data-testid="orbit-button"]')?.getAttribute('aria-label')).toBe('Add');
    // The workspace header sits on every tab, exactly as in the app.
    expect(q('[data-testid="ws-trigger"]')?.textContent).toContain('Acme Studio');
  });

  it('shows the seed folders and files in a grid, and switches to the list view', () => {
    render();
    expect(container!.querySelectorAll('[data-demo-tile]').length).toBeGreaterThan(3);
    expect(container!.querySelectorAll('[data-demo-row]').length).toBe(0);
    click(q('button[aria-label="List view"]'));
    expect(container!.querySelectorAll('[data-demo-row]').length).toBeGreaterThan(3);
    expect(container!.querySelectorAll('[data-demo-tile]').length).toBe(0);
  });

  it('filters by the Images chip', () => {
    render();
    const before = container!.querySelectorAll('[data-demo-tile]').length;
    click(Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Images') ?? null);
    const after = container!.querySelectorAll('[data-demo-tile]').length;
    expect(after).toBeLessThan(before);
    expect(container!.textContent).not.toContain('pitch-deck.pdf');
    expect(container!.textContent).toContain('sunset-beach.jpg');
  });

  it('switches to Backup and Settings via the tab bar', () => {
    render();
    click(q('[data-testid="orbit-tab-backup"]'));
    expect(container!.textContent).toContain('of 1,498 protected');
    expect(q('[data-testid="backup-now"]')).not.toBeNull();
    click(q('[data-testid="orbit-tab-settings"]'));
    expect(container!.textContent).toContain('Favourites');
    expect(container!.textContent).toContain('My workspaces');
    expect(container!.textContent).toContain('Alex Rivera');
  });

  it('opens the orbit sheet and starts an upload from "Choose photos"', () => {
    vi.useFakeTimers();
    render();
    click(q('[data-testid="orbit-button"]'));
    const sheet = q('[data-testid="orbit-sheet"]');
    expect(sheet).not.toBeNull();
    // Escape dismisses it, like the back gesture in the app; reopen for the rest.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(q('[data-testid="orbit-sheet"]')).toBeNull();
    click(q('[data-testid="orbit-button"]'));
    // RE-QUERIED, not the `sheet` above: Escape unmounted that node, so it is
    // detached from the document and a click inside it reaches no handler - the
    // sheet would stay open and the assertions below would read the old DOM.
    const reopened = q('[data-testid="orbit-sheet"]');
    expect(reopened).not.toBeNull();
    expect(reopened!.textContent).toContain('Add to Acme Studio');
    expect(q('[data-testid="orbit-button"]')?.getAttribute('aria-label')).toBe('Close');
    click(Array.from(reopened!.querySelectorAll('button')).find((b) => b.textContent?.includes('Choose photos')) ?? null);
    // The sheet closes and the orbit button turns into the transfer indicator.
    expect(q('[data-testid="orbit-sheet"]')).toBeNull();
    expect(q('[data-testid="orbit-button"]')?.getAttribute('aria-label')).toMatch(/^Uploading, \d+%$/);
    // Let the engine finish: the file lands in the listing.
    act(() => { vi.advanceTimersByTime(4000); });
    expect(container!.textContent).toContain('IMG_4790.jpg');
    expect(q('[data-testid="orbit-button"]')?.getAttribute('aria-label')).toBe('Add');
  });

  it('runs a simulated backup from the engine button and returns to Protected', () => {
    vi.useFakeTimers();
    render();
    click(q('[data-testid="orbit-tab-backup"]'));
    click(q('[data-testid="backup-now"]'));
    expect(q('[data-testid="backup-stop"]')).not.toBeNull();
    expect(container!.textContent).toContain('Backing up');
    // The ring counts down while the run is live, like the app's ledger does.
    expect(container!.textContent).toContain('1,495 of 1,498 protected');
    act(() => { vi.advanceTimersByTime(4500); });
    expect(q('[data-testid="backup-now"]')).not.toBeNull();
    expect(container!.textContent).toContain('Backup finished');
  });
});
