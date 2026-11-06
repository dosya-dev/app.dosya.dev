/**
 * One file from a Takeout zip into dosya, through the same doors the upload
 * queue uses (lib/upload-runner.ts): init, then a single PUT or resumable
 * parts, then complete. Kept apart from the queue on purpose: an export is
 * tens of thousands of files, and the queue's dock and its persisted rows
 * are built for a folder drop, not for that.
 */
import { API_BASE } from '@/api/client';
import { runPool, sourceTimeHeaders } from '@/lib/upload-runner';

/** Parts in flight per file once the first part has created the upload. */
const PART_CONCURRENCY = 3;

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', '3gp': 'video/3gpp', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', pdf: 'application/pdf', json: 'application/json', html: 'text/html', txt: 'text/plain', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mbox: 'application/mbox', ics: 'text/calendar', vcf: 'text/vcard',
};

export const mimeOf = (name: string) => MIME[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

/** A refusal the server worded; `status` lets the runner tell a full workspace from a blip. */
export class UploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'UploadError';
  }
}

async function call(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, { credentials: 'include', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new UploadError(data.error ?? `HTTP ${res.status}`, res.status);
  return data;
}

export interface UploadTarget {
  workspaceId: string;
  folderId: string | null;
  name: string;
  /** When the file last changed, for files.source_modified_at. 0 = unknown. */
  mtimeMs: number;
}

/** Uploads `blob` and resolves to the new file's id. */
export async function uploadBlob(blob: Blob, target: UploadTarget): Promise<string> {
  const mime = mimeOf(target.name);
  const init = await call(`${API_BASE}/api/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: target.workspaceId, folder_id: target.folderId,
      file_name: target.name, file_size: blob.size, mime_type: mime, file_id: null,
    }),
  });
  const times = sourceTimeHeaders(target.mtimeMs);

  if (!init.resumable) {
    const put = await call(`${API_BASE}${init.upload_url}`, {
      method: 'PUT', headers: { 'Content-Type': mime, ...times }, body: blob,
    });
    return put.file?.id;
  }

  const { part_size: partSize, total_parts: totalParts } = init.resumable as { part_size: number; total_parts: number };
  const sendPart = async (n: number) => {
    const start = (n - 1) * partSize;
    await call(`${API_BASE}/api/upload/${init.session_id}/part/${n}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' },
      body: blob.slice(start, Math.min(start + partSize, blob.size)),
    });
  };
  // The first part creates the multipart upload server-side; parts racing it
  // would each create their own (same reasoning as upload-runner.ts).
  await sendPart(1);
  const rest = Array.from({ length: totalParts - 1 }, (_, i) => i + 2);
  await runPool(rest, PART_CONCURRENCY, sendPart, () => false);
  const done = await call(`${API_BASE}/api/upload/${init.session_id}/complete`, { method: 'POST', headers: times });
  return done.file?.id;
}
