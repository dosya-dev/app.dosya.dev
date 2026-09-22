/**
 * The share modal's memo of each workspace's default link expiry.
 *
 * A round trip per share was wasteful for a value an admin changes about
 * never, but a cache with no way to drop it is its own bug: the admin who
 * changes the default keeps sharing with the old pre-fill until they reload,
 * and the next account to sign in on this browser inherits an answer that was
 * never theirs. So it lives here rather than inside the modal, where the
 * settings save path and logout can both reach it.
 */
const cache = new Map<string, number | null>();

/** `days` is the workspace's default, or null for "no default" (the client falls back to 7). */
export function rememberShareDefault(workspaceId: string, days: number | null): void {
  cache.set(workspaceId, days);
}

/** Null when nothing is remembered for this workspace - distinct from a remembered `null`. */
export function readShareDefault(workspaceId: string): { days: number | null } | null {
  return cache.has(workspaceId) ? { days: cache.get(workspaceId) ?? null } : null;
}

export function clearShareDefaultsCache(): void {
  cache.clear();
}
