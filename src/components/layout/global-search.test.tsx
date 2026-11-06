import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

// The engine is not under test here (people are covered in global-search.persons.test.tsx).
vi.mock('@/lib/personas-device/engine-host', () => import('@/lib/personas-device/__fixtures__/fake-host'));
const { GlobalSearch } = await import('./global-search');
const { useWorkspace } = await import('@/stores/workspace');
const { useSession } = await import('@/stores/session');
const { recordRecent } = await import('@/lib/search/recent');
const { resetContentSearchState } = await import('@/lib/ai-search');

const HELP = { ok: true, articles: [{ slug: 'wp', category: 'integrations', title: 'Back up a WordPress site', summary: 'Plugin setup', keywords: [] }] };
const FILES = { ok: true, files: [{ id: 'f1', name: 'wordpress-backup.zip', size_bytes: 10, extension: 'zip', folder_id: 'd1', uploader_name: 'Firat' }], folders: [], shared: [], file_requests: [] };
let perms: Record<string, boolean> = {};
let helpResponse: () => Promise<unknown> = async () => HELP;
let searchResponse: (q: string) => Promise<unknown> = async () => FILES;

function routeApi(path: string) {
  if (path.startsWith('/api/me/permissions')) return Promise.resolve({ ok: true, permissions: perms });
  if (path === '/api/help/index') return helpResponse();
  if (path.startsWith('/api/search')) return searchResponse(new URL(`https://x${path}`).searchParams.get('q') ?? '');
  return Promise.resolve({ ok: true });
}

