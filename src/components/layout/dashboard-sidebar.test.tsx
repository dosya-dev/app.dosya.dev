import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { DashboardSidebar } = await import('./dashboard-sidebar');
const { SidebarProvider } = await import('@/components/ui/sidebar');
const { useWorkspace } = await import('@/stores/workspace');

const ROW_H = 32;
// The "Workspace" group label above the second group collapses to zero height
// in icon mode (group-data-[collapsible=icon]:-mt-8), so everything below it
// slides up - which is exactly the layout shift the pill has to follow.
const LABEL_H = 24;

const rect = (top: number, height: number) =>
  ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

const isCollapsed = () => !!document.querySelector('[data-collapsible="icon"]');

/**
 * jsdom has no layout, so stand in for one: every menu button is a 32px row in
 * document order, and the second group carries the label's height while the
 * rail is expanded.
 */
function stubLayout() {
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const slot = this.getAttribute('data-slot');
    if (slot === 'sidebar-content') return rect(0, 500);
    if (slot === 'sidebar-menu-button') {
      const buttons = [...document.querySelectorAll('[data-slot="sidebar-menu-button"]')];
      const groups = [...document.querySelectorAll('[data-slot="sidebar-group"]')];
      const group = this.closest('[data-slot="sidebar-group"]');
      const inSecondGroup = !!group && groups.indexOf(group) > 0;
      const labelOffset = inSecondGroup && !isCollapsed() ? LABEL_H : 0;
      return rect(buttons.indexOf(this) * ROW_H + labelOffset, ROW_H);
    }
    return rect(0, 0);
  };
  return () => { Element.prototype.getBoundingClientRect = orig; };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  } as unknown as MediaQueryList));
});

// The active-item pill is the whole of the sidebar's navigation motion. It used
// to be hidden in icon-collapsed mode, so a user who collapsed the rail got an
// instant background swap between icons instead of the glide they get expanded.
describe('DashboardSidebar active pill', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let restoreLayout: (() => void) | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    restoreLayout?.();
    root = null;
    container = null;
    restoreLayout = null;
    apiMock.mockReset();
  });

  function Harness({ open, path }: { open: boolean; path: string }) {
    return (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <SidebarProvider open={open} onOpenChange={() => {}}>
            <DashboardSidebar />
          </SidebarProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  async function render(open: boolean, path: string) {
    apiMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/workspaces')) {
        return Promise.resolve({
          ok: true,
          workspaces: [{ id: 'ws_1', name: 'Acme', slug: 'acme', icon_initials: 'AC', icon_color: '#000', icon_image_url: null, role_id: 'role_owner' }],
        });
      }
      // ok:false keeps the storage widget on its "Loading..." branch (no
      // tooltip, no svg); the empty job lists keep the two Integrations
      // indicators on their render-nothing branch.
      return Promise.resolve({ ok: false, jobs: [] });
    });
    restoreLayout = stubLayout();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<Harness open={open} path={path} />);
      await Promise.resolve();
    });
    // Let the mount-time measurement settle.
    await act(async () => { await new Promise((r) => setTimeout(r, 320)); });
  }

  const pill = () => container!.querySelector<HTMLElement>('[data-slot="sidebar-active-pill"]');

  async function clickNav(label: string) {
    const link = [...container!.querySelectorAll('a')].find((a) => a.textContent?.trim() === label);
    expect(link, `nav link "${label}"`).toBeTruthy();
    await act(async () => {
      link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      await Promise.resolve();
    });
  }

  it('renders the pill in icon-collapsed mode instead of hiding it', async () => {
    await render(false, '/');
    const el = pill();
    expect(el, 'pill element').toBeTruthy();
    expect(el!.className).not.toContain('group-data-[collapsible=icon]:hidden');
  });

  it('glides the pill between items while the rail is collapsed', async () => {
    await render(false, '/');
    expect(pill()!.style.top).toBe('0px'); // Dashboard, row 0

    await clickNav('Uploads');
    expect(pill()!.style.top).toBe(`${2 * ROW_H}px`); // row 2
  });

  it('leaves the active button transparent in icon mode so the pill shows through', async () => {
    await render(false, '/files');
    const active = container!.querySelector<HTMLElement>('[data-slot="sidebar-menu-button"][data-active]');
    expect(active, 'active menu button').toBeTruthy();
    // A background painted by the button itself would sit under the icon for
    // the whole slide, making the pill's travel invisible.
    expect(active!.className).not.toContain('group-data-[collapsible=icon]:data-active:bg-accent');
  });

  it('re-measures when the rail collapses under an already-active item', async () => {
    await render(true, '/settings');
    // Settings is row 7 with the group label above it while expanded.
    expect(pill()!.style.top).toBe(`${7 * ROW_H + LABEL_H}px`);

    await act(async () => { root!.render(<Harness open={false} path="/settings" />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 320)); });

    expect(pill()!.style.top).toBe(`${7 * ROW_H}px`);
  });
});
