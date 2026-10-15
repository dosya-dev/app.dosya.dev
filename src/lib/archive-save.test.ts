// apps/web/src/lib/archive-save.test.ts
//
// Saving a subtree of an archive, planned and run on plain data: relative
// paths, what gets skipped and why, folder creation level by level, one file at
// a time, a refused folder, a failed file, and cancellation.
import { describe, it, expect, vi } from 'vitest';
import { planFolderSave, runFolderSave, MAX_FOLDER_SAVE_FILES, type SavePlan } from './archive-save';
import { buildArchiveTree } from './archive-tree';

const entry = (i: number, name: string, over: Partial<{ method: number; encrypted: boolean; dir: boolean }> = {}) =>
  ({ i, name, size: 1, csize: 1, method: 8, dir: false, encrypted: false, mtime: null, ...over });

const TREE = buildArchiveTree([
  entry(1, 'docs/readme.md'),
  entry(2, 'docs/2026/notes.md'),
  entry(3, 'docs/2026/q1/plan.md'),
  entry(4, 'docs/secret.psd', { encrypted: true }),
  entry(5, 'docs/legacy.bin', { method: 99 }),
  entry(6, 'docs/empty/', { dir: true }),
  entry(7, 'other.txt'),
]);
const docs = TREE.find((n) => n.name === 'docs')!;

describe('planFolderSave', () => {
  it('collects openable files with directories relative to the chosen node, and lists what it skips', () => {
    const plan = planFolderSave(docs.children, 'docs') as SavePlan;
    expect(plan.rootName).toBe('docs');
    // Tree order: directories before files at every level, so q1/plan.md is
    // reached before 2026/notes.md, and docs/readme.md comes last.
    expect(plan.files).toEqual([
      { index: 3, relDir: ['2026', 'q1'], name: 'plan.md' },
      { index: 2, relDir: ['2026'], name: 'notes.md' },
      { index: 1, relDir: [], name: 'readme.md' },
    ]);
    expect(plan.dirs).toEqual([['2026'], ['empty'], ['2026', 'q1']]);
    expect(plan.skipped).toEqual([
      { name: 'legacy.bin', reason: 'unsupported compression (method 99)' },
      { name: 'secret.psd', reason: 'password-protected' },
    ]);
  });

  it('refuses more files than the cap', () => {
    const many = buildArchiveTree(Array.from({ length: MAX_FOLDER_SAVE_FILES + 1 }, (_, i) => entry(i, `f${i}.txt`)));
    expect(planFolderSave(many, 'all')).toEqual({ tooMany: MAX_FOLDER_SAVE_FILES + 1 });
  });
});

function makeDeps() {
  let n = 0;
  const created: { parent: string | null; names: string[] }[] = [];
  const saved: { index: number; folderId: string | null; name: string }[] = [];
  const progress: [number, number][] = [];
  return {
    created, saved, progress,
    createFolders: vi.fn(async (parent: string | null, names: string[]) => {
      created.push({ parent, names });
      return new Map(names.map((name) => [name, `fld_${name}_${++n}`]));
    }),
    saveEntry: vi.fn(async (index: number, folderId: string | null, name: string) => {
      saved.push({ index, folderId, name });
      return { file_id: `file_${index}`, name };
    }),
    onProgress: vi.fn((d: number, t: number) => { progress.push([d, t]); }),
    isCancelled: () => false,
  };
}

describe('runFolderSave', () => {
  const plan = planFolderSave(docs.children, 'docs') as SavePlan;

  it('creates the wrapping folder, then each level, then saves files one at a time into the right folder', async () => {
    const d = makeDeps();
    const out = await runFolderSave(plan, 'dest', d);
    expect(d.created[0]).toEqual({ parent: 'dest', names: ['docs'] });
    expect(d.created[1]).toEqual({ parent: 'fld_docs_1', names: ['2026', 'empty'] });
    expect(d.created[2]).toEqual({ parent: 'fld_2026_2', names: ['q1'] });
    expect(d.saved).toEqual([
      { index: 3, folderId: 'fld_q1_4', name: 'plan.md' },
      { index: 2, folderId: 'fld_2026_2', name: 'notes.md' },
      { index: 1, folderId: 'fld_docs_1', name: 'readme.md' },
    ]);
    expect(d.progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
    expect(out).toEqual({ saved: 3, failed: [], skipped: 2, cancelled: false, rootFolderId: 'fld_docs_1' });
  });

  it('continues past a failed file and reports it', async () => {
    const d = makeDeps();
    d.saveEntry.mockImplementation(async (index: number, _folderId: string | null, name: string) => {
      if (index === 2) throw new Error('Storage limit reached');
      return { file_id: `file_${index}`, name };
    });
    const out = await runFolderSave(plan, 'dest', d);
    expect(out.saved).toBe(2);
    expect(out.failed).toEqual([{ name: '2026/notes.md', message: 'Storage limit reached' }]);
  });

  it('stops after the current file when cancelled', async () => {
    const d = makeDeps();
    let calls = 0;
    const out = await runFolderSave(plan, 'dest', { ...d, isCancelled: () => ++calls > 1 });
    expect(out.cancelled).toBe(true);
    expect(out.saved).toBe(1);
  });

  it('stops before any file when the first folder create is refused (review focus 4)', async () => {
    const d = makeDeps();
    d.createFolders.mockRejectedValueOnce(new Error("This folder is outside the folder you're confined to"));
    const out = await runFolderSave(plan, null, d);
    expect(out.saved).toBe(0);
    expect(d.saved).toEqual([]);
    expect(out.failed).toEqual([{ name: 'docs', message: "This folder is outside the folder you're confined to" }]);
  });

  it('reports a nested folder that could not be created AND every file beneath it, so the counts add up', async () => {
    const d = makeDeps();
    d.createFolders.mockImplementation(async (_parent: string | null, names: string[]) =>
      new Map(names.filter((n) => n !== 'q1').map((name) => [name, `fld_${name}`])));
    const out = await runFolderSave(plan, 'dest', d);
    expect(out.failed).toEqual([
      { name: '2026/q1', message: 'Folder could not be created' },
      { name: '2026/q1/plan.md', message: 'Its folder could not be created' },
    ]);
    expect(d.saved.find((s) => s.index === 3)).toBeUndefined();
    expect(out.saved).toBe(2);
    // Every file was accounted for: progress reaches the total.
    expect(d.progress.at(-1)).toEqual([3, 3]);
  });
});