let root: Root | null = null;
let container: HTMLDivElement;
let lastPath = '';
function PathSpy() { const l = useLocation(); useEffect(() => { lastPath = l.pathname + l.search + l.hash; }); return null; }

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = createRoot(container);
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/files']}>
          <GlobalSearch />
          <Routes><Route path="*" element={<PathSpy />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

const input = () => container.querySelector('input[role="combobox"]') as HTMLInputElement;
const options = () => [...container.querySelectorAll('[role="option"]')] as HTMLElement[];
const headers = () => [...container.querySelectorAll('[data-search-group]')].map((h) => h.getAttribute('data-search-group'));

async function type(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function focus() { await act(async () => { input().focus(); input().dispatchEvent(new FocusEvent('focus')); }); }
async function key(k: string, opts: KeyboardEventInit = {}, target: EventTarget = input()) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts })); });
}
async function flush(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  perms = { access_settings: true, access_files: true, access_team: true, view_activity: true, manage_branding: true, access_dashboard: true, access_upload: true, access_shared: true };
  helpResponse = async () => HELP;
  searchResponse = async () => FILES;
  apiMock.mockImplementation(routeApi);
  useWorkspace.setState({ activeId: 'ws_1' });
  useSession.setState({ user: { id: 'u_1' } } as never);
  // Content search (raw fetch) answers as a workspace without AI search;
  // global-search.content.test.tsx covers the content group itself.
  resetContentSearchState();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'ai_search_off' }), { status: 409 })));
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container.remove();
  root = null;
  apiMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('GlobalSearch', () => {
  it('uses the new placeholder', async () => {
    await mount();
    expect(input().placeholder).toBe('Search files, settings, integrations, help');
  });

  it('shows the integration as top hit, then files, then help, in that order', async () => {
    await mount();
    await focus();
    await type('wordpress');
    await flush(300);
    expect(headers()).toEqual(['top', 'files', 'help']);
    expect(options()[0].textContent).toContain('WordPress');
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('Enter opens the top hit; with no highlight Enter goes to /search', async () => {
    await mount();
    await focus();
    await type('billing');
    await key('Enter');
    expect(lastPath).toBe('/billing');
    await focus();
    await type('zzqq');
    await flush(300);
    await key('Enter');
    expect(lastPath).toBe('/search?q=zzqq');
  });

  it('arrow keys move across groups and wrap', async () => {
    await mount();
    await focus();
    await type('wordpress');
    await flush(300);
    const n = options().length;
    for (let i = 0; i < n; i++) await key('ArrowDown');
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    await key('ArrowUp');
    expect(options()[n - 1].getAttribute('aria-selected')).toBe('true');
  });

  it('Cmd+K and Ctrl+K focus the box; / does not steal focus from another input', async () => {
    await mount();
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    await key('/', {}, other);
    expect(document.activeElement).toBe(other);
    await key('k', { metaKey: true }, other);
    expect(document.activeElement).toBe(input());
    other.focus();
    await key('k', { ctrlKey: true }, other);
    expect(document.activeElement).toBe(input());
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    await key('k', { metaKey: true }, ta);
    expect(document.activeElement).toBe(ta);
    ta.remove();
    other.remove();
  });

  it('hides perm-gated pages the role lacks', async () => {
    perms = { ...perms, access_settings: false };
    await mount();
    await focus();
    await flush();
    await type('security');
    expect(options().map((o) => o.textContent).join('|')).not.toContain('Workspace settings');
    expect(options().map((o) => o.textContent).join('|')).toContain('Password & 2FA');
  });

  it('a failed help index hides only the Help group', async () => {
    helpResponse = async () => { throw new Error('down'); };
    await mount();
    await focus();
    await type('wordpress');
    await flush(300);
    expect(headers()).toEqual(['top', 'files']);
  });

  it('a failed file search shows one muted line and keeps instant groups', async () => {
    searchResponse = async () => { throw new Error('500'); };
    await mount();
    await focus();
    await type('billing');
    await flush(300);
    expect(container.textContent).toContain("Couldn't search files");
    expect(options()[0].textContent).toContain('Billing');
  });

  it('drops a late response for an older query', async () => {
    const old: { resolve: (v: unknown) => void } = { resolve: () => {} };
    searchResponse = (q) => (q === 'wo' ? new Promise((r) => { old.resolve = r; }) : Promise.resolve({ ...FILES, files: [{ ...FILES.files[0], name: 'new.zip' }] }));
    await mount();
    await focus();
    await type('wo');
    await flush(300);
    await type('wordpress');
    await flush(300);
    await act(async () => { old.resolve({ ...FILES, files: [{ ...FILES.files[0], name: 'old.zip' }] }); });
    expect(container.textContent).toContain('new.zip');
    expect(container.textContent).not.toContain('old.zip');
  });

  it('empty box shows recents; picking a row records it', async () => {
    recordRecent('u_1', 'ws_1', { id: 'goto:billing', kind: 'goto', title: 'Billing', href: '/billing' });
    await mount();
    await focus();
    expect(headers()).toEqual(['recent']);
    expect(options()[0].textContent).toContain('Billing');
    await type('api keys');
    await key('Enter');
    expect(lastPath).toBe('/profile/api');
    await focus();
    await type('');
    expect(options()[0].textContent).toContain('API keys');
  });

  it('keeps the highlight on the chosen row when file results arrive later', async () => {
    const late: { resolve: (v: unknown) => void } = { resolve: () => {} };
    searchResponse = () => new Promise((r) => { late.resolve = r; });
    await mount();
    await focus();
    await type('sec');
    await flush(300);
    await key('ArrowDown');
    const chosen = options().find((o) => o.getAttribute('aria-selected') === 'true')!;
    const chosenText = chosen.textContent;
    await act(async () => { late.resolve(FILES); });
    const selected = options().filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe(chosenText);
    await key('Enter');
    expect(chosenText).toContain('Password & 2FA');
    expect(lastPath).toBe('/profile/password');
  });

  it('switching workspace clears the query and closes the dropdown', async () => {
    await mount();
    await focus();
    await type('wordpress');
    await flush(300);
    expect(options().length).toBeGreaterThan(0);
    await act(async () => { useWorkspace.setState({ activeId: 'ws_2' }); });
    expect(input().value).toBe('');
    expect(options()).toHaveLength(0);
  });

  it('Esc closes the visible dropdown first, then blurs', async () => {
    await mount();
    await focus();
    await type('wordpress');
    await flush(300);
    expect(options().length).toBeGreaterThan(0);
    await key('Escape');
    expect(options()).toHaveLength(0);
    await key('Escape');
    expect(document.activeElement).not.toBe(input());
  });

  it('Cmd+K inside the box is not left to the browser', async () => {
    await mount();
    await focus();
    const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { input().dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('tabbing out closes the dropdown', async () => {
    await mount();
    const other = document.createElement('button');
    document.body.appendChild(other);
    await focus();
    await type('wordpress');
    await flush(300);
    expect(options().length).toBeGreaterThan(0);
    await act(async () => { other.focus(); });
    expect(options()).toHaveLength(0);
    other.remove();
  });

  it('mousedown on a dropdown link does not blur the box', async () => {
    await mount();
    await focus();
    await type('wordpress');
    await flush(300);
    const link = container.querySelector('a[href^="https://help.dosya.dev/search"]') as HTMLAnchorElement;
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    await act(async () => { link.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(options().length).toBeGreaterThan(0);
  });

  it('nothing found offers the help center', async () => {
    searchResponse = async () => ({ ...FILES, files: [] });
    await mount();
    await focus();
    await type('xyzzy');
    // The empty state waits for the content search too (400 ms debounce).
    await flush(400);
    expect(container.textContent).toContain('No results for "xyzzy"');
    const link = container.querySelector('a[href^="https://help.dosya.dev/search"]') as HTMLAnchorElement;
    expect(link.href).toBe('https://help.dosya.dev/search?q=xyzzy');
    expect(link.target).toBe('_blank');
  });
});
