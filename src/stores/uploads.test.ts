import { describe, it, expect, beforeEach } from 'vitest';
import { useUploads, uploadSummary } from './uploads';
import { claimOwner, loadItems, saveItems } from '@/lib/upload-persistence';
import type { UploadItem } from '@/lib/upload-types';

function item(over: Partial<UploadItem>): UploadItem {
  return {
    id: 'a', session_id: null, fileName: 'f', fileSize: 100, mimeType: 't',
    workspace_id: 'ws', folder_id: null, status: 'queued',
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

describe('owner-scoped persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    useUploads.setState({ items: [] });
  });

  it('claimOwner keeps items for the same owner', () => {
    saveItems([item({ id: 'a' })]);
    claimOwner('user-1'); // first login stamps the owner
    expect(claimOwner('user-1')).toHaveLength(1);
  });

  it('claimOwner wipes items persisted by a different user', () => {
    saveItems([item({ id: 'a' })]);
    claimOwner('user-1');
    expect(claimOwner('user-2')).toHaveLength(0);
    expect(loadItems()).toHaveLength(0); // storage wiped too, not just filtered
  });

  it('legacy plain-array payloads are readable (owner: null)', () => {
    localStorage.setItem('dosya_uploads', JSON.stringify([item({ id: 'a' })]));
    expect(loadItems()).toHaveLength(1);
  });

  it('store reset() empties items and storage', () => {
    useUploads.getState().setItems([item({ id: 'a' })]);
    useUploads.getState().reset();
    expect(useUploads.getState().items).toHaveLength(0);
    expect(localStorage.getItem('dosya_uploads')).toBeNull();
  });

  it('store pruneForOwner discards items persisted by a different owner', () => {
    useUploads.getState().setItems([item({ id: 'a' })]);
    claimOwner('user-1');
    useUploads.getState().pruneForOwner('user-2');
    expect(useUploads.getState().items).toHaveLength(0);
  });
});

// F3 (field report): a batch with several failures is retried in one action.
describe('useUploads.retryAllFailed', () => {
  beforeEach(() => { localStorage.clear(); useUploads.setState({ items: [] }); });

  it('re-queues every error row, clears its message, and reports the ids', () => {
    useUploads.setState({ items: [
      item({ id: 'e1', status: 'error', error: 'boom' }),
      item({ id: 'ok', status: 'complete' }),
      item({ id: 'e2', status: 'error', error: 'nope' }),
      item({ id: 'up', status: 'uploading' }),
    ] });
    const { requeued, parked } = useUploads.getState().retryAllFailed();
    expect(requeued).toEqual(['e1', 'e2']);
    expect(parked).toEqual([]);
    const byId = Object.fromEntries(useUploads.getState().items.map((i) => [i.id, i]));
    expect(byId.e1.status).toBe('queued');
    expect(byId.e1.error).toBeUndefined();
    expect(byId.e2.status).toBe('queued');
    expect(byId.ok.status).toBe('complete');
    expect(byId.up.status).toBe('uploading');
  });

  // Fix round 1, MINOR (a): a row whose File is gone (this tab reloaded) can
  // never be retried, and clearing its message threw away the only record of
  // WHY it failed. It is parked for a re-pick with the reason intact.
  it('parks a row it cannot retry as interrupted, keeping its reason', () => {
    useUploads.setState({ items: [
      item({ id: 'live', status: 'error', error: 'boom' }),
      item({ id: 'ghost', status: 'error', error: 'File type .exe is not allowed in this workspace' }),
    ] });
    const { requeued, parked } = useUploads.getState().retryAllFailed((id) => id === 'live');
    expect(requeued).toEqual(['live']);
    expect(parked).toEqual(['ghost']);
    const byId = Object.fromEntries(useUploads.getState().items.map((i) => [i.id, i]));
    expect(byId.ghost.status).toBe('interrupted');
    expect(byId.ghost.error).toBe('File type .exe is not allowed in this workspace');
  });

  it('is a no-op with nothing failed', () => {
    useUploads.setState({ items: [item({ id: 'ok', status: 'complete' })] });
    expect(useUploads.getState().retryAllFailed()).toEqual({ requeued: [], parked: [] });
  });
});
