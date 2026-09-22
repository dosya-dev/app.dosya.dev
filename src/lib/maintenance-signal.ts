/**
 * Cross-module wiring for the maintenance banner: `api/client.ts` learns of a
 * 503 surface_disabled response before `stores/session.ts` (which owns the
 * maintenance state) has necessarily loaded, and the client must not import
 * the store directly - that would pull the whole session/workspace store
 * graph into every fetch call and risks a circular import (session.ts itself
 * calls into api/client.ts for `api()`). A tiny pub/sub in between lets
 * session.ts register interest without client.ts knowing it exists.
 */
export interface MaintenanceInfo {
  surface: string;
  message: string | null;
}

let handler: ((m: MaintenanceInfo) => void) | null = null;

/** Registered once by stores/session.ts at module load. */
export function onMaintenance(h: (m: MaintenanceInfo) => void): void {
  handler = h;
}

/** Called by api/client.ts when a response carries the surface_disabled code. */
export function notifyMaintenance(m: MaintenanceInfo): void {
  handler?.(m);
}
