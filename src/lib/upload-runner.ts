import { API_BASE } from '@/api/client';
import { useUploads } from '@/stores/uploads';
import { createScheduler } from '@/lib/upload-scheduler';
import { getUserConcurrency, effectiveConcurrency } from '@/lib/upload-concurrency';
import type { UploadInput, UploadItem } from '@/lib/upload-types';

// File bytes live only here - never in the store or localStorage.
const fileMap = new Map<string, File>();
// In-flight XHRs per item, so cancel() can abort them. A multipart upload runs
// several parts at once, so one item can own more than one XHR at a time.
const activeXhr = new Map<string, Set<XMLHttpRequest>>();

/** Parts in flight per file. Peak memory is roughly this times part_size. */
export const PART_CONCURRENCY = 4;

function trackXhr(id: string, xhr: XMLHttpRequest): void {
  let set = activeXhr.get(id);
  if (!set) {
    set = new Set();
    activeXhr.set(id, set);
  }
  set.add(xhr);
}

function untrackXhr(id: string, xhr: XMLHttpRequest): void {
  const set = activeXhr.get(id);
  if (!set) return;
  set.delete(xhr);
  if (set.size === 0) activeXhr.delete(id);
}
// Bounded auto-retry counter for server concurrency-limit rejections.
const concurrencyRetries = new Map<string, number>();
// Ids the user canceled - checked after every await so an in-flight async step
// (init/status/complete fetch, or the gap between parts) can't resurrect a
// canceled upload by overwriting its status.
const canceledIds = new Set<string>();
// Ids temporarily held out of the queue during concurrency-limit backoff.
const heldIds = new Set<string>();
// Workspace max_concurrent_uploads (0 = unlimited); set by the Uploads page.
let wsCap = 0;

export function setWorkspaceCap(cap: number | null | undefined): void {
  wsCap = cap ?? 0;
}

/** Part numbers (1-based) in [1..totalParts] that are not yet uploaded. */
export function missingPartNumbers(totalParts: number, uploaded: number[]): number[] {
  const done = new Set(uploaded);
  const out: number[] = [];
  for (let n = 1; n <= totalParts; n++) if (!done.has(n)) out.push(n);
  return out;
}

/** Total byte size of the given part numbers, honouring a short final part. */
export function bytesForParts(parts: number[], partSize: number, fileSize: number): number {
  return parts.reduce((sum, n) => {
    const start = (n - 1) * partSize;
    return sum + Math.max(0, Math.min(start + partSize, fileSize) - start);
  }, 0);
}

/**
 * Byte accounting for one multipart upload.
 *
 * Parts run concurrently and each XHR only ever knows its own progress, so the
 * item's total is the sum of three things: bytes already stored server-side
 * from a previous run, the exact size of parts this run has finished, and the
 * latest in-flight `loaded` of the parts still going. Reporting any one part's
 * absolute offset (what the serial version did) would make parallel parts
 * overwrite each other and send progress backwards.
 */
export class PartBytes {
  private done = 0;
  private live = new Map<number, number>();

  constructor(private readonly resumed: number) {}

  /** Record a part's latest in-flight byte count; returns the new total. */
  onProgress(part: number, loaded: number): number {
    this.live.set(part, loaded);
    return this.total();
  }

  /** Retire a finished part at its exact size; returns the new total. */
  onComplete(part: number, size: number): number {
    this.live.delete(part);
    this.done += size;
    return this.total();
  }

  total(): number {
    let sum = this.resumed + this.done;
    for (const loaded of this.live.values()) sum += loaded;
    return sum;
  }
}

