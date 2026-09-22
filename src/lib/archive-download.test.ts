import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  archiveDownloadUrl, startArchiveDownload, chunkSelection,
  MAX_GET_IDS, MAX_CHUNKS, PART_STAGGER_MS, PART_SETTLE_MS,
} from './archive-download';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const frames = () => [...document.body.querySelectorAll('iframe')];
const ids = (n: number, prefix = 'file') => Array.from({ length: n }, (_, i) => `${prefix}_${i}`);

// F4 (field report): a folder ZIP used to be fetched into memory as a Blob
// before the browser was handed an object URL - a 4 GB folder was 4 GB of
// tab memory, and nothing appeared in the downloads shelf until the whole
// archive had arrived. The stream now goes straight to the browser's own
// download machinery by navigating to the archive URL (cookie-authed; the
// session cookie is SameSite=Lax and this is a top-level GET, so it rides
// along).
describe('archiveDownloadUrl', () => {
  it('names the selected folders and files in the query string', () => {
    expect(archiveDownloadUrl('https://api.dosya.dev', { folderIds: ['fld_1'] }))
      .toBe('https://api.dosya.dev/api/files/download-archive?folder_ids=fld_1');
    expect(archiveDownloadUrl('', { fileIds: ['a', 'b'], folderIds: ['c'] }))
      .toBe('/api/files/download-archive?file_ids=a%2Cb&folder_ids=c');
  });

  it('omits empty selections', () => {
    expect(archiveDownloadUrl('', { fileIds: [], folderIds: ['c'] }))
      .toBe('/api/files/download-archive?folder_ids=c');
  });
});

