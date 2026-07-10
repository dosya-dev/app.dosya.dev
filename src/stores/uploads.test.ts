import { describe, it, expect, beforeEach } from 'vitest';
import { useUploads, uploadSummary } from './uploads';
import type { UploadItem } from '@/lib/upload-types';

function item(over: Partial<UploadItem>): UploadItem {
  return {
    id: 'a', session_id: null, fileName: 'f', fileSize: 100, mimeType: 't',
    workspace_id: 'ws', folder_id: null, region: 'r', status: 'queued',
    progress: 0, bytesUploaded: 0, part_size: null, total_parts: null,
    uploaded_parts: [], ...over,
  };
}

describe('uploadSummary', () => {
  it('counts states and computes overall percent by active bytes', () => {
    const s = uploadSummary([
      item({ id: '1', status: 'uploading', fileSize: 100, bytesUploaded: 50 }),
      item({ id: '2', status: 'queued', fileSize: 100, bytesUploaded: 0 }),
      item({ id: '3', status: 'complete', fileSize: 100, bytesUploaded: 100 }),
      item({ id: '4', status: 'error' }),
      item({ id: '5', status: 'interrupted' }),
    ]);
    expect(s.total).toBe(5);
    expect(s.active).toBe(2);          // uploading + queued
    expect(s.done).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.interrupted).toBe(1);
    expect(s.overallPct).toBe(25);     // 50 of 200 active bytes
    expect(s.anyActive).toBe(true);
  });

  it('overallPct is 0 with no active items', () => {
    expect(uploadSummary([item({ status: 'complete' })]).overallPct).toBe(0);
  });
});

describe('useUploads', () => {
  beforeEach(() => { localStorage.clear(); useUploads.setState({ items: [] }); });

  it('addItems, patchItem, removeItem mutate state', () => {
    useUploads.getState().addItems([item({ id: '1' }), item({ id: '2' })]);
    expect(useUploads.getState().items).toHaveLength(2);
    useUploads.getState().patchItem('1', { status: 'uploading', progress: 40 });
    expect(useUploads.getState().items.find((i) => i.id === '1')!.progress).toBe(40);
    useUploads.getState().removeItem('2');
    expect(useUploads.getState().items.map((i) => i.id)).toEqual(['1']);
  });

  it('clearFinished drops complete/error/canceled, keeps active/interrupted', () => {
    useUploads.getState().addItems([
      item({ id: '1', status: 'complete' }),
      item({ id: '2', status: 'error' }),
      item({ id: '3', status: 'canceled' }),
      item({ id: '4', status: 'uploading' }),
      item({ id: '5', status: 'interrupted' }),
    ]);
    useUploads.getState().clearFinished();
    expect(useUploads.getState().items.map((i) => i.id)).toEqual(['4', '5']);
  });

  it('mutations persist to localStorage; hydrate marks interrupted', () => {
    useUploads.getState().addItems([item({ id: '1', status: 'uploading' })]);
    // simulate reload: reset in-memory state, hydrate from storage
    useUploads.setState({ items: [] });
    useUploads.getState().hydrate();
    expect(useUploads.getState().items[0].status).toBe('interrupted');
  });
});