/**
 * Run `items` through `run` with at most `limit` in flight.
 *
 * After the first failure no further items are started, and the error is
 * rethrown once the already-running ones settle - so a failed part can't leave
 * siblings racing on in the background. `shouldStop` lets a cancel short-circuit
 * the queue without being an error in its own right.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let cursor = 0;
  let failure: unknown = null;
  const worker = async (): Promise<void> => {
    while (cursor < items.length && !failure && !shouldStop()) {
      const item = items[cursor++];
      try {
        await run(item);
      } catch (err) {
        failure ??= err;
      }
    }
  };
  const workers = Math.max(0, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (failure) throw failure;
}

const store = () => useUploads.getState();
const getItem = (id: string): UploadItem | undefined => store().items.find((x) => x.id === id);

/**
 * Mark an item done and tell the rest of the app a file landed. Pages that
 * show file listings (Files, Dashboard) listen for this instead of polling -
 * uploads run in the background, so the page that started one is often no
 * longer the page that needs refreshing.
 */
function markComplete(id: string, patch: Partial<UploadItem>): void {
  store().patchItem(id, { status: 'complete', progress: 100, ...patch });
  window.dispatchEvent(new Event('dosya:upload-complete'));
  void enrolInGroup(getItem(id));
}

/**
 * Uploads started from a group view still land in a real folder - a group is a
 * flat, folder-spanning collection, not a parent. Without this the file was
 * stored correctly but never appeared in the group the user uploaded it to, so
 * a completed upload looked like a lost one (a refresh didn't help, because the
 * file genuinely wasn't in the group).
 *
 * Best-effort: the file is already safely stored, so a failure here must not
 * turn a successful upload into a failed one.
 */
async function enrolInGroup(item: UploadItem | undefined): Promise<void> {
  if (!item?.group_id || !item.fileId) return;
  try {
    await fetch(`${API_BASE}/api/groups/${item.group_id}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: item.fileId }),
    });
    window.dispatchEvent(new Event('dosya:groups-changed'));
    // Re-announce completion so the files listing invalidates AGAIN, now that
    // the file is actually a member. markComplete fires upload-complete before
    // awaiting this, so the first invalidation refetched a group that did not
    // contain the file yet - without this the upload still looked lost in the
    // very view it was started from, which is the bug being fixed.
    window.dispatchEvent(new Event('dosya:upload-complete'));
  } catch { /* file is stored either way; it just won't be listed in the group */ }
}

function newId(i: number): string {
  return `up_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
}

// Smoothed upload speed (bytes/sec) per item - transient, never persisted.
const speedSamples = new Map<string, { bytes: number; time: number; ema: number }>();

function reportBytes(id: string, bytes: number, total: number): void {
  const now = Date.now();
  const prev = speedSamples.get(id);
  // Parts upload concurrently now, so this is called several times more often
  // than when they were serial - and patchItem writes localStorage every time.
  // Coalesce to ~1 update per 250ms per item. The wider sampling interval also
  // steadies the EMA rather than degrading it.
  if (prev && now - prev.time < 250) return;
  let ema = prev?.ema ?? 0;
  if (prev) {
    const dt = now - prev.time;
    const db = bytes - prev.bytes;
    if (dt > 0 && db >= 0) {
      const inst = (db / dt) * 1000; // bytes per second over this interval
      ema = ema > 0 ? ema * 0.6 + inst * 0.4 : inst; // exponential moving average
    }
  }
  speedSamples.set(id, { bytes, time: now, ema });
  store().patchItem(id, {
    bytesUploaded: bytes,
    progress: total > 0 ? Math.min(100, Math.round((bytes / total) * 100)) : 0,
    speedBps: ema,
  });
}

// PUT with progress + abort. `onLoaded` gets the bytes sent so far for THIS
// request only - aggregating across parallel parts is the caller's job.
function xhrPut(
  id: string, url: string, body: Blob, contentType: string,
  onLoaded: (loaded: number) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    trackXhr(id, xhr);
    xhr.open('PUT', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', contentType);
    let lastTick = 0;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const now = Date.now();
      if (now - lastTick < 300) return;
      lastTick = now;
      onLoaded(e.loaded);
    };
    xhr.onload = () => {
      untrackXhr(id, xhr);
      try {
        const d = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && d.ok) resolve(d);
        else reject(new Error(d.error ?? `HTTP ${xhr.status}`));
      } catch { reject(new Error(`HTTP ${xhr.status}`)); }
    };
    xhr.onerror = () => { untrackXhr(id, xhr); reject(new Error('Network error')); };
    xhr.onabort = () => { untrackXhr(id, xhr); reject(new DOMException('Aborted', 'AbortError')); };
    xhr.send(body);
  });
}