describe('startArchiveDownload', () => {
  it('navigates to the archive URL rather than fetching it', async () => {
    const navigate = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await startArchiveDownload({ folderIds: ['fld_1'] }, { base: 'https://api.dosya.dev', navigate });
    expect(navigate).toHaveBeenCalledWith('https://api.dosya.dev/api/files/download-archive?folder_ids=fld_1');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does nothing for an empty selection', async () => {
    const navigate = vi.fn();
    await startArchiveDownload({}, { base: '', navigate });
    expect(navigate).not.toHaveBeenCalled();
  });

  // Fix round 2, MINOR 1: the buffered POST fallback this replaced could still
  // pull multiple gigabytes into tab memory (the endpoint caps at 5 GiB), which
  // is the exact failure the streaming fix existed to remove. A selection too
  // long for one URL is split into successive streamed downloads instead - the
  // archive never passes through this tab either way.
  it('splits a selection too long for one URL into successive streamed downloads', async () => {
    const navigate = vi.fn();
    const fetchMock = vi.fn();
    const createObjectURL = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
    const fileIds = Array.from({ length: MAX_GET_IDS + 5 }, (_, i) => `file_${i}`);

    const { parts } = await startArchiveDownload({ fileIds }, { base: '', navigate });

    expect(parts).toBe(2);
    expect(navigate).toHaveBeenCalledTimes(2);
    // Nothing is buffered: the archive never passes through this tab.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();

    const requested = navigate.mock.calls.flatMap(([url]) => {
      const params = new URL(url as string, 'http://x').searchParams;
      const ids = (params.get('file_ids') ?? '').split(',').filter(Boolean);
      expect(ids.length).toBeLessThanOrEqual(MAX_GET_IDS);
      return ids;
    });
    // Every id downloaded exactly once, in order.
    expect(requested).toEqual(fileIds);
  });

  it('reports one part for a selection that fits in a single URL', async () => {
    const navigate = vi.fn();
    const { parts } = await startArchiveDownload({ folderIds: ['fld_1'] }, { base: '', navigate });
    expect(parts).toBe(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('refuses, with a sentence, a selection too large even to chunk', async () => {
    const navigate = vi.fn();
    const onError = vi.fn();

    const { parts } = await startArchiveDownload({ fileIds: ids(MAX_GET_IDS * MAX_CHUNKS + 1) }, { base: '', navigate, onError });

    expect(parts).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    // Fix round 3, MINOR 2: the sentence names the number of downloads the
    // selection would need and the ceiling on those - the two facts that
    // actually decided the refusal.
    const message = onError.mock.calls[0][0] as string;
    expect(message).toContain(String(MAX_CHUNKS + 1));
    expect(message).toContain(String(MAX_CHUNKS));
  });

  // Folders and files chunk separately, so the ceiling is a number of
  // DOWNLOADS, not of ids: one folder plus 5,999 files is 6,000 ids but 21
  // parts. The old message promised "up to 6000", which this selection obeys
  // and is refused anyway, and told the user to "download the folder itself" -
  // meaningless for a library Select-all that spans many folders.
  it('refuses a mixed selection on the part count, and says so without pointing at "the folder"', async () => {
    const onError = vi.fn();
    const navigate = vi.fn();

    const { parts } = await startArchiveDownload(
      { folderIds: ['fld_1'], fileIds: ids(MAX_GET_IDS * MAX_CHUNKS - 1) },
      { base: '', navigate, onError },
    );

    expect(parts).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
    const message = onError.mock.calls[0][0] as string;
    expect(message).toContain('21');
    expect(message).not.toContain('download the folder itself');
  });
});

describe('chunkSelection', () => {
  it('keeps folders and files together up to the cap and preserves order', () => {
    const chunks = chunkSelection({ fileIds: ['f1', 'f2', 'f3'], folderIds: ['d1', 'd2'] }, 2);
    expect(chunks).toEqual([
      { folderIds: ['d1', 'd2'], fileIds: [] },
      { folderIds: [], fileIds: ['f1', 'f2'] },
      { folderIds: [], fileIds: ['f3'] },
    ]);
  });

  it('returns a single chunk when everything fits', () => {
    expect(chunkSelection({ fileIds: ['f1'], folderIds: ['d1'] }, 300))
      .toEqual([{ folderIds: ['d1'], fileIds: ['f1'] }]);
  });

  it('is empty for an empty selection', () => {
    expect(chunkSelection({}, 300)).toEqual([]);
  });

  // Fix round 3, MINOR 3: exported, so a caller can pass anything. A size of 0
  // used to slice zero ids per pass and loop until the tab died.
  it('never loops forever on a nonsense size', () => {
    for (const size of [0, -5, 0.4, Number.NaN]) {
      const chunks = chunkSelection({ fileIds: ['f1', 'f2', 'f3'] }, size);
      expect(chunks.flatMap((c) => c.fileIds), `size ${size}`).toEqual(['f1', 'f2', 'f3']);
      for (const c of chunks) expect(c.fileIds.length + c.folderIds.length).toBe(1);
    }
  });
});

// Fix round 3, IMPORTANT: a multi-part download runs in hidden frames, and a
// frame that gets a 400/401/5xx used to fail in total silence while the page
// had already promised the ZIPs were on the way. A download never fires
// `load` - the browser turns the navigation into a save - so a `load` IS the
// failure signal: it means the server sent something the browser rendered
// instead. (jsdom loads no resources, so these tests fire the events the
// browser would.)
describe('multi-part downloads report what failed', () => {
  const manyIds = ids(MAX_GET_IDS * 5);

  it('starts the parts staggered rather than all at once', async () => {
    vi.useFakeTimers();
    const { parts } = await startArchiveDownload({ fileIds: manyIds }, { base: '' });
    expect(parts).toBe(5);

    // Only the first part is in flight; the rest are still queued.
    expect(frames()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PART_STAGGER_MS);
    expect(frames()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(PART_STAGGER_MS * 3);
    expect(frames()).toHaveLength(5);
  });

  it('reports a mid-sequence failure through onError, naming how many started', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();

    const { parts } = await startArchiveDownload({ fileIds: manyIds }, { base: '', onError });
    expect(parts).toBe(5);
    await vi.advanceTimersByTimeAsync(PART_STAGGER_MS * 4);
    expect(frames()).toHaveLength(5);

    // Part 3 comes back as a rendered error page rather than a download.
    frames()[2].dispatchEvent(new Event('load'));
    // Nothing is claimed until every part has had its say.
    expect(onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PART_SETTLE_MS);
    expect(onError).toHaveBeenCalledTimes(1);
    const message = onError.mock.calls[0][0] as string;
    expect(message).toContain('4 of 5');
    expect(message).toContain('1');
  });

  it('counts an errored frame as a failed part too', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    await startArchiveDownload({ fileIds: manyIds }, { base: '', onError });
    await vi.advanceTimersByTimeAsync(PART_STAGGER_MS * 4);

    // The first dispatch fails part 1 and removes its frame, so the SECOND
    // dispatch lands on what is now the first remaining frame - part 2. Two
    // failed parts, and a removed frame that cannot be counted twice.
    frames()[0].dispatchEvent(new Event('error'));
    frames()[0].dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(PART_SETTLE_MS);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain('3 of 5');
  });

  it('says nothing when every part started', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    await startArchiveDownload({ fileIds: manyIds }, { base: '', onError });
    await vi.advanceTimersByTimeAsync(PART_STAGGER_MS * 4 + PART_SETTLE_MS);
    expect(onError).not.toHaveBeenCalled();
  });

  // Fix round 3, MINOR 1: removal used to be one fixed 60s timer from the
  // first part, which behind an HTTP/1.1 proxy (six connections) could tear
  // down a part still queued. Each frame is now removed on its OWN settle,
  // and a failed one goes immediately.
  it('removes each frame on its own timeline, and a failed one at once', async () => {
    vi.useFakeTimers();
    await startArchiveDownload({ fileIds: manyIds }, { base: '' });
    await vi.advanceTimersByTimeAsync(PART_STAGGER_MS * 4);
    expect(frames()).toHaveLength(5);

    frames()[4].dispatchEvent(new Event('load'));
    expect(frames()).toHaveLength(4);

    // The first part settles first, because it started first.
    await vi.advanceTimersByTimeAsync(PART_SETTLE_MS - PART_STAGGER_MS * 4);
    expect(frames()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(PART_STAGGER_MS * 4);
    expect(frames()).toHaveLength(0);
  });
});
