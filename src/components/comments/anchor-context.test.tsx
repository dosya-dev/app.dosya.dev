import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AnchorProvider, useRegisterAnchorTarget, useAnchorTarget, type AnchorTarget, type PendingAnchor } from './anchor-context';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; });

function Player({ target }: { target: AnchorTarget | null }) { useRegisterAnchorTarget(target); return null; }
function Reader({ onTarget }: { onTarget: (t: AnchorTarget | null) => void }) {
  const t = useAnchorTarget();
  useEffect(() => { onTarget(t); }, [t, onTarget]);
  return null;
}

function mount(pending: PendingAnchor, target: AnchorTarget | null, onApplied = vi.fn(), onTarget = vi.fn()) {
  const el = document.createElement('div');
  root = createRoot(el);
  act(() => root!.render(createElement(AnchorProvider, {
    markers: [], pending, onPendingApplied: onApplied, onSelectComment: vi.fn(),
    children: [createElement(Player, { key: 'p', target }), createElement(Reader, { key: 'r', onTarget })],
  })));
  return { onApplied, onTarget };
}

describe('AnchorProvider', () => {
  it('a registered target is visible to readers', () => {
    const t: AnchorTarget = { kind: 'page', now: () => 1, goTo: vi.fn() };
    const { onTarget } = mount(null, t);
    expect(onTarget).toHaveBeenLastCalledWith(t);
  });
  it('applies a pending time anchor once a time target registers', () => {
    const seek = vi.fn();
    const { onApplied } = mount({ ms: 42_000 }, { kind: 'time', now: () => 0, seek, pause: vi.fn() });
    expect(seek).toHaveBeenCalledWith(42_000);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
  it('pending anchor waits for a matching target', () => {
    const goTo = vi.fn();
    const { onApplied } = mount({ ms: 1 }, { kind: 'page', now: () => 1, goTo });
    expect(goTo).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    const none = mount({ page: 3 }, null);
    expect(none.onApplied).not.toHaveBeenCalled();
  });
  it('works without a provider: registering is a no-op and the target is null', () => {
    const el = document.createElement('div');
    root = createRoot(el);
    const onTarget = vi.fn();
    act(() => root!.render(createElement('div', null,
      createElement(Player, { target: { kind: 'page', now: () => 1, goTo: vi.fn() } }),
      createElement(Reader, { onTarget }))));
    expect(onTarget).toHaveBeenLastCalledWith(null);
  });
});
