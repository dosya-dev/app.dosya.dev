/**
 * Turning a dropped folder into a flat list of files with their relative paths.
 *
 * `dataTransfer.files` cannot do this. A dropped directory still puts ONE entry
 * in that list - a phantom File named after the folder, carrying the directory's
 * inode size (128 on macOS, so a `size === 0` guard does not catch it) and an
 * empty type. Reading its bytes throws NotFoundError, which surfaced as a bogus
 * "Network error" in the upload dock. The only way to see a directory's contents
 * is the FileSystem Entry API: dataTransfer.items -> webkitGetAsEntry().
 */

/** One file to upload, with the folder path it should land in. */
export interface DroppedEntry {
  /** Folder path relative to the drop target; '' means the target itself. */
  path: string;
  file: File;
}

export interface DroppedTree {
  entries: DroppedEntry[];
  /** Every directory walked, including empty ones, so they can be recreated. */
  dirs: string[];
  /** True when the drop contained at least one directory. */
  hadDirectory: boolean;
  /** Files left out because the batch hit the cap. */
  skipped: number;
}

/**
 * Upper bound on one drop. A folder tree has no natural size limit, and each
 * file becomes a queue item that is persisted to localStorage by the uploads
 * store, so an unbounded drop can wedge the tab before a single byte moves.
 * Anything above this is reported to the user, never silently discarded.
 */
export const MAX_DROPPED_FILES = 2000;

/** OS bookkeeping files - never what someone means to upload. */
const JUNK = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

function isJunk(name: string): boolean {
  // '._foo' is the AppleDouble sidecar written onto non-HFS volumes.
  return JUNK.has(name.toLowerCase()) || name.startsWith('._');
}

const join = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

function toFile(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    // A file deleted between the drop and the read rejects here; one unreadable
    // file must not abandon the rest of the tree.
    entry.file((f) => resolve(f), () => resolve(null));
  });
}

/**
 * Read a directory to exhaustion.
 *
 * readEntries hands back a bounded batch (~100 entries in Chromium) and signals
 * the end with an empty array, so a single call silently truncates any large
 * folder. It must be called in a loop.
 */
function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const out: FileSystemEntry[] = [];
  return new Promise((resolve) => {
    const pump = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) { resolve(out); return; }
          out.push(...batch);
          pump();
        },
        () => resolve(out),
      );
    };
    pump();
  });
}

/**
 * Walk dropped items into files plus their folder paths.
 *
 * MUST be called synchronously from the drop handler: `dataTransfer.items` is
 * only valid for the duration of the event, so the entry objects are taken
 * before the first await. Everything after that runs against entries this
 * function already owns.
 */
export async function readDroppedEntries(
  dt: DataTransfer,
  max: number = MAX_DROPPED_FILES,
): Promise<DroppedTree> {
  // ── synchronous phase ──
  const roots: FileSystemEntry[] = [];
  let entryApi = false;
  for (const item of Array.from(dt.items ?? [])) {
    const get = (item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntry | null;
    }).webkitGetAsEntry;
    if (typeof get !== 'function') continue;
    entryApi = true;
    const entry = get.call(item);
    if (entry) roots.push(entry);
  }
  // Engines without the entry API can still upload loose files; a folder in
  // this list is the unreadable phantom, and is filtered out downstream by the
  // caller's error handling rather than pretended into a directory here.
  const looseFiles = entryApi ? [] : Array.from(dt.files ?? []);

  // ── async phase ──
  const tree: DroppedTree = { entries: [], dirs: [], hadDirectory: false, skipped: 0 };

  for (const file of looseFiles) {
    if (isJunk(file.name)) continue;
    if (tree.entries.length >= max) { tree.skipped++; continue; }
    tree.entries.push({ path: '', file });
  }

  const visit = async (entry: FileSystemEntry, parent: string): Promise<void> => {
    if (isJunk(entry.name)) return;
    if (entry.isDirectory) {
      tree.hadDirectory = true;
      const path = join(parent, entry.name);
      tree.dirs.push(path);
      for (const child of await readAll(entry as FileSystemDirectoryEntry)) {
        await visit(child, path);
      }
      return;
    }
    if (!entry.isFile) return;
    // Past the cap, keep walking to report an honest count but stop paying for
    // file handles.
    if (tree.entries.length >= max) { tree.skipped++; return; }
    const file = await toFile(entry as FileSystemFileEntry);
    if (file) tree.entries.push({ path: parent, file });
  };

  for (const root of roots) await visit(root, '');
  return tree;
}

/**
 * The same shape from an `<input webkitdirectory>` picker, whose files carry a
 * `webkitRelativePath` like "Photos/2024/b.jpg" instead of entry objects.
 */
export function entriesFromPickedFiles(
  files: FileList | File[],
  max: number = MAX_DROPPED_FILES,
): DroppedTree {
  const tree: DroppedTree = { entries: [], dirs: [], hadDirectory: false, skipped: 0 };
  const seen = new Set<string>();
  for (const file of Array.from(files)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    const path = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    if (path) {
      tree.hadDirectory = true;
      // Record every ancestor, so "Photos/2024" also creates "Photos".
      const parts = path.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join('/');
        if (!seen.has(p)) { seen.add(p); tree.dirs.push(p); }
      }
    }
    if (isJunk(file.name)) continue;
    if (tree.entries.length >= max) { tree.skipped++; continue; }
    tree.entries.push({ path, file });
  }
  return tree;
}
