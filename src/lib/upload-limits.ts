/**
 * Screen a drop against the workspace's upload rules before anything is queued.
 *
 * The server has always enforced these. The problem was WHEN you found out: a
 * workspace with a whitelist let you queue a hundred files and refused them one
 * at a time, each with its own row in the dock, which reads as the product
 * breaking rather than as a rule.
 *
 * Nothing here is a new restriction. `checkUploadFile` is the shared policy the
 * gate itself applies, so a file this screens out is exactly a file the server
 * would have refused, with the same sentence.
 */
import { api } from '@/api/client';
import {
  checkUploadFile as checkUploadRules, checkBatchFitsQuota, summariseRejections, validateFileName,
  sanitizeIngestName, type UploadLimits,
} from '@/lib/validation-policy.generated';

// Re-exported so callers have one import for the whole screening story, and so
// desktop and web are demonstrably phrasing rejections with the same function.
export { summariseRejections };

interface LimitsResponse extends UploadLimits {
  ok: boolean;
}

/**
 * One in-flight request per workspace, and a short memo.
 *
 * A drop calls this once, but a user dropping three times in a row should not
 * pay three round trips - and the underlying figures are KV-cached server-side
 * at 60s anyway, so a shorter TTL here would buy staleness we cannot act on.
 */
const TTL_MS = 60_000;
const memo = new Map<string, { at: number; value: UploadLimits }>();
const inflight = new Map<string, Promise<UploadLimits>>();

export function clearUploadLimitsCache(): void {
  memo.clear();
  inflight.clear();
}

export async function getUploadLimits(workspaceId: string): Promise<UploadLimits> {
  const hit = memo.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const existing = inflight.get(workspaceId);
  if (existing) return existing;

  const req = api<LimitsResponse>(`/api/workspaces/${workspaceId}/upload-limits`)
    .then((res) => {
      const value: UploadLimits = {
        allowed_extensions: res.allowed_extensions ?? null,
        blocked_extensions: res.blocked_extensions ?? null,
        max_file_size_gb: res.max_file_size_gb ?? null,
        storage_remaining_bytes: res.storage_remaining_bytes ?? null,
      };
      memo.set(workspaceId, { at: Date.now(), value });
      return value;
    })
    // An unreachable limits endpoint must never stop an upload. Falling back to
    // "no limits known" restores exactly the old behaviour - queue it and let
    // the server decide - which is the correct failure direction for a check
    // that only exists to move the refusal earlier.
    .catch((): UploadLimits => ({}))
    .finally(() => { inflight.delete(workspaceId); });

  inflight.set(workspaceId, req);
  return req;
}

/**
 * Would this file be refused? The shared policy's `checkUploadFile` covers the
 * workspace rules (size, allowed and blocked types); the ingest routes also
 * refuse a name over the 255-character cap, which the shared function does
 * not check. Both are asked here so the pre-screen refuses exactly what the
 * server would, with the server's own sentence.
 *
 * The name is SANITISED first, in the same order the server does it
 * (`sanitizeIngestName` at the top of upload/init.ts, before any validation):
 * a backslash, a control character or a "../" is rewritten there, not
 * rejected. Screening the raw name refused files the server would have
 * accepted - a stricter client than server is still a wrong client.
 */
export function checkUploadFile(
  file: { name: string; size: number },
  limits: UploadLimits,
): string | null {
  const nameError = validateFileName(sanitizeIngestName(file.name));
  if (nameError) return nameError;
  return checkUploadRules(file, limits);
}

export interface Screened<T> {
  accepted: T[];
  /** One entry per rejected file, carrying the server's own sentence. */
  rejected: { name: string; reason: string }[];
  /** The same rejections with the original item, for callers that queue them as error rows. */
  rejectedItems: { item: T; reason: string }[];
  /** Set when the batch would overrun the remaining space. A warning only. */
  quotaWarning: string | null;
}

/**
 * Partition a batch. `sizeOf`/`nameOf` keep this usable for both the raw File
 * list and the expanded-tree entry shape without either caller reshaping first.
 */
export function screenBatch<T>(
  items: T[],
  limits: UploadLimits,
  nameOf: (item: T) => string,
  sizeOf: (item: T) => number,
): Screened<T> {
  const accepted: T[] = [];
  const rejected: { name: string; reason: string }[] = [];
  const rejectedItems: { item: T; reason: string }[] = [];

  for (const item of items) {
    const name = nameOf(item);
    const reason = checkUploadFile({ name, size: sizeOf(item) }, limits);
    if (reason) {
      rejected.push({ name, reason });
      rejectedItems.push({ item, reason });
    } else {
      accepted.push(item);
    }
  }

  // Only what will actually be sent counts toward the quota warning.
  const total = accepted.reduce((sum, item) => sum + sizeOf(item), 0);
  const fit = checkBatchFitsQuota(total, limits);
  const quotaWarning = fit.fits
    ? null
    : `This upload is about ${formatBytes(fit.over)} larger than the space left in this workspace. `
      + 'Some files may be refused.';

  return { accepted, rejected, rejectedItems, quotaWarning };
}

function formatBytes(bytes: number): string {
  const MB = 1_048_576, GB = 1_073_741_824;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
