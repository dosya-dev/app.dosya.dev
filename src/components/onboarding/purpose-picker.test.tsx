import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PurposePicker } from './purpose-picker';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('PurposePicker', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render(node: React.ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root!.render(node); });
  }

  it('offers all four purposes', () => {
    render(<PurposePicker onPick={() => {}} onSkip={() => {}} />);
    expect(container!.querySelectorAll('[data-testid^="purpose-"]:not([data-testid="purpose-skip"])')).toHaveLength(4);
  });

  it('reports the chosen purpose', () => {
    const onPick = vi.fn();
    render(<PurposePicker onPick={onPick} onSkip={() => {}} />);
    act(() => {
      container!.querySelector<HTMLButtonElement>('[data-testid="purpose-dev"]')!.click();
    });
    expect(onPick).toHaveBeenCalledWith('dev');
  });

  it('can be skipped', () => {
    const onSkip = vi.fn();
    render(<PurposePicker onPick={() => {}} onSkip={onSkip} />);
    act(() => {
      container!.querySelector<HTMLButtonElement>('[data-testid="purpose-skip"]')!.click();
    });
    expect(onSkip).toHaveBeenCalled();
  });
});
