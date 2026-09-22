// Pinned east of UTC (UTC+3). The other library tests derive their expectations
// from the machine's own zone, which makes them pass trivially on a UTC runner;
// these two files fix a zone so the wall-clock and real-epoch cases genuinely
// differ and the assertions have something to catch.
process.env.TZ = 'Asia/Istanbul';

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { LibraryItem } from '@/lib/library-request';

vi.mock('@/components/file-preview-image', () => ({
  FilePreviewImage: ({ fileName }: { fileName: string }) => <img alt={fileName} data-testid="thumb" />,
}));

const { LibraryView } = await import('./library-view');

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
});

/** 2024-06-30T23:00:00Z: still June in UTC, already July in Istanbul. */
const LATE_JUNE_UTC = Date.UTC(2024, 5, 30, 23, 0, 0) / 1000;

const fmt = (zone?: string) => new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', ...(zone ? { timeZone: zone } : {}),
}).format(new Date(LATE_JUNE_UTC * 1000));

function render(item: Partial<LibraryItem>) {
  const file = {
    id: 'p', name: 'p.jpg', size_bytes: 1, mime_type: 'image/jpeg', extension: '.jpg', region: 'eu',
    created_at: 1, updated_at: 1, current_version: 1, lock_mode: 'none', is_hidden: 0,
    uploaded_by: 'u1', uploader_name: 'Me', share_count: 0, comment_count: 0, is_synced: 0,
    folder_id: null, taken_at: LATE_JUNE_UTC, ...item,
  } as LibraryItem;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <LibraryView
          months={[{ key: '2024-06', label: 'June 2024', count: 1, files: [file] }]}
          total={1} loaded={1} hasMore={false} isLoading={false} isLoadingMore={false} error={null}
          search="" selected={new Set()} favourites={new Set()} unlockedFiles={new Map()} activeId={null}
          kind="photos" tileSize="small" layout="grid" columns={[]} uploadHref="/uploads"
          onLoadMore={vi.fn()} onRetry={vi.fn()} onOpen={vi.fn()} onToggleSelect={vi.fn()}
          onSelectMany={vi.fn()} onFavourite={vi.fn()} onContextMenu={vi.fn()}
        />
      </MemoryRouter>,
    );
  });
  return container;
}

describe('LibraryView captions at UTC+3', () => {
  it('the two readings really do differ here, so the assertions below mean something', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Istanbul');
    expect(fmt('UTC')).not.toBe(fmt());
  });

  it('captions an EXIF photo with the camera\'s own date (June), matching its June header', () => {
    const c = render({ taken_is_wall_clock: true });
    expect(c.textContent).toContain(fmt('UTC'));
    expect(c.textContent).not.toContain(fmt());
  });

  it('captions a photo with no EXIF in the viewer\'s zone (July), matching the header the server built the same way', () => {
    const c = render({ taken_is_wall_clock: false });
    expect(c.textContent).toContain(fmt());
    expect(c.textContent).not.toContain(fmt('UTC'));
  });
});
