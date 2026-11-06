import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * /save/:token: "Save to dosya" for a share someone sent you. Reads the public
 * share payload for the preview, lets the visitor pick a workspace and folder,
 * and posts { workspace_id, folder_id, file_ids? } to /api/share/:token/save.
 */
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
// The real dialog lazy-loads the folder tree over the network; this stand-in
// just hands back one folder when its confirm button is pressed.
vi.mock('@/components/folder-picker-dialog', () => ({
  FolderPickerDialog: ({ open, onSelect }: { open: boolean; onSelect: (id: string | null, name: string) => void }) =>
    open ? <button type="button" onClick={() => onSelect('fold_photos', 'Photos')}>Pick Photos</button> : null,
}));

import { ApiError } from '@/api/client';
import { useSession } from '@/stores/session';
import { useWorkspace } from '@/stores/workspace';
import SaveSharePage from './save-share';

const WORKSPACES = [
  { id: 'ws_personal', name: 'Personal', slug: 'personal', icon_initials: 'P', icon_color: '#000', icon_image_url: null, owner_id: 'u1', role_id: 'owner' },
  { id: 'ws_team', name: 'Studio', slug: 'studio', icon_initials: 'S', icon_color: '#000', icon_image_url: null, owner_id: 'u2', role_id: 'viewer' },
];

const LINK = { downloads_left: null, title: null, message: null };
const FILE_SHARE = {
  ok: true, is_bundle: false, is_folder: false, lock_mode: 'none',
  files: [{ id: 'f1', name: 'Report.pdf', size_bytes: 2 * 1048576, uploader_name: 'Alex' }],
  link: { ...LINK, title: 'Q3 numbers', message: 'Final version.\nThanks!' },
};
const BUNDLE_SHARE = {
  ok: true, is_bundle: true, is_folder: false, lock_mode: 'none',
  files: [
    { id: 'f1', name: 'a.jpg', size_bytes: 1048576, uploader_name: 'Alex' },
    { id: 'f2', name: 'b.jpg', size_bytes: 1048576, uploader_name: 'Alex' },
    { id: 'f3', name: 'c.jpg', size_bytes: 1048576, uploader_name: 'Alex' },
  ],
  link: LINK,
};
const FOLDER_SHARE = {
  ok: true, is_bundle: false, is_folder: true, lock_mode: 'none',
  folder: { root_id: 'fold_root', root_name: 'Holiday', current_id: 'fold_root', current_name: 'Holiday', breadcrumb: [], subfolders: [{ id: 's1', name: 'Day 1' }, { id: 's2', name: 'Day 2' }] },
  files: [{ id: 'f9', name: 'cover.jpg', size_bytes: 10, uploader_name: 'Sam' }],
  link: LINK,
};

type Routes = Record<string, unknown | ((init?: RequestInit) => unknown)>;
let routes: Routes = {};
const permsFor: Record<string, unknown> = {
  ws_personal: { ok: true, permissions: { upload_files: true }, root_folder_id: null, root_folder_name: null },
  ws_team: { ok: true, permissions: { upload_files: false }, root_folder_id: null, root_folder_name: null },
};

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiMock.mockReset(); navigate.mockReset(); toastSuccess.mockReset();
  routes = {};
  useSession.setState({ workspaces: WORKSPACES });
  useWorkspace.setState({ activeId: 'ws_personal' });
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    const perm = /^\/api\/me\/permissions\?workspace_id=(.+)$/.exec(path);
    if (perm) return permsFor[decodeURIComponent(perm[1]!)];
    const hit = routes[path];
    if (hit === undefined) throw new Error(`unexpected request ${path}`);
    const value = typeof hit === 'function' ? (hit as (i?: RequestInit) => unknown)(init) : hit;
    if (value instanceof Error) throw value;
    return value;
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
});

async function render(path = '/save/tok') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/save/:token" element={<SaveSharePage />} /></Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return container!;
}

