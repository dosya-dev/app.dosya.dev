import { describe, it, expect } from 'vitest';
import {
  MOVE_DRAG_TYPE, itemsForDrag, moveCount, encodeMovePayload, decodeMovePayload, isMoveDrag, canDropOn, canDragInView, mostCommon,
} from './drag-move';

const set = (...ids: string[]) => new Set(ids);

describe('itemsForDrag', () => {
  it('carries only the dragged file when it is not selected', () => {
    expect(itemsForDrag({ id: 'f9', kind: 'file' }, set('f1', 'f2'), set('d1'))).toEqual({ fileIds: ['f9'], folderIds: [] });
  });

  it('carries only the dragged folder when it is not selected', () => {
    expect(itemsForDrag({ id: 'd9', kind: 'folder' }, set('f1'), set('d1'))).toEqual({ fileIds: [], folderIds: ['d9'] });
  });

  it('carries the whole selection when the dragged file is part of it', () => {
    expect(itemsForDrag({ id: 'f2', kind: 'file' }, set('f1', 'f2'), set('d1'))).toEqual({ fileIds: ['f1', 'f2'], folderIds: ['d1'] });
  });

  it('carries the whole selection when the dragged folder is part of it', () => {
    expect(itemsForDrag({ id: 'd1', kind: 'folder' }, set('f1'), set('d1', 'd2'))).toEqual({ fileIds: ['f1'], folderIds: ['d1', 'd2'] });
  });

  it('does not confuse a file id with a selected folder id', () => {
    expect(itemsForDrag({ id: 'x', kind: 'file' }, set(), set('x'))).toEqual({ fileIds: ['x'], folderIds: [] });
  });

  it('counts both kinds', () => {
    expect(moveCount({ fileIds: ['a', 'b'], folderIds: ['c'] })).toBe(3);
  });
});

describe('payload encode/decode', () => {
  const payload = { workspaceId: 'ws_1', fileIds: ['f1'], folderIds: ['d1', 'd2'] };

  it('round-trips', () => {
    expect(decodeMovePayload(encodeMovePayload(payload))).toEqual(payload);
  });

  it('rejects empty, malformed and foreign data', () => {
    expect(decodeMovePayload('')).toBeNull();
    expect(decodeMovePayload(null)).toBeNull();
    expect(decodeMovePayload('not json')).toBeNull();
    expect(decodeMovePayload('"a string"')).toBeNull();
    expect(decodeMovePayload(JSON.stringify({ v: 2, ws: 'ws', files: ['a'], folders: [] }))).toBeNull();
    expect(decodeMovePayload(JSON.stringify({ v: 1, ws: '', files: ['a'], folders: [] }))).toBeNull();
    expect(decodeMovePayload(JSON.stringify({ v: 1, ws: 'ws', files: [1], folders: [] }))).toBeNull();
    expect(decodeMovePayload(JSON.stringify({ v: 1, ws: 'ws', files: [''], folders: [] }))).toBeNull();
    expect(decodeMovePayload(JSON.stringify({ v: 1, ws: 'ws', files: [], folders: [] }))).toBeNull();
  });
});

describe('isMoveDrag', () => {
  it('recognises the custom type and nothing else', () => {
    expect(isMoveDrag({ types: [MOVE_DRAG_TYPE] })).toBe(true);
    expect(isMoveDrag({ types: ['text/plain', MOVE_DRAG_TYPE] })).toBe(true);
    expect(isMoveDrag({ types: ['Files'] })).toBe(false);
    expect(isMoveDrag({ types: [] })).toBe(false);
    expect(isMoveDrag(null)).toBe(false);
  });
});

describe('canDropOn', () => {
  const items = { fileIds: ['f1'], folderIds: ['d1'] };

  it('accepts another folder', () => {
    expect(canDropOn(items, 'd5', 'here')).toBe(true);
  });

  it('accepts the root when the items are in a folder', () => {
    expect(canDropOn(items, null, 'here')).toBe(true);
  });

  it('refuses a folder being dragged', () => {
    expect(canDropOn(items, 'd1', 'here')).toBe(false);
  });

  it('refuses the folder the items are already in', () => {
    expect(canDropOn(items, 'here', 'here')).toBe(false);
    expect(canDropOn(items, null, null)).toBe(false);
  });

  it('lets the server judge when the source folder is unknown (group view)', () => {
    expect(canDropOn(items, null, undefined)).toBe(true);
    expect(canDropOn(items, 'here', undefined)).toBe(true);
    expect(canDropOn(items, 'd1', undefined)).toBe(false);
  });

  it('refuses an empty drag', () => {
    expect(canDropOn({ fileIds: [], folderIds: [] }, 'd5', 'here')).toBe(false);
  });
});

describe('canDragInView', () => {
  it('allows the folder listing only', () => {
    expect(canDragInView({ isDeleted: false, isHidden: false, isLibrary: false })).toBe(true);
    expect(canDragInView({ isDeleted: true, isHidden: false, isLibrary: false })).toBe(false);
    expect(canDragInView({ isDeleted: false, isHidden: true, isLibrary: false })).toBe(false);
    expect(canDragInView({ isDeleted: false, isHidden: false, isLibrary: true })).toBe(false);
  });
});

describe('mostCommon', () => {
  it('names the most frequent reason, the first on a tie, and null for none', () => {
    expect(mostCommon([])).toBeNull();
    expect(mostCommon(['a'])).toBe('a');
    expect(mostCommon(['a', 'b', 'b'])).toBe('b');
    expect(mostCommon(['a', 'b'])).toBe('a');
  });
});
