/**
 * Unit 7d: the final cleanup. The file badge fallback, the template-only
 * whitespace tidy, the import-source label that follows the language, and
 * the video player's Video.js control labels.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const rate = vi.hoisted(() => ({ value: { bytesPerSec: null as number | null, etaSeconds: null as number | null } }));
vi.mock('@/lib/import-rate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/import-rate')>();
  return { ...actual, jobRate: () => rate.value };
});
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: async () => { throw new Error('offline'); } };
});
vi.mock('@/components/comments/api', () => ({
  listComments: vi.fn().mockResolvedValue([]),
  postComment: vi.fn(),
  deleteComment: vi.fn(),
  editComment: vi.fn(),
  searchMentionable: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/components/folder-picker-dialog', () => ({ FolderPickerDialog: () => null }));

const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;
const pl = (await import('@/i18n/messages/pl.json')).default as Record<string, string>;
const { useSession } = await import('@/stores/session');
const { useCloudImports } = await import('@/stores/cloud-imports');
const { useWorkspace } = await import('@/stores/workspace');
const { DeletionBanner } = await import('@/components/deletion-banner');
const { ImportProgressCard } = await import('@/components/cloud-import/import-progress-card');
const { FileViewer } = await import('@/components/file-viewer');
const { IMPORT_SOURCE_LABELS } = await import('@/lib/cloud-providers');
const { videoLabels } = await import('@/components/video/video-labels');
const { videojsOptions } = await import('../../vendor/video-player/controls');
const { DEFAULT_LABELS } = await import('../../vendor/video-player/labels');
const { t: tNow } = await import('@/lib/i18n');

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { shown?.unmount(); shown = null; });

const DAY = 86_400;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const wrap = (ui: ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);
const text = () => shown?.container.textContent ?? '';
const clean = (s: string) => {
  expect(s).not.toMatch(/ {2,}/);
  expect(s).toBe(s.trim());
};

describe('file badge fallback', () => {
  const file = { id: 'f1', name: 'README', size_bytes: 5, mime_type: 'text/plain', extension: '', region: 'weur', created_at: 1, updated_at: 1,
    current_version: 1, lock_mode: 'none', is_hidden: 0, uploaded_by: 'u1', uploader_name: null, share_count: 0, comment_count: 0, is_synced: 1, origin: 'web' };
  const actions = { onToggleFavourite: () => {}, onShare: () => {}, onRename: () => {}, onMove: () => {}, onLock: () => {}, onDelete: () => {} };
  const badges = () => [...document.querySelectorAll('span[aria-hidden="true"]')].map((e) => e.textContent);
  const open = (locale: 'en' | 'tr') => renderInLocale(
    wrap(<FileViewer file={file as never} files={[file as never]} workspaceId="ws_1" onClose={() => {}} onNavigate={() => {}} onRefresh={() => {}} actions={actions as never} />),
    locale,
  );

  it('uses the badge word, cut to four letters, in English and Turkish', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    useWorkspace.setState({ activeId: 'ws_1' });
    shown = await open('en');
    await flush();
    expect(badges()).toContain('FILE');
    shown.unmount();
    shown = await open('tr');
    await flush();
    expect(badges()).toContain(tr['common.label.fileBadge'].slice(0, 4));
    vi.unstubAllGlobals();
  });
});

describe('whitespace stays clean in textContent', () => {
  const job = { id: 'j', provider: 'google', status: 'running', total_files: 4, completed_files: 1, failed_files: 0, skipped_files: 0, total_bytes: 1000, completed_bytes: 300 };
  const stats = () => shown!.container.querySelector('[data-testid="job-stats"]')?.textContent ?? '';

  it.each([['tr', { bytesPerSec: null, etaSeconds: null }], ['tr', { bytesPerSec: 100, etaSeconds: null }], ['pl', { bytesPerSec: null, etaSeconds: null }], ['pl', { bytesPerSec: null, etaSeconds: 90 }]] as const)(
    'import progress line in %s without a speed or time left part: no doubled or trailing space (%o)',
    async (locale, r) => {
      rate.value = { ...r };
      useCloudImports.setState({ jobs: [job], refresh: vi.fn().mockResolvedValue(undefined), cancel: vi.fn() } as never);
      shown = await renderInLocale(wrap(<ImportProgressCard />), locale);
      await flush();
      expect(stats().length).toBeGreaterThan(0);
      clean(stats());
    },
  );

  it('deletion banner in Turkish', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const delta of [5 * DAY + 100, -10]) {
      useSession.setState({ user: { deletion_scheduled_for: now + delta } } as never);
      shown = await renderInLocale(wrap(<DeletionBanner />), 'tr');
      const p = shown.container.querySelector('p')!;
      clean(p.textContent ?? '');
      shown.unmount();
    }
    expect(tr['common.action.cancelDeletion']).toBeTruthy();
    expect(pl['common.action.cancelDeletion']).toBeTruthy();
  });
});

describe('import source label follows the language', () => {
  it('Shared link in English and Turkish', async () => {
    shown = await renderInLocale(<span />, 'en');
    expect(IMPORT_SOURCE_LABELS.share).toBe('Shared link');
    expect(IMPORT_SOURCE_LABELS['google-drive']).toBe('Google Drive');
    shown.unmount();
    shown = await renderInLocale(<span />, 'tr');
    expect(IMPORT_SOURCE_LABELS.share).toBe(tr['search.label.sharedLink']);
    expect(IMPORT_SOURCE_LABELS.share).not.toBe('Shared link');
  });
});

describe('video player Video.js control labels', () => {
  const KEYS = ['Progress Bar', 'Current Time', 'Duration', 'Remaining Time', 'Playback Rate', 'Picture-in-Picture', 'Exit Fullscreen'];

  it('default English is byte-identical to Video.js', () => {
    const dict = (videojsOptions(false, 'auto', false, DEFAULT_LABELS) as { languages: { dp: Record<string, string> } }).languages.dp;
    for (const k of KEYS) expect(dict[k]).toBe(k);
  });

  it('web maps the catalog keys, so Turkish reaches Video.js', async () => {
    shown = await renderInLocale(<span />, 'tr');
    const labels = videoLabels(tNow);
    expect(labels.progressBar).toBe(tr['common.accessibility.progressBar']);
    expect(labels.exitFullscreen).toBe(tr['common.accessibility.exitFullscreen']);
    const dict = (videojsOptions(false, 'auto', false, labels) as { languages: { dp: Record<string, string> } }).languages.dp;
    expect(dict['Current Time']).toBe(tr['common.accessibility.currentTime']);
    expect(dict['Playback Rate']).toBe(tr['common.accessibility.playbackRate']);
    expect(dict['Picture-in-Picture']).toBe(tr['common.accessibility.pictureInPicture']);
    expect(dict.Duration).toBe(tr['common.accessibility.duration']);
    expect(dict['Remaining Time']).toBe(tr['common.accessibility.remainingTime']);
  });
});
