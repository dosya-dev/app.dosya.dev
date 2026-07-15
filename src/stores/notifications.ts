import { create } from "zustand";
import type { NotificationItem } from "../lib/notifications";
import { isUnread } from "../lib/notifications";
import * as apiNotif from "../api/notifications";

export function applySummary(
  prev: { lastLatestId: string | null },
  summary: { unread: number; latest: NotificationItem | null },
): { unread: number; lastLatestId: string | null; hasNew: boolean } {
  const newId = summary.latest?.id ?? prev.lastLatestId;
  const hasNew = !!summary.latest && summary.latest.id !== prev.lastLatestId && prev.lastLatestId !== null;
  return { unread: summary.unread, lastLatestId: newId ?? null, hasNew };
}

interface NotifState {
  unread: number;
  items: NotificationItem[];
  open: boolean;
  loading: boolean;
  lastLatestId: string | null;
  onNew?: (item: NotificationItem) => void;
  setOpen: (open: boolean) => void;
  setOnNew: (cb: (item: NotificationItem) => void) => void;
  refreshSummary: () => Promise<void>;
  loadList: () => Promise<void>;
  markItemRead: (id: string) => Promise<void>;
  markAll: () => Promise<void>;
  dismissItem: (id: string) => Promise<void>;
}

export const useNotifications = create<NotifState>((set, get) => ({
  unread: 0,
  items: [],
  open: false,
  loading: false,
  lastLatestId: null,
  setOpen: (open) => {
    set({ open });
    if (open) get().loadList();
  },
  setOnNew: (cb) => set({ onNew: cb }),
  refreshSummary: async () => {
    try {
      const summary = await apiNotif.fetchSummary();
      const next = applySummary({ lastLatestId: get().lastLatestId }, summary);
      set({ unread: next.unread, lastLatestId: next.lastLatestId });
      if (next.hasNew && summary.latest) get().onNew?.(summary.latest);
    } catch { /* offline / transient — keep previous state */ }
  },
  loadList: async () => {
    set({ loading: true });
    try {
      const { items } = await apiNotif.fetchList();
      set({ items });
    } catch { /* keep previous */ }
    finally { set({ loading: false }); }
  },
  markItemRead: async (id) => {
    const wasUnread = !!get().items.find((i) => i.id === id && isUnread(i));
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, read_at: i.read_at ?? Math.floor(Date.now() / 1000) } : i)),
      unread: wasUnread ? Math.max(0, s.unread - 1) : s.unread,
    }));
    try { await apiNotif.markRead(id); } catch { get().refreshSummary(); }
  },
  markAll: async () => {
    set((s) => ({ items: s.items.map((i) => ({ ...i, read_at: i.read_at ?? Math.floor(Date.now() / 1000) })), unread: 0 }));
    try { await apiNotif.markAllRead(); } catch { get().refreshSummary(); }
  },
  dismissItem: async (id) => {
    const wasUnread = get().items.find((i) => i.id === id && isUnread(i));
    set((s) => ({ items: s.items.filter((i) => i.id !== id), unread: wasUnread ? Math.max(0, s.unread - 1) : s.unread }));
    try { await apiNotif.dismiss(id); } catch { get().refreshSummary(); }
  },
}));
