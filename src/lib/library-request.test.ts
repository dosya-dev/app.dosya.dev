import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  libraryRequestPath, libraryQueryKey, mergeLibraryPages, formatItemDate, takenIsWallClockOf, LIBRARY_PAGE_SIZE,
  kindForFilter, sortOptionsFor, KIND_COPY, plural,
  defaultLayoutFor, loadLibraryLayouts, saveLibraryLayout, LIBRARY_LAYOUT_KEY,
  type LibraryPage, type LibraryItem,
} from './library-request';

beforeEach(() => {
  localStorage.clear();
});

function photo(id: string, taken_at = 0): LibraryItem {
  return {
    id, name: `${id}.jpg`, size_bytes: 1, mime_type: 'image/jpeg', extension: '.jpg', region: 'eu',
    created_at: taken_at, updated_at: taken_at, current_version: 1, lock_mode: 'none', is_hidden: 0,
    uploaded_by: 'u1', uploader_name: 'Me', share_count: 0, comment_count: 0, is_synced: 0,
    folder_id: null, taken_at,
  };
}

describe('libraryRequestPath', () => {
  it('builds the first-page path with the page size, sort and the viewer\'s tz offset', () => {
    expect(libraryRequestPath({ workspaceId: 'ws_1', kind: 'photos', sort: 'taken_desc', q: '' }, null, 180))
      .toBe(`/api/library?workspace_id=ws_1&kind=photos&limit=${LIBRARY_PAGE_SIZE}&sort=taken_desc&tz_offset=180`);
  });
  it('adds q and cursor only when present', () => {
    expect(libraryRequestPath({ workspaceId: 'ws_1', kind: 'photos', sort: 'taken_asc', q: 'ice land' }, 'abc', -240))
      .toBe(`/api/library?workspace_id=ws_1&kind=photos&limit=${LIBRARY_PAGE_SIZE}&sort=taken_asc&tz_offset=-240&q=ice+land&cursor=abc`);
  });
  // F2 (field report, Contract 4): months are grouped in the VIEWER's zone.
  // getTimezoneOffset() is minutes WEST of UTC (Istanbul = -180), the API
  // wants minutes EAST, hence the sign flip.
  it('defaults tz_offset to minutes east of UTC from the browser clock', () => {
    const expected = -new Date().getTimezoneOffset();
    const url = new URL(libraryRequestPath({ workspaceId: 'ws_1', kind: 'photos', sort: 'taken_desc', q: '' }, null), 'http://x');
    expect(url.searchParams.get('tz_offset')).toBe(String(expected));
  });
});

describe('libraryQueryKey', () => {
  it('changes with every input that changes the result set', () => {
    const a = libraryQueryKey({ workspaceId: 'ws_1', kind: 'photos', sort: 'taken_desc', q: '' });
    expect(a).toEqual(['library', 'ws_1', 'photos', 'taken_desc', '']);
    expect(libraryQueryKey({ workspaceId: 'ws_1', kind: 'photos', sort: 'taken_desc', q: 'x' })).not.toEqual(a);
  });
});

