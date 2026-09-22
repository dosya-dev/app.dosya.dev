import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  ALL_COLUMNS, DEFAULT_VISIBLE, TABLE_COLUMNS_KEY, loadSavedColumns, libraryColumnsFor,
  takenAtOf, takenIsWallClock,
} from './file-columns';
import type { LibraryItem } from '@/lib/library-request';
import type { FileItem } from '@/lib/file-types';
import { useDateFormat, formatExactDateTime } from '@/lib/date-format';
import { timeAgo } from '@/lib/helpers';

function photo(id: string, taken_at = 0): LibraryItem {
  return {
    id, name: `${id}.jpg`, size_bytes: 1, mime_type: 'image/jpeg', extension: '.jpg', region: 'eu',
    created_at: taken_at, updated_at: taken_at, current_version: 1, lock_mode: 'none', is_hidden: 0,
    uploaded_by: 'u1', uploader_name: 'Me', share_count: 0, comment_count: 0, is_synced: 0,
    folder_id: null, taken_at,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('ALL_COLUMNS / DEFAULT_VISIBLE', () => {
  it('defaults name, size, created and origin visible', () => {
    expect([...DEFAULT_VISIBLE].sort()).toEqual(['created', 'name', 'origin', 'size'].sort());
  });

  // F2 (field report, Contract 5): the folder listing offers "Date taken" in
  // the column picker, hidden by default, so a photo folder can be ordered by
  // capture date rather than upload date.
  it('offers a hidden-by-default "Date taken" column', () => {
    const taken = ALL_COLUMNS.find((c) => c.key === 'taken')!;
    expect(taken).toBeDefined();
    expect(taken.label).toBe('Date taken');
    expect(taken.defaultVisible).toBe(false);
  });
});

describe('loadSavedColumns', () => {
  it('falls back to the defaults with nothing saved', () => {
    expect(loadSavedColumns()).toEqual(DEFAULT_VISIBLE);
  });

  it('round-trips a valid saved selection', () => {
    localStorage.setItem(TABLE_COLUMNS_KEY, JSON.stringify(['name', 'modified']));
    expect(loadSavedColumns()).toEqual(new Set(['name', 'modified']));
  });

  // F2 (field report): "taken" is a real folder-listing column now (sortable
  // per Contract 5), so a saved selection that includes it is honoured.
  it('honours a persisted "taken" key', () => {
    localStorage.setItem(TABLE_COLUMNS_KEY, JSON.stringify(['name', 'taken', 'size']));
    expect(loadSavedColumns()).toEqual(new Set(['name', 'taken', 'size']));
  });

  it('falls back to the defaults when every saved key is unknown', () => {
    localStorage.setItem(TABLE_COLUMNS_KEY, JSON.stringify(['bogus', 'nonsense']));
    expect(loadSavedColumns()).toEqual(DEFAULT_VISIBLE);
  });

  it('falls back to the defaults on garbage JSON', () => {
    localStorage.setItem(TABLE_COLUMNS_KEY, '{not json');
    expect(loadSavedColumns()).toEqual(DEFAULT_VISIBLE);
  });

  it('always includes "name", even in a saved selection that dropped it', () => {
    localStorage.setItem(TABLE_COLUMNS_KEY, JSON.stringify(['size', 'modified']));
    const columns = loadSavedColumns();
    expect(columns.has('name')).toBe(true);
    expect(columns).toEqual(new Set(['name', 'size', 'modified']));
  });
});

describe('libraryColumnsFor', () => {
  it('inserts "taken" immediately after "created", labelled "Date taken" for photos', () => {
    const columns = libraryColumnsFor('photos');
    const keys = columns.map((c) => c.key);
    const createdIdx = keys.indexOf('created');
    expect(keys[createdIdx + 1]).toBe('taken');
    const taken = columns.find((c) => c.key === 'taken')!;
    expect(taken.label).toBe('Date taken');
    expect(taken.defaultVisible).toBe(true);
  });

  it('labels the same column "Date created" for videos', () => {
    const columns = libraryColumnsFor('videos');
    const taken = columns.find((c) => c.key === 'taken')!;
    expect(taken.label).toBe('Date created');
  });

  it('labels the same column "Date created" for documents', () => {
    const columns = libraryColumnsFor('documents');
    const taken = columns.find((c) => c.key === 'taken')!;
    expect(taken.label).toBe('Date created');
  });


  it('keeps every other column, in the same order as ALL_COLUMNS (the listing\'s own "taken" swapped for the library one)', () => {
    const columns = libraryColumnsFor('photos');
    const withoutTaken = columns.filter((c) => c.key !== 'taken');
    expect(withoutTaken.map((c) => c.key)).toEqual(ALL_COLUMNS.filter((c) => c.key !== 'taken').map((c) => c.key));
    expect(columns.filter((c) => c.key === 'taken')).toHaveLength(1);
  });

  it('photos: keeps "created" ("Created"), with "taken" immediately after it', () => {
    const columns = libraryColumnsFor('photos');
    const keys = columns.map((c) => c.key);
    const created = columns.find((c) => c.key === 'created')!;
    expect(created.label).toBe('Created');
    expect(keys[keys.indexOf('created') + 1]).toBe('taken');
  });

  // The feed's created_at is COALESCE(source_created_at, created_at)
  // (display-time.ts), and taken_at resolves through the same expression for
  // videos and documents - so the two columns would show the identical
  // value. Rather than label one of them wrong, videos and documents drop
  // "created" and show "taken" in its place.
  for (const kind of ['videos', 'documents'] as const) {
    it(`${kind}: has no "created" column, with "taken" at the position "created" occupied (after "size")`, () => {
      const columns = libraryColumnsFor(kind);
      const keys = columns.map((c) => c.key);
      expect(keys).not.toContain('created');
      const sizeIdx = keys.indexOf('size');
      expect(keys[sizeIdx + 1]).toBe('taken');
    });

    it(`${kind}: keeps every other column, in the same order as ALL_COLUMNS`, () => {
      const columns = libraryColumnsFor(kind);
      const withoutTaken = columns.filter((c) => c.key !== 'taken');
      expect(withoutTaken.map((c) => c.key)).toEqual(ALL_COLUMNS.filter((c) => c.key !== 'created' && c.key !== 'taken').map((c) => c.key));
    });
  }

  it('leaves ALL_COLUMNS - the folder listing\'s own set - untouched', () => {
    const before = ALL_COLUMNS.map((c) => ({ ...c }));
    libraryColumnsFor('photos');
    libraryColumnsFor('videos');
    libraryColumnsFor('documents');
    expect(ALL_COLUMNS.map((c) => ({ ...c }))).toEqual(before);
    expect(ALL_COLUMNS.find((c) => c.key === 'created')!.label).toBe('Created');
  });

  it('photos: the created column still renders and sorts as before', () => {
    const created = libraryColumnsFor('photos').find((c) => c.key === 'created')!;
    const source = ALL_COLUMNS.find((c) => c.key === 'created')!;
    expect(created.key).toBe('created');
    expect(created.label).toBe(source.label);
    expect(created.defaultVisible).toBe(source.defaultVisible);
    expect(created.width).toBe(source.width);
    expect(created.render).toBe(source.render);
  });
});

// F1 (field report): every date cell carries the exact local date/time in its
// title, and the "Exact dates" preference swaps the relative label for the
// absolute string in the cell itself.
//
// Rendered into a real DOM root rather than renderToStaticMarkup: zustand's
// hook reads the store's INITIAL state under server rendering, so a static
// render could never observe the preference flipping.
describe('date cells', () => {
  const TS = 1718445600; // 2024-06-15T10:00:00Z
  const file = photo('d', TS);
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function renderCell(node: React.ReactNode): HTMLElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root!.render(<>{node}</>); });
    return container;
  }

  function cell(key: 'created' | 'modified', exact: boolean): HTMLElement {
    useDateFormat.setState({ exact });
    const col = ALL_COLUMNS.find((c) => c.key === key)!;
    return renderCell(col.render({ ...file, created_at: TS, updated_at: TS }));
  }

  it('relative mode: the created cell shows timeAgo and titles the exact date/time', () => {
    const el = cell('created', false);
    expect(el.textContent).toBe(timeAgo(TS));
    expect(el.querySelector('[title]')?.getAttribute('title')).toBe(formatExactDateTime(TS));
  });

  it('exact mode: the created and modified cells render the absolute string', () => {
    expect(cell('created', true).textContent).toBe(formatExactDateTime(TS));
    if (root) act(() => root!.unmount());
    container?.remove();
    expect(cell('modified', true).textContent).toBe(formatExactDateTime(TS));
  });

  it('folder date cells get the same title', () => {
    useDateFormat.setState({ exact: false });
    const col = ALL_COLUMNS.find((c) => c.key === 'created')!;
    const folder = {
      id: 'f', name: 'F', created_at: TS, updated_at: TS, file_count: 0, lock_mode: 'none', is_hidden: 0,
      hidden_mode: null, is_synced: 0, total_size_bytes: 0, content_updated_at: TS, region: null,
      uploader_name: null, share_count: 0, comment_count: 0, origin: null,
    } as unknown as Parameters<NonNullable<typeof col.renderFolder>>[0];
    const el = renderCell(col.renderFolder!(folder));
    expect(el.querySelector('[title]')?.getAttribute('title')).toBe(formatExactDateTime(TS));
  });

  it('renders a capture date in UTC, not the viewer\'s zone (the value is a wall clock)', () => {
    useDateFormat.setState({ exact: true });
    const col = ALL_COLUMNS.find((c) => c.key === 'taken')!;
    const capturedAt = '2024-06-30 23:00:00';
    const pseudoEpoch = Date.UTC(2024, 5, 30, 23, 0, 0) / 1000;
    const el = renderCell(col.render({ ...file, captured_at: capturedAt, created_at: pseudoEpoch }));
    expect(el.textContent).toBe(formatExactDateTime(pseudoEpoch, { wallClock: true }));
    // A row with no capture date is a real epoch and stays in local time.
    if (root) act(() => root!.unmount());
    container?.remove();
    const plain = renderCell(col.render({ ...file, captured_at: null, created_at: pseudoEpoch }));
    expect(plain.textContent).toBe(formatExactDateTime(pseudoEpoch));
  });

  // The library's primary-date column carries the title too - in UTC for
  // photos, whose taken_at is EXIF's wall clock (fix round 1, IMPORTANT 2),
  // and in the viewer's zone for the kinds whose taken_at is a real instant.
  it('the library "taken" column reads a photo in UTC in BOTH the cell and the title', () => {
    useDateFormat.setState({ exact: false });
    const taken = libraryColumnsFor('photos').find((c) => c.key === 'taken')!;
    // A capture at 23:00 UTC: the day differs between readings anywhere east
    // of Greenwich, which is what makes this assertion worth making.
    const boundary = Date.UTC(2024, 5, 30, 23, 0, 0) / 1000;
    const el = renderCell(taken.render(photo('a', boundary)));
    expect(el.querySelector('[title]')?.getAttribute('title')).toBe(formatExactDateTime(boundary, { wallClock: true }));
    // The cell text used to go through a viewer-zone timeAgo while the title
    // was in UTC, so the same tile could disagree with itself.
    expect(el.textContent).toBe(timeAgo(boundary, undefined, { utc: true }));
  });

  // Fix round 2, IMPORTANT: the library table and the tiles must not disagree
  // with each other, nor with the folder listing's own per-row logic.
  it('the library "taken" column follows the row\'s flag, not the kind', () => {
    useDateFormat.setState({ exact: true });
    const taken = libraryColumnsFor('photos').find((c) => c.key === 'taken')!;
    const noExif = { ...photo('a', TS), taken_is_wall_clock: false };
    const el = renderCell(taken.render(noExif));
    expect(el.textContent).toBe(formatExactDateTime(TS));

    if (root) act(() => root!.unmount());
    container?.remove();
    const exif = { ...photo('b', TS), taken_is_wall_clock: true };
    expect(renderCell(taken.render(exif)).textContent).toBe(formatExactDateTime(TS, { wallClock: true }));
  });

  it('the library "taken" column titles a video in the viewer\'s zone', () => {
    useDateFormat.setState({ exact: false });
    const taken = libraryColumnsFor('videos').find((c) => c.key === 'taken')!;
    const el = renderCell(taken.render(photo('a', TS)));
    expect(el.querySelector('[title]')?.getAttribute('title')).toBe(formatExactDateTime(TS));
  });
});

