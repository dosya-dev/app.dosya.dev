/**
 * Recreating a dropped folder tree server-side, then routing each file into it.
 *
 * Deliberately free of network and store access so the ordering rules below are
 * testable: the caller injects how a folder gets created.
 */
import type { DroppedEntry, DroppedTree } from '@/lib/dropped-entries';

/** Creates one folder and resolves to its id. */
export type CreateFolder = (name: string, parentId: string | null) => Promise<string>;

export interface FolderPlan {
  /** Relative dir path -> server folder id. */
  ids: Map<string, string>;
  /** Paths that could not be created, plus everything beneath them. */
  failed: string[];
  /** First creation error, for the message shown to the user. */
  error?: string;
}

const depth = (p: string) => p.split('/').length;

/**
 * Every folder that has to exist, ordered so a parent is always created before
 * its children - the create call needs its parent's id, and letting a child go
 * first would either re-create the parent or strand the child at the root.
 */
export function orderedDirs(tree: DroppedTree): string[] {
  const all = new Set<string>();
  const add = (path: string) => {
    if (!path) return;
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
  };
  for (const d of tree.dirs) add(d);
  // A file's path is proof its folder is needed even if the walk never listed it.
  for (const e of tree.entries) add(e.path);
  return [...all].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}

/**
 * Create the folders one level at a time.
 *
 * Levels are a correctness boundary, not just batching: a child needs its
 * parent's id. Within a level, siblings are created concurrently - they have
 * distinct names, so they cannot race each other into a duplicate.
 */
export async function createFolderTree(
  dirs: string[],
  rootId: string | null,
  create: CreateFolder,
  concurrency = 4,
): Promise<FolderPlan> {
  const plan: FolderPlan = { ids: new Map(), failed: [] };
  const dead = new Set<string>();

  const parentPath = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const leaf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

  const levels = new Map<number, string[]>();
  for (const d of dirs) {
    const k = depth(d);
    (levels.get(k) ?? levels.set(k, []).get(k)!).push(d);
  }

  for (const level of [...levels.keys()].sort((a, b) => a - b)) {
    const paths = levels.get(level)!;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < paths.length) {
        const path = paths[cursor++];
        const parent = parentPath(path);
        // A folder whose parent never got created has nowhere to go. Marking the
        // whole subtree dead keeps its files out of the root rather than
        // flattening the tree the user dropped.
        if (parent && !plan.ids.has(parent)) {
          dead.add(path);
          plan.failed.push(path);
          continue;
        }
        try {
          plan.ids.set(path, await create(leaf(path), parent ? plan.ids.get(parent)! : rootId));
        } catch (err) {
          dead.add(path);
          plan.failed.push(path);
          plan.error ??= err instanceof Error ? err.message : 'Could not create folder';
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(concurrency, paths.length)) }, worker),
    );
  }

  plan.failed.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  return plan;
}

/**
 * Bucket files by the folder id their path resolved to. Files under a folder
 * that failed are reported, never redirected somewhere the user did not ask for.
 */
export function groupByFolder(
  entries: DroppedEntry[],
  plan: Pick<FolderPlan, 'ids' | 'failed'>,
  rootId: string | null,
): { groups: Map<string | null, File[]>; skipped: number } {
  const groups = new Map<string | null, File[]>();
  let skipped = 0;
  for (const entry of entries) {
    let target: string | null;
    if (!entry.path) {
      target = rootId;
    } else {
      const id = plan.ids.get(entry.path);
      if (!id) { skipped++; continue; }
      target = id;
    }
    const bucket = groups.get(target);
    if (bucket) bucket.push(entry.file);
    else groups.set(target, [entry.file]);
  }
  return { groups, skipped };
}