const buttons = (c: HTMLElement) => [...c.querySelectorAll('button')];
const findButton = (c: HTMLElement, re: RegExp) => buttons(c).find((b) => re.test(b.textContent ?? ''));
async function click(el: HTMLElement | undefined) {
  expect(el).toBeTruthy();
  await act(async () => { el!.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
const saveCalls = () => apiMock.mock.calls.filter(([p]) => String(p).endsWith('/save'));

describe('SaveSharePage preview', () => {
  it('a single file: name, size, sender and the sender note', async () => {
    routes['/api/share/tok'] = FILE_SHARE;
    const c = await render();
    expect(c.querySelector('h1')?.textContent).toBe('Report.pdf');
    expect(c.textContent).toContain('2.0 MB');
    expect(c.textContent).toContain('Shared by Alex');
    expect(c.textContent).toContain('Q3 numbers');
    expect(c.textContent).toContain('Final version.');
    expect(findButton(c, /^Save to Personal$/)).toBeTruthy();
  });

  it('a bundle: the file count and total size', async () => {
    routes['/api/share/tok'] = BUNDLE_SHARE;
    const c = await render();
    expect(c.querySelector('h1')?.textContent).toBe('3 files');
    expect(c.textContent).toContain('3.0 MB');
  });

  it('a folder: the folder name, what is at the top level, and that a new folder is created', async () => {
    routes['/api/share/tok'] = FOLDER_SHARE;
    const c = await render();
    expect(c.querySelector('h1')?.textContent).toBe('Holiday');
    expect(c.textContent).toContain('2 folders and 1 file at the top level');
    expect(c.textContent).toContain('A new folder named Holiday is created here');
  });

  it('a selection made on the share page is named as such', async () => {
    routes['/api/share/tok'] = BUNDLE_SHARE;
    const c = await render('/save/tok?ids=f1,f3');
    expect(c.querySelector('h1')?.textContent).toBe('2 selected files');
    expect(c.textContent).toContain('2.0 MB');
  });
});

describe('SaveSharePage saving', () => {
  it('posts the workspace and the root folder, then opens the files page', async () => {
    routes['/api/share/tok'] = FILE_SHARE;
    routes['/api/share/tok/save'] = { ok: true, workspace_id: 'ws_personal', folder_id: null, saved: [{ file_id: 'n1', name: 'Report.pdf', size_bytes: 1 }], skipped: [] };
    const c = await render();
    await click(findButton(c, /^Save to Personal$/));
    expect(saveCalls()).toHaveLength(1);
    const [, init] = saveCalls()[0]!;
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ workspace_id: 'ws_personal', folder_id: null });
    expect(toastSuccess).toHaveBeenCalledWith('Saved to Personal', '1 file saved.');
    expect(navigate).toHaveBeenCalledWith('/files');
  });

  it('sends the picked folder and the selected file ids, and opens the folder it saved into', async () => {
    routes['/api/share/tok'] = BUNDLE_SHARE;
    routes['/api/share/tok/save'] = { ok: true, workspace_id: 'ws_personal', folder_id: 'fold_photos', saved: [{ file_id: 'n1', name: 'a.jpg', size_bytes: 1 }, { file_id: 'n3', name: 'c.jpg', size_bytes: 1 }], skipped: [] };
    const c = await render('/save/tok?ids=f1,f3');
    await click(findButton(c, /^Change$/));
    await click(findButton(c, /Pick Photos/));
    expect(c.textContent).toContain('Photos');
    await click(findButton(c, /^Save to Personal$/));
    const [, init] = saveCalls()[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ workspace_id: 'ws_personal', folder_id: 'fold_photos', file_ids: ['f1', 'f3'] });
    expect(navigate).toHaveBeenCalledWith('/files?folder=fold_photos');
    expect(useWorkspace.getState().activeId).toBe('ws_personal');
  });

  it('a folder share lands in the new folder the API created, in the workspace it was saved to', async () => {
    useWorkspace.setState({ activeId: 'ws_team' });
    permsFor.ws_team = { ok: true, permissions: { upload_files: true }, root_folder_id: null, root_folder_name: null };
    routes['/api/share/tok'] = FOLDER_SHARE;
    routes['/api/share/tok/save'] = { ok: true, workspace_id: 'ws_team', folder_id: 'fold_new', saved: [{ file_id: 'n9', name: 'cover.jpg', size_bytes: 10 }], skipped: [] };
    const c = await render();
    await click(findButton(c, /^Save to Studio$/));
    expect(JSON.parse((saveCalls()[0]![1] as RequestInit).body as string)).toEqual({ workspace_id: 'ws_team', folder_id: null });
    expect(navigate).toHaveBeenCalledWith('/files?folder=fold_new');
    expect(useWorkspace.getState().activeId).toBe('ws_team');
    permsFor.ws_team = { ok: true, permissions: { upload_files: false }, root_folder_id: null, root_folder_name: null };
  });

  it('switching to a workspace where the role cannot upload says so and disables Save', async () => {
    routes['/api/share/tok'] = FILE_SHARE;
    const c = await render();
    const select = c.querySelector('select')!;
    await act(async () => {
      select.value = 'ws_team';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(c.textContent).toContain('Your role in Studio cannot add files');
    expect(findButton(c, /^Save to Studio$/)!.disabled).toBe(true);
  });

  it('an API refusal is shown inline in the words the API used, and nothing navigates', async () => {
    routes['/api/share/tok'] = FILE_SHARE;
    routes['/api/share/tok/save'] = new ApiError(413, JSON.stringify({ error: 'This share is larger than your free space. Free up 2 GB or pick another workspace.' }));
    const c = await render();
    await click(findButton(c, /^Save to Personal$/));
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Free up 2 GB');
    expect(navigate).not.toHaveBeenCalled();
    expect(findButton(c, /^Save to Personal$/)!.disabled).toBe(false);
  });

  it('everything skipped is an inline error, not a success', async () => {
    routes['/api/share/tok'] = FILE_SHARE;
    routes['/api/share/tok/save'] = { ok: true, workspace_id: 'ws_personal', folder_id: null, saved: [], skipped: [{ name: 'Report.pdf', reason: 'The sender locked this file' }] };
    const c = await render();
    await click(findButton(c, /^Save to Personal$/));
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Report.pdf: The sender locked this file');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('SaveSharePage gates', () => {
  it('a password link that is still locked links to the share page and offers no Save', async () => {
    routes['/api/share/tok'] = { ok: true, is_password_protected: true, lock_mode: 'none', is_bundle: false, is_folder: false, files: [], file: null, link: { downloads_left: null } };
    const c = await render();
    expect(c.textContent).toContain('Open the link and unlock it first');
    const a = [...c.querySelectorAll('a')].find((x) => /Open the share page/.test(x.textContent ?? ''));
    expect(a?.getAttribute('href')).toMatch(/\/s\/tok$/);
    expect(findButton(c, /^Save to/)).toBeUndefined();
  });

  it('a restricted link before verification also links to the share page', async () => {
    routes['/api/share/tok'] = { ok: true, requires_recipient_verification: true, is_password_protected: false, lock_mode: 'none', files: [], file: null, link: { downloads_left: null } };
    const c = await render();
    expect(c.textContent).toContain('Open the link and unlock it first');
    expect(c.textContent).toContain('invited people only');
    expect(findButton(c, /^Save to/)).toBeUndefined();
  });

  it('a view-only link explains downloads are off and shows no Save button', async () => {
    routes['/api/share/tok'] = { ...FILE_SHARE, lock_mode: 'view_only' };
    const c = await render();
    expect(c.textContent).toContain('The sender turned off downloads');
    expect(findButton(c, /^Save to/)).toBeUndefined();
  });

  it('a link with no downloads left says so and shows no Save button', async () => {
    routes['/api/share/tok'] = { ...FILE_SHARE, link: { ...LINK, downloads_left: 0 } };
    const c = await render();
    expect(c.textContent).toContain('no downloads left');
    expect(findButton(c, /^Save to/)).toBeUndefined();
  });

  it('a removed link says what to do and offers no Save', async () => {
    routes['/api/share/tok'] = new ApiError(404, JSON.stringify({ error: 'Share link not found' }));
    const c = await render();
    expect(c.textContent).toContain('Ask the sender for a new one');
    expect(findButton(c, /^Save to/)).toBeUndefined();
  });
});