describe('mergeLibraryPages', () => {
  const page1: LibraryPage = {
    ok: true, total: 5, counts: { '2024-07': 2, '2024-06': 3 },
    months: [
      { key: '2024-07', label: 'July 2024', files: [photo('a', 7), photo('b', 6)] },
      { key: '2024-06', label: 'June 2024', files: [photo('c', 5)] },
    ],
    next_cursor: 'cur1', can_lock: true, can_hide: false,
  };
  const page2: LibraryPage = {
    ok: true,
    months: [{ key: '2024-06', label: 'June 2024', files: [photo('d', 4), photo('e', 3)] }],
    next_cursor: null,
  };

  it('returns an empty library for no pages', () => {
    expect(mergeLibraryPages([])).toEqual({ months: [], files: [], total: 0, loaded: 0, hasMore: false, canLock: false, canHide: false });
  });

  it('continues a month across pages instead of repeating it, keeping the first-page counts', () => {
    const lib = mergeLibraryPages([page1, page2]);
    expect(lib.months.map((m) => m.key)).toEqual(['2024-07', '2024-06']);
    expect(lib.months[1].files.map((f) => f.id)).toEqual(['c', 'd', 'e']);
    expect(lib.months[1].count).toBe(3);
    expect(lib.months[0].count).toBe(2);
    expect(lib.files.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(lib.total).toBe(5);
    expect(lib.loaded).toBe(5);
    expect(lib.hasMore).toBe(false);
    expect(lib.canLock).toBe(true);
  });

  it('keeps server count on a partially loaded month while files.length reflects what is loaded', () => {
    const lib = mergeLibraryPages([page1]);
    expect(lib.hasMore).toBe(true);
    expect(lib.loaded).toBe(3);
    expect(lib.months[1].count).toBe(3);
    expect(lib.months[1].files).toHaveLength(1);
  });

  it('drops a duplicate id that arrives twice', () => {
    const lib = mergeLibraryPages([page1, { ...page2, months: [{ key: '2024-06', label: 'June 2024', files: [photo('c', 5), photo('d', 4)] }] }]);
    expect(lib.files.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('formatItemDate', () => {
  it('renders a short day, month and year', () => {
    expect(formatItemDate(1718445600)).toBe('Jun 15, 2024');
  });

  // F1/F6 (field report): the caption is the viewer's local date in the
  // viewer's locale. A fixed 'en-US' ignored the browser locale entirely.
  it('formats a real epoch in the viewer\'s locale and time zone (no en-US, no UTC pin)', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString');
    formatItemDate(1718445600);
    expect(spy).toHaveBeenCalledTimes(1);
    const [locale, options] = spy.mock.calls[0] as [unknown, Intl.DateTimeFormatOptions | undefined];
    expect(locale).toBeUndefined();
    expect(options?.timeZone).toBeUndefined();
    spy.mockRestore();
  });

  // Fix round 1, IMPORTANT 2: a photo's taken_at is EXIF `captured_at`, a wall
  // clock with no zone, which the server reads as UTC and deliberately does
  // NOT shift into the viewer's zone when it builds the month key
  // (apps/api/src/pages/api/library/index.ts). Rendering it locally captioned
  // a 23:00 photo "Jul 1" under a "June" header. This is the ONE place UTC
  // formatting is right; the "drop the UTC literal" rule applies to real epoch
  // values, which is the default below.
  it('renders a wall-clock date in UTC, so the caption cannot contradict its month header', () => {
    const pseudoEpoch = Date.UTC(2024, 5, 30, 23, 0, 0) / 1000;
    expect(formatItemDate(pseudoEpoch, { wallClock: true }))
      .toBe(new Date(pseudoEpoch * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }));
    expect(formatItemDate(pseudoEpoch, { wallClock: true })).toContain('30');
  });

  it('renders the same instant locally without the flag - the two differ east or west of UTC', () => {
    const pseudoEpoch = Date.UTC(2024, 5, 30, 23, 0, 0) / 1000;
    expect(formatItemDate(pseudoEpoch))
      .toBe(new Date(pseudoEpoch * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
    // Guarded so the assertion is meaningful on a UTC machine as well.
    const offset = new Date(pseudoEpoch * 1000).getTimezoneOffset();
    if (offset < 0) {
      expect(formatItemDate(pseudoEpoch)).not.toBe(formatItemDate(pseudoEpoch, { wallClock: true }));
    } else {
      expect(formatItemDate(pseudoEpoch)).toBe(formatItemDate(pseudoEpoch, { wallClock: true }));
    }
  });
});

describe('kinds', () => {
  it('maps sidebar filters to kinds', () => {
    expect(kindForFilter('images')).toBe('photos');
    expect(kindForFilter('videos')).toBe('videos');
    expect(kindForFilter('documents')).toBe('documents');
    expect(kindForFilter('')).toBeNull();
    expect(kindForFilter('deleted')).toBeNull();
  });
  it('labels the primary date per kind', () => {
    expect(sortOptionsFor('photos').map((o) => o.label)).toEqual(['Date taken · newest', 'Date taken · oldest', 'Date uploaded · newest']);
    expect(sortOptionsFor('videos').map((o) => o.label)).toEqual(['Date created · newest', 'Date created · oldest', 'Date uploaded · newest']);
    expect(sortOptionsFor('documents')[0].value).toBe('taken_desc');
  });
  it('carries kind-specific copy', () => {
    expect(KIND_COPY.videos.title).toBe('Videos');
    expect(KIND_COPY.documents.searchPlaceholder).toBe('Search documents...');
    expect(KIND_COPY.photos.emptyTitle).toBe('No photos yet');
    expect(plural('documents', 1)).toBe('1 document');
    expect(plural('videos', 23)).toBe('23 videos');
  });
  it('puts kind in the request path', () => {
    expect(libraryRequestPath({ workspaceId: 'ws_1', kind: 'documents', sort: 'taken_desc', q: '' }, null, 0))
      .toBe(`/api/library?workspace_id=ws_1&kind=documents&limit=${LIBRARY_PAGE_SIZE}&sort=taken_desc&tz_offset=0`);
  });
});

describe('library layout preference', () => {
  it('defaults documents to list and photos/videos to grid', () => {
    expect(defaultLayoutFor('documents')).toBe('list');
    expect(defaultLayoutFor('photos')).toBe('grid');
    expect(defaultLayoutFor('videos')).toBe('grid');
  });

  it('loadLibraryLayouts falls back to the per-kind defaults with nothing saved', () => {
    expect(loadLibraryLayouts()).toEqual({ photos: 'grid', videos: 'grid', documents: 'list' });
  });

  it('saveLibraryLayout round-trips through loadLibraryLayouts', () => {
    saveLibraryLayout('photos', 'list');
    expect(loadLibraryLayouts()).toEqual({ photos: 'list', videos: 'grid', documents: 'list' });
  });

  it('saveLibraryLayout read-merge-writes: setting one kind never disturbs another', () => {
    saveLibraryLayout('photos', 'list');
    saveLibraryLayout('videos', 'list');
    expect(loadLibraryLayouts()).toEqual({ photos: 'list', videos: 'list', documents: 'list' });
  });

  it('falls back to the defaults on garbage JSON without throwing', () => {
    localStorage.setItem(LIBRARY_LAYOUT_KEY, '{not json');
    expect(loadLibraryLayouts()).toEqual({ photos: 'grid', videos: 'grid', documents: 'list' });
  });

  it('ignores an unknown kind and an invalid layout value in the saved JSON', () => {
    localStorage.setItem(LIBRARY_LAYOUT_KEY, JSON.stringify({ photos: 'list', bogus_kind: 'grid', videos: 'sideways' }));
    expect(loadLibraryLayouts()).toEqual({ photos: 'list', videos: 'grid', documents: 'list' });
  });

  it('falls back to the defaults when the saved JSON parses to null', () => {
    localStorage.setItem(LIBRARY_LAYOUT_KEY, 'null');
    expect(loadLibraryLayouts()).toEqual({ photos: 'grid', videos: 'grid', documents: 'list' });
  });

  it('falls back to the defaults when the saved JSON parses to an array', () => {
    localStorage.setItem(LIBRARY_LAYOUT_KEY, '[]');
    expect(loadLibraryLayouts()).toEqual({ photos: 'grid', videos: 'grid', documents: 'list' });
  });

  it('saveLibraryLayout swallows a storage write failure instead of throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      expect(() => saveLibraryLayout('photos', 'list')).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

// Fix round 2, IMPORTANT: `taken_at` is COALESCE(captured_at, source_created_at,
// created_at), so "is this a wall clock?" is a property of the ROW, not of the
// kind. A screenshot or a stripped PNG is a photo with no EXIF: its taken_at is
// a real epoch, and rendering it in UTC put it on the wrong side of midnight -
// the inverse of the bug the last round fixed. The server now says which it is
// (`taken_is_wall_clock`, Group E).
describe('takenIsWallClockOf', () => {
  const row = (over: Partial<LibraryItem>) => ({ id: 'a', taken_at: 0, ...over } as LibraryItem);

  it('believes the server flag over the kind, in both directions', () => {
    expect(takenIsWallClockOf(row({ taken_is_wall_clock: true }), 'photos')).toBe(true);
    // A photo with no EXIF: real epoch, so local formatting.
    expect(takenIsWallClockOf(row({ taken_is_wall_clock: false }), 'photos')).toBe(false);
    // A video row could only ever be a real epoch, but the flag still rules.
    expect(takenIsWallClockOf(row({ taken_is_wall_clock: true }), 'videos')).toBe(true);
    expect(takenIsWallClockOf(row({ taken_is_wall_clock: false }), 'videos')).toBe(false);
  });

  // `sort=uploaded_desc` returns the UPLOAD epoch as taken_at for every row, so
  // the server sends the flag false even for a photo that has EXIF. Keying on
  // the kind here - "it is a photo, so UTC" - would render that photo's upload
  // time shifted by the viewer's offset. Key on the flag, only ever the flag.
  it('renders an EXIF photo locally under sort=uploaded_desc, because the row says so', () => {
    const exifPhotoSortedByUpload = row({ taken_is_wall_clock: false, taken_at: 1_719_788_400 });
    expect(takenIsWallClockOf(exifPhotoSortedByUpload, 'photos')).toBe(false);
  });

  // The contract says a JSON boolean. A server that ever regressed to SQLite's
  // 1/0 would still be read correctly rather than sending every row down the
  // "flag absent" path, where 0 would have meant "photo, so UTC".
  it('reads a 1/0 flag as the boolean it stands for', () => {
    expect(takenIsWallClockOf(row({ taken_is_wall_clock: 1 as unknown as boolean }), 'videos')).toBe(true);
    expect(takenIsWallClockOf(row({ taken_is_wall_clock: 0 as unknown as boolean }), 'photos')).toBe(false);
  });

  it('falls back to the per-kind guess when an older server omits the flag', () => {
    expect(takenIsWallClockOf(row({}), 'photos')).toBe(true);
    expect(takenIsWallClockOf(row({}), 'videos')).toBe(false);
    expect(takenIsWallClockOf(row({}), 'documents')).toBe(false);
  });
});