async function initSession(item: UploadItem): Promise<any> {
  const res = await fetch(`${API_BASE}/api/upload/init`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: item.workspace_id, folder_id: item.folder_id,
      file_name: item.fileName, file_size: item.fileSize,
      mime_type: item.mimeType,
      // Sending '' would be validated against the workspace's available_regions
      // and rejected - omit it entirely so the server picks the default.
      ...(item.region ? { region: item.region } : {}),
      // Only present for version uploads; the server treats a null file_id as
      // "create a new file", which is the normal path.
      file_id: item.file_id ?? null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error ?? `Init failed (HTTP ${res.status})`);
  return data;
}

async function uploadParts(
  id: string, file: File, sessionId: string, partSize: number, totalParts: number,
): Promise<void> {
  store().patchItem(id, { part_size: partSize, total_parts: totalParts });
  const already = getItem(id)?.uploaded_parts ?? [];
  const queue = missingPartNumbers(totalParts, already);
  const bytes = new PartBytes(bytesForParts(already, partSize, file.size));

  async function sendPart(n: number): Promise<void> {
    const start = (n - 1) * partSize;
    const chunk = file.slice(start, Math.min(start + partSize, file.size));
    await xhrPut(id, `${API_BASE}/api/upload/${sessionId}/part/${n}`,
      chunk, 'application/octet-stream',
      (loaded) => reportBytes(id, bytes.onProgress(n, loaded), file.size));
    // Read-then-patch, with no await between the two statements: concurrent
    // parts cannot interleave here, so no append can lose another's.
    const uploaded = [...(getItem(id)?.uploaded_parts ?? []), n];
    const total = bytes.onComplete(n, chunk.size);
    store().patchItem(id, {
      uploaded_parts: uploaded, bytesUploaded: total,
      progress: Math.min(100, Math.round((total / file.size) * 100)),
    });
  }

  // The server creates the R2 multipart upload lazily, on the first part it
  // receives, deriving a fresh file id and r2_key in the process. Parts racing
  // that path each create their own MPU under their own key; COALESCE keeps one
  // of each and the losers' etags are unusable at complete time. So the first
  // part of a fresh session goes alone, and the rest fan out only once
  // r2_upload_id is persisted. A resumed session already has one and can fan
  // out immediately. Same reasoning as apps/cli/src/multipart.ts.
  if (already.length === 0 && queue.length > 0) {
    await sendPart(queue.shift()!);
    if (bailIfCanceled(id)) return;
  }

  await runPool(queue, PART_CONCURRENCY, sendPart, () => canceledIds.has(id));
  if (bailIfCanceled(id)) return;
  const res = await fetch(`${API_BASE}/api/upload/${sessionId}/complete`, {
    method: 'POST', credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error ?? `Complete failed (HTTP ${res.status})`);
  if (bailIfCanceled(id)) return;
  markComplete(id, { bytesUploaded: file.size, fileId: data?.file?.id });
}

async function resumeParts(id: string, file: File, sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/upload/${sessionId}/status`, { credentials: 'include' });
  const s = await res.json().catch(() => ({}));
  if (!res.ok || !s.ok) throw new Error(s.error ?? 'Could not read upload status');
  if (bailIfCanceled(id)) return;
  if (s.status === 'complete') {
    markComplete(id, { bytesUploaded: file.size });
    return;
  }
  store().patchItem(id, {
    uploaded_parts: s.uploaded_parts ?? [],
    bytesUploaded: s.bytes_uploaded ?? 0,
  });
  await uploadParts(id, file, sessionId, s.part_size, s.total_parts);
}

function handleError(id: string, err: unknown): void {
  if (err instanceof DOMException && err.name === 'AbortError') {
    store().patchItem(id, { status: 'canceled' });
    return;
  }
  store().patchItem(id, {
    status: 'error',
    error: err instanceof Error ? err.message : 'Upload failed',
  });
}

// The server rejects init when the workspace's max_concurrent_uploads is
// already saturated (e.g. other tabs). Recognise that message so we can wait
// and retry instead of surfacing it as a hard error.
function isConcurrencyLimit(err: unknown): boolean {
  const m = err instanceof Error ? err.message.toLowerCase() : '';
  return m.includes('uploads in progress');
}

// If the item was canceled during an await, finalize it as canceled and stop.
function bailIfCanceled(id: string): boolean {
  if (!canceledIds.has(id)) return false;
  canceledIds.delete(id);
  store().patchItem(id, { status: 'canceled', speedBps: 0 });
  fileMap.delete(id);
  speedSamples.delete(id);
  return true;
}

async function runOne(id: string): Promise<void> {
  const file = fileMap.get(id);
  const item = getItem(id);
  if (!file || !item) return;
  if (bailIfCanceled(id)) return;
  store().patchItem(id, { status: 'uploading', error: undefined }); // leaves the queued set synchronously
  try {
    const resuming = !!item.session_id && !!item.total_parts;
    if (resuming) {
      await resumeParts(id, file, item.session_id!);
    } else {
      const init = await initSession(item);
      if (bailIfCanceled(id)) return;
      store().patchItem(id, { session_id: init.session_id });
      if (init.resumable) {
        await uploadParts(id, file, init.session_id, init.resumable.part_size, init.resumable.total_parts);
      } else {
        const putRes = await xhrPut(id, `${API_BASE}${init.upload_url}`, file,
          file.type || 'application/octet-stream',
          (loaded) => reportBytes(id, loaded, file.size));
        if (bailIfCanceled(id)) return;
        markComplete(id, { bytesUploaded: file.size, fileId: putRes?.file?.id });
      }
    }
  } catch (err) {
    if (canceledIds.has(id)) {
      // Canceled mid-transfer (e.g. XHR abort) - finalize as canceled, not error.
      canceledIds.delete(id);
      store().patchItem(id, { status: 'canceled' });
    } else if (isConcurrencyLimit(err) && (concurrencyRetries.get(id) ?? 0) < 5) {
      // Real backoff: hold the id OUT of the queue for 3s, then requeue. Setting
      // 'queued' alone would be re-picked immediately by the scheduler's
      // post-settle pump(), defeating the delay.
      concurrencyRetries.set(id, (concurrencyRetries.get(id) ?? 0) + 1);
      heldIds.add(id);
      store().patchItem(id, { status: 'queued', error: undefined });
      setTimeout(() => { heldIds.delete(id); scheduler.wake(); }, 3000);
    } else {
      handleError(id, err);
    }
  } finally {
    if (getItem(id)?.status === 'complete') {
      fileMap.delete(id);
      concurrencyRetries.delete(id);
      speedSamples.delete(id);
    }
    updateUnloadGuard();
  }
}

const scheduler = createScheduler({
  getQueuedIds: () => store().items.filter((i) => i.status === 'queued' && !heldIds.has(i.id)).map((i) => i.id),
  getConcurrency: () => effectiveConcurrency(getUserConcurrency(), wsCap),
  runOne,
});

export function enqueue(files: File[] | FileList, input: UploadInput): void {
  const items: UploadItem[] = Array.from(files).map((file, i) => {
    const id = newId(i);
    fileMap.set(id, file);
    return {
      id, session_id: null, fileName: file.name, fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      workspace_id: input.workspace_id, folder_id: input.folder_id,
      // '' means "no explicit choice" - initSession omits it so the server
      // falls back to the workspace default. Call sites without a region
      // picker (Files drag-and-drop, version upload) rely on this.
      region: input.region ?? '',
      file_id: input.file_id ?? null,
      group_id: input.group_id ?? null,
      status: 'queued', progress: 0, bytesUploaded: 0,
      part_size: null, total_parts: null, uploaded_parts: [],
    };
  });
  store().addItems(items);
  updateUnloadGuard();
  scheduler.wake();
}

export function cancel(id: string): void {
  canceledIds.add(id);
  heldIds.delete(id);
  const xhrs = activeXhr.get(id);
  // Abort every in-flight part, not just one - a multipart upload has several.
  // Each abort triggers onabort → AbortError → status 'canceled'.
  if (xhrs?.size) for (const xhr of Array.from(xhrs)) xhr.abort();
  else store().patchItem(id, { status: 'canceled', speedBps: 0 });
  fileMap.delete(id);
  speedSamples.delete(id);
  updateUnloadGuard();
}

/** Abort every in-flight upload - used by logout so no XHR outlives the session. */
export function cancelAll(): void {
  for (const id of Array.from(activeXhr.keys())) cancel(id);
}

/** Retry an errored item whose File is still in memory (no re-pick needed). */
export function retry(id: string): void {
  const item = getItem(id);
  if (!item || !fileMap.has(id)) return;
  canceledIds.delete(id);
  concurrencyRetries.delete(id);
  store().patchItem(id, { status: 'queued', error: undefined });
  updateUnloadGuard();
  scheduler.wake();
}

/** Retry a failed upload in a different region - starts a fresh session. */
export function retryInRegion(id: string, region: string): void {
  const item = getItem(id);
  if (!item || !fileMap.has(id)) return;
  canceledIds.delete(id);
  concurrencyRetries.delete(id);
  speedSamples.delete(id);
  store().patchItem(id, {
    region,
    status: 'queued',
    error: undefined,
    session_id: null,
    part_size: null,
    total_parts: null,
    uploaded_parts: [],
    bytesUploaded: 0,
    progress: 0,
    speedBps: 0,
  });
  updateUnloadGuard();
  scheduler.wake();
}

/** Resume an interrupted item by re-selecting the same file. */
export function resumeWithFile(id: string, file: File): { ok: boolean; error?: string } {
  const item = getItem(id);
  if (!item) return { ok: false, error: 'Upload not found' };
  if (file.name !== item.fileName || file.size !== item.fileSize) {
    return { ok: false, error: 'That file does not match (name or size differs).' };
  }
  fileMap.set(id, file);
  canceledIds.delete(id);
  concurrencyRetries.delete(id);
  const isMultipart = !!item.total_parts && !!item.session_id;
  store().patchItem(id, {
    status: 'queued',
    error: undefined,
    // Multipart resumes from server-tracked parts; single-PUT restarts clean.
    session_id: isMultipart ? item.session_id : null,
    bytesUploaded: isMultipart ? item.bytesUploaded : 0,
    progress: isMultipart ? item.progress : 0,
    uploaded_parts: isMultipart ? item.uploaded_parts : [],
  });
  updateUnloadGuard();
  scheduler.wake();
  return { ok: true };
}

// ── beforeunload guard ───────────────────────────────────────
// Warn before a reload/close while bytes are actively transferring.
let unloadBound = false;
function onBeforeUnload(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = ''; }
function updateUnloadGuard(): void {
  const active = store().items.some((i) => i.status === 'uploading' || i.status === 'queued');
  if (active && !unloadBound) {
    window.addEventListener('beforeunload', onBeforeUnload);
    unloadBound = true;
  } else if (!active && unloadBound) {
    window.removeEventListener('beforeunload', onBeforeUnload);
    unloadBound = false;
  }
}

// Hydrate persisted items on first import (marks in-flight → interrupted).
store().hydrate();
