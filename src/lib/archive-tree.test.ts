// apps/web/src/lib/archive-tree.test.ts
//
// The API hands us a FLAT entry list; the pane needs a tree. Everything
// awkward about that conversion lives here: implied directories (a zip may
// contain "a/b.txt" with no entry for "a/"), ordering, and names a hostile
// archive can put in the list.
import { describe, expect, it } from 'vitest';
import { buildArchiveTree, type ArchiveEntry } from './archive-tree';

function entry(over: Partial<ArchiveEntry> & { i: number; name: string }): ArchiveEntry {
  return { size: 0, csize: 0, method: 8, dir: false, encrypted: false, mtime: null, ...over };
}

describe('buildArchiveTree', () => {
  it('nests files under their directories', () => {
    const tree = buildArchiveTree([
      entry({ i: 0, name: 'assets/hero.png', size: 10 }),
      entry({ i: 1, name: 'README.md', size: 3 }),
    ]);

    expect(tree.map((n) => n.name)).toEqual(['assets', 'README.md']);
    expect(tree[0]!.kind).toBe('dir');
    expect(tree[0]!.children.map((c) => c.name)).toEqual(['hero.png']);
    expect(tree[0]!.children[0]!.index).toBe(0);
  });

  it('creates directories the archive never declared', () => {
    // Real zips often omit directory entries entirely.
    const tree = buildArchiveTree([entry({ i: 0, name: 'a/b/c.txt' })]);
    expect(tree[0]!.name).toBe('a');
    expect(tree[0]!.children[0]!.name).toBe('b');
    expect(tree[0]!.children[0]!.children[0]!.name).toBe('c.txt');
  });

  it('sorts directories before files, each alphabetically', () => {
    const tree = buildArchiveTree([
      entry({ i: 0, name: 'zeta.txt' }),
      entry({ i: 1, name: 'alpha.txt' }),
      entry({ i: 2, name: 'src/x.ts' }),
      entry({ i: 3, name: 'assets/y.png' }),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['assets', 'src', 'alpha.txt', 'zeta.txt']);
  });

  it('keeps an explicit directory entry from becoming a file', () => {
    const tree = buildArchiveTree([entry({ i: 0, name: 'empty/', dir: true })]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.kind).toBe('dir');
    expect(tree[0]!.children).toEqual([]);
  });

  it('carries the entry index, size and flags onto the leaf', () => {
    const tree = buildArchiveTree([
      entry({ i: 7, name: 'secret.psd', size: 99, encrypted: true, method: 0 }),
    ]);
    const leaf = tree[0]!;
    expect(leaf).toMatchObject({ kind: 'file', index: 7, size: 99, encrypted: true, method: 0 });
  });

  it('sums a directory total from everything beneath it', () => {
    const tree = buildArchiveTree([
      entry({ i: 0, name: 'a/one.bin', size: 100 }),
      entry({ i: 1, name: 'a/deep/two.bin', size: 25 }),
    ]);
    expect(tree[0]!.totalBytes).toBe(125);
    expect(tree[0]!.fileCount).toBe(2);
  });

  it('neutralises traversal and absolute paths in displayed names', () => {
    // The server addresses entries by index, so a hostile name cannot reach
    // anything - but it must not be able to draw a misleading tree either.
    const tree = buildArchiveTree([
      entry({ i: 0, name: '../../etc/passwd' }),
      entry({ i: 1, name: '/abs/rooted.txt' }),
    ]);
    const flat = JSON.stringify(tree);
    expect(flat).not.toContain('..');
    expect(tree.every((n) => n.name.length > 0)).toBe(true);
  });

  it('drops empty path segments rather than rendering blank rows', () => {
    const tree = buildArchiveTree([entry({ i: 0, name: 'a//b.txt' })]);
    expect(tree[0]!.name).toBe('a');
    expect(tree[0]!.children[0]!.name).toBe('b.txt');
  });

  it('splits a Windows-written path instead of naming one node "a/b/c.txt"', () => {
    // Separators must be normalised before the split, not after: doing it per
    // segment cannot split anything, and the row ends up displaying slashes.
    const tree = buildArchiveTree([entry({ i: 0, name: 'a\\b\\c.txt' })]);
    expect(tree[0]!.name).toBe('a');
    expect(tree[0]!.children[0]!.name).toBe('b');
    expect(tree[0]!.children[0]!.children[0]!.name).toBe('c.txt');
    expect(JSON.stringify(tree)).not.toContain('a/b/c.txt');
  });

  it('drops a segment made only of control characters rather than drawing a blank row', () => {
    const tree = buildArchiveTree([entry({ i: 0, name: 'bad/\x01\x02/ok.txt' })]);
    expect(tree[0]!.name).toBe('bad');
    expect(tree[0]!.children[0]!.name).toBe('ok.txt');
  });

  it('strips a right-to-left-override spoof rather than drawing a name that lies', () => {
    // "invoice<U+202E>gnp.exe" renders as "invoicexe.png" in every client, and
    // the name travels past the row - into the desktop save dialog's
    // defaultPath and the download's `filename*` parameter - so a row that
    // merely LOOKS wrong is not the whole of it.
    const tree = buildArchiveTree([
      entry({ i: 0, name: 'invoice\u202Egnp.exe' }),
      entry({ i: 1, name: '\u2066reports\u2069/q1\u200e.csv' }),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['reports', 'invoicegnp.exe']);
    expect(tree[0]!.children[0]!.name).toBe('q1.csv');
    expect(JSON.stringify(tree)).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
  });

  it('returns an empty array for an archive with no entries', () => {
    expect(buildArchiveTree([])).toEqual([]);
  });
});
