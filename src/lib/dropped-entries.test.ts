import { describe, it, expect } from 'vitest';
import {
  readDroppedEntries,
  entriesFromPickedFiles,
  MAX_DROPPED_FILES,
} from './dropped-entries';

// ── Fakes for the FileSystem Entry API ─────────────────────
//
// jsdom implements neither webkitGetAsEntry nor FileSystemDirectoryReader, so
// the walk is exercised against hand-built entries. The important fidelity
// detail is readEntries' BATCHING: a real directory reader returns at most ~100
// entries per call and signals "done" with an empty array, which is the trap
// this module exists to get right.

function fileEntry(name: string, size = 3): FileSystemFileEntry {
  const file = new File(['x'.repeat(size)], name, { type: 'text/plain' });
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (cb: (f: File) => void) => cb(file),
  } as unknown as FileSystemFileEntry;
}

/** `batchSize` mimics the browser's per-call cap on readEntries. */
function dirEntry(
  name: string,
  children: FileSystemEntry[],
  batchSize = 100,
): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let cursor = 0;
      return {
        readEntries: (ok: (e: FileSystemEntry[]) => void) => {
          const batch = children.slice(cursor, cursor + batchSize);
          cursor += batch.length;
          ok(batch);
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

/**
 * A DataTransfer stand-in. `neuterAfterSyncPhase` reproduces the browser's real
 * behaviour: the item list is only valid during the event handler, and reading
 * it after an await yields nothing.
 */
function dataTransfer(
  entries: (FileSystemEntry | null)[],
  files: File[] = [],
  neuterAfterSyncPhase = false,
): DataTransfer {
  let live = true;
  if (neuterAfterSyncPhase) queueMicrotask(() => { live = false; });
  return {
    get items() {
      return (live ? entries : []).map((entry) => ({
        kind: entry ? 'file' : 'string',
        webkitGetAsEntry: () => entry,
      })) as unknown as DataTransferItemList;
    },
    get files() {
      return (live ? files : []) as unknown as FileList;
    },
  } as unknown as DataTransfer;
}

describe('readDroppedEntries', () => {
  it('gives a plain file drop an empty folder path', async () => {
    const res = await readDroppedEntries(dataTransfer([fileEntry('a.txt')]));
    expect(res.entries.map((e) => [e.path, e.file.name])).toEqual([['', 'a.txt']]);
    expect(res.hadDirectory).toBe(false);
    expect(res.dirs).toEqual([]);
  });

  it('expands a dropped folder into its files, keeping nested paths', async () => {
    const dt = dataTransfer([
      dirEntry('Photos', [
        fileEntry('a.jpg'),
        dirEntry('2024', [fileEntry('b.jpg'), dirEntry('raw', [fileEntry('c.dng')])]),
      ]),
    ]);
    const res = await readDroppedEntries(dt);
    expect(res.entries.map((e) => `${e.path}/${e.file.name}`).sort()).toEqual([
      'Photos/2024/b.jpg',
      'Photos/2024/raw/c.dng',
      'Photos/a.jpg',
    ]);
    expect(res.hadDirectory).toBe(true);
  });

  it('reports every directory it walked, so empty ones still get created', async () => {
    const dt = dataTransfer([
      dirEntry('Trip', [fileEntry('a.jpg'), dirEntry('empty', [])]),
    ]);
    const res = await readDroppedEntries(dt);
    expect(res.dirs.sort()).toEqual(['Trip', 'Trip/empty']);
  });

  // The bug this guards: readEntries returns a bounded batch, so a single call
  // silently truncates a large folder to its first ~100 files.
  it('keeps calling readEntries until the directory is exhausted', async () => {
    const many = Array.from({ length: 250 }, (_, i) => fileEntry(`f${i}.txt`));
    const dt = dataTransfer([dirEntry('Big', many, 100)]);
    const res = await readDroppedEntries(dt);
    expect(res.entries).toHaveLength(250);
    expect(res.skipped).toBe(0);
  });

  it('handles a mixed drop of loose files and folders', async () => {
    const dt = dataTransfer([
      fileEntry('loose.txt'),
      dirEntry('Docs', [fileEntry('deck.pdf')]),
    ]);
    const res = await readDroppedEntries(dt);
    expect(res.entries.map((e) => `${e.path}/${e.file.name}`).sort()).toEqual([
      '/loose.txt',
      'Docs/deck.pdf',
    ]);
    expect(res.hadDirectory).toBe(true);
  });

  it('drops OS metadata junk instead of uploading it', async () => {
    const dt = dataTransfer([
      dirEntry('Photos', [fileEntry('.DS_Store'), fileEntry('a.jpg'), fileEntry('Thumbs.db')]),
    ]);
    const res = await readDroppedEntries(dt);
    expect(res.entries.map((e) => e.file.name)).toEqual(['a.jpg']);
  });

  it('caps the batch and reports how many files it left out', async () => {
    const many = Array.from({ length: 12 }, (_, i) => fileEntry(`f${i}.txt`));
    const res = await readDroppedEntries(dataTransfer([dirEntry('Big', many)]), 5);
    expect(res.entries).toHaveLength(5);
    expect(res.skipped).toBe(7);
  });

  it('reads the item list before its first await, so the walk survives neutering', async () => {
    const dt = dataTransfer([dirEntry('Photos', [fileEntry('a.jpg')])], [], true);
    const res = await readDroppedEntries(dt);
    expect(res.entries.map((e) => e.file.name)).toEqual(['a.jpg']);
  });

  // Firefox pre-2016 and any future engine without the entry API: the loose
  // files still have to upload, and a folder must not masquerade as a file.
  it('falls back to dataTransfer.files when the entry API is absent', async () => {
    const dt = {
      items: [] as unknown as DataTransferItemList,
      files: [new File(['abc'], 'a.txt', { type: 'text/plain' })] as unknown as FileList,
    } as unknown as DataTransfer;
    const res = await readDroppedEntries(dt);
    expect(res.entries.map((e) => e.file.name)).toEqual(['a.txt']);
    expect(res.hadDirectory).toBe(false);
  });

  it('exposes a cap that is a real number', () => {
    expect(MAX_DROPPED_FILES).toBeGreaterThan(0);
  });
});

describe('entriesFromPickedFiles', () => {
  it('turns webkitRelativePath into the folder path', () => {
    const mk = (name: string, rel: string) => {
      const f = new File(['x'], name);
      Object.defineProperty(f, 'webkitRelativePath', { value: rel });
      return f;
    };
    const res = entriesFromPickedFiles([
      mk('a.jpg', 'Photos/a.jpg'),
      mk('b.jpg', 'Photos/2024/b.jpg'),
    ]);
    expect(res.entries.map((e) => e.path)).toEqual(['Photos', 'Photos/2024']);
    expect(res.dirs.sort()).toEqual(['Photos', 'Photos/2024']);
    expect(res.hadDirectory).toBe(true);
  });

  it('treats a picker with no relative paths as loose files', () => {
    const res = entriesFromPickedFiles([new File(['x'], 'a.txt')]);
    expect(res.entries).toEqual([{ path: '', file: expect.any(File) }]);
    expect(res.hadDirectory).toBe(false);
  });

  it('skips junk from the folder picker too', () => {
    const f = new File(['x'], '.DS_Store');
    Object.defineProperty(f, 'webkitRelativePath', { value: 'Photos/.DS_Store' });
    expect(entriesFromPickedFiles([f]).entries).toEqual([]);
  });
});
