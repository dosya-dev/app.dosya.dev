/**
 * Pages added after the web catalog was extracted (unit 11b): the Save to dosya
 * page. English must read exactly as before the wiring, and every key the page
 * uses must exist in the catalog and in the vendored English messages. The
 * Turkish case is added after the new keys are translated.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import en from '@/i18n/messages/en.json';

const apiMock = vi.fn();
const navigate = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  API_BASE: '',
  api: (...args: unknown[]) => apiMock(...args),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/folder-picker-dialog', () => ({
  FolderPickerDialog: (p: { open: boolean; title: string; confirmLabel: string }) =>
    p.open ? <div data-testid="picker">{p.title}|{p.confirmLabel}</div> : null,
}));

import { ApiError } from '@/api/client';
import { useSession } from '@/stores/session';
import { useWorkspace } from '@/stores/workspace';
import SaveSharePage from '@/pages/save-share';

const WS = [
  { id: 'ws_personal', name: 'Personal', slug: 'personal', icon_initials: 'P', icon_color: '#000', icon_image_url: null, owner_id: 'u1', role_id: 'owner' },
  { id: 'ws_team', name: 'Studio', slug: 'studio', icon_initials: 'S', icon_color: '#000', icon_image_url: null, owner_id: 'u2', role_id: 'viewer' },
];
const LINK = { downloads_left: null, title: null, message: null };
const FILE = { id: 'f1', name: 'Report.pdf', size_bytes: 2 * 1048576, uploader_name: 'Alex' };
const base = { ok: true, is_bundle: false, is_folder: false, lock_mode: 'none', link: LINK };
const SHARES: Record<string, unknown> = {
  file: { ...base, files: [FILE] },
  bundle: { ...base, files: [FILE, { ...FILE, id: 'f2', name: 'b.jpg' }, { ...FILE, id: 'f3', name: 'c.jpg' }] },
  one: { ...base, files: [{ ...FILE, id: 'f2', uploader_name: null }, ], },
  gallery: { ...base, is_gallery: true, gallery: { title: 'Trip', item_count: 1 }, files: [FILE] },
  galleryMany: { ...base, is_gallery: true, gallery: { title: 'Trip', item_count: 4 }, files: [FILE] },
  folder: { ...base, is_folder: true, folder: { root_id: 'r', root_name: 'Holiday', subfolders: [{ id: 's1', name: 'D1' }, { id: 's2', name: 'D2' }] }, files: [FILE] },
  folderOne: { ...base, is_folder: true, folder: { root_id: 'r', root_name: 'Holiday', subfolders: [{ id: 's1', name: 'D1' }] }, files: [] },
  folderFilesOnly: { ...base, is_folder: true, folder: { root_id: 'r', root_name: 'Holiday', subfolders: [] }, files: [FILE, { ...FILE, id: 'f2' }] },
  folderEmpty: { ...base, is_folder: true, folder: { root_id: 'r', root_name: 'Holiday', subfolders: [] }, files: [] },
  password: { ...base, is_password_protected: true, files: [] },
  verify: { ...base, requires_recipient_verification: true, files: [] },
  viewOnly: { ...base, lock_mode: 'view_only', files: [FILE] },
  noDownloads: { ...base, link: { ...LINK, downloads_left: 0 }, files: [FILE] },
};
let routes: Record<string, unknown> = {};
const perms: Record<string, unknown> = {
  ws_personal: { permissions: { upload_files: true }, root_folder_id: null, root_folder_name: null },
  ws_team: { permissions: { upload_files: false }, root_folder_id: 'fx', root_folder_name: null },
};

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null;
let container: HTMLDivElement | null = null;
beforeEach(() => {
  apiMock.mockReset(); navigate.mockReset(); toastSuccess.mockReset();
  routes = {};
  useSession.setState({ workspaces: WS });
  useWorkspace.setState({ activeId: 'ws_personal' });
  apiMock.mockImplementation(async (path: string) => {
    const p = /^\/api\/me\/permissions\?workspace_id=(.+)$/.exec(path);
    if (p) return perms[decodeURIComponent(p[1]!)];
    const hit = routes[path];
    if (hit === undefined) throw new Error(`unexpected request ${path}`);
    if (hit instanceof Error) throw hit;
    return hit;
  });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove(); root = null; container = null;
});

async function render(path = '/save/tok', settle = true) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/save/:token" element={<SaveSharePage />} /></Routes></MemoryRouter>);
  });
  if (settle) await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return container!;
}
const text = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ');
const btn = (c: HTMLElement, re: RegExp) => [...c.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
async function click(el: HTMLElement | undefined) {
  expect(el).toBeTruthy();
  await act(async () => { el!.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
const load = (key: string) => { routes['/api/share/tok'] = SHARES[key]; };

describe('Save to dosya page: English is unchanged', () => {
  it('loading state', async () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    const c = await render('/save/tok', false);
    expect(c.querySelector('[aria-busy="true"]')?.getAttribute('aria-label')).toBe('Loading the shared link');
  });

  it('load errors: expired, and the connection fallback', async () => {
    routes['/api/share/tok'] = new ApiError(404, JSON.stringify({ error: 'x' }));
    let c = await render();
    expect(c.querySelector('h1')?.textContent).toBe('This link cannot be opened');
    expect(text(c)).toContain('This link has expired or was removed. Ask the sender for a new one.');
    expect(btn(c, /Try again/)).toBeTruthy();
    act(() => root!.unmount()); c.remove();
    routes['/api/share/tok'] = new Error('net');
    c = await render();
    expect(text(c)).toContain('Could not open this link. Check your connection and try again.');
  });

  it('sign-in required / gated states', async () => {
    load('password');
    let c = await render();
    expect(c.querySelector('h1')?.textContent).toBe('Open the link and unlock it first');
    expect(text(c)).toContain('This link asks for a password. Enter it on the share page, then choose Save to dosya there again.');
    expect(text(c)).toContain('Open the share page');
    act(() => root!.unmount()); c.remove();
    load('verify');
    c = await render();
    expect(text(c)).toContain('This link is for invited people only. Confirm your email address on the share page, then choose Save to dosya there again.');
  });

  it('view-only and no-downloads states', async () => {
    load('viewOnly');
    let c = await render();
    expect(text(c)).toContain('Save to dosya');
    expect(text(c)).toContain('The sender turned off downloads');
    expect(text(c)).toContain('This link can only be viewed, so it cannot be saved to dosya. You can still open it on the share page.');
    expect(text(c)).toContain('Open the share page');
    act(() => root!.unmount()); c.remove();
    load('noDownloads');
    c = await render();
    expect(text(c)).toContain('This link has no downloads left');
    expect(text(c)).toContain('Saving counts as a download. Ask the sender to raise the limit or send a new link.');
  });

  it('previews: titles and detail lines', async () => {
    const cases: [string, string, string][] = [
      ['file', 'Report.pdf', '2.0 MB · Shared by Alex'],
      ['bundle', '3 files', 'Shared by Alex'],
      ['one', 'Report.pdf', '2.0 MB'],
      ['gallery', 'Trip', '1 photo · Shared by Alex'],
      ['galleryMany', 'Trip', '4 photos · Shared by Alex'],
      ['folder', 'Holiday', '2 folders and 1 file at the top level · Shared by Alex'],
      ['folderOne', 'Holiday', '1 folder at the top level'],
      ['folderFilesOnly', 'Holiday', '2 files at the top level · Shared by Alex'],
      ['folderEmpty', 'Holiday', 'Empty folder'],
    ];
    for (const [key, title, detail] of cases) {
      load(key);
      const c = await render();
      expect(c.querySelector('h1')?.textContent, key).toBe(title);
      expect(text(c), key).toContain(detail);
      act(() => root!.unmount()); c.remove(); root = null;
    }
    load('bundle');
    let c = await render('/save/tok?ids=f1,f3');
    expect(c.querySelector('h1')?.textContent).toBe('2 selected files');
    act(() => root!.unmount()); c.remove();
    load('folder');
    c = await render('/save/tok?ids=f1');
    expect(c.querySelector('h1')?.textContent).toBe('1 selected file');
    expect(text(c)).toContain('From Holiday · Shared by Alex');
  });

  it('the ready form: labels, folder, picker, save button', async () => {
    load('folder');
    const c = await render();
    const t = text(c);
    expect(t).toContain('Workspace');
    expect(t).toContain('Folder');
    expect(t).toContain('Root (top level)');
    expect(t).toContain('Change');
    expect(t).toContain('A new folder named Holiday is created here.');
    expect(t).toContain('Back to the share page');
    expect(btn(c, /^Save to Personal$/)).toBeTruthy();
    await click(btn(c, /^Change$/));
    expect(c.querySelector('[data-testid="picker"]')?.textContent).toBe('Save to a folder in Personal|Use this folder');
  });

  it('a role that cannot add files, and no workspace', async () => {
    load('file');
    let c = await render();
    const sel = c.querySelector('select')!;
    await act(async () => { sel.value = 'ws_team'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(text(c)).toContain('Your role in Studio cannot add files. Pick another workspace, or ask an admin there for upload access.');
    expect(text(c)).toContain('Your folder');
    act(() => root!.unmount()); c.remove();
    useSession.setState({ workspaces: [] });
    load('file');
    c = await render();
    expect(text(c)).toContain('You have no workspace to save into. Create one first, then come back to this link.');
  });

  it('saving: success toast, skipped note, nothing saved, and the connection error', async () => {
    load('file');
    routes['/api/share/tok/save'] = { ok: true, workspace_id: 'ws_personal', folder_id: null, saved: [{ file_id: 'n', name: 'a', size_bytes: 1 }], skipped: [{ name: 'x.txt', reason: 'locked' }, { name: 'y.txt', reason: 'locked' }] };
    let c = await render();
    await click(btn(c, /^Save to Personal$/));
    expect(toastSuccess).toHaveBeenCalledWith('Saved to Personal', '1 file saved. 2 files skipped: x.txt (locked).');
    act(() => root!.unmount()); c.remove();
    toastSuccess.mockReset();
    routes['/api/share/tok/save'] = { ok: true, workspace_id: 'ws_personal', folder_id: null, saved: [{ file_id: 'n', name: 'a', size_bytes: 1 }, { file_id: 'm', name: 'b', size_bytes: 1 }], skipped: [{ name: 'x.txt', reason: 'locked' }] };
    c = await render();
    await click(btn(c, /^Save to Personal$/));
    expect(toastSuccess).toHaveBeenCalledWith('Saved to Personal', '2 files saved. 1 file skipped: x.txt (locked).');
    act(() => root!.unmount()); c.remove();
    routes['/api/share/tok/save'] = { ok: true, workspace_id: 'ws_personal', folder_id: null, saved: [], skipped: [{ name: 'Report.pdf', reason: 'locked' }] };
    c = await render();
    await click(btn(c, /^Save to Personal$/));
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Nothing was saved. Report.pdf: locked');
    act(() => root!.unmount()); c.remove();
    routes['/api/share/tok/save'] = { ok: true, workspace_id: 'ws_personal', folder_id: null, saved: [], skipped: [] };
    c = await render();
    await click(btn(c, /^Save to Personal$/));
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Nothing was saved. The link has no files you can save.');
    act(() => root!.unmount()); c.remove();
    routes['/api/share/tok/save'] = new Error('net');
    c = await render();
    await click(btn(c, /^Save to Personal$/));
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Could not reach dosya. Check your connection and try again.');
  });

  it('the saving state', async () => {
    load('file');
    routes['/api/share/tok/save'] = undefined as never;
    let release: () => void = () => {};
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/me/permissions')) return perms.ws_personal;
      if (path.endsWith('/save')) await new Promise<void>((r) => { release = r; });
      return path.endsWith('/save') ? { ok: true, workspace_id: 'ws_personal', folder_id: null, saved: [{ file_id: 'n', name: 'a', size_bytes: 1 }], skipped: [] } : routes[path];
    });
    const c = await render();
    await click(btn(c, /^Save to Personal$/));
    expect(btn(c, /Saving to Personal/)).toBeTruthy();
    expect(c.querySelector('[aria-live="polite"]')?.textContent).toBe('Saving to Personal');
    await act(async () => { release(); });
  });
});

describe('Save to dosya page: catalog keys', () => {
  const src = readFileSync(resolve(__dirname, '../pages/save-share.tsx'), 'utf8');
  const keys = [...new Set([...src.matchAll(/\bt\(\s*['"]([\w.-]+)['"]/g)].map((m) => m[1]!))];
  const catalog = JSON.parse(readFileSync(resolve(__dirname, '../../../../packages/i18n/web/en.catalog.json'), 'utf8')) as { strings: { key: string }[] };
  const known = new Set(catalog.strings.map((s) => s.key));

  it('uses t() for its text', () => { expect(keys.length).toBeGreaterThan(25); });
  it('every key exists in the catalog', () => { expect(keys.filter((k) => !known.has(k))).toEqual([]); });
  it('every key exists in the vendored English messages', () => {
    expect(keys.filter((k) => !(k in (en as Record<string, string>)))).toEqual([]);
  });
});
