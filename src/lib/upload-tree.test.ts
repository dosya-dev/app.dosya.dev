import { describe, it, expect } from 'vitest';
import { buildUploadTree, visibleRows, type UploadTreeNode, type UploadLeaf, type UploadFolderNode } from './upload-tree';

// The upload queue used to be one flat list, so a 400-file folder drop read as
// 400 unrelated rows. These pin how files are grouped back under the folders
// they came from and how a folder's numbers roll up from everything beneath it.

interface Item { id: string; path: string; size: number; done: number; state: UploadLeaf['state'] }

const item = (id: string, path: string, state: UploadLeaf['state'] = 'pending', size = 100, done = 0): Item =>
  ({ id, path, size, done, state });

const leaf = (i: Item): UploadLeaf => ({ path: i.path, size: i.size, bytesDone: i.done, state: i.state });

const names = (nodes: UploadTreeNode<Item>[]): string[] =>
  nodes.map((n) => (n.kind === 'folder' ? `${n.name}/` : n.item.id));

function folder(node: UploadTreeNode<Item> | undefined): UploadFolderNode<Item> {
  if (node?.kind !== 'folder') throw new Error('expected a folder node');
  return node;
}

describe('buildUploadTree', () => {
  it('keeps files with no folder path at the top level, in queue order', () => {
    expect(names(buildUploadTree([item('a', ''), item('b', '')], leaf))).toEqual(['a', 'b']);
  });

  it('nests files under every folder on their path, folders listed before loose files', () => {
    const tree = buildUploadTree(
      [item('loose', ''), item('p1', 'Photos'), item('t1', 'Photos/2024/Trip'), item('p2', 'Photos')],
      leaf,
    );
    expect(names(tree)).toEqual(['Photos/', 'loose']);
    const photos = folder(tree[0]);
    expect(photos.path).toBe('Photos');
    expect(names(photos.children)).toEqual(['2024/', 'p1', 'p2']);
    const y2024 = folder(photos.children[0]);
    expect(y2024.path).toBe('Photos/2024');
    expect(names(y2024.children)).toEqual(['Trip/']);
  });

  it("rolls a folder's counts and bytes up from its whole subtree", () => {
    const tree = buildUploadTree(
      [
        item('a', 'Docs', 'done', 100, 100),
        item('b', 'Docs/Old', 'error', 50, 10),
        item('c', 'Docs/Old', 'active', 200, 50),
        item('d', 'Docs/Old/Deep', 'pending', 150, 0),
      ],
      leaf,
    );
    const docs = folder(tree[0]);
    expect(docs).toMatchObject({
      fileCount: 4, doneCount: 1, errorCount: 1, activeCount: 1, totalBytes: 500,
      // A failed file's partial bytes are not progress: they will be sent again.
      doneBytes: 150,
    });
    expect(folder(docs.children[0])).toMatchObject({ fileCount: 3, totalBytes: 400 });
  });

  it('collects every item beneath a folder, for folder-level actions', () => {
    const tree = buildUploadTree([item('a', 'X'), item('b', 'X/Y'), item('c', '')], leaf);
    expect(folder(tree[0]).items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('turns an empty queue into an empty tree', () => {
    expect(buildUploadTree([], leaf)).toEqual([]);
  });
});

describe('visibleRows', () => {
  it('walks depth-first and hides the contents of closed folders', () => {
    const tree = buildUploadTree([item('a', 'X'), item('b', 'X/Y'), item('c', '')], leaf);
    expect(visibleRows(tree, () => true).map((r) =>
      `${r.depth}:${r.node.kind === 'folder' ? r.node.name : r.node.item.id}`,
    )).toEqual(['0:X', '1:Y', '2:b', '1:a', '0:c']);
    expect(visibleRows(tree, (f) => f.path !== 'X/Y').map((r) =>
      (r.node.kind === 'folder' ? r.node.name : r.node.item.id),
    )).toEqual(['X', 'Y', 'a', 'c']);
  });
});
