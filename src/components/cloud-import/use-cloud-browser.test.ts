import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApiError } from '@/api/client';
import type { CloudEntryDto, SelectionEntry } from '@/api/cloud-import';

const browseMock = vi.fn();
vi.mock('@/api/cloud-import', () => ({
  browse: (...args: unknown[]) => browseMock(...args),
}));

const { useCloudBrowser, toggleSelection, toSelectionEntry } = await import('./use-cloud-browser');

const folder: SelectionEntry = { id: 'f1', name: 'Photos', kind: 'folder' };
const file: SelectionEntry = { id: 'a1', name: 'a.pdf', kind: 'file', size: 10 };

describe('toggleSelection', () => {
  it('adds an unselected entry', () => {
    expect(toggleSelection([], folder)).toEqual([folder]);
  });

  it('removes an already-selected entry', () => {
    expect(toggleSelection([folder], folder)).toEqual([]);
  });

  it('keeps other entries untouched', () => {
    expect(toggleSelection([folder, file], folder)).toEqual([file]);
  });

  it('matches on id, not object identity', () => {
    expect(toggleSelection([folder], { ...folder })).toEqual([]);
  });
});

function cloudEntry(over: Partial<CloudEntryDto> = {}): CloudEntryDto {
  return { id: 'e1', name: 'Report.pdf', kind: 'file', size: 100, ...over };
}

describe('toSelectionEntry', () => {
  it('converts a normal entry into the shape the import API expects', () => {
    expect(toSelectionEntry(cloudEntry())).toEqual({
      id: 'e1', name: 'Report.pdf', kind: 'file', size: 100, mimeType: undefined, exportMime: null,
    });
  });

  it('returns null for an unsupported entry, so it can never enter a selection', () => {
    expect(toSelectionEntry(cloudEntry({ unsupported: true }))).toBeNull();
  });

  it('carries the export mime for a Google-native doc that needs exporting on import', () => {
    const entry = cloudEntry({ exportAs: { mime: 'application/pdf', ext: 'pdf' } });
    expect(toSelectionEntry(entry)?.exportMime).toBe('application/pdf');
  });
});

// ---------------------------------------------------------------------------
// useCloudBrowser - rendered with a minimal harness, following this repo's
// existing no-@testing-library pattern (see select-checkbox.test.tsx /
// vault-sidebar.test.tsx): a real React tree via react-dom/client + act(),
// no extra test-rendering library.
// ---------------------------------------------------------------------------

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  browseMock.mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Drains the microtask queue so awaited mocks (browse()) settle inside act(). */
async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

type BrowserApi = ReturnType<typeof useCloudBrowser>;

async function renderBrowser(accountId: string | null) {
  let latest!: BrowserApi;
  function Harness() {
    latest = useCloudBrowser(accountId);
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(Harness));
    await flush();
  });
  return { get api() { return latest; } };
}

/** Runs a hook action and lets its resulting state settle before returning. */
async function run(fn: () => void) {
  await act(async () => {
    fn();
    await flush();
  });
}

describe('useCloudBrowser - loading and navigation', () => {
  it('loads the root folder (empty folder id) on mount', async () => {
    browseMock.mockResolvedValue({ entries: [cloudEntry({ id: 'root-file' })], cursor: null });
    const h = await renderBrowser('acc1');
    expect(browseMock).toHaveBeenCalledWith({ accountId: 'acc1', folderId: '', cursor: undefined });
    expect(h.api.entries.map((e) => e.id)).toEqual(['root-file']);
    expect(h.api.crumbs).toEqual([{ id: '', name: 'Home' }]);
  });

  it('entering a folder loads its id, and the breadcrumb trail grows', async () => {
    browseMock.mockResolvedValueOnce({ entries: [cloudEntry({ id: 'root-file' })], cursor: null });
    const h = await renderBrowser('acc1');

    browseMock.mockResolvedValueOnce({ entries: [cloudEntry({ id: 'nested-file' })], cursor: null });
    await run(() => h.api.enter(cloudEntry({ id: 'folder-1', name: 'Photos', kind: 'folder' })));

    expect(browseMock).toHaveBeenLastCalledWith({ accountId: 'acc1', folderId: 'folder-1', cursor: undefined });
    expect(h.api.crumbs.map((c) => c.id)).toEqual(['', 'folder-1']);
    expect(h.api.entries.map((e) => e.id)).toEqual(['nested-file']);
  });

  it('going back via the breadcrumb reloads the right (earlier) folder id', async () => {
    browseMock.mockResolvedValueOnce({ entries: [cloudEntry({ id: 'root-file' })], cursor: null });
    const h = await renderBrowser('acc1');

    browseMock.mockResolvedValueOnce({ entries: [cloudEntry({ id: 'nested-file' })], cursor: null });
    await run(() => h.api.enter(cloudEntry({ id: 'folder-1', name: 'Photos', kind: 'folder' })));

    browseMock.mockResolvedValueOnce({ entries: [cloudEntry({ id: 'root-file' })], cursor: null });
    await run(() => h.api.goTo(0));

    expect(browseMock).toHaveBeenLastCalledWith({ accountId: 'acc1', folderId: '', cursor: undefined });
    expect(h.api.crumbs.map((c) => c.id)).toEqual(['']);
    expect(h.api.entries.map((e) => e.id)).toEqual(['root-file']);
  });
});

