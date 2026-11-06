/**
 * Viewers, uploads and the media pages in Turkish: no English left on the file
 * viewer chrome and inspector, the archive, vCard and audio viewers, the PDF
 * and find toolbars, the comments panel, the uploads page and dock, and the
 * duplicates, search, editor and map filter screens; module-level texts
 * (editor errors, upload limits, sleep timer, reader themes) translate too.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';
import type { UploadItem } from '@/lib/upload-types';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/components/comments/api', () => ({
  listComments: vi.fn().mockResolvedValue([]),
  postComment: vi.fn(),
  deleteComment: vi.fn(),
  editComment: vi.fn(),
  searchMentionable: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/components/pdf-viewer/pdf-viewer', () => {
  const PdfViewer = () => createElement('div', { 'data-testid': 'pdf-stub' });
  return { PdfViewer, default: PdfViewer };
});
vi.mock('@/components/folder-picker-dialog', () => ({ FolderPickerDialog: () => null }));
vi.mock('@/lib/upload-runner', () => ({
  enqueue: () => {},
  enqueueByFolder: () => 0,
  enqueueRejected: () => {},
  setWorkspaceCap: () => {},
  retry: () => {},
  retryAllFailed: () => {},
  canRetry: () => true,
  cancel: () => {},
  resumeWithFile: () => ({ ok: true }),
}));

const { FileViewer } = await import('@/components/file-viewer');
const { ArchiveViewer } = await import('@/components/archive-viewer/archive-viewer');
const { VCardView } = await import('@/components/vcard-viewer');
const { AudioPlayer } = await import('@/components/audio/audio-player');
const { SLEEP_OPTIONS } = await import('@/components/audio/audio-modes');
const { TextFindBar } = await import('@/components/text-find-bar');
const { LiveBadge } = await import('@/components/live-badge');
const { PdfToolbar } = await import('@/components/pdf-viewer/pdf-toolbar');
const { CommentsPanel } = await import('@/components/comments/comments-panel');
const { MentionComposer } = await import('@/components/comments/mention-composer');
const { olderVersionNote } = await import('@/components/comments/format');
const { MapFilterPanel } = await import('@/components/map-filter-panel');
const { OfficePreview } = await import('@/components/office-preview');
const { default: UploadDock } = await import('@/components/uploads/upload-dock');
const { default: UploadsPage, QueueRow } = await import('@/pages/uploads');
const { default: DuplicatesPage } = await import('@/pages/duplicates');
const { default: SearchPage } = await import('@/pages/search');
const { default: EditorPage, describeEditorError, describeEditorNotice } = await import('@/pages/editor');
const { screenBatch } = await import('@/lib/upload-limits');
const { resumeWithFile } = await vi.importActual<typeof import('@/lib/upload-runner')>('@/lib/upload-runner');
const { READER_THEMES } = await import('@/lib/reader/readerThemes');
const { useUploads } = await import('@/stores/uploads');
const { useWorkspace } = await import('@/stores/workspace');
const { t: tNow } = await import('@/lib/i18n');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  useWorkspace.setState({ activeId: 'ws_1' });
  useUploads.setState({ items: [] });
  apiMock.mockReset();
  apiMock.mockRejectedValue(new Error('offline'));
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  vi.unstubAllGlobals();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function show(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  shown = await renderInLocale(
    <QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>,
    'tr',
  );
  await flush();
  await flush();
  return shown;
}
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); await Promise.resolve(); });
const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`);

function fileItem(over: Record<string, unknown> = {}) {
  return {
    id: 'f1', name: 'page.html', size_bytes: 512, mime_type: 'text/plain',
    extension: 'html', region: 'weur', created_at: 1, updated_at: 1,
    current_version: 1, lock_mode: 'none', is_hidden: 0, uploaded_by: 'u1',
    uploader_name: null, share_count: 2, comment_count: 0, is_synced: 1, origin: 'web', ...over,
  } as never;
}
const upload = (over: Partial<UploadItem>): UploadItem => ({
  id: 'u1', session_id: null, fileName: 'a.txt', fileSize: 100, mimeType: 't', workspace_id: 'ws_1',
  folder_id: null, status: 'queued', progress: 0, bytesUploaded: 0, part_size: null, total_parts: null,
  uploaded_parts: [], ...over,
});

describe('file viewer in Turkish', () => {
  const actions = {
    onToggleFavourite: () => {}, onShare: () => {}, onRename: () => {}, onMove: () => {}, onLock: () => {}, onDelete: () => {},
  };
  const open = async (file: unknown) => {
    const r = await show(
      <FileViewer file={file as never} files={[file as never]} workspaceId="ws_1" onClose={() => {}}
        onNavigate={() => {}} onRefresh={() => {}} actions={actions as never} />,
    );
    return r;
  };

  it('chrome, menu and the details inspector', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const r = await open(fileItem({ name: 'data.bin', extension: 'bin', mime_type: 'application/octet-stream' }));
    await click(byLabel(tr['common.accessibility.moreActions']));
    expect(r.container.textContent).toContain(tr['common.action.moveToTrash']);
    expect(r.leftover()).toEqual([]);
    // The inspector starts open in jsdom: toggle it closed and open again.
    await click(byLabel(tr['common.action.toggleInspector']));
    await click(byLabel(tr['common.action.toggleInspector']));
    expect(r.leftover()).toEqual([]);
  });

  it('versions and comments tabs, and the image zoom cluster', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    apiMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/versions')) {
        return { ok: true, versions: [
          { version_number: 2, size_bytes: 20, created_at: 2, uploader_name: 'Jo' },
          { version_number: 1, size_bytes: 10, created_at: 1, uploader_name: 'Jo' },
        ] };
      }
      throw new Error('offline');
    });
    const r = await open(fileItem({ name: 'pic.png', extension: 'png', mime_type: 'image/png' }));
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    await click(tabs[1]);
    expect(r.leftover()).toEqual([]);
    await click(tabs[2]);
    expect(r.leftover()).toEqual([]);
  });

  it('empty version history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const r = await open(fileItem());
    await click(document.querySelectorAll('[role="tab"]')[1]);
    expect(r.container.textContent).toContain(tr['common.description.noVersionHistoryYet']);
    expect(r.leftover()).toEqual([]);
  });

  it('unsupported type card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const r = await open(fileItem({ name: 'x.zzz', extension: 'zzz', mime_type: 'application/octet-stream' }));
    expect(r.container.textContent).toContain(tr['common.action.openAsText']);
    expect(r.leftover()).toEqual([]);
  });

  it('csv and markdown viewers', async () => {
    const body = 'a,b\n1,2\n3,4\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode(body).buffer }));
    const r = await open(fileItem({ name: 'rows.csv', extension: 'csv', size_bytes: 12 }));
    await flush();
    expect(r.leftover()).toEqual([]);
    r.unmount();
    const m = await open(fileItem({ name: 'README.md', extension: 'md', size_bytes: 12 }));
    await flush();
    expect(m.leftover()).toEqual([]);
  });

  it('failed content load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')));
    const r = await open(fileItem({ name: 'rows.csv', extension: 'csv', size_bytes: 12 }));
    await flush();
    expect(r.container.textContent).toContain(tr['common.error.failedToLoadFileContent']);
    expect(r.leftover()).toEqual([]);
  });
});

describe('archive viewer in Turkish', () => {
  const index = {
    kind: 'zip', archiveSize: 4096, totalEntries: 5000, truncated: true,
    entries: [
      { i: 0, name: 'docs/readme.txt', size: 10, csize: 10, method: 8, dir: false, encrypted: false, mtime: null },
      { i: 1, name: 'docs/secret.txt', size: 10, csize: 10, method: 8, dir: false, encrypted: true, mtime: null },
      { i: 2, name: 'docs/odd.bin', size: 10, csize: 10, method: 12, dir: false, encrypted: false, mtime: null },
    ],
  };
  const zip = () => fileItem({ name: 'bundle.zip', extension: 'zip', mime_type: 'application/zip' });

  it('listing, truncation notice and the empty preview', async () => {
    apiMock.mockResolvedValue(index);
    const r = await show(<ArchiveViewer file={zip()} />);
    await click(document.querySelector('[data-testid="archive-dir-docs"]'));
    expect(r.container.textContent).toContain(tr['common.action.saveAllToDosya']);
    expect(r.leftover()).toEqual([]);
  });

  it('error and loading states', async () => {
    apiMock.mockRejectedValue(new Error('offline'));
    const r = await show(<ArchiveViewer file={zip()} />);
    expect(r.container.textContent).toContain(tr['common.error.thisArchiveCouldNotBeOpened']);
    expect(r.leftover()).toEqual([]);
  });

  it('selected entry preview', async () => {
    apiMock.mockResolvedValue({ ...index, truncated: false, entries: [{ i: 0, name: 'img.png', size: 10, csize: 10, method: 8, dir: false, encrypted: false, mtime: null }] });
    const r = await show(<ArchiveViewer file={zip()} />);
    await click(document.querySelector('[data-testid="archive-entry-0"]'));
    expect(r.container.textContent).toContain(tr['common.action.saveToDosya']);
    expect(r.leftover()).toEqual([]);
  });
});

describe('vCard and audio viewers in Turkish', () => {
  const card = 'BEGIN:VCARD\nVERSION:3.0\nFN:Zed Quill\nTEL;TYPE=CELL:+1 555 0100\nEMAIL:jane@example.com\nEND:VCARD\nBEGIN:VCARD\nVERSION:3.0\nFN:\nEND:VCARD\n';

  it('contact card, list and editor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => card }));
    const r = await show(<VCardView file={{ id: 'v1', name: 'c.vcf', mime_type: 'text/vcard' }} rawUrl="/c.vcf" workspaceId="ws_1" onSaved={() => {}} />);
    expect(r.container.textContent).toContain(tr['common.placeholder.searchContacts'] ? 'Zed Quill' : '');
    expect(r.leftover()).toEqual([]);
    const edit = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(tr['common.edit']));
    await click(edit ?? null);
    expect(r.container.textContent).toContain(tr['common.action.addLabeltolowercase'].replace('{labelToLowerCase}', tr['common.label.phone'].toLowerCase()));
    expect(r.leftover()).toEqual([]);
  });

  it('unreadable contact file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const r = await show(<VCardView file={{ id: 'v1', name: 'c.vcf', mime_type: 'text/vcard' }} rawUrl="/c.vcf" workspaceId="ws_1" onSaved={() => {}} />);
    expect(r.container.textContent).toContain(tr['common.error.thisContactFileCouldnTBeRead']);
    expect(r.leftover()).toEqual([]);
  });

  it('audio player controls and the sleep menu', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')));
    const song = fileItem({ id: 'a1', name: 'song.mp3', extension: 'mp3', mime_type: 'audio/mpeg' });
    const other = fileItem({ id: 'a2', name: 'other.mp3', extension: 'mp3', mime_type: 'audio/mpeg' });
    const r = await show(<AudioPlayer file={song} files={[song, other]} rawUrl="/a.mp3" downloadUrl="/a.mp3" version={undefined} onNavigate={() => {}} />);
    await click(document.querySelector('[aria-haspopup="true"]'));
    expect(r.container.textContent).toContain(tr['common.heading.stopPlayingAfter']);
    expect(r.leftover()).toEqual([]);
  });

  it('sleep options and reader themes translate on read', async () => {
    await show(<div />);
    expect(SLEEP_OPTIONS.map((o) => o.label)).toContain(tr['common.label.oneHour']);
    expect(SLEEP_OPTIONS.map((o) => o.label)).toContain(tr['common.label.off']);
    expect(READER_THEMES.map((th) => th.label)).toContain(tr['common.option.sepia']);
  });
});

describe('toolbars and badges in Turkish', () => {
  it('text find bar', async () => {
    const find = { query: 'zz', setQuery: () => {}, count: 0, current: 0, next: () => {}, prev: () => {} };
    const r = await show(<TextFindBar find={find as never} onClose={() => {}} />);
    expect(r.container.textContent).toContain(tr['common.label.noResults']);
    expect(r.leftover()).toEqual([]);
  });

  it('live badge in both shapes', async () => {
    const r = await show(<div><LiveBadge size="pill" /><LiveBadge size="tile" /></div>);
    expect(r.container.textContent).toContain(tr['common.label.live']);
    expect(r.leftover()).toEqual([]);
  });

  it('pdf toolbar with its zoom menu', async () => {
    const r = await show(
      <PdfToolbar fileName="a.pdf" downloadUrl="/a.pdf" sidebarOpen={false} onToggleSidebar={() => {}} page={1} numPages={3}
        zoomLabel="100%" printing={false} onZoomIn={() => {}} onZoomOut={() => {}} onZoom={() => {}} onJump={() => {}}
        onToggleFind={() => {}} onPrint={() => {}} />,
    );
    await click(byLabel(tr['common.action.zoomOptions']));
    expect(r.container.textContent).toContain(tr['common.label.fitWidth']);
    expect(r.leftover()).toEqual([]);
  });

  it('office preview loading card and open-in-editor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const r = await show(<OfficePreview file={fileItem({ name: 'a.docx', extension: 'docx' })} fallback={null} />);
    expect(r.container.textContent).toContain(tr['common.description.loadingPreview']);
    expect(r.leftover()).toEqual([]);
  });

  it('map filter panel', async () => {
    const r = await show(<MapFilterPanel value={{ folderId: 'x', folderName: null, from: 1 } as never} onChange={() => {}} workspaceId="ws_1" />);
    expect(r.container.textContent).toContain(tr['map.action.allFolders']);
    expect(r.leftover()).toEqual([]);
  });
});

describe('comments in Turkish', () => {
  const comments = [
    { id: 'c1', user_id: 'me', user_name: 'Me', body: 'hello', created_at: 1, parent_id: null, anchor_ms: 1500, anchor_page: null, anchor_version: 1, mentions: [] },
  ];
  const thread = (list: unknown[], extra: Record<string, unknown> = {}) =>
    ({ comments: list, loading: false, error: false, setComments: () => {}, reload: async () => {}, ...extra }) as never;

  it('panel with a reply target, row actions and the composer', async () => {
    apiMock.mockImplementation(async (url: string) => (String(url) === '/api/me' ? { user: { id: 'me' } } : Promise.reject(new Error('x'))));
    const r = await show(<CommentsPanel fileId="f1" workspaceId="ws_1" currentVersion={3} viewingVersion={3} thread={thread(comments)} activeCommentId={null} />);
    expect(r.container.textContent).toContain(tr['common.tooltip.reply']);
    expect(r.leftover()).toEqual([]);
  });

  it('empty and failed states', async () => {
    const r = await show(<CommentsPanel fileId="f1" workspaceId="ws_1" currentVersion={1} viewingVersion={1} thread={thread([])} activeCommentId={null} />);
    expect(r.container.textContent).toContain(tr['common.empty.noCommentsYet']);
    expect(r.leftover()).toEqual([]);
    r.unmount();
    const f = await show(<CommentsPanel fileId="f1" workspaceId="ws_1" currentVersion={1} viewingVersion={1} thread={thread([], { error: true })} activeCommentId={null} />);
    expect(f.container.textContent).toContain(tr['common.error.couldnTLoadComments']);
    expect(f.leftover()).toEqual([]);
  });

  it('composer with a time anchor', async () => {
    const r = await show(<MentionComposer workspaceId="ws_1" fileId="f1" anchor={{ kind: 'time', ms: 65000 }} onSubmit={async () => true} />);
    expect(r.container.textContent).toContain('1:05');
    expect(r.leftover()).toEqual([]);
  });

  it('older-version note translates', async () => {
    await show(<div />);
    expect(olderVersionNote({ anchor_version: 1 }, 3)).toBe(tr['common.label.commentWasLeftOnVCanchorVersion'].replace('{cAnchor_version}', '1'));
  });
});

describe('uploads in Turkish', () => {
  const items = [
    upload({ id: 'q', status: 'queued', fileName: 'q.txt' }),
    upload({ id: 'p', status: 'uploading', progress: 40, bytesUploaded: 40, speedBps: 2048, fileName: 'p.txt' }),
    upload({ id: 'c', status: 'complete', progress: 100, bytesUploaded: 100, fileId: 'fx', fileName: 'c.txt' }),
    upload({ id: 'e', status: 'error', error: 'Nope', fileName: 'e.txt' }),
    upload({ id: 'i', status: 'interrupted', fileName: 'i.txt' }),
    upload({ id: 'x', status: 'canceled', fileName: 'x.txt' }),
  ];

  it('upload dock, rows and headline', async () => {
    useUploads.setState({ items });
    const r = await show(<UploadDock />);
    expect(r.container.textContent).toContain(tr['common.tooltip.retryAllFailed']);
    expect(r.leftover()).toEqual([]);
  });

  it('upload page with the queue tree and folder rows', async () => {
    useUploads.setState({
      items: [...items, upload({ id: 'n', status: 'error', error: 'Bad', relativePath: 'Holiday/2024', fileName: 'n.jpg' })],
    });
    apiMock.mockResolvedValue({ ok: true, settings: { max_concurrent_uploads: 0 } });
    const r = await show(<UploadsPage />);
    expect(r.container.textContent).toContain(tr['upload.heading.uploadQueue']);
    expect(r.leftover()).toEqual([]);
  });

  describe('folder row summary (English and Turkish)', () => {
    const summaryOf = (c: HTMLElement) => c.querySelector('[role="treeitem"][aria-expanded] .text-\\[11px\\]') as HTMLElement | null;
    const folderItems = (failed: number) => [
      upload({ id: 'a', status: 'complete', progress: 100, bytesUploaded: 100, relativePath: 'Holiday', fileName: 'a.jpg', fileId: 'x' }),
      ...Array.from({ length: failed }, (_, i) => upload({ id: `e${i}`, status: 'error', error: 'Bad', relativePath: 'Holiday', fileName: `e${i}.jpg` })),
    ];
    const setup = async (failed: number, locale: 'en' | 'tr') => {
      useUploads.setState({ items: folderItems(failed) });
      apiMock.mockResolvedValue({ ok: true, settings: { max_concurrent_uploads: 0 } });
      const client = new QueryClient();
      shown = await renderInLocale(
        <QueryClientProvider client={client}><MemoryRouter><UploadsPage /></MemoryRouter></QueryClientProvider>, locale,
      );
      await flush();
      return summaryOf(shown.container)!;
    };

    it('English with no failures: no failed part and no destructive span', async () => {
      const el = await setup(0, 'en');
      expect(el.textContent).toBe('1/1 files · 100 B');
      expect(el.querySelector('.text-destructive')).toBeNull();
    });

    it('English with 2 failures: destructive span carries " · 2 failed"', async () => {
      const el = await setup(2, 'en');
      expect(el.textContent).toBe('1/3 files · 300 B · 2 failed');
      const d = el.querySelector('.text-destructive');
      expect(d?.textContent).toBe(' · 2 failed');
    });

    it('Turkish with no failures and with failures', async () => {
      const ok = await setup(0, 'tr');
      expect(ok.textContent).not.toMatch(/\b0\b.*(başarısız|failed)/);
      expect(ok.querySelector('.text-destructive')).toBeNull();
      shown?.unmount();
      const bad = await setup(2, 'tr');
      expect(bad.querySelector('.text-destructive')?.textContent).toContain('2');
    });
  });

  it('empty upload page', async () => {
    apiMock.mockResolvedValue({ ok: true, settings: { max_concurrent_uploads: 3 } });
    const r = await show(<UploadsPage />);
    expect(r.container.textContent).toContain(tr['common.label.dropFilesOrFoldersHereToUpload']);
    expect(r.leftover()).toEqual([]);
  });

  it('queue row on its own', async () => {
    const r = await show(<QueueRow item={upload({ status: 'complete', fileId: 'f' })} />);
    expect(r.container.textContent).toContain(tr['common.action.viewFile']);
    expect(r.leftover()).toEqual([]);
  });

  it('runner and limit messages translate', async () => {
    await show(<div />);
    expect(resumeWithFile('nope', new File(['x'], 'a.txt')).error).toBe(tr['common.error.uploadNotFound']);
    const quota = screenBatch(
      [{ n: 'a.txt', s: 50_000_000_000 }],
      { storage_remaining_bytes: 1_000 } as never,
      (i) => i.n, (i) => i.s,
    );
    expect(quota.quotaWarning).toContain(tr['common.description.thisUploadIsAboutFitoverLargerThanTheSpaceLeftIn'].split('{fitOver}')[1]);
  });
});

describe('duplicates, search, editor and the map filter in Turkish', () => {
  it('duplicates list and the confirm dialog', async () => {
    apiMock.mockResolvedValue({
      ok: true, total_groups: 2, total_wasted_bytes: 2048, scanning: { pending: 3 },
      groups: [{
        content_hash: 'h', size_bytes: 1024, count: 2, wasted_bytes: 1024,
        files: [
          { id: 'a', name: 'one.txt', folder_id: null, folder_path: null, created_at: 2, uploaded_by: 'u', uploader_name: 'U', mime_type: 't', extension: 'txt' },
          { id: 'b', name: 'two.txt', folder_id: 'f', folder_path: 'Reports', created_at: 1, uploaded_by: 'u', uploader_name: 'U', mime_type: 't', extension: 'txt' },
        ],
      }],
    });
    const r = await show(<DuplicatesPage />);
    const selectAll = [...document.querySelectorAll('button')].find((b) => b.textContent === tr['duplicates.action.selectAllButNewest']);
    await click(selectAll ?? null);
    const move = [...document.querySelectorAll('button')].find((b) => /trash|çöp/i.test(b.textContent ?? '') && b.className.includes('destructive'));
    await click(move ?? null);
    expect(r.container.textContent).toContain(tr['duplicates.label.newest']);
    expect(r.leftover()).toEqual([]);
  });

  it('duplicates empty and error states', async () => {
    apiMock.mockResolvedValue({ ok: true, groups: [], total_groups: 0, total_wasted_bytes: 0, scanning: { pending: 0 } });
    const r = await show(<DuplicatesPage />);
    expect(r.container.textContent).toContain(tr['duplicates.tooltip.noDuplicatesFound']);
    expect(r.leftover()).toEqual([]);
    r.unmount();
    apiMock.mockRejectedValue(new Error('offline'));
    const e = await show(<DuplicatesPage />);
    expect(e.container.textContent).toContain(tr['duplicates.error.duplicatesCouldNotBeLoaded']);
    expect(e.leftover()).toEqual([]);
  });

  it('search results', async () => {
    apiMock.mockResolvedValue({
      ok: true,
      files: [{ id: 'f', name: 'a.txt', size_bytes: 10, folder_id: null, uploader_name: null, created_at: 1 }],
      folders: [{ id: 'd', name: 'Reports', file_count: 3, created_at: 1 }],
      shared: [{ link_id: 'l', file_name: null, folder_name: null, view_count: 4, sharer_name: null, shared_at: 1, status: 'active' }],
      file_requests: [{ id: 'r', title: '', upload_count: 2, created_by_name: null, created_at: 1, is_revoked: false }],
      pagination: { total_files: 1, total_folders: 1, total_shares: 1, total_requests: 1 },
    });
    shown = null;
    const client = new QueryClient();
    shown = await renderInLocale(
      <QueryClientProvider client={client}><MemoryRouter initialEntries={['/search?q=abc']}><SearchPage /></MemoryRouter></QueryClientProvider>,
      'tr',
    );
    await flush();
    await flush();
    expect(shown.container.textContent).toContain(tr['common.label.sharedLinks']);
    expect(shown.leftover()).toEqual([]);
  });

  it('search without a query', async () => {
    const r = await show(<SearchPage />);
    expect(r.container.textContent).toContain(tr['search.label.searchYourWorkspace']);
    expect(r.leftover()).toEqual([]);
  });

  it('editor error card and read-only badge', async () => {
    apiMock.mockRejectedValue(new Error('offline'));
    const r = await show(<EditorPage />);
    expect(r.container.textContent).toContain(tr['editor.action.openPreview']);
    expect(r.leftover()).toEqual([]);
  });

  it('editor error sentences translate', async () => {
    await show(<div />);
    const lead = tr['editor.error.theDocumentEditorCouldNotBeLoaded'];
    expect(describeEditorError({ data: { errorCode: -2 } } as never)).toBe(
      tr['editor.error.leadTheDocumentServerCouldNotBeReached'].replace('{lead}', lead),
    );
    expect(describeEditorNotice({ data: { errorCode: 7 } } as never)).toContain('7');
    expect(tNow('common.label.live')).toBe(tr['common.label.live']);
  });
});
