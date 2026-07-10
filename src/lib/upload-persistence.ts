import type { UploadItem } from './upload-types';

const KEY = 'dosya_uploads';
const MAX_PERSISTED = 50;

/** Persist the most recent items (bytes are never stored — items carry none). */
export function saveItems(items: UploadItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX_PERSISTED)));
  } catch {
    // quota exceeded or storage unavailable — non-fatal
  }
}

export function loadItems(): UploadItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UploadItem[]) : [];
  } catch {
    return [];
  }
}

/**
 * A page reload wipes the JS heap, including the File bytes. Any upload that was
 * mid-flight or queued can no longer proceed on its own, so mark it 'interrupted'
 * — the dock offers Resume (re-pick the file). Terminal states are kept as-is.
 */
export function hydrateForBoot(items: UploadItem[]): UploadItem[] {
  return items.map((it) =>
    it.status === 'uploading' || it.status === 'queued'
      ? { ...it, status: 'interrupted' as const }
      : it,
  );
}

export function loadAndHydrate(): UploadItem[] {
  return hydrateForBoot(loadItems());
}
