import { describe, it, expect, beforeEach } from 'vitest';
import { saveItems, loadItems, hydrateForBoot, loadAndHydrate } from './upload-persistence';
import type { UploadItem } from './upload-types';

function item(over: Partial<UploadItem>): UploadItem {
  return {
    id: 'a', session_id: null, fileName: 'f', fileSize: 10, mimeType: 't',
    workspace_id: 'ws', folder_id: null, region: 'r', status: 'queued',
    progress: 0, bytesUploaded: 0, part_size: null, total_parts: null,
    uploaded_parts: [], ...over,
  };
}

describe('upload-persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips items through localStorage', () => {
    const items = [item({ id: '1' }), item({ id: '2', status: 'complete' })];
    saveItems(items);
    expect(loadItems()).toEqual(items);
  });

  it('returns [] on missing or corrupt data', () => {
    expect(loadItems()).toEqual([]);
    localStorage.setItem('dosya_uploads', '{not json');
    expect(loadItems()).toEqual([]);
    localStorage.setItem('dosya_uploads', '{"a":1}'); // not an array
    expect(loadItems()).toEqual([]);
  });

  it('marks in-flight items interrupted on boot, keeps terminal ones', () => {
    const out = hydrateForBoot([
      item({ id: '1', status: 'uploading' }),
      item({ id: '2', status: 'queued' }),
      item({ id: '3', status: 'complete' }),
      item({ id: '4', status: 'error' }),
    ]);
    expect(out.map((i) => i.status)).toEqual([
      'interrupted', 'interrupted', 'complete', 'error',
    ]);
  });

  it('caps persisted items to the most recent 50', () => {
    const many = Array.from({ length: 60 }, (_, i) => item({ id: String(i) }));
    saveItems(many);
    const loaded = loadItems();
    expect(loaded).toHaveLength(50);
    expect(loaded[0].id).toBe('10');
    expect(loaded[49].id).toBe('59');
  });

  it('loadAndHydrate composes load + hydrate', () => {
    saveItems([item({ id: '1', status: 'uploading' })]);
    expect(loadAndHydrate()[0].status).toBe('interrupted');
  });
});
