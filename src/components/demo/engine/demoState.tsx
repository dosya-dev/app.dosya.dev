import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import {
  CANNED_UPLOADS, SEED_ACTIVITY, SEED_FILES, SEED_FOLDERS, kindOf, shareSlug,
  type DemoActivityRow, type DemoFile, type DemoFolder, type DemoThemeId, type DemoUpload,
} from './demoData';

export type SortKey = 'name' | 'size' | 'modified' | 'region';
export interface SortSpec { key: SortKey; dir: 'asc' | 'desc' }
export interface DemoToastState { text: string; cta?: boolean }

export interface DemoState {
  folderId: string | null;
  tab: 'files' | 'activity';
  view: 'list' | 'grid';
  sort: SortSpec;
  files: DemoFile[];
  folders: DemoFolder[];
  uploads: DemoUpload[];
  activity: DemoActivityRow[];
  previewFileId: string | null;
  shareFileId: string | null;
  shareLink: string | null;
  theme: DemoThemeId;
  toast: DemoToastState | null;
  uploadSeq: number;
}

export type DemoAction =
  | { type: 'NAVIGATE'; folderId: string | null }
  | { type: 'SET_TAB'; tab: DemoState['tab'] }
  | { type: 'SET_VIEW'; view: DemoState['view'] }
  | { type: 'TOGGLE_SORT'; key: SortKey }
  | { type: 'START_UPLOAD'; name?: string; sizeBytes?: number }
  | { type: 'TICK_UPLOADS'; step: number }
  | { type: 'OPEN_SHARE'; fileId: string }
  | { type: 'CREATE_LINK' }
  | { type: 'CLOSE_SHARE' }
  | { type: 'PREVIEW'; fileId: string | null }
  | { type: 'SET_THEME'; theme: DemoThemeId }
  | { type: 'TOAST'; toast: DemoToastState | null };

// First-click sort direction per column (mirrors apps/web list-sort semantics).
const FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = { name: 'asc', region: 'asc', size: 'desc', modified: 'desc' };

export const initialDemoState: DemoState = {
  folderId: null, tab: 'files', view: 'grid',
  sort: { key: 'modified', dir: 'desc' },
  files: SEED_FILES, folders: SEED_FOLDERS, uploads: [], activity: SEED_ACTIVITY,
  previewFileId: null, shareFileId: null, shareLink: null,
  theme: 'claude', toast: null, uploadSeq: 0,
};

export function demoReducer(s: DemoState, a: DemoAction): DemoState {
  switch (a.type) {
    case 'NAVIGATE': return { ...s, folderId: a.folderId, tab: 'files', previewFileId: null };
    case 'SET_TAB': return { ...s, tab: a.tab, previewFileId: null };
    case 'SET_VIEW': return { ...s, view: a.view };
    case 'TOGGLE_SORT': {
      const dir = s.sort.key === a.key ? (s.sort.dir === 'asc' ? 'desc' : 'asc') : FIRST_DIR[a.key];
      return { ...s, sort: { key: a.key, dir } };
    }
    case 'START_UPLOAD': {
      const canned = CANNED_UPLOADS[s.uploadSeq % CANNED_UPLOADS.length];
      const up: DemoUpload = {
        id: `up-${s.uploadSeq}`,
        name: a.name ?? canned.name,
        sizeBytes: a.sizeBytes ?? canned.sizeBytes,
        progress: 0,
        folderId: s.folderId,
      };
      return { ...s, uploads: [...s.uploads, up], uploadSeq: s.uploadSeq + 1 };
    }
    case 'TICK_UPLOADS': {
      if (!s.uploads.length) return s;
      const done: DemoUpload[] = [];
      const uploads: DemoUpload[] = [];
      for (const u of s.uploads) {
        const progress = Math.min(100, u.progress + a.step);
        if (progress >= 100) done.push({ ...u, progress: 100 });
        else uploads.push({ ...u, progress });
      }
      if (!done.length) return { ...s, uploads };
      const newFiles: DemoFile[] = done.map((u, i) => ({
        id: `new-${u.id}`, name: u.name, sizeBytes: u.sizeBytes, region: 'SYD',
        modified: 'Just now', modifiedRank: 1000 + s.uploadSeq * 10 + i,
        folderId: u.folderId, kind: kindOf(u.name),
      }));
      const newRows: DemoActivityRow[] = done.map((u) => ({
        id: `act-${u.id}`, color: '#22c55e', text: `You uploaded ${u.name}`, meta: 'This demo · Just now',
      }));
      return {
        ...s, uploads,
        files: [...newFiles, ...s.files],
        activity: [...newRows, ...s.activity],
        toast: { text: `${done[0].name} uploaded to SYD - like it?`, cta: true },
      };
    }
    case 'OPEN_SHARE': return { ...s, shareFileId: a.fileId, shareLink: null };
    case 'CREATE_LINK': {
      if (!s.shareFileId) return s;
      const file = s.files.find((f) => f.id === s.shareFileId);
      const row: DemoActivityRow = {
        id: `act-share-${s.shareFileId}-${s.activity.length}`,
        color: '#3b82f6', text: `You shared ${file?.name ?? 'a file'}`, meta: 'This demo · Just now',
      };
      return {
        ...s,
        shareLink: `https://dosya.dev/s/${shareSlug()}`,
        activity: [row, ...s.activity],
        files: s.files.map((f) => (f.id === s.shareFileId ? { ...f, shared: true } : f)),
      };
    }
    case 'CLOSE_SHARE': return { ...s, shareFileId: null, shareLink: null };
    case 'PREVIEW': return { ...s, previewFileId: a.fileId };
    case 'SET_THEME': return { ...s, theme: a.theme };
    case 'TOAST': return { ...s, toast: a.toast };
    default: return s;
  }
}

export function visibleItems(s: DemoState): { folders: DemoFolder[]; files: DemoFile[] } {
  const folders = s.folders
    .filter((f) => f.parentId === s.folderId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [...s.files.filter((f) => f.folderId === s.folderId)].sort((a, b) => {
    const m = s.sort.dir === 'asc' ? 1 : -1;
    switch (s.sort.key) {
      case 'name': return m * a.name.localeCompare(b.name);
      case 'size': return m * (a.sizeBytes - b.sizeBytes);
      case 'modified': return m * (a.modifiedRank - b.modifiedRank);
      case 'region': return m * a.region.localeCompare(b.region);
    }
  });
  return { folders, files };
}

export function breadcrumbs(s: DemoState): DemoFolder[] {
  const trail: DemoFolder[] = [];
  let cur = s.folders.find((f) => f.id === s.folderId);
  while (cur) {
    trail.unshift(cur);
    const parentId: string | null = cur.parentId;
    cur = s.folders.find((f) => f.id === parentId);
  }
  return trail;
}

interface DemoCtx { state: DemoState; dispatch: Dispatch<DemoAction> }
const DemoContext = createContext<DemoCtx | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(demoReducer, initialDemoState);

  // Upload ticker: advances all in-flight uploads. Reduced motion → finish instantly.
  const uploading = state.uploads.length > 0;
  useEffect(() => {
    if (!uploading) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = window.setInterval(() => dispatch({ type: 'TICK_UPLOADS', step: reduced ? 100 : 4 }), 90);
    return () => window.clearInterval(id);
  }, [uploading]);

  // Auto-dismiss plain toasts; CTA toasts stay until dismissed.
  const toast = state.toast;
  useEffect(() => {
    if (!toast || toast.cta) return;
    const id = window.setTimeout(() => dispatch({ type: 'TOAST', toast: null }), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoCtx {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error('useDemo must be used inside DemoProvider');
  return ctx;
}
