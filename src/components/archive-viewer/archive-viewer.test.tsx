// apps/web/src/components/archive-viewer/archive-viewer.test.tsx
//
// The pane's job is to be honest: it lists what is inside, it says clearly
// when an entry cannot be opened, and it never claims more than the API told
// it. The refusal paths matter as much as the happy one.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FileItem } from '@/lib/file-types';

const apiMock = vi.fn();
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, api: (...a: unknown[]) => apiMock(...a) };
});

const { ArchiveViewer } = await import('./archive-viewer');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
  vi.unstubAllGlobals();
});

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

function zipFile(over: Partial<FileItem> = {}): FileItem {
  return {
    id: 'f1', name: 'bundle.zip', size_bytes: 4096, mime_type: 'application/zip',
    extension: 'zip', region: 'weur', created_at: 1, updated_at: 1,
    current_version: 1, share_count: 0, comment_count: 0, folder_id: null,
    lock_mode: null, is_synced: 0, origin: null, uploader_name: null,
    ...over,
  } as FileItem;
}

async function render(file: FileItem, version?: number) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(ArchiveViewer, { file, version }));
    await flush();
  });
}

// Indices are deliberately NON-sequential and out of array order (4, 7, 9,
// not 0, 1, 2): a component that used the array position instead of reading
// the entry's own `i` field would still pass every assertion below if the
// fixture's positions and indices happened to coincide, which is exactly
// what a 0/1/2 fixture could not catch.
const INDEX = {
  archiveSize: 4096,
  totalEntries: 3,
  truncated: false,
  entries: [
    { i: 4, name: 'assets/hero.png', size: 284, csize: 271, method: 8, dir: false, encrypted: false, mtime: null },
    { i: 7, name: 'README.md', size: 30, csize: 20, method: 8, dir: false, encrypted: false, mtime: null },
    { i: 9, name: 'secret.psd', size: 10, csize: 10, method: 0, dir: false, encrypted: true, mtime: null },
  ],
};

// A dedicated fixture for the copy-check test: the shared INDEX's
// README.md legitimately contains "read" as a filename substring, which is
// not the kind of claim the no-read/scan/inspect rule is policing. Testing
// the rule against a fixture that cannot itself trip it is what makes the
// assertion mean something.
const COPY_CHECK_INDEX = {
  archiveSize: 4096,
  totalEntries: 3,
  truncated: false,
  entries: [
    { i: 4, name: 'assets/hero.png', size: 284, csize: 271, method: 8, dir: false, encrypted: false, mtime: null },
    { i: 7, name: 'notes.txt', size: 30, csize: 20, method: 8, dir: false, encrypted: false, mtime: null },
    { i: 9, name: 'secret.psd', size: 10, csize: 10, method: 0, dir: false, encrypted: true, mtime: null },
  ],
};

const METHOD_REFUSED_INDEX = {
  archiveSize: 100,
  totalEntries: 1,
  truncated: false,
  entries: [
    { i: 3, name: 'legacy.bin', size: 50, csize: 50, method: 99, dir: false, encrypted: false, mtime: null },
  ],
};

const BIG_TEXT_INDEX = {
  archiveSize: 5_000_000,
  totalEntries: 1,
  truncated: false,
  entries: [
    { i: 5, name: 'huge.log', size: 3 * 1024 * 1024, csize: 1000, method: 8, dir: false, encrypted: false, mtime: null },
  ],
};

const SMALL_TEXT_INDEX = {
  archiveSize: 1000,
  totalEntries: 1,
  truncated: false,
  entries: [
    { i: 6, name: 'notes.txt', size: 500_000, csize: 100_000, method: 8, dir: false, encrypted: false, mtime: null },
  ],
};

