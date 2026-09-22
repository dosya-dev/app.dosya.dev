/**
 * Folder and multi-select ZIP downloads.
 *
 * The archive is streamed by the API; the browser's own download machinery is
 * the only thing that can write a multi-gigabyte stream to disk without
 * holding it in memory. The page therefore NAVIGATES to the archive URL
 * instead of fetching it into a Blob, which pinned the whole archive in tab
 * memory and showed nothing in the downloads shelf until the last byte
 * arrived. Auth rides on the session cookie: it is SameSite=Lax and this is a
 * top-level GET, so the browser sends it to the API origin.
 *
 * A very large SELECTION (not a large archive) does not fit in a URL: the
 * library view accumulates pages by infinite scroll, so "Select all" can name
 * thousands of ids, and past MAX_GET_IDS the query string exceeds the ~16 KB
 * request line servers and proxies accept. Those are SPLIT into successive
 * downloads of at most MAX_GET_IDS ids each - several ZIPs, each streamed.
 * Posting the whole selection and buffering the response would be one file,
 * but it would put up to 5 GiB (the endpoint's own cap) back into this tab,
 * which is the failure all of this exists to avoid.
 */
import { API_BASE } from '@/api/client';

export interface ArchiveSelection {
  fileIds?: string[];
  folderIds?: string[];
}

/**
 * Ids per request line. A dosya id is ~21 characters plus a separator, so 300
 * of them is roughly 6.6 KB of query string - comfortably inside the ~16 KB
 * every mainstream server accepts (nginx's default `large_client_header_buffers`
 * is 8 KB per buffer), with room for the origin and the rest of the URL.
 */
export const MAX_GET_IDS = 300;

/**
 * How many downloads one action may start. Twenty ZIPs is already a lot to ask
 * of someone; beyond that the honest answer is "download the folder instead",
 * which is one request for any number of files.
 */
export const MAX_CHUNKS = 20;

const ARCHIVE_PATH = '/api/files/download-archive';

export function archiveDownloadUrl(base: string, sel: ArchiveSelection): string {
  const params = new URLSearchParams();
  if (sel.fileIds && sel.fileIds.length > 0) params.set('file_ids', sel.fileIds.join(','));
  if (sel.folderIds && sel.folderIds.length > 0) params.set('folder_ids', sel.folderIds.join(','));
  return `${base}${ARCHIVE_PATH}?${params}`;
}

/**
 * Split a selection into URL-sized pieces. Folders and files are only mixed in
 * a single chunk that holds everything; past that they are chunked separately,
 * so a part is either "some folders" or "some files" and each ZIP has an
 * obvious shape.
 */
export function chunkSelection(sel: ArchiveSelection, size: number): Required<ArchiveSelection>[] {
  const fileIds = sel.fileIds ?? [];
  const folderIds = sel.folderIds ?? [];
  if (fileIds.length + folderIds.length === 0) return [];
  // Exported, so the argument is not ours to trust: a size of 0 (or a NaN, or
  // a fraction) sliced nothing per pass and looped until the tab died.
  const step = Number.isFinite(size) ? Math.max(1, Math.floor(size)) : 1;
  if (fileIds.length + folderIds.length <= step) return [{ folderIds, fileIds }];

  const chunks: Required<ArchiveSelection>[] = [];
  for (let i = 0; i < folderIds.length; i += step) {
    chunks.push({ folderIds: folderIds.slice(i, i + step), fileIds: [] });
  }
  for (let i = 0; i < fileIds.length; i += step) {
    chunks.push({ folderIds: [], fileIds: fileIds.slice(i, i + step) });
  }
  return chunks;
}

export interface ArchiveDownloadOptions {
  base?: string;
  /** Test seam for the download mechanism. */
  navigate?: (url: string) => void;
  /** Called with a sentence when the selection is refused. */
  onError?: (message: string) => void;
}

