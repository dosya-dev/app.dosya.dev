// The Markdown/text editor page, driven with a mocked API, a stubbed fetch
// (the raw text and the upload PUT) and a textarea standing in for
// CodeMirror (jsdom cannot lay it out). A data router, as in the app, so the
// leave guard (useBlocker) is the real one.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';

const { apiMock, toast } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, API_BASE: 'https://api.example.com', api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/lib/toast', () => ({ toast }));
vi.mock('@/components/md-editor/code-editor', async () => {
  const React = await import('react');
  const { formatMarkdown } = await import('@/lib/md-format');
  type Handle = import('@/components/md-editor/code-editor').EditorHandle;
  type Props = import('@/components/md-editor/code-editor').CodeEditorProps;
  function CodeEditor({ ref, initialText, label, phrases, onChange }: Props) {
    const ta = React.useRef<HTMLTextAreaElement>(null);
    // The find bar, as far as the page can see it: open (on which field) or not.
    const [find, setFind] = React.useState<'search' | 'replace' | null>(null);
    const findRef = React.useRef(find);
    findRef.current = find;
    React.useImperativeHandle(ref as React.Ref<Handle>, () => ({
      openSearch: (opts) => setFind(opts?.replace ? 'replace' : 'search'),
      closeSearch: () => {
        if (!findRef.current) return false;
        findRef.current = null;
        setFind(null);
        return true;
      },
      searchOpen: () => findRef.current !== null,
      getText: () => ta.current!.value,
      setText: (text: string) => { ta.current!.value = text; onChange(text); },
      format: (kind) => {
        const el = ta.current!;
        const edit = formatMarkdown(el.value, el.selectionStart, el.selectionEnd, kind);
        let out = el.value;
        for (const c of [...edit.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
        el.value = out;
        onChange(out);
      },
      focus: () => ta.current?.focus(),
      scroller: () => ta.current,
    }));
    return (
      <>
        {find && <div data-testid="find-panel" data-field={find}>{phrases?.Find}|{phrases?.['replace all']}|{phrases?.close}</div>}
        <textarea data-testid="code-editor" aria-label={label} ref={ta} defaultValue={initialText} onChange={(e) => onChange(e.target.value)} />
      </>
    );
  }
  return { CodeEditor };
});

const { default: TextEditorPage } = await import('./text-editor');
const { saveDraft } = await import('@/lib/text-drafts');

type FileRow = {
  id: string; name: string; size_bytes: number; mime_type: string; lock_mode: string;
  current_version: number; updated_at: number; workspace_id: string; folder_id: string | null;
};
const NOW_SEC = Math.floor(Date.now() / 1000);
let file: FileRow;
let body: string;
/** What GET /api/files/:id answers at save time (the conflict check). */
let latest: FileRow | null;
/** Names the folder already holds (the copy-name check). */
let taken: string[];
/** The id the upload PUT answers with. */
let putFileId: string;
const fetchMock = vi.fn();

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  localStorage.clear();
  file = {
    id: 'f1', name: 'plan.md', size_bytes: 40, mime_type: 'text/markdown', lock_mode: 'none',
    current_version: 3, updated_at: NOW_SEC - 120, workspace_id: 'ws1', folder_id: 'd1',
  };
  body = '# Q4 launch plan\n\nShip it.';
  latest = null;
  taken = [];
  putFileId = 'f1';
  let opened = false;
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/files/f1') {
      if (opened && latest) return { ok: true, file: latest };
      opened = true;
      return { ok: true, file };
    }
    if (path.startsWith('/api/files/f1/versions')) {
      return { ok: true, versions: [{ version_number: 4, uploader_name: 'Ada', created_at: NOW_SEC - 60, size_bytes: 1 }] };
    }
    if (path.startsWith('/api/files?')) {
      const q = new URL(`https://x${path}`).searchParams.get('q');
      if (q) return { ok: true, files: taken.filter((n) => n === q).map((name) => ({ name })), folders: [] };
      return { ok: true, files: [], folders: [], breadcrumbs: [{ id: 'd1', name: 'Notes' }] };
    }
    if (path === '/api/upload/init') return { ok: true, session_id: 'upl_1' };
    throw new Error(`unexpected api ${path}`);
  });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      // A save moves the server's file on, as the real one does.
      if (putFileId === 'f1') file = { ...file, current_version: file.current_version + 1, updated_at: NOW_SEC };
      return new Response(JSON.stringify({ ok: true, file: { id: putFileId, current_version: putFileId === 'f1' ? file.current_version : 1 } }), { status: 200 });
    }
    return { ok: true, text: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  toast.success.mockClear();
  toast.error.mockClear();
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function render(id = 'f1', state?: unknown) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const router = createMemoryRouter([
    { path: '/text-editor/:fileId', element: <><TextEditorPage /><Where /></> },
    { path: '/files', element: <Where /> },
    { path: '/start', element: <Where /> },
  ], { initialEntries: state ? ['/start', { pathname: `/text-editor/${id}`, state }] : [`/text-editor/${id}`], initialIndex: state ? 1 : 0 });
  await act(async () => { root!.render(<RouterProvider router={router} />); });
  await flush();
}

