import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MOVE_DRAG_TYPE } from '@/lib/drag-move';

// Drag a file or folder onto a folder to move it, with a confirm first. These
// drive the real page with synthetic drag events (jsdom has no DataTransfer),
// so they cover the wiring: which targets react, that nothing moves before
// Move, that OS files still reach the upload overlay, and that a server
// refusal reaches the toast in the server's words.

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
const toastCalls: { kind: string; title: string; body?: string }[] = [];
vi.mock('@/lib/toast', () => ({
  toast: {
    info: (title: string, body?: string) => { toastCalls.push({ kind: 'info', title, body }); },
    error: (title: string, body?: string) => { toastCalls.push({ kind: 'error', title, body }); },
    success: (title: string, body?: string) => { toastCalls.push({ kind: 'success', title, body }); },
  },
}));

const { default: FilesPage } = await import('./files');
const { useWorkspace } = await import('@/stores/workspace');
const { ApiError } = await import('@/api/client');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
  toastCalls.length = 0;
  localStorage.clear();
  document.body.innerHTML = '';
});

const folder = (id: string, name: string) => ({
  id, name, created_at: 1_700_000_000, updated_at: 1_700_000_000,
  file_count: 1, lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', is_synced: 0,
  total_size_bytes: 10, content_updated_at: 1_700_000_000, region: null,
  uploader_name: null, share_count: 0, comment_count: 0, origin: null, created_by: 'u_me',
});
const file = (id: string, name: string) => ({
  id, name, size_bytes: 12, mime_type: 'text/plain', extension: '.txt',
  region: 'ap-southeast-2', created_at: 1_700_000_000, updated_at: 1_700_000_000, current_version: 1,
  lock_mode: 'none', is_hidden: 0, hidden_mode: 'none', uploaded_by: 'u_me', uploader_name: 'Me',
  share_count: 0, comment_count: 0, is_synced: 0, origin: 'web',
});

type MoveHandler = (path: string, init?: RequestInit) => Promise<unknown>;

async function render(url = '/files?folder=fld_cur', onMove: MoveHandler = () => Promise.resolve({ ok: true })) {
  const listing = {
    ok: true,
    folders: [folder('fld_a', 'Projects'), folder('fld_b', 'Archive')],
    files: [file('file_1', 'notes.txt'), file('file_2', 'todo.txt')],
    breadcrumbs: url.includes('folder=fld_cur') ? [{ id: 'fld_cur', name: 'Current' }] : [],
    pagination: { page: 1, per_page: 100, total_files: 2, total_pages: 1 },
  };
  apiMock.mockImplementation((path: unknown, init?: RequestInit) => {
    const p = String(path);
    if (p.startsWith('/api/cloud/imports')) return Promise.resolve({ ok: true, jobs: [] });
    if (p.startsWith('/api/me/permissions')) {
      return Promise.resolve({
        ok: true, user_id: 'u_me', role_id: 'r', role_name: 'Role', is_builtin: false,
        root_folder_id: null, root_folder_name: null,
        permissions: { upload_files: true, rename_folders: true, delete_any_file: true },
      });
    }
    if (p.startsWith('/api/groups')) {
      return Promise.resolve({ ok: true, groups: [{ id: 'g1', name: 'Team', color: '#888', folders: [{ folder_id: 'fld_deep', folder_name: 'Deep' }], files: [] }] });
    }
    if (p.startsWith('/api/favourites')) return Promise.resolve({ ok: true, files: [] });
    if (p.startsWith('/api/file-requests')) return Promise.resolve({ ok: true, total: 0 });
    if (p.includes('/move')) return onMove(p, init);
    return Promise.resolve(listing);
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}><FilesPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** A minimal DataTransfer: jsdom has none. */
class FakeDataTransfer {
  private data = new Map<string, string>();
  dropEffect = 'none';
  effectAllowed = 'all';
  dragImage: Element | null = null;
  constructor(init: Record<string, string> = {}) { for (const [k, v] of Object.entries(init)) this.data.set(k, v); }
  get types() { return [...this.data.keys()]; }
  setData(type: string, value: string) { this.data.set(type, value); }
  getData(type: string) { return this.data.get(type) ?? ''; }
  clearData() { this.data.clear(); }
  setDragImage(el: Element) { this.dragImage = el; }
}

function fire(el: Element, type: string, dt: FakeDataTransfer): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dt });
  act(() => { el.dispatchEvent(ev); });
  return ev;
}

/** The grid card (data-slot="card") whose text includes `name`. */
const card = (name: string): HTMLElement => {
  const el = [...document.querySelectorAll<HTMLElement>('[data-slot="card"]')].find((c) => c.textContent?.includes(name));
  expect(el, `card "${name}"`).toBeTruthy();
  return el!;
};
const button = (text: string): HTMLButtonElement => {
  const el = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
  expect(el, `button "${text}"`).toBeTruthy();
  return el!;
};
/** The confirm's own button: the bulk bar also has a "Move" (collapsed while nothing is selected). */
const dialogButton = (text: string): HTMLButtonElement => {
  const el = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-content"] button')].find((b) => b.textContent?.trim() === text);
  expect(el, `dialog button "${text}"`).toBeTruthy();
  return el!;
};
const dialogText = () => document.querySelector('[data-slot="dialog-content"]')?.textContent ?? '';
const movePuts = () => apiMock.mock.calls.filter(([p]) => String(p).includes('/move'));

