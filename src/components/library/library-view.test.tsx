import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { MonthGroup, LibraryItem } from '@/lib/library-request';
import type { ColumnDef } from '@/lib/file-columns';

// The thumbnail component hits /thumb and /raw; a stub keeps this test about layout.
vi.mock('@/components/file-preview-image', () => ({
  FilePreviewImage: ({ fileName }: { fileName: string }) => <img alt={fileName} data-testid="thumb" />,
}));

const { LibraryView } = await import('./library-view');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function photo(id: string, over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id, name: `${id}.jpg`, size_bytes: 1, mime_type: 'image/jpeg', extension: '.jpg', region: 'eu',
    created_at: 1, updated_at: 1, current_version: 1, lock_mode: 'none', is_hidden: 0,
    uploaded_by: 'u1', uploader_name: 'Me', share_count: 0, comment_count: 0, is_synced: 0,
    folder_id: null, taken_at: 1718445600, ...over,
  };
}

const MONTHS: MonthGroup[] = [
  { key: '2024-07', label: 'July 2024', count: 23, files: [photo('a'), photo('b')] },
  { key: '2024-06', label: 'June 2024', count: 2, files: [photo('c'), photo('d', { lock_mode: 'full_lock' })] },
];

function baseProps(over: Partial<React.ComponentProps<typeof LibraryView>> = {}): React.ComponentProps<typeof LibraryView> {
  return {
    months: MONTHS, total: 25, loaded: 4, hasMore: true, isLoading: false, isLoadingMore: false, error: null,
    search: '', selected: new Set(), favourites: new Set(), unlockedFiles: new Map(), activeId: null,
    kind: 'photos', tileSize: 'small', layout: 'grid', columns: [], uploadHref: '/uploads',
    onLoadMore: vi.fn(), onRetry: vi.fn(), onOpen: vi.fn(), onToggleSelect: vi.fn(), onSelectMany: vi.fn(),
    onFavourite: vi.fn(), onContextMenu: vi.fn(),
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
});

function render(props: React.ComponentProps<typeof LibraryView>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<MemoryRouter><LibraryView {...props} /></MemoryRouter>); });
  return container;
}

/**
 * The instant to test a date boundary with, east or west of UTC: 23:30 UTC for
 * a viewer ahead of UTC (local date is already tomorrow), 00:30 UTC for one
 * behind it (local date is still yesterday). On a UTC machine the two agree
 * and every assertion below still holds, trivially.
 */
function boundaryInstant(): number {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const d = offsetMinutes >= 0 ? Date.UTC(2024, 5, 30, 23, 30) : Date.UTC(2024, 5, 30, 0, 30);
  return d / 1000;
}

/** How the server keys the month: wall clocks unshifted, real epochs shifted into the viewer's zone. */
function serverMonthLabel(takenAt: number, isWallClock: boolean): string {
  const tzSeconds = -new Date().getTimezoneOffset() * 60;
  const keyed = new Date((takenAt + (isWallClock ? 0 : tzSeconds)) * 1000);
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(keyed);
}

/** The month the caption puts the photo in. */
function captionMonth(takenAt: number, isWallClock: boolean): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', year: 'numeric', ...(isWallClock ? { timeZone: 'UTC' } : {}),
  }).format(new Date(takenAt * 1000));
}

