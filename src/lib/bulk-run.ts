/**
 * Run a per-item async task across a selection with bounded concurrency.
 *
 * Bulk actions used to `await` one request per item in a `for` loop, so moving
 * 50 files meant 50 round trips end to end and the UI sat still for the sum of
 * them. Unbounded `Promise.all` is not the answer either - a 500-item
 * selection would open 500 sockets and trip rate limiting - so this keeps a
 * fixed number in flight.
 *
 * A rejected task is counted, never thrown: bulk actions report "N done, M
 * failed" rather than dying on the first error.
 */

export interface BulkResult<R> {
  ok: number;
  fail: number;
  /** Per-input results in input order; `null` where the task rejected. */
  results: (R | null)[];
}

/** How many requests a bulk action keeps in flight by default. */
export const BULK_CONCURRENCY = 6;

export interface BulkOptions {
  /** Called after each item settles (success or failure); skipped items don't fire it. */
  onItemDone?: () => void;
  /**
   * Polled before each item starts. Once it returns true no further items are
   * started; items already in flight run to completion. Skipped items are
   * counted in neither `ok` nor `fail` and stay `null` in `results`.
   */
  shouldStop?: () => boolean;
}

export async function runBulk<T, R>(
  items: readonly T[],
  task: (item: T, index: number) => Promise<R>,
  limit: number = BULK_CONCURRENCY,
  opts: BulkOptions = {},
): Promise<BulkResult<R>> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let ok = 0;
  let fail = 0;
  if (items.length === 0) return { ok, fail, results };

  const width = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (opts.shouldStop?.()) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await task(items[i], i);
        ok++;
      } catch {
        fail++;
      }
      opts.onItemDone?.();
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return { ok, fail, results };
}

export interface SelectionChunk {
  file_ids: string[];
  folder_ids: string[];
}

/**
 * Split a mixed file/folder selection into batch-delete payloads of at most
 * `size` combined ids. One batch-delete request per chunk is what turns the
 * soft-delete progress bar from a guess into a count - a single request over
 * 100 folders has no observable progress.
 */
export function chunkSelection(fileIds: readonly string[], folderIds: readonly string[], size: number): SelectionChunk[] {
  const all = [
    ...fileIds.map((id) => ({ id, folder: false })),
    ...folderIds.map((id) => ({ id, folder: true })),
  ];
  const step = Math.max(1, size);
  const chunks: SelectionChunk[] = [];
  for (let i = 0; i < all.length; i += step) {
    const slice = all.slice(i, i + step);
    chunks.push({
      file_ids: slice.filter((s) => !s.folder).map((s) => s.id),
      folder_ids: slice.filter((s) => s.folder).map((s) => s.id),
    });
  }
  return chunks;
}
