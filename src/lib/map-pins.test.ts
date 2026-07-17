import { describe, it, expect } from 'vitest';
import { mapPinsQuery } from './map-pins';

describe('mapPinsQuery', () => {
  it('workspace only when no filters', () => {
    expect(mapPinsQuery('ws_1')).toBe('workspace_id=ws_1');
    expect(mapPinsQuery('ws_1', {})).toBe('workspace_id=ws_1');
  });

  it('adds folder_id when a folder is set', () => {
    const q = new URLSearchParams(mapPinsQuery('ws_1', { folderId: 'fold_9' }));
    expect(q.get('workspace_id')).toBe('ws_1');
    expect(q.get('folder_id')).toBe('fold_9');
    expect(q.has('from')).toBe(false);
  });

  it('adds from/to when dates are set', () => {
    const q = new URLSearchParams(mapPinsQuery('ws_1', { from: 100, to: 200 }));
    expect(q.get('from')).toBe('100');
    expect(q.get('to')).toBe('200');
  });

  it('omits null/undefined filters and ignores the UI-only folderName', () => {
    const q = new URLSearchParams(mapPinsQuery('ws_1', { folderId: null, from: null, to: 500, folderName: 'Trip' }));
    expect(q.has('folder_id')).toBe(false);
    expect(q.has('from')).toBe(false);
    expect(q.get('to')).toBe('500');
    expect(q.has('folderName')).toBe(false);
  });

  it('includes from=0 (epoch start) rather than dropping it', () => {
    // 0 is a valid bound; only null/undefined are omitted.
    expect(new URLSearchParams(mapPinsQuery('ws_1', { from: 0 })).get('from')).toBe('0');
  });
});
