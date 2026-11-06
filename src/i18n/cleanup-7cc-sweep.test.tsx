/**
 * Unit 7cc: the components that still rendered English literals or worked around
 * defective catalog messages. Each case renders the component in Turkish with the
 * sweep helper (nothing may be left in English and the catalog text must appear)
 * and, where the wording was reworked, in English to prove the output is the same.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const rate = vi.hoisted(() => ({ value: { bytesPerSec: null as number | null, etaSeconds: null as number | null } }));
vi.mock('@/lib/import-rate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/import-rate')>();
  return { ...actual, jobRate: () => rate.value };
});
vi.mock('@/lib/upload-runner', () => ({
  cancel: () => {}, retry: () => {}, resumeWithFile: () => ({ ok: true }), retryAllFailed: () => {}, canRetry: () => true,
}));
vi.mock('@/api/client', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  api: async () => ({ ok: true }),
  apiErrorMessage: String,
  API_BASE: '',
}));

const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;
const { useSession } = await import('@/stores/session');
const { useCloudImports } = await import('@/stores/cloud-imports');
const { useUploads } = await import('@/stores/uploads');
const { DeletionBanner } = await import('@/components/deletion-banner');
const { Breadcrumb, BreadcrumbEllipsis } = await import('@/components/ui/breadcrumb');
const { ApiKeyCallout } = await import('@/components/integrations/integration-layout');
const { DeleteAccountNowDialog } = await import('@/components/delete-account-now-dialog');
const { ImportProgressCard } = await import('@/components/cloud-import/import-progress-card');
const { default: UploadDock } = await import('@/components/uploads/upload-dock');
const { FileInfoDialog } = await import('@/components/file-info-dialog');
const { MaintenanceScreen } = await import('@/components/maintenance-screen');

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  useUploads.setState({ items: [] });
});

const DAY = 86_400;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const wrap = (ui: React.ReactElement) => <MemoryRouter>{ui}</MemoryRouter>;
const text = () => shown?.container.textContent ?? '';
const body = () => document.body.textContent ?? '';

describe('deletion banner', () => {
  it('says "today" and the day count through the corrected message, in Turkish and English', async () => {
    const now = Math.floor(Date.now() / 1000);
    useSession.setState({ user: { deletion_scheduled_for: now + 5 * DAY + 100 } } as never);
    shown = await renderInLocale(wrap(<DeletionBanner />), 'tr');
    expect(text()).toContain(tr['common.action.cancelDeletion']);
    expect(text()).not.toMatch(/days? left|today/);
    expect(text()).not.toContain('#');
    expect(shown.leftover()).toEqual([]);
    shown.unmount();

    shown = await renderInLocale(wrap(<DeletionBanner />), 'en');
    expect(text()).toMatch(/^Your account is scheduled for deletion on .+ - 5 days left\.Cancel deletion$/);
    shown.unmount();

    useSession.setState({ user: { deletion_scheduled_for: now - 10 } } as never);
    shown = await renderInLocale(wrap(<DeletionBanner />), 'en');
    expect(text()).toMatch(/^Your account is scheduled for deletion on .+ - today\.Cancel deletion$/);
  });
});

describe('breadcrumb', () => {
  it('names the landmark and the collapsed items in Turkish', async () => {
    shown = await renderInLocale(<Breadcrumb><BreadcrumbEllipsis /></Breadcrumb>, 'tr');
    expect(shown.container.querySelector('nav')?.getAttribute('aria-label')).toBe(tr['common.accessibility.breadcrumb']);
    expect(text()).toContain(tr['files.action.more']);
    expect(shown.leftover()).toEqual([]);
    shown.unmount();
    shown = await renderInLocale(<Breadcrumb><BreadcrumbEllipsis /></Breadcrumb>, 'en');
    expect(shown.container.querySelector('nav')?.getAttribute('aria-label')).toBe('breadcrumb');
    expect(text()).toBe('More');
  });
});

describe('API key callout', () => {
  it('reads as before in English and as its own sentences in Turkish', async () => {
    shown = await renderInLocale(wrap(<ApiKeyCallout />), 'en');
    expect(text()).toBe('You’ll need an API keyGenerate a dos_… key in Profile → API keys, then use it where the snippets below say dos_your_api_key.');
    shown.unmount();
    shown = await renderInLocale(wrap(<ApiKeyCallout />), 'tr');
    expect(text()).toContain(tr['common.label.youRsquoLlNeedAnApiKey']);
    expect(text()).toContain(tr['common.description.thenUseItWhereTheSnippetsBelowSayLowercase'].replace('{apiKeyExample}', 'dos_your_api_key'));
    expect(text()).not.toContain('&');
    expect(shown.leftover()).toEqual([]);
  });
});

describe('delete account now dialog', () => {
  const preview = { workspaces: [{ id: 'w', name: 'Solo' }], file_count: 1, total_bytes: 1, blockers: [], window_days: 30, deletion_scheduled_for: 0 };
  const ui = (
    <DeleteAccountNowDialog open onOpenChange={() => {}} preview={preview} hasPassword onDeleted={() => {}}
      scheduledFor={Math.floor(Date.now() / 1000) + 1 * DAY + 100} />
  );
  it('counts days, files and workspaces with real plurals', async () => {
    shown = await renderInLocale(ui, 'en');
    await flush();
    expect(body()).toContain('This skips the 1 day left on your countdown. Your account closes immediately and 1 file in 1 workspace are permanently erased within the hour. This cannot be undone.');
    shown.unmount();
    shown = await renderInLocale(ui, 'tr');
    await flush();
    expect(body()).not.toMatch(/\bdays?\b|\bworkspaces?\b|\bfiles?\b/);
    expect(shown.leftover()).toEqual([]);
  });
});

describe('cloud import progress', () => {
  const job = {
    id: 'j', provider: 'google', status: 'running', total_files: 4, completed_files: 1, failed_files: 0, skipped_files: 0,
    total_bytes: 1000, completed_bytes: 300,
  };
  const stats = () => shown!.container.querySelector('[data-testid="job-stats"]')?.textContent ?? '';
  const setup = (r: { bytesPerSec: number | null; etaSeconds: number | null }) => {
    rate.value = r;
    useCloudImports.setState({ jobs: [job], refresh: vi.fn().mockResolvedValue(undefined), cancel: vi.fn() } as never);
  };

  it('has no doubled or trailing spaces with or without speed and time left', async () => {
    setup({ bytesPerSec: 100, etaSeconds: 90 });
    shown = await renderInLocale(<ImportProgressCard />, 'en');
    expect(stats()).toMatch(/^300 B of 1000 B - 100 B\/s - about .+ left$/);
    shown.unmount();
    setup({ bytesPerSec: null, etaSeconds: null });
    shown = await renderInLocale(<ImportProgressCard />, 'en');
    expect(stats()).toBe('300 B of 1000 B');
    shown.unmount();
    setup({ bytesPerSec: null, etaSeconds: 90 });
    shown = await renderInLocale(<ImportProgressCard />, 'en');
    expect(stats()).toMatch(/^300 B of 1000 B - about .+ left$/);
  });

  it('translates in Turkish', async () => {
    setup({ bytesPerSec: 100, etaSeconds: 90 });
    shown = await renderInLocale(<ImportProgressCard />, 'tr');
    expect(stats()).not.toMatch(/\bof\b|\babout\b|\bleft\b/);
    expect(shown.leftover()).toEqual([]);
  });
});

describe('upload dock headlines', () => {
  const item = (over: Record<string, unknown>) => ({
    id: 'u', session_id: null, fileName: 'a.txt', fileSize: 100, mimeType: 't', workspace_id: 'ws', folder_id: null,
    status: 'complete', progress: 100, bytesUploaded: 100, part_size: null, total_parts: null, uploaded_parts: [], ...over,
  });
  const headline = () => shown!.container.querySelector('span.font-semibold')?.textContent ?? '';

  it('translates the attention and partial headlines and keeps the English', async () => {
    useUploads.setState({ items: [item({ id: 'a' }), item({ id: 'b', status: 'error' })] } as never);
    shown = await renderInLocale(wrap(<UploadDock />), 'en');
    expect(headline()).toBe('1/2 uploaded · 1 need attention');
    shown.unmount();
    shown = await renderInLocale(wrap(<UploadDock />), 'tr');
    expect(headline()).not.toMatch(/uploaded|need attention/);
    expect(headline()).toContain('1/2');
    shown.unmount();

    useUploads.setState({ items: [item({ id: 'a' }), item({ id: 'b', status: 'canceled' })] } as never);
    shown = await renderInLocale(wrap(<UploadDock />), 'en');
    expect(headline()).toBe('1/2 uploaded');
    shown.unmount();
    shown = await renderInLocale(wrap(<UploadDock />), 'tr');
    expect(headline()).not.toMatch(/uploaded/);
    expect(shown.leftover()).toEqual([]);
  });
});

describe('file info dialog', () => {
  const file = {
    id: 'f', name: 'a.bin', size_bytes: 2048, mime_type: '', extension: 'bin', region: 'auto', created_at: 1700000000,
    updated_at: 1700000000, current_version: 2, lock_mode: 'none', is_hidden: 0, uploader_name: 'Ada', share_count: 3, comment_count: 1,
  };
  const ui = <FileInfoDialog target={{ type: 'file', item: file }} onClose={() => {}} />;

  it('counts versions, shares and comments with plurals and has no leftover English', async () => {
    shown = await renderInLocale(ui, 'en');
    await flush();
    expect(body()).toContain('2 versions');
    expect(body()).toContain('3 shares');
    expect(body()).toContain('1 comment');
    expect(body()).toContain('Unknown type');
    shown.unmount();
    shown = await renderInLocale(ui, 'tr');
    await flush();
    expect(body()).not.toMatch(/\bversions?\b|\bshares?\b|\bcomments?\b|Unknown type/);
    expect(shown.leftover()).toEqual([]);
  });
});

describe('maintenance screen', () => {
  it('names an unknown surface in Turkish', async () => {
    shown = await renderInLocale(
      <MaintenanceScreen surface={'nope' as never} message={null} onRetry={async () => true} email="a@b.co" onSignOut={() => {}} />, 'tr');
    expect(text()).toContain(tr['common.label.thisService']);
    expect(shown.leftover()).toEqual([]);
  });
});
