import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const permsMock = vi.fn();
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => permsMock(),
}));

const { RequirePermission } = await import('./require-permission');

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
  permsMock.mockReset();
});

/** Shapes the hook can be in, named the way use-permissions names them. */
function state(o: Partial<{ held: boolean; isResolved: boolean; isLoading: boolean }>) {
  const { held = true, isResolved = true, isLoading = false } = o;
  return {
    // The real `can()` answers TRUE while the map is missing - fail open.
    can: (_p: string) => (isResolved ? held : true),
    isResolved,
    isLoading,
    isError: false,
  };
}

function render(perm = 'access_settings') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <RequirePermission perm={perm}>
          <div data-testid="guarded">SECRET PAGE</div>
        </RequirePermission>
      </MemoryRouter>,
    );
  });
  return container!;
}

describe('RequirePermission', () => {
  it('renders the page when the role holds the permission', () => {
    permsMock.mockReturnValue(state({ held: true }));
    expect(render().textContent).toContain('SECRET PAGE');
  });

  it('withholds the page when the permission is definitively denied', () => {
    permsMock.mockReturnValue(state({ held: false }));
    const el = render();
    expect(el.textContent).not.toContain('SECRET PAGE');
    expect(el.querySelector('[data-testid="guarded"]')).toBeNull();
  });

  it('says why, rather than rendering an empty frame', () => {
    permsMock.mockReturnValue(state({ held: false }));
    expect(render().textContent).toMatch(/do not have access/i);
  });

  it('renders neither the page nor a refusal while the map is still loading', () => {
    permsMock.mockReturnValue(state({ isResolved: false, isLoading: true }));
    const el = render();
    expect(el.textContent).not.toContain('SECRET PAGE');
    expect(el.textContent).not.toMatch(/do not have access/i);
  });

  it('fails OPEN when the map never resolves, matching use-permissions', () => {
    // A network blip must not lock someone out of their own workspace; the
    // server is what says no, and it now withholds the fields anyway.
    permsMock.mockReturnValue(state({ isResolved: false, isLoading: false }));
    expect(render().textContent).toContain('SECRET PAGE');
  });
});
