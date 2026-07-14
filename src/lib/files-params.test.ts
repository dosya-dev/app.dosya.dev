import { describe, it, expect } from 'vitest';
import { folderNavParams, filterNavParams, groupNavParams } from './files-params';

const q = (s: string) => new URLSearchParams(s);

describe('folderNavParams', () => {
  it('keeps the active type filter when opening a folder', () => {
    const p = folderNavParams(q('filter=images'), 'fold_1');
    expect(p.get('filter')).toBe('images');
    expect(p.get('folder')).toBe('fold_1');
  });

  it('keeps the filter across nested folder hops', () => {
    let p = folderNavParams(q('filter=images'), 'fold_1');
    p = folderNavParams(p, 'fold_2');
    p = folderNavParams(p, 'fold_3');
    expect(p.get('filter')).toBe('images');
    expect(p.get('folder')).toBe('fold_3');
  });

  it('keeps the filter when walking back up to root', () => {
    const p = folderNavParams(q('filter=images&folder=fold_9'), null);
    expect(p.get('filter')).toBe('images');
    expect(p.has('folder')).toBe(false);
  });

  it('resets pagination when the folder changes', () => {
    const p = folderNavParams(q('filter=images&page=4'), 'fold_1');
    expect(p.has('page')).toBe(false);
  });

  it('leaves the group view when navigating into a folder', () => {
    const p = folderNavParams(q('group=grp_1'), 'fold_1');
    expect(p.has('group')).toBe(false);
    expect(p.get('folder')).toBe('fold_1');
  });

  it('drops the one-shot file deep-link param', () => {
    const p = folderNavParams(q('filter=images&file=file_1'), 'fold_1');
    expect(p.has('file')).toBe(false);
  });

  it('does not mutate the params it was given', () => {
    const current = q('filter=images&folder=fold_1');
    folderNavParams(current, 'fold_2');
    expect(current.get('folder')).toBe('fold_1');
  });
});

describe('filterNavParams', () => {
  it('keeps the current folder so the filter applies in place', () => {
    const p = filterNavParams(q('folder=fold_1'), 'images');
    expect(p.get('folder')).toBe('fold_1');
    expect(p.get('filter')).toBe('images');
  });

  it('clears the filter for the All item', () => {
    const p = filterNavParams(q('filter=images&folder=fold_1'), '');
    expect(p.has('filter')).toBe(false);
    expect(p.get('folder')).toBe('fold_1');
  });

  it('resets pagination and leaves the group view', () => {
    const p = filterNavParams(q('page=3&group=grp_1'), 'videos');
    expect(p.has('page')).toBe(false);
    expect(p.has('group')).toBe(false);
  });
});

describe('groupNavParams', () => {
  it('opens the group as a flat view, dropping folder and filter', () => {
    const p = groupNavParams(q('filter=images&folder=fold_1&page=2'), 'grp_1');
    expect(p.get('group')).toBe('grp_1');
    expect(p.has('folder')).toBe(false);
    expect(p.has('filter')).toBe(false);
    expect(p.has('page')).toBe(false);
  });
});