// Fix round 1, IMPORTANT 1: `captured_at` is a wall clock with no zone, and
// the server reads it as UTC (`strftime('%s', substr(captured_at,1,19))` in
// apps/api/src/lib/list-sort.ts). Parsing it as LOCAL here shifted the value
// by the viewer's offset, so in a folder mixing EXIF photos with plain files
// the Date taken column disagreed with the order it sorts in.
describe('takenAtOf', () => {
  const base = { id: 'f', name: 'a.jpg', created_at: 1_600_000_000 } as unknown as FileItem;

  it('reads captured_at as UTC, exactly like the server', () => {
    const f = { ...base, captured_at: '2024-06-30 23:00:00' };
    expect(takenAtOf(f)).toBe(Date.UTC(2024, 5, 30, 23, 0, 0) / 1000);
    expect(takenIsWallClock(f)).toBe(true);
  });

  it('accepts the ISO "T" spelling too', () => {
    expect(takenAtOf({ ...base, captured_at: '2024-06-30T23:00:00' }))
      .toBe(Date.UTC(2024, 5, 30, 23, 0, 0) / 1000);
  });

  it('ignores a trailing sub-second part the way substr(1,19) does', () => {
    expect(takenAtOf({ ...base, captured_at: '2024-06-30 23:00:00.500' }))
      .toBe(Date.UTC(2024, 5, 30, 23, 0, 0) / 1000);
  });

  it('falls back to created_at - a real epoch - when there is no capture date', () => {
    expect(takenAtOf(base)).toBe(1_600_000_000);
    expect(takenIsWallClock(base)).toBe(false);
    const garbage = { ...base, captured_at: 'not a date' };
    expect(takenAtOf(garbage)).toBe(1_600_000_000);
    expect(takenIsWallClock(garbage)).toBe(false);
  });
});
