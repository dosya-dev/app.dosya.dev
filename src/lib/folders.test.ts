import { describe, it, expect } from 'vitest';
import { folderPath, buildTreeRows, filterFolders, type PickerFolder } from './folders';

// Tree:  root(A) ─ A1 ─ A1a
//        root(B)
const FOLDERS: PickerFolder[] = [
  { id: 'A', name: 'Alpha', parent_id: null, file_count: 2 },
  { id: 'A1', name: 'Beta', parent_id: 'A', file_count: 0 },
  { id: 'A1a', name: 'Gamma', parent_id: 'A1', file_count: 5 },
  { id: 'B', name: 'Delta', parent_id: null, file_count: 1 },
];

describe('folderPath', () => {
  it('returns "" for a root folder', () => {
    expect(folderPath(FOLDERS, 'A')).toBe('');
  });
  it('joins ancestor names for a nested folder', () => {
    expect(folderPath(FOLDERS, 'A1a')).toBe('Alpha / Beta');
  });
  it('returns "" for an unknown id', () => {
    expect(folderPath(FOLDERS, 'nope')).toBe('');
  });
});

describe('buildTreeRows', () => {
  it('flattens the tree depth-first with depth + hasChildren', () => {
    const rows = buildTreeRows(FOLDERS);
    expect(rows.map((r) => [r.folder.id, r.depth, r.hasChildren])).toEqual([
      ['A', 0, true],
      ['A1', 1, true],
      ['A1a', 2, false],
      ['B', 0, false],
    ]);
  });
  it('sorts siblings by name', () => {
    const rows = buildTreeRows([
      { id: 'z', name: 'Zed', parent_id: null, file_count: 0 },
      { id: 'a', name: 'Ann', parent_id: null, file_count: 0 },
    ]);
    expect(rows.map((r) => r.folder.id)).toEqual(['a', 'z']);
  });
  it('prunes excludeId and its whole subtree', () => {
    const rows = buildTreeRows(FOLDERS, { excludeId: 'A' });
    expect(rows.map((r) => r.folder.id)).toEqual(['B']);
  });
  it('hides children of a collapsed node but keeps hasChildren true', () => {
    const rows = buildTreeRows(FOLDERS, { collapsed: new Set(['A']) });
    expect(rows.map((r) => r.folder.id)).toEqual(['A', 'B']);
    expect(rows.find((r) => r.folder.id === 'A')!.hasChildren).toBe(true);
  });
});

describe('filterFolders', () => {
  it('returns case-insensitive name substring matches', () => {
    expect(filterFolders(FOLDERS, 'a').map((f) => f.id).sort()).toEqual(['A', 'A1', 'A1a', 'B']);
    expect(filterFolders(FOLDERS, 'gam').map((f) => f.id)).toEqual(['A1a']);
  });
  it('returns [] for a blank query', () => {
    expect(filterFolders(FOLDERS, '   ')).toEqual([]);
  });
});
