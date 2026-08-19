import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { FilesSidebar } = await import('./files-sidebar');
const { useWorkspace } = await import('@/stores/workspace');

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

  async function render(path: string) {
    apiMock.mockResolvedValue({ ok: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[path]}>
          <FilesSidebar onFilterChange={() => {}} onFavouriteClick={() => {}} onGroupClick={() => {}} />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
  }

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