describe('ArchiveViewer', () => {
  it('lists the archive as a tree', async () => {
    apiMock.mockResolvedValue(INDEX);
    await render(zipFile());
    const text = container!.textContent ?? '';
    expect(text).toContain('assets');
    expect(text).toContain('README.md');
  });

  it('shows a skeleton, not a spinner, while loading', async () => {
    apiMock.mockReturnValue(new Promise(() => {}));
    await render(zipFile());
    expect(container!.querySelectorAll('[data-testid="archive-skeleton-row"]').length).toBeGreaterThan(0);
  });

  it('says how many entries and how large, without claiming to read them', async () => {
    apiMock.mockResolvedValue(COPY_CHECK_INDEX);
    await render(zipFile());
    const text = (container!.textContent ?? '').toLowerCase();
    expect(text).toContain('3 entries');
    // Properly grouped and bounded on both sides - `\bread` alone would also
    // match inside a legitimate word like "readme"; this must not.
    expect(text).not.toMatch(/\b(read|scan|inspect)\b/);
  });

  it('keeps a folder collapsed until it is opened, and reports state via aria-expanded', async () => {
    apiMock.mockResolvedValue(INDEX);
    await render(zipFile());
    const dir = container!.querySelector('[data-testid="archive-dir-assets"]') as HTMLButtonElement;
    expect(dir.getAttribute('aria-expanded')).toBe('false');
    expect(container!.querySelector('[data-testid="archive-entry-4"]')).toBeNull();
    await act(async () => { dir.click(); await flush(); });
    expect(dir.getAttribute('aria-expanded')).toBe('true');
    expect(container!.querySelector('[data-testid="archive-entry-4"]')).not.toBeNull();
  });

  it('marks a password-protected entry and refuses to select it', async () => {
    apiMock.mockResolvedValue(INDEX);
    await render(zipFile());
    const locked = container!.querySelector('[data-testid="archive-entry-9"]') as HTMLButtonElement;
    // aria-disabled, not disabled: a truly disabled button drops out of the
    // tab order, so a keyboard/SR user could never land on it to learn why.
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.getAttribute('title')).toMatch(/password/i);
    await act(async () => { locked.click(); await flush(); });
    expect(container!.textContent).toContain('Select a file to preview it.');
  });

  it('marks an unsupported compression method with a visible marker and an announced reason', async () => {
    apiMock.mockResolvedValue(METHOD_REFUSED_INDEX);
    await render(zipFile());
    const row = container!.querySelector('[data-testid="archive-entry-3"]') as HTMLButtonElement;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    const srReason = row.querySelector('.sr-only')?.textContent ?? '';
    expect(srReason).toMatch(/method/i);
  });

  it('dims with the muted token, never with opacity', async () => {
    // opacity - and its alpha-modifier twin, text-[color]/NN - both drop
    // contrast below the AA floor this project publishes, and grepping only
    // one row's className would miss the alpha form entirely.
    apiMock.mockResolvedValue(INDEX);
    await render(zipFile());
    const locked = container!.querySelector('[data-testid="archive-entry-9"]') as HTMLElement;
    expect(locked.className).toContain('text-muted-foreground');
    expect(container!.innerHTML).not.toMatch(/opacity-/);
    expect(container!.innerHTML).not.toMatch(/text-[^\s"']+\/\d{1,3}/);
  });

  it('points the preview at the entry endpoint by INDEX, never by path', async () => {
    apiMock.mockResolvedValue(INDEX);
    await render(zipFile());
    const dir = container!.querySelector('[data-testid="archive-dir-assets"]') as HTMLButtonElement;
    await act(async () => { dir.click(); await flush(); });
    const png = container!.querySelector('[data-testid="archive-entry-4"]') as HTMLButtonElement;
    await act(async () => { png.click(); await flush(); });
    const img = container!.querySelector('img[data-testid="archive-preview-image"]') as HTMLImageElement;
    expect(img.src).toContain('/api/files/f1/archive/entry?i=4');
    expect(img.src).not.toContain('hero.png');
  });

  it('asks for the version the viewer is showing, in the index and in the entry', async () => {
    // Both archive routes accept ?version=N and answer with an hour of
    // private caching and no cache-buster. Leaving the version off listed and
    // opened the LATEST version's entries while the viewer showed an older
    // one, and kept serving a re-uploaded zip's old contents besides.
    apiMock.mockResolvedValue(INDEX);
    await render(zipFile(), 2);
    expect(apiMock.mock.calls[0]![0]).toBe('/api/files/f1/archive?version=2');

    const dir = container!.querySelector('[data-testid="archive-dir-assets"]') as HTMLButtonElement;
    await act(async () => { dir.click(); await flush(); });
    const png = container!.querySelector('[data-testid="archive-entry-4"]') as HTMLButtonElement;
    await act(async () => { png.click(); await flush(); });
    const img = container!.querySelector('img[data-testid="archive-preview-image"]') as HTMLImageElement;
    expect(img.src).toContain('i=4');
    expect(img.src).toContain('version=2');
  });

  it('omits the version entirely when the viewer is showing the current one', async () => {
    apiMock.mockResolvedValue(INDEX);
    await render(zipFile());
    expect(apiMock.mock.calls[0]![0]).toBe('/api/files/f1/archive');

    const dir = container!.querySelector('[data-testid="archive-dir-assets"]') as HTMLButtonElement;
    await act(async () => { dir.click(); await flush(); });
    const png = container!.querySelector('[data-testid="archive-entry-4"]') as HTMLButtonElement;
    await act(async () => { png.click(); await flush(); });
    const img = container!.querySelector('img[data-testid="archive-preview-image"]') as HTMLImageElement;
    expect(img.src).not.toContain('version=');
  });

  it('reports a damaged archive using the message the API sent', async () => {
    // Check ApiError's real constructor signature in src/api/client.ts before
    // writing this - if it does not take (status, body), build the rejection
    // the way the other component tests in src/components/ already do.
    const { ApiError } = await import('@/api/client');
    apiMock.mockRejectedValue(new ApiError(422, JSON.stringify({ error: 'not a zip archive (no end-of-central-directory record)' })));
    await render(zipFile());
    expect(container!.textContent).toContain('end-of-central-directory');
  });

  it('uses a neutral heading for a failure that is not about the archive being invalid', async () => {
    // A 403 (view-only, or any other request-level refusal) is not a claim
    // that the file is a bad zip - the invalid-zip heading is reserved for
    // the one status (422) that actually means that.
    const { ApiError } = await import('@/api/client');
    apiMock.mockRejectedValue(new ApiError(403, JSON.stringify({ error: 'no' })));
    await render(zipFile());
    expect(container!.textContent).not.toContain("isn't a valid zip");
    expect(container!.textContent).toContain('This archive could not be opened');
  });

  it('says an archive is too large to list, rather than blaming the file', async () => {
    // 413 is a valid archive the server declined to index. Falling back to the
    // generic heading is honest but withholds the one fact the user can act on.
    const { ApiError } = await import('@/api/client');
    apiMock.mockRejectedValue(new ApiError(413, JSON.stringify({
      error: 'central directory is 20000000 bytes, over the 16777216-byte limit. Download the file to browse its contents instead of listing them here.',
    })));
    await render(zipFile());
    const text = container!.textContent ?? '';
    expect(text).toContain('too large to list');
    expect(text).not.toContain("isn't a valid zip");
  });

  it('gives the filter field a visible focus indicator', async () => {
    // WCAG 2.4.7. The input carries `outline-none`, so without a ring on the
    // wrapper a keyboard user tabbing into the filter sees nothing change.
    apiMock.mockResolvedValue(INDEX);
    await render(zipFile());
    const label = container!.querySelector('label') as HTMLLabelElement;
    expect(label.className).toContain('focus-within:border-ring');
    expect(label.className).toContain('focus-within:ring-3');
  });

  it('exposes the entry list by name, not on a role-less div', async () => {
    // aria-label on an element with no role is dropped by assistive tech, so
    // the region was unnamed however carefully it was labelled.
    apiMock.mockResolvedValue(INDEX);
    await render(zipFile());
    const region = container!.querySelector('[aria-label="Archive contents"]') as HTMLElement;
    expect(region.getAttribute('role')).toBe('group');
  });

  it('does not answer a failure by repeating its own heading', async () => {
    // A plain Error carries no API message. Echoing the heading told the user
    // nothing twice; naming the transport at least says what to try.
    apiMock.mockRejectedValue(new Error('boom'));
    await render(zipFile());
    const text = container!.textContent ?? '';
    expect(text).toContain('This archive could not be opened');
    expect(text).toContain('Network error. Please try again.');
    expect(text.match(/This archive could not be opened/g)!.length).toBe(1);
  });

  it('teaches the empty state when every entry name neutralises away', async () => {
    // The count is non-zero and the tree is still empty: names made only of
    // control or bidi characters are dropped by archive-tree.ts. Keying the
    // empty state on totalEntries drew a blank list here.
    apiMock.mockResolvedValue({
      archiveSize: 40,
      totalEntries: 2,
      truncated: false,
      entries: [
        { i: 0, name: '\u0001\u0002', size: 1, csize: 1, method: 8, dir: false, encrypted: false, mtime: null },
        { i: 1, name: '\u202e\u200f', size: 1, csize: 1, method: 8, dir: false, encrypted: false, mtime: null },
      ],
    });
    await render(zipFile());
    expect(container!.textContent).toMatch(/nothing inside|empty/i);
  });

  it('says an archive was truncated rather than listing a silent prefix', async () => {
    apiMock.mockResolvedValue({ ...INDEX, truncated: true, totalEntries: 148302 });
    await render(zipFile());
    expect(container!.textContent).toMatch(/148,?302/);
  });

  it('teaches the empty archive instead of showing a blank pane', async () => {
    apiMock.mockResolvedValue({ archiveSize: 22, totalEntries: 0, truncated: false, entries: [] });
    await render(zipFile());
    expect(container!.textContent).toMatch(/nothing inside|empty/i);
  });

  it('will not fetch a text entry larger than the preview cap', async () => {
    apiMock.mockResolvedValue(BIG_TEXT_INDEX);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await render(zipFile());
    const row = container!.querySelector('[data-testid="archive-entry-5"]') as HTMLButtonElement;
    await act(async () => { row.click(); await flush(); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container!.textContent).toMatch(/too large/i);
  });

  it('says a text preview was cut rather than silently truncating it', async () => {
    apiMock.mockResolvedValue(SMALL_TEXT_INDEX);
    const longBody = 'x'.repeat(250_000);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(longBody, { status: 200 })));
    await render(zipFile());
    const row = container!.querySelector('[data-testid="archive-entry-6"]') as HTMLButtonElement;
    await act(async () => { row.click(); await flush(); });
    expect(container!.textContent).toMatch(/200,000/);
  });
});
