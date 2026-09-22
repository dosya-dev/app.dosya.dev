import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BulkProgressDialog } from './bulk-progress-dialog';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('BulkProgressDialog', () => {
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

  const dialog = () => document.body.querySelector('[data-slot="dialog-content"]');

  it('renders nothing when there is no progress', () => {
    render(<BulkProgressDialog progress={null} />);
    expect(dialog()).toBeNull();
  });

  it('shows the running count while deleting', () => {
    render(<BulkProgressDialog progress={{ done: 37, total: 100, permanent: false }} />);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain('37 of 100');
  });

  it('has no close button', () => {
    render(<BulkProgressDialog progress={{ done: 1, total: 5, permanent: false }} />);
    const buttons = Array.from(dialog()!.querySelectorAll('button'));
    expect(buttons.some((b) => b.textContent?.includes('Close'))).toBe(false);
  });

  it('stays open when Escape is pressed', () => {
    render(<BulkProgressDialog progress={{ done: 1, total: 5, permanent: false }} />);
    act(() => {
      dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dialog()).not.toBeNull();
  });

  it('shows no cancel button on the soft-delete path', () => {
    render(<BulkProgressDialog progress={{ done: 1, total: 5, permanent: false }} />);
    expect(dialog()!.querySelector('button')).toBeNull();
  });

  it('shows a working cancel button on the permanent path', () => {
    let cancelled = false;
    render(
      <BulkProgressDialog
        progress={{ done: 1, total: 5, permanent: true }}
        onCancel={() => { cancelled = true; }}
      />,
    );
    const btn = Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent?.includes('Cancel'));
    expect(btn).toBeDefined();
    act(() => { btn!.click(); });
    expect(cancelled).toBe(true);
  });

  it('disables the cancel button once cancel is requested', () => {
    render(
      <BulkProgressDialog
        progress={{ done: 1, total: 5, permanent: true }}
        onCancel={() => {}}
        cancelRequested
      />,
    );
    const btn = Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent?.includes('Cancelling'));
    expect(btn).toBeDefined();
    expect(btn!.disabled).toBe(true);
  });
});