describe('useCloudBrowser - selection', () => {
  it('toggling a supported entry adds then removes it via the real toggle() wiring', async () => {
    browseMock.mockResolvedValue({ entries: [cloudEntry({ id: 'root-file' })], cursor: null });
    const h = await renderBrowser('acc1');

    await run(() => h.api.toggle(cloudEntry({ id: 'root-file' })));
    expect(h.api.selection.map((s) => s.id)).toEqual(['root-file']);

    await run(() => h.api.toggle(cloudEntry({ id: 'root-file' })));
    expect(h.api.selection).toEqual([]);
  });

  it('an unsupported entry cannot be selected - toggling it never adds it', async () => {
    browseMock.mockResolvedValue({ entries: [], cursor: null });
    const h = await renderBrowser('acc1');

    await run(() => h.api.toggle(cloudEntry({ id: 'weird', unsupported: true })));
    expect(h.api.selection).toEqual([]);
  });

  it('selection survives navigating into a folder and back via the breadcrumb', async () => {
    browseMock.mockResolvedValueOnce({ entries: [cloudEntry({ id: 'root-file' })], cursor: null });
    const h = await renderBrowser('acc1');

    await run(() => h.api.toggle(cloudEntry({ id: 'root-file' })));
    expect(h.api.selection.map((s) => s.id)).toEqual(['root-file']);

    browseMock.mockResolvedValueOnce({ entries: [cloudEntry({ id: 'nested-file' })], cursor: null });
    await run(() => h.api.enter(cloudEntry({ id: 'folder-1', name: 'Photos', kind: 'folder' })));
    expect(h.api.selection.map((s) => s.id)).toEqual(['root-file']);

    browseMock.mockResolvedValueOnce({ entries: [cloudEntry({ id: 'root-file' })], cursor: null });
    await run(() => h.api.goTo(0));
    expect(h.api.selection.map((s) => s.id)).toEqual(['root-file']);
  });
});

describe('useCloudBrowser - RECONNECT_REQUIRED (401)', () => {
  it('sets reconnectRequired rather than showing an empty folder', async () => {
    browseMock.mockRejectedValue(
      new ApiError(401, JSON.stringify({ ok: false, error: 'Reconnect needed', code: 'RECONNECT_REQUIRED' })),
    );
    const h = await renderBrowser('acc1');
    expect(h.api.reconnectRequired).toBe(true);
    expect(h.api.entries).toEqual([]);
  });

  it('a 401 without the RECONNECT_REQUIRED code is a generic error, not a reconnect prompt', async () => {
    browseMock.mockRejectedValue(new ApiError(401, JSON.stringify({ ok: false, error: 'Not authenticated' })));
    const h = await renderBrowser('acc1');
    expect(h.api.reconnectRequired).toBe(false);
    expect(h.api.error).toBeTruthy();
  });
});

describe('useCloudBrowser - RATE_LIMITED (429)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('is not treated as a reconnect case or a fatal error, and auto-retries after the provider delay', async () => {
    const rateLimited = new ApiError(
      429,
      JSON.stringify({ ok: false, code: 'RATE_LIMITED', retryAfterSeconds: 5 }),
    );
    browseMock.mockRejectedValueOnce(rateLimited);
    browseMock.mockResolvedValueOnce({ entries: [cloudEntry({ id: 'root-file' })], cursor: null });

    const h = await renderBrowser('acc1');
    expect(h.api.reconnectRequired).toBe(false);
    expect(h.api.error).toBeNull();
    expect(h.api.rateLimitedSeconds).toBe(5);
    expect(browseMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await flush();
    });

    expect(browseMock).toHaveBeenCalledTimes(2);
    expect(h.api.entries.map((e) => e.id)).toEqual(['root-file']);
    expect(h.api.rateLimitedSeconds).toBeNull();
  });
});
