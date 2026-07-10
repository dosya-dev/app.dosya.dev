import { create } from 'zustand';
import type { UploadItem } from '@/lib/upload-types';
import { saveItems, loadAndHydrate } from '@/lib/upload-persistence';

export interface UploadSummary {
  total: number;
  active: number;       // queued + uploading
  done: number;         // complete
  failed: number;       // error
  interrupted: number;
  overallPct: number;   // by bytes across active items
  anyActive: boolean;
}

export function uploadSummary(items: UploadItem[]): UploadSummary {
  const active = items.filter((i) => i.status === 'queued' || i.status === 'uploading');
  const totalActiveBytes = active.reduce((s, i) => s + i.fileSize, 0);
  const doneActiveBytes = active.reduce((s, i) => s + i.bytesUploaded, 0);
  return {
    total: items.length,
    active: active.length,
    done: items.filter((i) => i.status === 'complete').length,
    failed: items.filter((i) => i.status === 'error').length,
    interrupted: items.filter((i) => i.status === 'interrupted').length,
    overallPct: totalActiveBytes > 0 ? Math.round((doneActiveBytes / totalActiveBytes) * 100) : 0,
    anyActive: active.length > 0,
  };
}

interface UploadsState {
  items: UploadItem[];
  addItems: (items: UploadItem[]) => void;
  patchItem: (id: string, patch: Partial<UploadItem>) => void;
  removeItem: (id: string) => void;
  clearFinished: () => void;
  setItems: (items: UploadItem[]) => void;
  hydrate: () => void;
}

export const useUploads = create<UploadsState>((set, get) => ({
  items: [],
  addItems: (newItems) => {
    const next = [...get().items, ...newItems];
    set({ items: next });
    saveItems(next);
  },
  patchItem: (id, patch) => {
    const next = get().items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    set({ items: next });
    saveItems(next);
  },
  removeItem: (id) => {
    const next = get().items.filter((i) => i.id !== id);
    set({ items: next });
    saveItems(next);
  },
  clearFinished: () => {
    const next = get().items.filter(
      (i) => i.status !== 'complete' && i.status !== 'error' && i.status !== 'canceled',
    );
    set({ items: next });
    saveItems(next);
  },
  setItems: (items) => {
    set({ items });
    saveItems(items);
  },
  hydrate: () => {
    const items = loadAndHydrate();
    set({ items });
    saveItems(items);
  },
}));
