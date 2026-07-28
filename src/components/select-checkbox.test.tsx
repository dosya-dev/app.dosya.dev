import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SelectCheckbox } from '@/components/select-checkbox';

// Base UI's Checkbox re-dispatches the click as a bubbling PointerEvent on its
// hidden <input> sibling; jsdom has no PointerEvent, so alias it to MouseEvent.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const w = window as unknown as { PointerEvent?: typeof MouseEvent; MouseEvent: typeof MouseEvent };
  if (!w.PointerEvent) {
    w.PointerEvent = w.MouseEvent;
  }
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function renderRow() {
  const onRowClick = vi.fn();
  const onCheckedChange = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <div onClick={onRowClick}>
        <SelectCheckbox checked={false} onCheckedChange={onCheckedChange} />
      </div>,
    );
  });
  return { onRowClick, onCheckedChange };
}

describe('SelectCheckbox', () => {
  it('toggles selection without activating the parent row', () => {
    const { onRowClick, onCheckedChange } = renderRow();
    const checkbox = container!.querySelector<HTMLElement>('[role="checkbox"]');
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    // Regression: Base UI re-dispatches the click on its hidden input, which
    // bubbled to the row and opened the folder/file the user tried to select.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('still lets clicks elsewhere in the row through', () => {
    const { onRowClick } = renderRow();
    act(() => {
      container!.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
