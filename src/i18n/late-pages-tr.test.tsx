/**
 * The Save to dosya page (src/pages/save-share.tsx) in Turkish, German and
 * Polish. Turkish: every state reads in the language, with no leftover
 * English. German and Polish: the plural messages whose "=0 {}" branch is
 * empty (the folder contents line and the toast body).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Locale } from '@/i18n/locales';
import { loadMessages } from '@/lib/i18n';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

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
let shown: Rendered | null = null;
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
afterEach(() => { shown?.unmount(); shown = null; });

async function render(locale: Locale, path = '/save/tok') {
  shown = await renderInLocale(
    <MemoryRouter initialEntries={[path]}><Routes><Route path="/save/:token" element={<SaveSharePage />} /></Routes></MemoryRouter>,
    locale,
  );
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return shown;
}
const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
const btn = (re: RegExp) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
async function click(el: HTMLElement | undefined) {
  expect(el).toBeTruthy();
  await act(async () => { el!.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
const load = (key: string) => { routes['/api/share/tok'] = SHARES[key]; };


const SKIPPED_OK = { ok: true, workspace_id: 'ws_personal', folder_id: null, saved: [{ file_id: 'n', name: 'a', size_bytes: 1 }], skipped: [] };

describe('Save to dosya page in Turkish', () => {
  let tr: Record<string, string>;
  beforeAll(async () => { tr = (await loadMessages('tr')) as Record<string, string>; });

  it('load errors', async () => {
    routes['/api/share/tok'] = new ApiError(404, JSON.stringify({ error: 'x' }));
    await render('tr');
    expect(document.querySelector('h1')?.textContent).toBe(tr['save-share.heading.thisLinkCannotBeOpened']);
    expect(text()).toContain(tr['save-share.error.linkExpired']);
    expect(shown!.leftover()).toEqual([]);
    shown!.unmount();
    routes['/api/share/tok'] = new Error('net');
    await render('tr');
    expect(text()).toContain(tr['save-share.error.couldNotOpenThisLink']);
    expect(shown!.leftover()).toEqual([]);
  });

  it('loading state label', async () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    shown = await renderInLocale(
      <MemoryRouter initialEntries={['/save/tok']}><Routes><Route path="/save/:token" element={<SaveSharePage />} /></Routes></MemoryRouter>,
      'tr',
    );
    expect(document.querySelector('[aria-busy="true"]')?.getAttribute('aria-label')).toBe(tr['save-share.label.loadingTheSharedLink']);
  });

  it('gated and blocked states', async () => {
    load('password');
    await render('tr');
    expect(document.querySelector('h1')?.textContent).toBe(tr['save-share.heading.openTheLinkAndUnlockItFirst']);
    expect(text()).toContain(tr['save-share.description.asksForAPassword']);
    expect(text()).toContain(tr['save-share.action.openTheSharePage']);
    expect(shown!.leftover()).toEqual([]);
    shown!.unmount();
    load('verify');
    await render('tr');
    expect(text()).toContain(tr['save-share.description.invitedPeopleOnly']);
    expect(shown!.leftover()).toEqual([]);
    shown!.unmount();
    load('viewOnly');
    await render('tr');
    expect(text()).toContain(tr['save-share.heading.theSenderTurnedOffDownloads']);
    expect(text()).toContain(tr['save-share.description.viewOnly']);
    expect(shown!.leftover()).toEqual([]);
    shown!.unmount();
    load('noDownloads');
    await render('tr');
    expect(text()).toContain(tr['save-share.heading.noDownloadsLeft']);
    expect(text()).toContain(tr['save-share.description.noDownloadsLeft']);
    expect(shown!.leftover()).toEqual([]);
  });

  it('previews and detail lines', async () => {
    const cases: [string, string, string][] = [
      ['file', 'Report.pdf', '2,0 MB · Paylaşan: Alex'],
      ['bundle', '3 dosya', 'Paylaşan: Alex'],
      ['gallery', 'Trip', 'Paylaşan: Alex'],
      ['folder', 'Holiday', 'En üst düzeyde 2 klasör ve 1 dosya var · Paylaşan: Alex'],
      ['folderOne', 'Holiday', 'En üst düzeyde 1 klasör var'],
      ['folderFilesOnly', 'Holiday', 'En üst düzeyde 2 dosya var · Paylaşan: Alex'],
      ['folderEmpty', 'Holiday', tr['save-share.label.emptyFolder']!],
    ];
    for (const [key, title, detail] of cases) {
      load(key);
      await render('tr');
      expect(document.querySelector('h1')?.textContent, key).toBe(title);
      expect(text(), key).toContain(detail);
      expect(shown!.leftover(), key).toEqual([]);
      shown!.unmount();
    }
    load('bundle');
    await render('tr', '/save/tok?ids=f1,f3');
    expect(document.querySelector('h1')?.textContent).toBe('2 dosya seçildi');
    shown!.unmount();
    load('folder');
    await render('tr', '/save/tok?ids=f1');
    expect(text()).toContain('Kaynak: Holiday · Paylaşan: Alex');
  });

  it('the ready form and the picker', async () => {
    load('folder');
    await render('tr');
    expect(text()).toContain(tr['save-share.description.newFolderCreatedHere']!.replace('{name}', 'Holiday'));
    expect(text()).toContain(tr['save-share.action.backToTheSharePage']);
    expect(btn(new RegExp(`^${tr['save-share.action.saveToName']!.replace('{name}', 'Personal')}$`))).toBeTruthy();
    await click(btn(/Değiştir/));
    expect(document.querySelector('[data-testid="picker"]')?.textContent).toBe(
      `${tr['save-share.heading.saveToAFolderInName']!.replace('{name}', 'Personal')}|${tr['save-share.action.useThisFolder']}`,
    );
    expect(shown!.leftover()).toEqual([]);
  });

  it('a role that cannot add files, and no workspace', async () => {
    load('file');
    await render('tr');
    const sel = document.querySelector('select')!;
    await act(async () => { sel.value = 'ws_team'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(text()).toContain(tr['save-share.description.roleCannotAddFiles']!.replace('{name}', 'Studio'));
    expect(text()).toContain(tr['save-share.label.yourFolder']);
    expect(shown!.leftover()).toEqual([]);
    shown!.unmount();
    useSession.setState({ workspaces: [] });
    load('file');
    await render('tr');
    expect(text()).toContain(tr['save-share.error.noWorkspace']);
    expect(shown!.leftover()).toEqual([]);
  });

  it('saving: toast, errors and the saving state', async () => {
    load('file');
    const saveBtn = () => btn(/^Kaydet: Personal$/);
    routes['/api/share/tok/save'] = { ...SKIPPED_OK, skipped: [{ name: 'x.txt', reason: 'locked' }, { name: 'y.txt', reason: 'locked' }] };
    await render('tr');
    await click(saveBtn());
    expect(toastSuccess).toHaveBeenCalledWith('Kaydedilen yer: Personal', '1 dosya kaydedildi. 2 dosya atlandı: x.txt (locked).');
    shown!.unmount();
    routes['/api/share/tok/save'] = { ...SKIPPED_OK, saved: [], skipped: [{ name: 'Report.pdf', reason: 'locked' }] };
    await render('tr');
    await click(saveBtn());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Hiçbir şey kaydedilmedi. Report.pdf: locked');
    shown!.unmount();
    routes['/api/share/tok/save'] = { ...SKIPPED_OK, saved: [] };
    await render('tr');
    await click(saveBtn());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(tr['save-share.error.nothingWasSavedNoFiles']);
    shown!.unmount();
    routes['/api/share/tok/save'] = new Error('net');
    await render('tr');
    await click(saveBtn());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(tr['save-share.error.couldNotReachDosya']);
    expect(shown!.leftover()).toEqual([]);
  });
});

describe.each([
  ['de', 'Freigabe von Alex', '2 Dateien auf oberster Ebene', '2 Ordner und 1 Datei auf oberster Ebene', 'Gespeichert in Personal', '1 Datei gespeichert.'],
  ['pl', 'Udostępnia: Alex', 'Na najwyższym poziomie: 2 pliki', 'Na najwyższym poziomie: 2 foldery i 1 plik', 'Zapisano w Personal', 'Zapisano: 1 plik.'],
] as const)('Save to dosya page in %s: empty plural branches', (locale, byAlex, filesOnly, mixed, toastTitle, toastBody) => {
  it('the folder contents line with no folders and with both', async () => {
    load('folderFilesOnly');
    await render(locale);
    expect(text()).toContain(`${filesOnly} · ${byAlex}`);
    expect(shown!.leftover()).toEqual([]);
    shown!.unmount();
    load('folder');
    await render(locale);
    expect(text()).toContain(`${mixed} · ${byAlex}`);
    expect(shown!.leftover()).toEqual([]);
  });

  it('the toast body with nothing skipped has no trailing text', async () => {
    load('file');
    routes['/api/share/tok/save'] = SKIPPED_OK;
    await render(locale);
    const m = (await loadMessages(locale)) as Record<string, string>;
    const label = m['save-share.action.saveToName']!.replace('{name}', 'Personal');
    await click(btn(new RegExp(`^${label}$`)));
    expect(toastSuccess).toHaveBeenCalledWith(toastTitle, toastBody);
  });
});
