import type { UploadItem } from './upload-types';

const KEY = 'dosya_uploads';
const MAX_PERSISTED = 50;

interface Envelope {
  v: 2;
  /** id of the account that wrote these items; null = pre-v2 legacy payload */
  owner: string | null;
  items: UploadItem[];
}

function loadEnvelope(): Envelope {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { v: 2, owner: null, items: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { v: 2, owner: null, items: parsed as UploadItem[] }; // legacy
    if (parsed && Array.isArray(parsed.items)) {
      return { v: 2, owner: parsed.owner ?? null, items: parsed.items as UploadItem[] };
    }
    return { v: 2, owner: null, items: [] };
  } catch {
    return { v: 2, owner: null, items: [] };
  }
}

function saveEnvelope(env: Envelope): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...env, items: env.items.slice(-MAX_PERSISTED) }),
    );
  } catch {
    // quota exceeded or storage unavailable - non-fatal
  }
}

/** Persist the most recent items, preserving the current owner stamp. */
export function saveItems(items: UploadItem[]): void {
  saveEnvelope({ ...loadEnvelope(), items });
}

export function loadItems(): UploadItem[] {
  return loadEnvelope().items;
}

export function clearPersisted(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // non-fatal
  }
}

/**
 * Called once the logged-in user is known. If the persisted items belong to a
 * DIFFERENT account, wipe them (they must never resurface in this session's
 * dock); either way stamp the storage with the current owner and return the
 * surviving items.
 */
export function claimOwner(userId: string): UploadItem[] {
  const env = loadEnvelope();
  const items = env.owner !== null && env.owner !== userId ? [] : env.items;
  saveEnvelope({ v: 2, owner: userId, items });
  return items;
}

/**
 * A page reload wipes the JS heap, including the File bytes. Any upload that was
 * mid-flight or queued can no longer proceed on its own, so mark it 'interrupted'
 * - the dock offers Resume (re-pick the file). Terminal states are kept as-is.
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
