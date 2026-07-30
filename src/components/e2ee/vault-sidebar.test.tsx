import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VaultSidebar } from '@/components/e2ee/vault-sidebar';
import type { KnownWorkspace } from '@/stores/e2ee';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function space(id: string, name: string, shared = false): KnownWorkspace {
  return { id, name, selfFounded: !shared, globalWorkspaceId: 'gw1', shared };
}

function render(props: Partial<Parameters<typeof VaultSidebar>[0]> = {}) {
  const onSelect = vi.fn();
  const onNewSpace = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <VaultSidebar
        mySpaces={props.mySpaces ?? [space('a', 'Personal'), space('b', 'Work')]}
        sharedSpaces={props.sharedSpaces ?? []}
        activeId={props.activeId ?? null}
        onSelect={props.onSelect ?? onSelect}
        onNewSpace={props.onNewSpace ?? onNewSpace}
      />,
    );
  });
  return { onSelect, onNewSpace };
}

/** Every Space row/tile, in render order (the collapse toggle has no text). */
function spaceButtons(): HTMLButtonElement[] {
  return [...container!.querySelectorAll('button')].filter(
    (b) => b.getAttribute('title') !== 'Collapse' && b.getAttribute('title') !== 'Expand',
  ) as HTMLButtonElement[];
}

function click(el: Element) {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

describe('VaultSidebar', () => {
  it('lists own Spaces and reports the clicked id', () => {
    const { onSelect } = render();
    const work = spaceButtons().find((b) => b.textContent?.includes('Work'));
    expect(work).toBeDefined();
    click(work!);
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('separates shared Spaces under their own heading', () => {
    render({ sharedSpaces: [space('s1', 'Team docs', true)] });
    expect(container!.textContent).toContain('My Spaces');
    expect(container!.textContent).toContain('Shared with me');
    expect(container!.textContent).toContain('Team docs');
  });

  it('hides the shared heading entirely when nothing is shared', () => {
    render({ sharedSpaces: [] });
    expect(container!.textContent).not.toContain('Shared with me');
  });

  it('marks only the active Space', () => {
    render({ activeId: 'a' });
    const rows = spaceButtons().filter((b) => /Personal|Work/.test(b.textContent ?? ''));
    const active = rows.filter((b) => b.className.includes('font-semibold'));
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('Personal');
  });

  it('always offers a way to create the first Space when empty', () => {
    const { onNewSpace } = render({ mySpaces: [] });
    expect(container!.textContent).toContain('No Spaces yet');
    const plus = container!.querySelector('[title="New Space"]');
    expect(plus).not.toBeNull();
    click(plus!);
    expect(onNewSpace).toHaveBeenCalledTimes(1);
  });

  it('collapses to initials and persists the choice', () => {
    render({ activeId: 'a' });
    click(container!.querySelector('[title="Collapse"]')!);

    // Collapsed: names give way to single-letter tiles, but the Space stays
    // clickable and its full name survives as the tooltip.
    const tiles = spaceButtons().filter((b) => b.getAttribute('title') !== 'New Space');
    expect(tiles.map((b) => b.textContent)).toEqual(['P', 'W']);
    expect(tiles[0].getAttribute('title')).toBe('Personal');
    expect(localStorage.getItem('dosya_vault_sidebar_collapsed')).toBe('1');
  });

  it('restores the collapsed state on mount', () => {
    localStorage.setItem('dosya_vault_sidebar_collapsed', '1');
    render();
    expect(container!.querySelector('[title="Expand"]')).not.toBeNull();
    expect(container!.textContent).not.toContain('Personal');
  });
});