/** `parts` is how many downloads were started; 0 means the selection was refused. */
export async function startArchiveDownload(
  sel: ArchiveSelection,
  opts: ArchiveDownloadOptions = {},
): Promise<{ parts: number }> {
  const base = opts.base ?? API_BASE;
  const chunks = chunkSelection(sel, MAX_GET_IDS);
  if (chunks.length === 0) return { parts: 0 };

  if (chunks.length > MAX_CHUNKS) {
    // The ceiling is a number of DOWNLOADS, not of ids: folders and files
    // chunk separately, so one folder plus 5,999 files is 6,000 ids but 21
    // parts. Quoting an id count would have described a limit this selection
    // obeys while being refused anyway.
    opts.onError?.(
      `That selection would need ${chunks.length} separate downloads, and ${MAX_CHUNKS} is the most `
      + 'one action will start. Select fewer items and download the rest after.',
    );
    return { parts: 0 };
  }

  const urls = chunks.map((chunk) => archiveDownloadUrl(base, chunk));

  // One part opens a tab, so the API's own refusal (an empty folder answers
  // 400) is visible where the user is looking. Several parts go through hidden
  // frames instead: a popup blocker stops every window.open after the first,
  // and twenty tabs would be hostile even if it did not.
  if (opts.navigate) {
    for (const url of urls) opts.navigate(url);
    return { parts: urls.length };
  }
  if (urls.length === 1) {
    openInTab(urls[0]);
    return { parts: 1 };
  }

  // Deliberately NOT awaited: the caller says "arriving as N ZIPs" straight
  // away, and the parts report themselves as they settle, seconds later.
  void runPartsInFrames(urls, opts.onError);
  return { parts: urls.length };
}

/**
 * Interval between part starts. Behind an HTTP/1.1 proxy the browser only
 * holds six connections per origin, so firing twenty requests at once buries
 * the last ones in a queue; spacing the starts keeps that queue short enough
 * that no part is still waiting when its own frame is cleaned up.
 */
export const PART_STAGGER_MS = 400;

/**
 * How long a part is given to turn into a download before it is treated as
 * started. A real download fires no `load` event at all - the browser converts
 * the navigation into a save - so silence is the success signal here.
 */
export const PART_SETTLE_MS = 4000;

/**
 * Run the parts in hidden frames and report the ones that did not become
 * downloads.
 *
 * `load` means the server answered with something the browser RENDERED - an
 * error page, a JSON refusal - rather than an attachment, so it is the failure
 * signal; `error` is a navigation that did not happen at all. A part of 300
 * folder ids can expand to arbitrarily many files and trip the endpoint's own
 * 5 GiB / 10,000-entry caps, so this is a case that happens rather than a
 * theoretical one. Without it the page had already promised every ZIP was on
 * its way while some of them silently never started.
 */
function runPartsInFrames(urls: string[], onError?: (message: string) => void): Promise<void> {
  return Promise.all(urls.map((url, index) => new Promise<boolean>((resolve) => {
    const start = () => {
      const frame = document.createElement('iframe');
      frame.hidden = true;
      let settled = false;
      let settleTimer = 0;
      const finish = (started: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(settleTimer);
        // Removing the frame does not cancel a download the browser has
        // already taken over; it only tidies the DOM.
        frame.remove();
        resolve(started);
      };
      frame.addEventListener('load', () => finish(false));
      frame.addEventListener('error', () => finish(false));
      settleTimer = window.setTimeout(() => finish(true), PART_SETTLE_MS);
      document.body.appendChild(frame);
      frame.src = url;
    };
    // The first part goes now, inside the click that asked for it; the rest
    // are spaced out behind it.
    if (index === 0) start();
    else window.setTimeout(start, index * PART_STAGGER_MS);
  }))).then((started) => {
    const failed = started.filter((ok) => !ok).length;
    if (failed === 0) return;
    onError?.(
      `${urls.length - failed} of ${urls.length} downloads started. ${failed} could not be prepared - `
      + 'a part may cover more than the server will archive at once. Select fewer items and try those again.',
    );
  });
}

/**
 * Same shape the single-file Download action uses (`window.open(..., '_blank')`
 * in files.tsx): an `attachment` response closes the new tab straight into the
 * downloads shelf, and a refusal shows there rather than replacing the app
 * itself, which `location.assign` would do. Popup blockers only interfere when
 * the call is not inside a user gesture; if one does, the tab itself navigates.
 */
function openInTab(url: string): void {
  const tab = window.open(url, '_blank', 'noopener');
  if (!tab) window.location.assign(url);
}
