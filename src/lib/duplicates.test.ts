import { describe, it, expect } from 'vitest';
import {
  allButNewest, chunk, DELETE_CHUNK, duplicatesQueryKey,
  fullySelectedGroups, selectedBytes, type DuplicateGroup,
} from './duplicates';

function group(hash: string, size: number, ids: string[]): DuplicateGroup {
  return {
    content_hash: hash,
    size_bytes: size,
    count: ids.length,
    wasted_bytes: (ids.length - 1) * size,
    // Server contract: files arrive newest-first (group.ts sorts created_at DESC).
    files: ids.map((id, i) => ({
      id, name: `${id}.bin`, folder_id: null, folder_path: null,
      created_at: 1000 - i, uploaded_by: 'u1', uploader_name: 'U',
      mime_type: 'application/octet-stream', extension: '.bin',
    })),
  };
}

describe('duplicates lib', () => {
  it('duplicatesQueryKey is rooted for workspace-wide invalidation', () => {
    expect(duplicatesQueryKey('ws1')).toEqual(['duplicates', 'ws1']);
  });

  it('allButNewest keeps index 0 of every group', () => {
    const groups = [group('h1', 10, ['n1', 'o1', 'o2']), group('h2', 5, ['n2', 'o3'])];
    expect(allButNewest(groups)).toEqual(['o1', 'o2', 'o3']);
  });

  it('fullySelectedGroups counts groups where every copy is selected', () => {
    const groups = [group('h1', 10, ['a', 'b']), group('h2', 5, ['c', 'd'])];
    expect(fullySelectedGroups(groups, new Set(['a', 'b', 'c']))).toBe(1);
    expect(fullySelectedGroups(groups, new Set(['a', 'c']))).toBe(0);
  });

  it('selectedBytes sums the group size for each selected copy', () => {
    const groups = [group('h1', 10, ['a', 'b']), group('h2', 5, ['c', 'd'])];
    expect(selectedBytes(groups, new Set(['a', 'c', 'd']))).toBe(20);
  });

  it('chunk splits at the batch-delete cap', () => {
    const ids = Array.from({ length: DELETE_CHUNK + 1 }, (_, i) => `f${i}`);
    const chunks = chunk(ids);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(DELETE_CHUNK);
    expect(chunks[1]).toEqual([`f${DELETE_CHUNK}`]);
  });
});
