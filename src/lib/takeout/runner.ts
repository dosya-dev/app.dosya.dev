/**
 * Runs a Takeout plan: for each item, read its bytes out of the zip, upload
 * them into the right folder, and send Google's date and place for it.
 *
 * Everything with a side effect is injected (Deps), so the ordering, retry,
 * resume and pause rules are testable without a network or a zip.
 *
 * Resume: every finished item's key is kept in localStorage, per workspace
 * and destination. Choosing the same zips again after a closed tab, a
 * crash or a pause skips what already landed.
 */
import { parseSidecar, type PhotoMeta } from './sidecar';
import type { Archive, Plan, PlanItem } from './plan';

export interface MetaItem { file_id: string; captured_at: string | null; latitude: number | null; longitude: number | null }

export interface Deps {
  /** The item's bytes (zip.ts entryBlob in production). */
  readEntry: (file: File, item: PlanItem['entry']) => Promise<Blob>;
  /** Creates (or finds) a folder path under `parentId`; resolves to the leaf id. */
  ensureFolder: (path: string, parentId: string | null) => Promise<string>;
  /** Uploads and resolves to the new file id. */
  upload: (blob: Blob, target: { folderId: string | null; name: string; mtimeMs: number }) => Promise<string>;
  postMeta: (items: MetaItem[]) => Promise<void>;
  /** Waits; injected so tests do not. */
  sleep: (ms: number) => Promise<void>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export interface Failure { name: string; dir: string; reason: string }

export interface Progress {
  total: number;
  totalBytes: number;
  done: number;
  doneBytes: number;
  /** Items skipped because an earlier session already uploaded them. */
  resumed: number;
  datesApplied: number;
  placesApplied: number;
  failures: Failure[];
}

export type RunOutcome = 'done' | 'paused' | 'stopped';

/** Uploads in flight at once. Matches the upload queue's default. */
export const CONCURRENCY = 3;
/** Sidecar dates and places sent per call. */
export const META_BATCH = 50;
/** Consecutive failures after which the run stops rather than failing every file the same way (a full workspace, a lost session). */
export const STOP_AFTER = 8;

/** Waits of 3 s on the upload ceiling before a file fails: 12 minutes. */
const BUSY_WAITS = 240;
const isConcurrencyRefusal = (err: unknown) => err instanceof Error && err.message.toLowerCase().includes('uploads in progress');
const statusOf = (err: unknown) => (err as { status?: number })?.status ?? 0;

export function resumeKey(workspaceId: string, destFolderId: string | null) {
  return `dosya.takeout.done.${workspaceId}.${destFolderId ?? 'root'}`;
}

export class TakeoutRun {
  readonly progress: Progress;
  private pausing = false;
  private stopReason: string | null = null;
  private folders = new Map<string, Promise<string>>();
  private meta: MetaItem[] = [];
  private doneKeys: Set<string>;
  private consecutiveFailures = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly archives: Archive[],
    private readonly plan: Plan,
    private readonly opts: { workspaceId: string; destFolderId: string | null; applyDates: boolean },
    private readonly deps: Deps,
    private readonly onProgress: (p: Progress) => void = () => {},
  ) {
    this.doneKeys = this.loadDone();
    const resumed = plan.items.filter((i) => this.doneKeys.has(i.key));
    this.progress = {
      total: plan.items.length, totalBytes: plan.bytes,
      done: resumed.length, doneBytes: resumed.reduce((n, i) => n + i.entry.size, 0),
      resumed: resumed.length, datesApplied: 0, placesApplied: 0, failures: [],
    };
  }

  /** Stop picking new files; the ones in flight finish. */
  pause() { this.pausing = true; }

  /** Why the run stopped on its own, once run() answered 'stopped'. */
  get stoppedBecause() { return this.stopReason; }

