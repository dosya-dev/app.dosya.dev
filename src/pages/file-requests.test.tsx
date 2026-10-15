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

const { default: FileRequestsPage } = await import('./file-requests');
const { useWorkspace } = await import('@/stores/workspace');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
  // Base UI's Checkbox re-dispatches the click as a PointerEvent on its hidden
  // <input>; jsdom has none, so alias it to MouseEvent (as select-checkbox.test does).
  const w = window as unknown as { PointerEvent?: typeof MouseEvent; MouseEvent: typeof MouseEvent };
  if (!w.PointerEvent) w.PointerEvent = w.MouseEvent;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
});

const EXPIRES_AT = Math.floor(Date.now() / 1000) + 30 * 86_400;

const REQUEST = {
  id: 'fr_1', title: 'Invoices', url: 'https://x/t', is_revoked: 0, is_password_protected: 0,
  expires_at: EXPIRES_AT, created_at: 1_700_000_000, created_by_name: 'Ada', upload_count: 2,
  message: null, folder_id: null, folder_name: null, allowed_extensions: null,
  max_file_size_bytes: null, max_files: null,
};

async function render() {
  apiMock.mockImplementation(async (path: string) =>
    (path.startsWith('/api/file-requests') ? { ok: true, requests: [REQUEST] } : { ok: true }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // The page renders FilesSidebar, which asks usePermissions (react-query)
  // for whether to show the Deleted row - so it needs a client like the app has.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><FileRequestsPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

// F6 (field report): the expiry line pinned 'en-US', so a German or Turkish
// viewer got a US-formatted date. Watched at the call rather than grepped for,
// so the assertion holds in any locale and however the string is built.
describe('FileRequestsPage expiry date', () => {
  it('formats in the viewer\'s locale', async () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString');
    await render();
    expect(container!.textContent).toContain('Invoices');
    expect(spy).toHaveBeenCalled();
    for (const [locale] of spy.mock.calls) expect(locale).toBeUndefined();
    expect(container!.textContent).toContain(
      new Date(EXPIRES_AT * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    );
    spy.mockRestore();
  });
});

// "Put each uploader in their own folder": on by default for a new request,
// and what the box says is what the create call asks for.
describe('FileRequestsPage create dialog', () => {
  const click = async (el: Element | null | undefined) => {
    expect(el).toBeTruthy();
    await act(async () => {
      (el as HTMLElement).click();
      await Promise.resolve();
    });
  };
  const byText = (text: string) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text));
  const createBody = () => {
    const call = apiMock.mock.calls.find(([path]) => path === '/api/file-requests/create');
    return call ? JSON.parse((call[1] as { body: string }).body) : undefined;
  };

  async function openLinkMode() {
    await render();
    await click(byText('New request'));
    const linkTab = [...document.querySelectorAll('[role="tab"]')].find((t) => /link/i.test(t.textContent ?? ''));
    await act(async () => {
      linkTab!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      (linkTab as HTMLElement).click();
      await Promise.resolve();
    });
  }

  it('sends uploader_folders: true unless the box is cleared', async () => {
    await openLinkMode();
    const box = document.querySelector('[data-testid="uploader-folders"]');
    expect(box?.getAttribute('aria-checked') ?? box?.getAttribute('data-state')).toMatch(/true|checked/);
    await click(byText('Generate link'));
    expect(createBody()).toMatchObject({ uploader_folders: true });
  });

  it('sends uploader_folders: false when the box is cleared', async () => {
    await openLinkMode();
    await click(document.querySelector('[data-testid="uploader-folders"]'));
    await click(byText('Generate link'));
    expect(createBody()).toMatchObject({ uploader_folders: false });
  });
});
