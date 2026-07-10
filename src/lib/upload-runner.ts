import { API_BASE } from '@/api/client';
import { useUploads } from '@/stores/uploads';
import { createScheduler } from '@/lib/upload-scheduler';
import { getUserConcurrency, effectiveConcurrency } from '@/lib/upload-concurrency';
import type { UploadInput, UploadItem } from '@/lib/upload-types';

// File bytes live only here — never in the store or localStorage.
const fileMap = new Map<string, File>();
// In-flight XHRs, so cancel() can abort them.
const activeXhr = new Map<string, XMLHttpRequest>();
// Bounded auto-retry counter for server concurrency-limit rejections.
const concurrencyRetries = new Map<string, number>();
// Ids the user canceled — checked after every await so an in-flight async step
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

const store = () => useUploads.getState();
const getItem = (id: string): UploadItem | undefined => store().items.find((x) => x.id === id);

function newId(i: number): string {
  return `up_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
}

function reportBytes(id: string, bytes: number, total: number): void {
  store().patchItem(id, {
    bytesUploaded: bytes,
    progress: total > 0 ? Math.min(100, Math.round((bytes / total) * 100)) : 0,
  });
}

// PUT with progress + abort. Reports absolute bytes (baseBytes + loaded).
function xhrPut(
  id: string, url: string, body: Blob, contentType: string,
  baseBytes: number, total: number,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeXhr.set(id, xhr);
    xhr.open('PUT', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', contentType);
    let lastTick = 0;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const now = Date.now();
      if (now - lastTick < 300) return;
      lastTick = now;
      reportBytes(id, baseBytes + e.loaded, total);
    };
    xhr.onload = () => {
      activeXhr.delete(id);
      try {
        const d = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && d.ok) resolve(d);
        else reject(new Error(d.error ?? `HTTP ${xhr.status}`));
      } catch { reject(new Error(`HTTP ${xhr.status}`)); }
    };
    xhr.onerror = () => { activeXhr.delete(id); reject(new Error('Network error')); };
    xhr.onabort = () => { activeXhr.delete(id); reject(new DOMException('Aborted', 'AbortError')); };
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
      mime_type: item.mimeType, region: item.region,
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
  for (const n of missingPartNumbers(totalParts, already)) {
    if (bailIfCanceled(id)) return;
    const start = (n - 1) * partSize;
    const chunk = file.slice(start, Math.min(start + partSize, file.size));
    const d = await xhrPut(id, `${API_BASE}/api/upload/${sessionId}/part/${n}`,
      chunk, 'application/octet-stream', start, file.size);
    const uploaded = [...(getItem(id)?.uploaded_parts ?? []), n];
    const bytes = d.bytes_uploaded ?? start + chunk.size;
    store().patchItem(id, {
      uploaded_parts: uploaded, bytesUploaded: bytes,
      progress: Math.min(100, Math.round((bytes / file.size) * 100)),
    });
  }
  if (bailIfCanceled(id)) return;
  const res = await fetch(`${API_BASE}/api/upload/${sessionId}/complete`, {
    method: 'POST', credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error ?? `Complete failed (HTTP ${res.status})`);
  if (bailIfCanceled(id)) return;
  store().patchItem(id, { status: 'complete', progress: 100, bytesUploaded: file.size });
}

async function resumeParts(id: string, file: File, sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/upload/${sessionId}/status`, { credentials: 'include' });
  const s = await res.json().catch(() => ({}));
  if (!res.ok || !s.ok) throw new Error(s.error ?? 'Could not read upload status');
  if (bailIfCanceled(id)) return;
  if (s.status === 'complete') {
    store().patchItem(id, { status: 'complete', progress: 100, bytesUploaded: file.size });
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
  store().patchItem(id, { status: 'canceled' });
  fileMap.delete(id);
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
        await xhrPut(id, `${API_BASE}${init.upload_url}`, file,
          file.type || 'application/octet-stream', 0, file.size);
        if (bailIfCanceled(id)) return;
        store().patchItem(id, { status: 'complete', progress: 100, bytesUploaded: file.size });
      }
    }
  } catch (err) {
    if (canceledIds.has(id)) {
      // Canceled mid-transfer (e.g. XHR abort) — finalize as canceled, not error.
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
      workspace_id: input.workspace_id, folder_id: input.folder_id, region: input.region,
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
  const xhr = activeXhr.get(id);
  if (xhr) xhr.abort();              // triggers onabort → AbortError → status 'canceled'
  else store().patchItem(id, { status: 'canceled' });
  fileMap.delete(id);
  updateUnloadGuard();
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
