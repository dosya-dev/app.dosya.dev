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

const { FilesSidebar } = await import('./files-sidebar');
const { useWorkspace } = await import('@/stores/workspace');
const { useSession } = await import('@/stores/session');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
});

// The sidebar renders on three pages (/files, /file-requests, /map), but its
// active states used to come from the ?filter= param alone - so on
// /file-requests the "All" row lit up and "File requests" stayed muted, and the
// sidebar pointed at a page the user was not on.
describe('FilesSidebar active states', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    apiMock.mockReset();
  });

  async function render(path: string, permissions?: Record<string, boolean>) {
    // The sidebar asks /api/me/permissions to decide whether to show the
    // Deleted row. With no map given, usePermissions answers optimistically
    // (every door open), which keeps the active-state cases below unchanged.
    apiMock.mockImplementation((p: unknown) => {
      if (permissions && typeof p === 'string' && p.startsWith('/api/me/permissions')) {
        return Promise.resolve({
          ok: true, user_id: 'u1', role_id: 'role_under_test', role_name: 'Role', is_builtin: false,
          root_folder_id: null, root_folder_name: null, permissions,
        });
      }
      return Promise.resolve({ ok: true });
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[path]}>
            <FilesSidebar onFilterChange={() => {}} onFavouriteClick={() => {}} onGroupClick={() => {}} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    if (permissions) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  const hasNavButton = (label: string) =>
    [...container!.querySelectorAll('button')].some((b) => b.textContent?.trim().startsWith(label));

  // The Deleted row opens GET /api/files?deleted=1, which the server refuses
  // to a role holding neither delete permission (there is nothing such a role
  // could do in the trash). The row follows the same split.
  it('hides Deleted from a role with neither delete permission', async () => {
    await render('/files', {});
    expect(hasNavButton('All')).toBe(true);
    expect(hasNavButton('Deleted')).toBe(false);
  });

  it('shows Deleted to a role with delete_own_files', async () => {
    await render('/files', { delete_own_files: true });
    expect(hasNavButton('Deleted')).toBe(true);
  });

  it('shows Deleted to a role with delete_any_file', async () => {
    await render('/files', { delete_any_file: true });
    expect(hasNavButton('Deleted')).toBe(true);
  });

  function navButton(label: string): HTMLButtonElement {
    const btn = [...container!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim().startsWith(label),
    );
    expect(btn, `button "${label}"`).toBeTruthy();
    return btn as HTMLButtonElement;
  }

  const isActive = (b: HTMLButtonElement) => b.className.includes('bg-muted') && b.className.includes('font-semibold');

  it('on /file-requests, File requests is the one active row', async () => {
    await render('/file-requests');
    expect(isActive(navButton('File requests'))).toBe(true);
    expect(isActive(navButton('All'))).toBe(false);
  });

  it('a request detail page keeps File requests active', async () => {
    await render('/file-requests/req_1');
    expect(isActive(navButton('File requests'))).toBe(true);
  });

  it('on /map, Map is the one active row', async () => {
    await render('/map');
    expect(isActive(navButton('Map'))).toBe(true);
    expect(isActive(navButton('All'))).toBe(false);
    expect(isActive(navButton('File requests'))).toBe(false);
  });

  it('on /files the filter rows still work as before', async () => {
    await render('/files?filter=documents');
    expect(isActive(navButton('Documents'))).toBe(true);
    expect(isActive(navButton('All'))).toBe(false);
    expect(isActive(navButton('File requests'))).toBe(false);

    await act(async () => root!.unmount());
    container!.remove();
    await render('/files');
    expect(isActive(navButton('All'))).toBe(true);
  });
});

// Personas sits after Images and before Shared and lights on /personas and its
// persona pages. It runs on each member's own device, free on every plan, so
// the row shows for every role that may see files, with no server check.
describe('FilesSidebar Personas row', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    apiMock.mockReset();
    localStorage.clear();
  });

  async function render(path: string, opts: { permissions?: Record<string, boolean> } = {}) {
    useWorkspace.setState({ activeId: 'ws_1' });
    useSession.setState({ user: { id: 'u1' } } as never);
    const permissions = opts.permissions ?? { access_files: true, delete_own_files: true };
    apiMock.mockImplementation((p: unknown) => {
      if (typeof p === 'string' && p.startsWith('/api/me/permissions')) {
        return Promise.resolve({
          ok: true, user_id: 'u1', role_id: 'role_under_test', role_name: 'Role', is_builtin: false,
          root_folder_id: null, root_folder_name: null, permissions,
        });
      }
      return Promise.resolve({ ok: true });
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[path]}>
            <FilesSidebar onFilterChange={() => {}} onFavouriteClick={() => {}} onGroupClick={() => {}} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
  }

  const personasAsked = () => apiMock.mock.calls.some(([p]) => typeof p === 'string' && p.includes('/personas'));
  const rowLabels = () => [...container!.querySelectorAll('nav button')].map((b) => b.querySelector('span.truncate')?.textContent?.trim());
  const personasRow = () => [...container!.querySelectorAll<HTMLButtonElement>('nav button')].find((b) => b.textContent?.includes('Personas'))!;
  const isActive = (b: HTMLButtonElement) => b.className.includes('bg-muted') && b.className.includes('font-semibold');

  it('shows the row for a role that may see files, without asking the server, and with no New badge', async () => {
    await render('/files');
    expect(rowLabels()).toContain('Personas');
    expect(personasAsked()).toBe(false);
    expect(personasRow().textContent).not.toContain('New');
  });

  it('has no row for a role without access_files', async () => {
    await render('/file-requests', { permissions: { access_files: false } });
    expect(personasAsked()).toBe(false);
    expect(rowLabels()).not.toContain('Personas');
  });

  it('renders Personas between Images and Shared', async () => {
    await render('/files');
    const labels = rowLabels();
    const at = labels.indexOf('Personas');
    expect(at).toBeGreaterThan(0);
    expect(labels[at - 1]).toBe('Images');
    expect(labels[at + 1]).toBe('Shared');
  });

  it('is active on /personas and on a persona page, and nowhere else', async () => {
    await render('/personas');
    expect(isActive(personasRow())).toBe(true);
    await act(async () => root!.unmount());
    container!.remove();
    await render('/personas/p1');
    expect(isActive(personasRow())).toBe(true);
    await act(async () => root!.unmount());
    container!.remove();
    await render('/files');
    expect(isActive(personasRow())).toBe(false);
  });
});