/** Start a drag on `source`, hover `target`, and return the drag's DataTransfer and dragover event. */
function dragOnto(source: Element, target: Element) {
  const dt = new FakeDataTransfer();
  fire(source, 'dragstart', dt);
  fire(target, 'dragenter', dt);
  const over = fire(target, 'dragover', dt);
  return { dt, over };
}

describe('files page drag-to-move', () => {
  it('a file dropped on a folder asks first, and moves only on Move', async () => {
    await render();
    const notes = card('notes.txt');
    expect(notes.getAttribute('draggable')).toBe('true');

    const target = card('Archive');
    const { dt, over } = dragOnto(notes, target);
    expect(dt.types).toEqual([MOVE_DRAG_TYPE]);
    expect(over.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe('move');
    expect(target.className).toContain('bg-primary/10');

    fire(target, 'drop', dt);
    expect(target.className).not.toContain('bg-primary/10');
    expect(dialogText()).toContain('Are you sure?');
    expect(dialogText()).toContain('You are moving notes.txt to Archive.');
    expect(movePuts()).toEqual([]);

    await act(async () => { dialogButton('Move').click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(movePuts().map(([p, init]) => [p, JSON.parse(String((init as RequestInit).body))])).toEqual([
      ['/api/files/file_1/move', { folder_id: 'fld_b' }],
    ]);
    expect(toastCalls.at(-1)).toMatchObject({ kind: 'success' });
  });

  it('Cancel closes the confirm without moving', async () => {
    await render();
    const { dt } = dragOnto(card('notes.txt'), card('Archive'));
    fire(card('Archive'), 'drop', dt);
    await act(async () => { dialogButton('Cancel').click(); });
    expect(movePuts()).toEqual([]);
  });

  it('a folder does not accept itself, and the current folder crumb is not a target', async () => {
    await render();
    const projects = card('Projects');
    // The page swallows the event (so the browser never navigates) but
    // refuses the drop: "none", and the folder does not light up.
    const { dt } = dragOnto(projects, projects);
    expect(dt.dropEffect).toBe('none');
    expect(projects.className).not.toContain('bg-primary/10');

    const crumb = button('Current');
    dt.dropEffect = 'move';
    fire(crumb, 'dragenter', dt);
    fire(crumb, 'dragover', dt);
    expect(dt.dropEffect).toBe('none');
    expect(crumb.className).not.toContain('bg-primary/10');
    fire(crumb, 'drop', dt);
    expect(dialogText()).toBe('');
    fire(projects, 'dragend', dt);
  });

  it('the Home crumb is a target named Home', async () => {
    await render();
    const home = document.querySelector<HTMLButtonElement>('button svg.lucide-house')?.closest('button')
      ?? [...document.querySelectorAll('button')].find((b) => b.nextElementSibling?.textContent?.includes('Current'))!;
    const { dt, over } = dragOnto(card('Projects'), home);
    expect(over.defaultPrevented).toBe(true);
    fire(home, 'drop', dt);
    expect(dialogText()).toContain('You are moving Projects to Home.');
  });

  it('dragging a selected item carries the whole selection', async () => {
    await render();
    // Ctrl-click selects without opening.
    await act(async () => { card('notes.txt').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
    await act(async () => { card('todo.txt').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
    const { dt } = dragOnto(card('todo.txt'), card('Archive'));
    expect(dt.dragImage?.textContent).toBe('2 items');
    fire(card('Archive'), 'drop', dt);
    expect(dialogText()).toContain('You are moving 2 files to Archive.');
  });

  it('a move drag never shows the upload overlay, OS files still do', async () => {
    await render();
    const overlay = () => document.querySelector('.group\\/drop');
    const { dt } = dragOnto(card('notes.txt'), card('notes.txt'));
    expect(overlay()?.getAttribute('data-dragging')).toBeNull();
    fire(card('notes.txt'), 'dragend', dt);

    const osFiles = new FakeDataTransfer({ Files: '' });
    fire(card('notes.txt'), 'dragover', osFiles);
    expect(overlay()?.getAttribute('data-dragging')).toBe('true');
  });

  it("a refused move shows the server's reason", async () => {
    await render('/files?folder=fld_cur', () => Promise.reject(new ApiError(400, JSON.stringify({ error: 'Cannot move a folder into its own subfolder' }))));
    // Open the sidebar group so its folder row is on screen.
    await act(async () => { button('Team1').parentElement!.querySelector('button')!.click(); });
    const deep = button('Deep');
    const { dt, over } = dragOnto(card('Projects'), deep);
    expect(over.defaultPrevented).toBe(true);
    fire(deep, 'drop', dt);
    expect(dialogText()).toContain('You are moving Projects to Deep.');
    await act(async () => { dialogButton('Move').click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(movePuts().map(([p]) => p)).toEqual(['/api/folders/fld_a/move']);
    expect(toastCalls.at(-1)).toMatchObject({ kind: 'error', body: 'Cannot move a folder into its own subfolder' });
  });

  it('nothing is draggable in the trash', async () => {
    await render('/files?filter=deleted');
    expect(document.querySelector('[draggable="true"]')).toBeNull();
  });
});