describe('LibraryView', () => {

  // Fix round 2, IMPORTANT: keying UTC formatting on `kind === 'photos'` broke
  // the photos that have no EXIF - a screenshot's taken_at is a real epoch, and
  // the server groups it in the viewer's zone. Both rows must caption inside
  // the month header they are printed under.
  it.each([
    ['an EXIF photo (wall clock)', true],
    ['a photo with no EXIF (real epoch)', false],
  ])('captions %s inside its own month header', (_label, isWallClock) => {
    const takenAt = boundaryInstant();
    const c = render(baseProps({
      kind: 'photos',
      months: [{
        key: 'k', label: serverMonthLabel(takenAt, isWallClock), count: 1,
        files: [photo('x', { taken_at: takenAt, taken_is_wall_clock: isWallClock })],
      }],
    }));
    // The caption's month is the header's month, whichever side of midnight
    // the viewer's zone puts this instant on.
    expect(captionMonth(takenAt, isWallClock)).toBe(serverMonthLabel(takenAt, isWallClock));
    expect(c.textContent).toContain(
      new Date(takenAt * 1000).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric', ...(isWallClock ? { timeZone: 'UTC' } : {}),
      }),
    );
  });

  // Fix round 1, IMPORTANT 2: a photo's taken_at is a wall clock read as UTC,
  // and the month header it sits under is built from that same unshifted
  // value server-side. Captioning it in the viewer's zone put a 23:00 photo
  // on "Jul 1" underneath a "June 2024" header.
  it('captions a photo with its capture date, not the viewer-local shift of it', () => {
    const wallClock = Date.UTC(2024, 5, 30, 23, 0, 0) / 1000;
    const c = render(baseProps({
      kind: 'photos',
      months: [{ key: '2024-06', label: 'June 2024', count: 1, files: [photo('late', { taken_at: wallClock })] }],
    }));
    const utc = new Date(wallClock * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    expect(c.textContent).toContain(utc);
  });

  // Videos and documents carry no EXIF: their taken_at is a real epoch
  // (source date, else upload), so it stays in the viewer's own zone.
  it('captions a video in the viewer\'s own zone', () => {
    const epoch = Date.UTC(2024, 5, 30, 23, 0, 0) / 1000;
    const c = render(baseProps({
      kind: 'videos',
      months: [{ key: '2024-06', label: 'June 2024', count: 1, files: [photo('vid', { taken_at: epoch })] }],
    }));
    const local = new Date(epoch * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    expect(c.textContent).toContain(local);
  });

  it('renders a header per month with the full count and a partial-load note', () => {
    const c = render(baseProps());
    expect(c.textContent).toContain('July 2024');
    expect(c.textContent).toContain('23 photos');
    expect(c.textContent).toContain('2 loaded');
    expect(c.textContent).toContain('June 2024');
    expect(c.textContent).toContain('2 photos');
    expect(c.querySelectorAll('[data-testid="thumb"]')).toHaveLength(3); // the locked tile shows no thumbnail
  });

  // The same rule at the rendering layer: under sort=uploaded_desc every row's
  // taken_at is the upload instant, flagged false, and must read in the
  // viewer's own zone even though the kind is photos.
  it('captions an EXIF photo locally when the feed is sorted by upload date', () => {
    const takenAt = boundaryInstant();
    const c = render(baseProps({
      kind: 'photos',
      months: [{
        key: 'k', label: serverMonthLabel(takenAt, false), count: 1,
        files: [photo('uploaded', { taken_at: takenAt, taken_is_wall_clock: false })],
      }],
    }));
    expect(c.textContent).toContain(
      new Date(takenAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    );
    // And NOT the UTC reading of the same instant, which is a different day here.
    const utc = new Date(takenAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const local = new Date(takenAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    if (utc !== local) expect(c.textContent).not.toContain(utc);
  });

  it('shows progress and calls onLoadMore from the button', () => {
    const props = baseProps();
    const c = render(props);
    expect(c.textContent).toContain('Showing 4 of 25 photos');
    const btn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Load'))!;
    expect(btn.textContent).toContain('Load 21 more');
    act(() => { btn.click(); });
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('says "That\'s all" when there is nothing more to load', () => {
    const c = render(baseProps({ hasMore: false, loaded: 25 }));
    expect(c.textContent).toContain("That's all 25 photos");
    expect(Array.from(c.querySelectorAll('button')).some((b) => b.textContent?.includes('Load'))).toBe(false);
  });

  it('opens a photo on click and toggles selection when a selection exists', () => {
    const props = baseProps();
    const c = render(props);
    act(() => { (c.querySelector('[data-testid="photo-a"]') as HTMLElement).click(); });
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    const withSel = baseProps({ selected: new Set(['b']) });
    const c2 = render(withSel);
    act(() => { (c2.querySelector('[data-testid="photo-a"]') as HTMLElement).click(); });
    expect(withSel.onToggleSelect).toHaveBeenCalledWith('a');
  });

  it('renders the empty state with an upload link, and a search-specific empty state', () => {
    const c = render(baseProps({ months: [], total: 0, loaded: 0, hasMore: false }));
    expect(c.textContent).toContain('No photos yet');
    expect(c.querySelector('a[href="/uploads"]')).not.toBeNull();
    const c2 = render(baseProps({ months: [], total: 0, loaded: 0, hasMore: false, search: 'iceland' }));
    expect(c2.textContent).toContain('No photos match "iceland"');
  });

  it('renders an error panel with Retry', () => {
    const props = baseProps({ months: [], error: 'Boom' });
    const c = render(props);
    expect(c.textContent).toContain('Boom');
    const btn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Try again'))!;
    act(() => { btn.click(); });
    expect(props.onRetry).toHaveBeenCalled();
  });
});

describe('LibraryView kinds', () => {
  it('renders videos as cards with a play mark, format pill, name and size', () => {
    const c = render(baseProps({ kind: 'videos', months: [{ key: '2024-07', label: 'July 2024', count: 2, files: [photo('v1', { name: 'trip.mp4', size_bytes: 184_000_000, mime_type: 'video/mp4', extension: '.mp4' }), photo('v2', { name: 'clip.mov', size_bytes: 96_000_000, mime_type: 'video/quicktime', extension: '.mov', lock_mode: 'full_lock' })] }], total: 2, loaded: 2, hasMore: false }));
    expect(c.textContent).toContain('2 videos');
    const card = c.querySelector('[data-testid="video-v1"]')!;
    expect(card.getAttribute('data-kind')).toBe('video');
    expect(card.textContent).toContain('trip.mp4');
    expect(card.textContent).toContain('MP4');
    expect(card.textContent).toMatch(/MB/);
    expect(card.querySelector('[data-testid="play"]')).not.toBeNull();
    const locked = c.querySelector('[data-testid="video-v2"]')!;
    expect(locked.querySelector('[data-testid="play"]')).toBeNull();
    expect(locked.querySelector('[data-testid="lock"]')).not.toBeNull();
    expect(c.querySelectorAll('[data-testid="thumb"]')).toHaveLength(0);
    expect(c.textContent).toContain("That's all 2 videos");
  });

  it('renders documents as tiles with icon, ext pill, name, size and date', () => {
    const c = render(baseProps({ kind: 'documents', months: [{ key: '2024-07', label: 'July 2024', count: 14, files: [photo('d1', { name: 'lease.pdf', size_bytes: 2_100_000, mime_type: 'application/pdf', extension: '.pdf' })] }], total: 14, loaded: 1, hasMore: true }));
    expect(c.textContent).toContain('14 documents');
    expect(c.textContent).toContain('1 loaded');
    const tile = c.querySelector('[data-testid="document-d1"]')!;
    expect(tile.getAttribute('data-kind')).toBe('document');
    expect(tile.querySelector('img')!.getAttribute('src')).toContain('/file-icons/');
    expect(tile.textContent).toContain('lease.pdf');
    expect(tile.textContent).toContain('PDF');
    expect(tile.textContent).toContain('MB');
    expect(tile.textContent).toContain('Jun 15, 2024');
    // Tiles, not rows: no thumbnail request, and no table header in grid layout.
    expect(c.querySelectorAll('[data-testid="thumb"]')).toHaveLength(0);
    expect(c.querySelector('[data-testid="library-table-header"]')).toBeNull();
    expect(c.textContent).toContain('Showing 1 of 14 documents');
    expect(c.textContent).toContain('Load 13 more');
  });

  it('gives a document tile the same select, favourite and open behaviour as a video card', () => {
    const props = baseProps({ kind: 'documents', months: [{ key: '2024-07', label: 'July 2024', count: 2, files: [photo('d1', { name: 'a.pdf' }), photo('d2', { name: 'b.pdf', lock_mode: 'full_lock' })] }], total: 2, loaded: 2, hasMore: false });
    const c = render(props);
    const tile = c.querySelector('[data-testid="document-d1"]') as HTMLElement;
    expect(tile.querySelector('[data-slot="checkbox"]')).not.toBeNull();
    act(() => { tile.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    expect(props.onToggleSelect).toHaveBeenCalledWith('d1');
    act(() => { tile.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
    expect(props.onToggleSelect).toHaveBeenCalledTimes(2);
    const star = Array.from(tile.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Add to favourites')!;
    act(() => { star.click(); });
    expect(props.onFavourite).toHaveBeenCalledWith('d1');
    // A fully locked document keeps its lock mark and loses the checkbox.
    const locked = c.querySelector('[data-testid="document-d2"]')!;
    expect(locked.querySelector('[data-slot="checkbox"]')).toBeNull();
    expect(locked.querySelector('[data-testid="lock"]')).not.toBeNull();
  });

  it('uses the kind copy for the empty state and opens on click for every kind', () => {
    const c = render(baseProps({ kind: 'videos', months: [], total: 0, loaded: 0, hasMore: false }));
    expect(c.textContent).toContain('No videos yet');
    const props = baseProps({ kind: 'documents', months: [{ key: '2024-07', label: 'July 2024', count: 1, files: [photo('d1', { name: 'a.pdf' })] }], total: 1, loaded: 1, hasMore: false });
    const c2 = render(props);
    act(() => { (c2.querySelector('[data-testid="document-d1"]') as HTMLElement).click(); });
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
  });
});

// The fixture stands in for libraryColumnsFor(kind) (covered in
// file-columns.test.tsx). The cell output is deliberately distinctive so a
// row proves the text came from the column def, not from the row's own markup.
const COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', defaultVisible: true, width: 'flex-1 min-w-40', render: () => null },
  { key: 'size', label: 'Size', defaultVisible: true, width: 'w-20', render: (f) => `size:${f.size_bytes}` },
  { key: 'taken', label: 'Date taken', defaultVisible: true, width: 'w-24', render: (f) => `taken:${(f as LibraryItem).taken_at}` },
];

function listProps(over: Partial<React.ComponentProps<typeof LibraryView>> = {}): React.ComponentProps<typeof LibraryView> {
  return baseProps({ layout: 'list', columns: COLUMNS, ...over });
}

describe('LibraryView list layout', () => {
  it('renders one table header above the months, with the column labels and no sort buttons', () => {
    const c = render(listProps());
    const headers = c.querySelectorAll('[data-testid="library-table-header"]');
    expect(headers).toHaveLength(1);
    // A plain div: there is no table/grid/rowgroup ancestor, so role="row" here would be invalid ARIA.
    expect(headers[0].getAttribute('role')).toBeNull();
    expect(headers[0].getAttribute('title')).toBe("Rows follow the sort menu's date order");
    expect(headers[0].textContent).toContain('Name');
    expect(headers[0].textContent).toContain('Size');
    expect(headers[0].textContent).toContain('Date taken');
    expect(headers[0].querySelectorAll('button')).toHaveLength(0);
  });

  it('paints no header when there are no columns to label', () => {
    const c = render(listProps({ columns: [] }));
    expect(c.querySelector('[data-testid="library-table-header"]')).toBeNull();
    expect(c.querySelectorAll('[data-testid^="library-row-"]')).toHaveLength(4);
  });

  it('renders a row per item with the column cells, and no tiles, for every kind', () => {
    for (const [kind, singular] of [['photos', 'photo'], ['videos', 'video'], ['documents', 'document']] as const) {
      const c = render(listProps({ kind }));
      expect(c.querySelectorAll('[data-testid^="library-row-"]')).toHaveLength(4);
      const row = c.querySelector('[data-testid="library-row-a"]')!;
      expect(row.getAttribute('role')).toBe('button');
      expect(row.getAttribute('tabindex')).toBe('0');
      expect(row.getAttribute('aria-label')).toBe('a.jpg');
      expect(row.getAttribute('data-kind')).toBe(singular);
      expect(row.textContent).toContain('a.jpg');
      expect(row.textContent).toContain('size:1');
      expect(row.textContent).toContain('taken:1718445600');
      expect(c.querySelector('[data-testid="photo-a"]')).toBeNull();
      expect(c.querySelector('[data-testid="video-a"]')).toBeNull();
      expect(c.querySelector('[data-testid="document-a"]')).toBeNull();
      // The month headers and their select-all survive the layout switch.
      expect(c.textContent).toContain('July 2024');
      expect(c.textContent).toContain('Select 2 loaded');
    }
  });

  it('shows a thumbnail for photos and videos, and the file icon for documents and locked items', () => {
    const c = render(listProps());
    expect(c.querySelectorAll('[data-testid="thumb"]')).toHaveLength(3); // the locked row falls back to the icon
    const docs = render(listProps({ kind: 'documents' }));
    expect(docs.querySelectorAll('[data-testid="thumb"]')).toHaveLength(0);
    expect(docs.querySelectorAll('[data-testid="library-row-a"] img')).toHaveLength(1);
  });

  it('opens a row on click, toggles with a modifier or an existing selection, and follows the keyboard rules', () => {
    const props = listProps();
    const c = render(props);
    const row = c.querySelector('[data-testid="library-row-a"]') as HTMLElement;
    act(() => { row.click(); });
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    act(() => { row.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
    expect(props.onToggleSelect).toHaveBeenCalledWith('a');
    act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(props.onOpen).toHaveBeenCalledTimes(2);
    act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    expect(props.onToggleSelect).toHaveBeenCalledTimes(2);
    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); });
    expect(props.onContextMenu).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'a' }));

    const withSel = listProps({ selected: new Set(['b']) });
    const c2 = render(withSel);
    act(() => { (c2.querySelector('[data-testid="library-row-a"]') as HTMLElement).click(); });
    expect(withSel.onToggleSelect).toHaveBeenCalledWith('a');
    expect(withSel.onOpen).not.toHaveBeenCalled();
  });

  it('drops the checkbox on a locked row and ignores Space there', () => {
    const props = listProps();
    const c = render(props);
    expect(c.querySelector('[data-testid="library-row-a"] [data-slot="checkbox"]')).not.toBeNull();
    const locked = c.querySelector('[data-testid="library-row-d"]') as HTMLElement;
    expect(locked.querySelector('[data-slot="checkbox"]')).toBeNull();
    act(() => { locked.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    expect(props.onToggleSelect).not.toHaveBeenCalled();
    act(() => { locked.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'd' }));
  });

  it('keeps the skeleton count on first load and while loading more', () => {
    const c = render(listProps({ months: [], isLoading: true }));
    expect(c.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(18);
    expect(c.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="library-table-header"]')).toBeNull();
    const more = render(listProps({ isLoadingMore: true }));
    expect(more.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(21); // total 25 - 4 loaded
  });
});
