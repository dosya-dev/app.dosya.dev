import { describe, it, expect } from 'vitest';
import { serializeSort, parseSort, toggleSort, DEFAULT_SORT, type SortSpec } from './list-sort';

describe('serializeSort', () => {
  it('keeps the legacy wire names for the six original modes', () => {
    expect(serializeSort({ key: 'created', dir: 'desc' })).toBe('newest');
    expect(serializeSort({ key: 'created', dir: 'asc' })).toBe('oldest');
    expect(serializeSort({ key: 'name', dir: 'asc' })).toBe('name_asc');
    expect(serializeSort({ key: 'name', dir: 'desc' })).toBe('name_desc');
    expect(serializeSort({ key: 'size', dir: 'desc' })).toBe('largest');
    expect(serializeSort({ key: 'size', dir: 'asc' })).toBe('smallest');
  });

  it('uses <key>_<dir> for every other column', () => {
    expect(serializeSort({ key: 'uploader', dir: 'asc' })).toBe('uploader_asc');
    expect(serializeSort({ key: 'modified', dir: 'desc' })).toBe('modified_desc');
    expect(serializeSort({ key: 'shares', dir: 'desc' })).toBe('shares_desc');
  });
});

describe('parseSort', () => {
  it('round-trips every key in both directions', () => {
    const keys: SortSpec['key'][] = [
      'name', 'size', 'created', 'modified', 'type', 'extension',
      'version', 'uploader', 'region', 'origin', 'shares', 'comments',
    ];
    for (const key of keys) {
      for (const dir of ['asc', 'desc'] as const) {
        expect(parseSort(serializeSort({ key, dir }))).toEqual({ key, dir });
      }
    }
  });

  it('falls back to the default for unknown values', () => {
    expect(parseSort('banana')).toEqual(DEFAULT_SORT);
    expect(parseSort('banana_asc')).toEqual(DEFAULT_SORT);
    expect(parseSort('')).toEqual(DEFAULT_SORT);
  });
});

describe('toggleSort', () => {
  it('flips direction when clicking the active column', () => {
    expect(toggleSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(toggleSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });

  it('starts text columns ascending and numeric/date columns descending', () => {
    const from: SortSpec = { key: 'created', dir: 'desc' };
    expect(toggleSort(from, 'uploader')).toEqual({ key: 'uploader', dir: 'asc' });
    expect(toggleSort(from, 'origin')).toEqual({ key: 'origin', dir: 'asc' });
    expect(toggleSort(from, 'size')).toEqual({ key: 'size', dir: 'desc' });
    expect(toggleSort(from, 'modified')).toEqual({ key: 'modified', dir: 'desc' });
    expect(toggleSort({ key: 'size', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });
});