  async run(): Promise<RunOutcome> {
    const queue = this.plan.items.filter((i) => !this.doneKeys.has(i.key));
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length && !this.pausing && !this.stopReason) {
        await this.one(queue[cursor++]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    await this.flushMeta(true);
    this.saveDone(true);
    if (this.stopReason) return 'stopped';
    if (this.pausing && this.progress.done < this.progress.total) return 'paused';
    // Finished: the resume record has done its job.
    try { this.deps.storage?.removeItem(resumeKey(this.opts.workspaceId, this.opts.destFolderId)); } catch { /* storage blocked */ }
    return 'done';
  }

  private async one(item: PlanItem): Promise<void> {
    try {
      const archive = this.archives[item.archive];
      const meta = this.opts.applyDates && item.sidecar ? await this.readMeta(item) : null;
      const blob = await this.deps.readEntry(archive.file, item.entry);
      const folderId = await this.folder(item.dir);
      const mtimeMs = meta?.capturedAt ? Date.parse(meta.capturedAt) : (item.entry.mtime ?? 0);
      const fileId = await this.withRetry(() => this.deps.upload(blob, { folderId, name: item.name, mtimeMs }));
      if (meta && fileId) {
        this.meta.push({ file_id: fileId, captured_at: meta.capturedAt, latitude: meta.latitude, longitude: meta.longitude });
        if (meta.capturedAt) this.progress.datesApplied++;
        if (meta.latitude !== null) this.progress.placesApplied++;
        await this.flushMeta(false);
      }
      this.consecutiveFailures = 0;
      this.doneKeys.add(item.key);
      this.saveDone(false);
    } catch (err) {
      this.progress.failures.push({ name: item.name, dir: item.dir, reason: err instanceof Error ? err.message : String(err) });
      // A refusal that will repeat for every file (no storage left, signed
      // out, no permission) stops the run instead of burning through it.
      if (++this.consecutiveFailures >= STOP_AFTER || [401, 403, 413, 507].includes(statusOf(err))) {
        this.stopReason ??= err instanceof Error ? err.message : String(err);
      }
    }
    this.progress.done++;
    this.progress.doneBytes += item.entry.size;
    this.onProgress(this.progress);
  }

  private async readMeta(item: PlanItem): Promise<PhotoMeta | null> {
    try {
      const ref = item.sidecar!;
      const blob = await this.deps.readEntry(this.archives[ref.archive].file, ref.entry);
      return parseSidecar(await blob.text());
    } catch {
      // A damaged sidecar costs the date, never the photo.
      return null;
    }
  }

  private folder(path: string): Promise<string> {
    let p = this.folders.get(path);
    if (!p) {
      p = this.withRetry(() => this.deps.ensureFolder(path, this.opts.destFolderId));
      // A failure is not cached: the next file in that folder tries again.
      p.catch(() => this.folders.delete(path));
      this.folders.set(path, p);
    }
    return p;
  }

  /**
 * Waits out the per-member upload ceiling; retries other errors twice.
 * The ceiling also counts uploads a closed or reloaded tab left unfinished,
 * which the server stops counting 10 minutes after they started, so the
 * wait outlasts that.
 */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let busy = 0;
    let failed = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        if (isConcurrencyRefusal(err) && busy++ < BUSY_WAITS) { await this.deps.sleep(3_000); continue; }
        const status = statusOf(err);
        const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
        if (permanent || failed++ >= 2) throw err;
        await this.deps.sleep(failed === 1 ? 2_000 : 6_000);
      }
    }
  }

  private async flushMeta(all: boolean) {
    while (this.meta.length >= (all ? 1 : META_BATCH)) {
      const batch = this.meta.splice(0, META_BATCH);
      // Best effort: the photos are in; a lost batch costs dates, not files.
      try { await this.withRetry(() => this.deps.postMeta(batch)); } catch { /* counted as applied already; rare */ }
    }
  }

  private loadDone(): Set<string> {
    try {
      const raw = this.deps.storage?.getItem(resumeKey(this.opts.workspaceId, this.opts.destFolderId));
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }

  private saveDone(now: boolean) {
    const write = () => {
      this.saveTimer = null;
      try {
        this.deps.storage?.setItem(resumeKey(this.opts.workspaceId, this.opts.destFolderId), JSON.stringify([...this.doneKeys]));
      } catch { /* full or blocked: resume is a convenience */ }
    };
    if (now) { if (this.saveTimer) clearTimeout(this.saveTimer); write(); return; }
    this.saveTimer ??= setTimeout(write, 2_000);
  }
}