const editor = () => document.querySelector<HTMLTextAreaElement>('[data-testid="code-editor"]');
const where = () => document.querySelector('[data-testid="where"]')?.textContent;
const text = () => document.body.textContent ?? '';
const button = (name: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name);
const dot = () => document.querySelector('[data-testid="unsaved-dot"]');
const putCalls = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
const initBodies = () => apiMock.mock.calls.filter(([p]) => p === '/api/upload/init').map(([, init]) => JSON.parse((init as RequestInit).body as string));

function type(value: string) {
  const el = editor()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** jsdom's Blob has no text(). */
function readBlob(b: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.readAsText(b);
  });
}
async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
}
function key(init: KeyboardEventInit, target: EventTarget = editor() ?? window) {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(ev); });
  return ev;
}

describe('TextEditorPage', () => {
  it('loads the file into the editor with breadcrumb and status, never from a stale cache', async () => {
    await render();
    expect(editor()?.value).toBe(body);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/files/f1/raw', expect.objectContaining({ credentials: 'include', cache: 'no-cache' }));
    const crumbs = document.querySelector('[data-testid="editor-breadcrumb"]')!.textContent;
    expect(crumbs).toContain('Files');
    expect(crumbs).toContain('Notes');
    expect(crumbs).toContain('plan.md');
    expect(text()).toContain('Markdown');
    expect(text()).toContain('5 words');
    expect(text()).toContain('Ln 1, Col 1');
    expect(text()).toContain('v3 saved 2m ago');
    expect(dot()).toBeNull();
    expect(text()).not.toContain('Unsaved changes');
    // Split view: source and preview side by side.
    expect(document.querySelector('[data-testid="md-preview"] h1')?.textContent).toBe('Q4 launch plan');
  });

  it('typing marks the file as changed', async () => {
    await render();
    type(body + ' Now.');
    expect(dot()).not.toBeNull();
    expect(text()).toContain('Unsaved changes');
    type(body); // back to what is saved
    expect(dot()).toBeNull();
  });

  it('Cmd+S uploads a new version of the same file (file_id) and clears the changed state', async () => {
    await render();
    type('# Q4\n\nNew text');
    const ev = key({ key: 's', metaKey: true });
    expect(ev.defaultPrevented).toBe(true); // never the browser's "Save page as"
    await flush();
    expect(initBodies()).toEqual([{ workspace_id: 'ws1', file_id: 'f1', file_name: 'plan.md', file_size: 14, mime_type: 'text/markdown' }]);
    expect(putCalls()).toHaveLength(1);
    expect(putCalls()[0][0]).toBe('https://api.example.com/api/upload/upl_1');
    expect(await readBlob((putCalls()[0][1] as RequestInit).body as Blob)).toBe('# Q4\n\nNew text');
    expect(toast.success).toHaveBeenCalledWith('Saved as a new version');
    expect(dot()).toBeNull();
    expect(text()).toContain('v4 saved just now');
  });

  it('Ctrl+S works too, and the Save button', async () => {
    await render();
    type('x');
    key({ key: 's', ctrlKey: true });
    await flush();
    expect(putCalls()).toHaveLength(1);
    type('y');
    await click(button('Save'));
    await flush();
    expect(putCalls()).toHaveLength(2);
  });

  it('a file that changed since opening asks first; Overwrite saves anyway', async () => {
    await render();
    latest = { ...file, current_version: 4, updated_at: NOW_SEC - 60 };
    type('mine');
    key({ key: 's', metaKey: true });
    await flush();
    expect(putCalls()).toHaveLength(0);
    const dialog = document.querySelector('[data-testid="conflict-dialog"]')!;
    expect(dialog.textContent).toContain('Are you sure?');
    expect(dialog.textContent).toContain('This file changed since you opened it.');
    expect(dialog.textContent).toContain('Ada saved version 4');
    await click(button('Overwrite'));
    await flush();
    expect(putCalls()).toHaveLength(1);
    expect(initBodies()[0].file_id).toBe('f1');
    expect(document.querySelector('[data-testid="conflict-dialog"]')).toBeNull();
  });

  it('Save as copy makes a new file beside it under a free name and opens that', async () => {
    putFileId = 'f2';
    taken = ['plan (copy).md'];
    await render();
    latest = { ...file, current_version: 4 };
    type('mine');
    key({ key: 's', metaKey: true });
    await flush();
    await click(button('Save as copy'));
    await flush();
    const init = initBodies()[0];
    expect(init.file_id).toBeUndefined();
    expect(init.file_name).toBe('plan (copy 2).md');
    expect(init.folder_id).toBe('d1');
    expect(await readBlob((putCalls()[0][1] as RequestInit).body as Blob)).toBe('mine');
    // No leave question for text that was just saved into the copy.
    expect(document.querySelector('[data-testid="leave-dialog"]')).toBeNull();
    expect(where()).toBe('/text-editor/f2');
  });

  it('Cancel in the conflict dialog saves nothing', async () => {
    await render();
    latest = { ...file, current_version: 4 };
    type('mine');
    key({ key: 's', metaKey: true });
    await flush();
    await click(button('Cancel'));
    await flush();
    expect(putCalls()).toHaveLength(0);
    expect(dot()).not.toBeNull();
  });

  it('a failed save says so and keeps the changes', async () => {
    await render();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: false, error: 'Storage full' }), { status: 507 }));
    type('mine');
    key({ key: 's', metaKey: true });
    await flush();
    expect(toast.error).toHaveBeenCalledWith('Could not save this file', 'Storage full');
    expect(dot()).not.toBeNull();
  });

  it('closing with unsaved changes asks; Keep editing stays, Discard changes leaves', async () => {
    await render();
    type('changed');
    await click(button('Close'));
    await flush();
    const dialog = () => document.querySelector('[data-testid="leave-dialog"]');
    expect(dialog()?.textContent).toContain('Are you sure?');
    expect(dialog()?.textContent).toContain('You have unsaved changes. They will be lost if you leave.');
    await click(button('Keep editing'));
    await flush();
    expect(dialog()).toBeNull();
    expect(where()).toBe('/text-editor/f1');
    key({ key: 'Escape' });
    await flush();
    expect(dialog()).not.toBeNull();
    await click(button('Discard changes'));
    await flush();
    expect(where()).toBe('/files?folder=d1');
  });

  it('closing with nothing changed just leaves; with history it goes back', async () => {
    await render();
    await click(button('Close'));
    await flush();
    expect(where()).toBe('/files?folder=d1');
    act(() => root!.unmount());
    root = null;
    await render('f1', { back: true });
    await click(button('Close'));
    await flush();
    expect(where()).toBe('/start');
  });

  it('the breadcrumb is guarded too', async () => {
    await render();
    type('changed');
    await click(button('Notes'));
    await flush();
    expect(document.querySelector('[data-testid="leave-dialog"]')).not.toBeNull();
  });

  it('closing or reloading the tab asks only while there are changes', async () => {
    await render();
    const unload = () => {
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(unload()).toBe(false);
    type('changed');
    expect(unload()).toBe(true);
    type(body);
    expect(unload()).toBe(false);
  });

  it('Version history opens the files page on the versions of this file', async () => {
    await render();
    await click(button('Version history'));
    await flush();
    expect(where()).toBe('/files?folder=d1&view=f1&tab=versions');
  });

  it('keystrokes in the editor do not reach app-level shortcut handlers (Cmd+K search included)', async () => {
    await render();
    const onDoc = vi.fn();
    document.addEventListener('keydown', onDoc);
    key({ key: 'k', metaKey: true });
    key({ key: 'a', metaKey: true });
    key({ key: 'Delete' });
    document.removeEventListener('keydown', onDoc);
    expect(onDoc).not.toHaveBeenCalled();
  });

  it('the toolbar formats the selection', async () => {
    body = 'hello';
    await render();
    act(() => { editor()!.setSelectionRange(0, 5); });
    await click(button('Bold (⌘B)') ?? button('Bold (Ctrl+B)'));
    expect(editor()!.value).toBe('**hello**');
    expect(dot()).not.toBeNull();
  });

  it('switches between split, edit and preview', async () => {
    await render();
    const pane = () => editor()!.closest('[data-testid="source-pane"]')!;
    const preview = () => document.querySelector('[data-testid="md-preview"]');
    await click(button('Preview'));
    expect(pane().className).toContain('hidden');
    expect(preview()).not.toBeNull();
    await click(button('Edit'));
    expect(pane().className).not.toContain('hidden');
    expect(preview()).toBeNull();
    await click(button('Split'));
    expect(preview()).not.toBeNull();
    expect(editor()?.value).toBe(body); // the editor was never remounted
  });

  it('a plain text file gets one pane: no toolbar, preview or view switch', async () => {
    file = { ...file, name: 'todo.txt', mime_type: 'text/plain' };
    body = 'buy milk';
    await render();
    expect(editor()?.value).toBe('buy milk');
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    expect(document.querySelector('[data-testid="md-preview"]')).toBeNull();
    expect(button('Split')).toBeUndefined();
    expect(text()).toContain('Plain text');
    expect(text()).toContain('2 words');
  });

  it('offers an unsaved draft from earlier; Restore puts it back', async () => {
    saveDraft(localStorage, { workspaceId: 'ws1', fileId: 'f1', version: 3 }, 'draft text', Date.now());
    await render();
    expect(text()).toContain('You have unsaved changes from earlier.');
    await click(button('Restore'));
    expect(editor()!.value).toBe('draft text');
    expect(dot()).not.toBeNull();
    expect(text()).not.toContain('You have unsaved changes from earlier.');
  });

  it('Discard drops the draft for good', async () => {
    saveDraft(localStorage, { workspaceId: 'ws1', fileId: 'f1', version: 3 }, 'draft text', Date.now());
    await render();
    await click(button('Discard'));
    expect(text()).not.toContain('You have unsaved changes from earlier.');
    expect(localStorage.length).toBe(0);
    expect(editor()!.value).toBe(body);
  });

  it('keeps a draft while editing and clears it on save', async () => {
    await render();
    type('work in progress');
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(localStorage.getItem('dosya_text_draft:ws1:f1:v3')).toContain('work in progress');
    key({ key: 's', metaKey: true });
    await flush();
    expect(localStorage.length).toBe(0);
  });

  it('refuses a password-locked file without fetching it', async () => {
    file = { ...file, lock_mode: 'full_lock' };
    await render();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
    expect(text()).toContain('Locked with a password');
  });

  it('refuses a file over 2 MB, and a file that is not Markdown or text', async () => {
    file = { ...file, size_bytes: 3 * 1024 * 1024 };
    await render();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain('Files over 2 MB can be viewed but not edited.');
    act(() => root!.unmount());
    root = null;
    file = { ...file, size_bytes: 40, name: 'data.json' };
    await render();
    expect(editor()).toBeNull();
    expect(text()).toContain('This file cannot be edited here.');
  });

  // ── Find / replace ───────────────────────────────────────────

  it("Cmd+F opens the editor's find bar from anywhere on the page, labelled in the app's language", async () => {
    await render();
    const findPanel = () => document.querySelector('[data-testid="find-panel"]');
    expect(findPanel()).toBeNull();
    // Focus on the toolbar, not the text.
    const ev = key({ key: 'f', metaKey: true }, button('Bold (⌘B)') ?? button('Bold (Ctrl+B)')!);
    await flush();
    expect(ev.defaultPrevented).toBe(true); // not the browser's find
    expect(findPanel()?.getAttribute('data-field')).toBe('search');
    expect(findPanel()?.textContent).toBe('Find|Replace all|Close find');
  });

  it('Ctrl+F works too, and Cmd+Alt+F opens straight on Replace', async () => {
    await render();
    key({ key: 'f', ctrlKey: true });
    await flush();
    expect(document.querySelector('[data-testid="find-panel"]')?.getAttribute('data-field')).toBe('search');
    key({ key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true });
    await flush();
    expect(document.querySelector('[data-testid="find-panel"]')?.getAttribute('data-field')).toBe('replace');
  });

  it('Cmd+F in Preview brings the source back with the bar open', async () => {
    await render();
    await click(button('Preview'));
    key({ key: 'f', metaKey: true }, window);
    await flush();
    expect(editor()!.closest('[data-testid="source-pane"]')!.className).not.toContain('hidden');
    expect(document.querySelector('[data-testid="find-panel"]')).not.toBeNull();
  });

  it('Escape closes the find bar first, even with unsaved changes; the next Escape asks to leave', async () => {
    await render();
    type('changed');
    key({ key: 'f', metaKey: true });
    await flush();
    key({ key: 'Escape' });
    await flush();
    expect(document.querySelector('[data-testid="find-panel"]')).toBeNull();
    expect(document.querySelector('[data-testid="leave-dialog"]')).toBeNull();
    expect(where()).toBe('/text-editor/f1');
    key({ key: 'Escape' });
    await flush();
    expect(document.querySelector('[data-testid="leave-dialog"]')).not.toBeNull();
  });

  it('a plain text file gets find too', async () => {
    file = { ...file, name: 'todo.txt', mime_type: 'text/plain' };
    body = 'buy milk';
    await render();
    key({ key: 'f', metaKey: true });
    await flush();
    expect(document.querySelector('[data-testid="find-panel"]')).not.toBeNull();
  });
});
