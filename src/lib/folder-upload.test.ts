import { describe, it, expect } from 'vitest';
import { orderedDirs, createFolderTree, groupByFolder } from './folder-upload';
import type { DroppedTree } from './dropped-entries';

const f = (name: string) => new File(['x'], name);

const tree = (paths: string[], dirs: string[] = []): DroppedTree => ({
  entries: paths.map((p, i) => ({ path: p, file: f(`f${i}.txt`) })),
  dirs,
  hadDirectory: dirs.length > 0,
  skipped: 0,
});

describe('orderedDirs', () => {
  it('lists every folder parents-first, so a child is never created first', () => {
    expect(orderedDirs(tree([], ['Photos/2024/raw', 'Photos', 'Photos/2024'])))
      .toEqual(['Photos', 'Photos/2024', 'Photos/2024/raw']);
  });

  it('fills in ancestors that only appear inside a file path', () => {
    expect(orderedDirs(tree(['Photos/2024'], []))).toEqual(['Photos', 'Photos/2024']);
  });

  it('dedupes and ignores root-level files', () => {
    expect(orderedDirs(tree(['', 'Docs', 'Docs'], ['Docs']))).toEqual(['Docs']);
  });
});

describe('createFolderTree', () => {
  it('creates each folder once, under the id of its own parent', async () => {
    const calls: [string, string | null][] = [];
    const plan = await createFolderTree(['Photos', 'Photos/2024'], 'fld_root', async (name, parent) => {
      calls.push([name, parent]);
      return `id_${name}`;
    });
    expect(calls).toEqual([['Photos', 'fld_root'], ['2024', 'id_Photos']]);
    expect(plan.ids.get('Photos/2024')).toBe('id_2024');
    expect(plan.failed).toEqual([]);
  });

  it('passes a null parent at the workspace root', async () => {
    const calls: (string | null)[] = [];
    await createFolderTree(['Docs'], null, async (_n, parent) => { calls.push(parent); return 'id'; });
    expect(calls).toEqual([null]);
  });

  // Without this, a folder that fails to create would leave its children asking
  // for a parent id that does not exist - or worse, defaulting to the root and
  // flattening the user's tree.
  it('skips the whole subtree under a folder that failed', async () => {
    const attempted: string[] = [];
    const plan = await createFolderTree(
      ['Photos', 'Photos/2024', 'Photos/2024/raw', 'Docs'],
      null,
      async (name) => {
        attempted.push(name);
        if (name === 'Photos') throw new Error('Folder name is too long');
        return `id_${name}`;
      },
    );
    expect(attempted).toEqual(['Photos', 'Docs']);
    expect(plan.failed).toEqual(['Photos', 'Photos/2024', 'Photos/2024/raw']);
    expect(plan.ids.get('Docs')).toBe('id_Docs');
    expect(plan.error).toBe('Folder name is too long');
  });
});

describe('groupByFolder', () => {
  it('sends each file to the folder its path resolved to', () => {
    const t = tree(['', 'Photos', 'Photos/2024'], ['Photos', 'Photos/2024']);
    const plan = { ids: new Map([['Photos', 'id_p'], ['Photos/2024', 'id_24']]), failed: [] };
    const { groups, skipped } = groupByFolder(t.entries, plan, 'fld_root');
    expect(skipped).toBe(0);
    expect(groups.get('fld_root')?.map((x) => x.name)).toEqual(['f0.txt']);
    expect(groups.get('id_p')?.map((x) => x.name)).toEqual(['f1.txt']);
    expect(groups.get('id_24')?.map((x) => x.name)).toEqual(['f2.txt']);
  });

  it('drops files whose folder failed instead of dumping them in the root', () => {
    const t = tree(['Photos', '']);
    const plan = { ids: new Map<string, string>(), failed: ['Photos'] };
    const { groups, skipped } = groupByFolder(t.entries, plan, null);
    expect(skipped).toBe(1);
    expect(groups.get(null)?.map((x) => x.name)).toEqual(['f1.txt']);
    expect([...groups.keys()]).toEqual([null]);
  });
});
