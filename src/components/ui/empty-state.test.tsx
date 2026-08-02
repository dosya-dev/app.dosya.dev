import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FolderOpen } from 'lucide-react';
import { EmptyState } from './empty-state';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('EmptyState', () => {
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

  it('renders the title and description', () => {
    render(<EmptyState icon={FolderOpen} title="This folder is empty" description="Drop files here to get started." />);
    expect(container!.textContent).toContain('This folder is empty');
    expect(container!.textContent).toContain('Drop files here to get started.');
  });

  it('renders actions when given them', () => {
    render(<EmptyState icon={FolderOpen} title="Empty" actions={<button>Upload</button>} />);
    expect(container!.querySelector('[data-testid="empty-state-actions"]')).not.toBeNull();
  });

  it('renders no action row when given none', () => {
    render(<EmptyState icon={FolderOpen} title="Empty" />);
    expect(container!.querySelector('[data-testid="empty-state-actions"]')).toBeNull();
  });
});
