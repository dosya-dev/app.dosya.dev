/**
 * Recently opened files and pages for the search box's empty state.
 * Per browser, per user, per workspace. localStorage can be missing, full or
 * throwing (private windows, blocked site data), so every access is guarded
 * and failure just means "no recents".
 */
export interface RecentItem { id: string; kind: 'file' | 'folder' | 'goto' | 'integration'; title: string; href: string }

const PREFIX = 'dosya.recent.';
const MAX_STORED = 8;
const KINDS = new Set(['file', 'folder', 'goto', 'integration']);

const keyFor = (userId?: string, wsId?: string) => (userId && wsId ? `${PREFIX}${userId}.${wsId}` : null);

// In-app paths only: a tampered stored value must never become a navigation target.
function isRecent(v: unknown): v is RecentItem {
  const o = v as Record<string, unknown> | null;
  return !!o && typeof o === 'object' && typeof o.id === 'string' && typeof o.title === 'string'
    && typeof o.href === 'string' && o.href.startsWith('/') && !o.href.startsWith('//') && KINDS.has(o.kind as string);
}

function read(key: string): RecentItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecent) : [];
  } catch {
    return [];
  }
}

export function getRecents(userId: string | undefined, wsId: string | undefined, limit = 5): RecentItem[] {
  const key = keyFor(userId, wsId);
  return key ? read(key).slice(0, limit) : [];
}

export function recordRecent(userId: string | undefined, wsId: string | undefined, item: RecentItem): void {
  const key = keyFor(userId, wsId);
  if (!key) return;
  const next = [item, ...read(key).filter((r) => r.id !== item.id)].slice(0, MAX_STORED);
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable: no recents */ }
}

export function clearAllRecents(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* nothing to clear */ }
}
