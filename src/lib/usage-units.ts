// Usage-limit unit conversions (migration 0098). The API's wire format for
// egress_bytes_per_day/max_file_size_bytes is bytes-or-null - no unit suffix
// accepted server-side (see apps/api/src/lib/access/write-validation.ts's
// validateUsageLimit). The "Usage limits" forms in profile.tsx (API keys)
// and role-create.tsx (roles) collect these two fields in the friendlier
// GB/MB units and both convert through this ONE module, so the two forms
// cannot independently drift on the conversion the way review round 1 (task
// 5, I1) flagged as untested when the math lived inline in each form -
// mirroring write-validation.ts's own "one shared function" reasoning,
// applied here on the client instead of the server.
//
// 1024-based (GiB/MiB) - the same convention already used everywhere else in
// this codebase for a value labeled "GB"/"MB" (lib/helpers.ts's
// formatBytes, lib/billing/cart-math.ts's GB, apps/api/src/lib/constants.ts's
// GB). This file does not introduce a new convention, it centralises the
// existing one.
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/**
 * A raw GB input string (an input's `.value`) -> integer bytes, or `null` for
 * blank/whitespace-only input (no restriction).
 *
 * Rounds to the nearest integer: the wire format is a strict integer
 * (validateUsageLimit rejects fractional values), so a fractional GB entry
 * must never reach the request as a non-integer byte count.
 *
 * `0` is NOT special-cased to `null` - it converts to `0` like any other
 * number and is left for the server to reject (validateUsageLimit refuses
 * zero identically to a negative value), the same way the server surfaces
 * every other invalid value via `toast.error` rather than the client
 * silently reinterpreting "0" as "unlimited".
 *
 * A non-numeric string (should not normally reach here past a `type="number"`
 * input, but this function does not assume that) produces `NaN`, passed
 * through rather than coerced to `0` or `null` - a caller receiving `NaN`
 * has a bug to fix, not a value to quietly paper over.
 */
export function gbToBytes(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return Math.round(Number(trimmed) * GIB);
}

/** A raw MB input string -> integer bytes. Same rules as {@link gbToBytes}. */
export function mbToBytes(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return Math.round(Number(trimmed) * MIB);
}

/**
 * bytes -> a GB decimal string, for pre-filling a form's text input from a
 * stored byte value (role-create.tsx's edit-mode load). Only the inverse
 * direction needs this: profile.tsx's key-creation form has no existing
 * value to display (keys have no edit surface), so only role-create.tsx
 * calls this.
 *
 * Rounded to 6 decimal places to trim floating-point noise (e.g. a stored
 * value that isn't an exact multiple of 1 GiB) without accumulating visible
 * garbage digits in the input.
 */
export function bytesToGb(bytes: number): string {
  return String(Math.round((bytes / GIB) * 1e6) / 1e6);
}

/** bytes -> an MB decimal string. Same rules as {@link bytesToGb}. */
export function bytesToMb(bytes: number): string {
  return String(Math.round((bytes / MIB) * 1e6) / 1e6);
}
