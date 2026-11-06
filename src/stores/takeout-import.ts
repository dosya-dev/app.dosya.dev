import { create } from 'zustand';
import { api } from '@/api/client';
import { t } from '@/lib/i18n';
import { buildPlan, ROOT_FOLDER, type Archive, type Plan } from '@/lib/takeout/plan';
import { RateMeter } from '@/lib/takeout/rate';
import { TakeoutRun, type Deps, type Progress } from '@/lib/takeout/runner';
import { uploadBlob } from '@/lib/takeout/upload';
import { entryBlob, fileReader, readZipDirectory, ZipError, type ZipEntry, type ZipErrorCode } from '@/lib/takeout/zip';

/**
 * The Google Takeout import on /integrations/google-takeout.
 *
 * Module-level on purpose: the File handles live only in this tab, and
 * keeping them here (not in the page) lets an import keep running while the
 * user looks at other pages of the app.
 */

export interface ChosenArchive {
  file: File;
  status: 'reading' | 'ok' | 'error';
  error?: ZipErrorCode;
  entries?: ZipEntry[];
}

export type Phase = 'pick' | 'ready' | 'running' | 'paused' | 'stopped' | 'done';

interface TakeoutState {
  archives: ChosenArchive[];
  applyDates: boolean;
  dedupeAlbums: boolean;
  dest: { id: string | null; name: string };
  plan: Plan | null;
  phase: Phase;
  progress: Progress | null;
  /** Upload speed in bytes per second while running; null until measured. */
  bps: number | null;
  stoppedBecause: string | null;
  /** The Google Takeout folder, once a run has finished, for "Open folder". */
  rootFolderId: string | null;
  addFiles: (files: File[]) => void;
  removeArchive: (index: number) => void;
  setOption: (key: 'applyDates' | 'dedupeAlbums', value: boolean) => void;
  setDest: (id: string | null, name: string) => void;
  start: (workspaceId: string) => Promise<void>;
  pause: () => void;
  reset: () => void;
}

let current: TakeoutRun | null = null;

const readyArchives = (archives: ChosenArchive[]): Archive[] =>
  archives.filter((a) => a.status === 'ok').map((a) => ({ file: a.file, entries: a.entries! }));

function replan(s: Pick<TakeoutState, 'archives' | 'dedupeAlbums'>): Plan | null {
  const ready = readyArchives(s.archives);
  return ready.length ? buildPlan(ready, { dedupeAlbums: s.dedupeAlbums }) : null;
}

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function realDeps(workspaceId: string): Deps {
  return {
    readEntry: entryBlob,
    async ensureFolder(path, parentId) {
      // A multi-segment name creates the missing folders and reuses the ones
      // that exist, so a resumed import lands in the same folders.
      const res = await api<{ ok: boolean; error?: string; folder?: { id: string } }>('/api/folders', {
        method: 'POST', body: JSON.stringify({ workspace_id: workspaceId, parent_id: parentId, name: path }),
      });
      if (!res.ok || !res.folder?.id) throw new Error(res.error ?? t('common.error.couldNotCreateFolder'));
      return res.folder.id;
    },
    upload: (blob, target) => uploadBlob(blob, { workspaceId, ...target }),
    async postMeta(items) {
      await api('/api/files/takeout-metadata', { method: 'POST', body: JSON.stringify({ workspace_id: workspaceId, items }) });
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    storage: storage(),
  };
}

const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };

export const useTakeoutImport = create<TakeoutState>((set, get) => ({
  archives: [],
  applyDates: true,
  dedupeAlbums: true,
  dest: { id: null, name: '' },
  plan: null,
  phase: 'pick',
  progress: null,
  bps: null,
  stoppedBecause: null,
  rootFolderId: null,

  addFiles(files) {
    const { archives } = get();
    const known = new Set(archives.map((a) => `${a.file.name}|${a.file.size}`));
    const fresh = files.filter((f) => !known.has(`${f.name}|${f.size}`));
    if (fresh.length === 0) return;
    set({ archives: [...archives, ...fresh.map((file) => ({ file, status: 'reading' as const }))].sort((a, b) => a.file.name.localeCompare(b.file.name)), phase: 'ready' });
    fresh.forEach(async (file) => {
      let patch: Partial<ChosenArchive>;
      try {
        patch = { status: 'ok', entries: await readZipDirectory(fileReader(file), file.size) };
      } catch (err) {
        patch = { status: 'error', error: err instanceof ZipError ? err.code : 'damaged' };
      }
      set((s) => {
        const next = s.archives.map((a) => (a.file === file ? { ...a, ...patch } : a));
        return { archives: next, plan: replan({ archives: next, dedupeAlbums: s.dedupeAlbums }) };
      });
    });
  },

  removeArchive(index) {
    set((s) => {
      const archives = s.archives.filter((_, i) => i !== index);
      return { archives, plan: replan({ archives, dedupeAlbums: s.dedupeAlbums }), phase: archives.length ? s.phase : 'pick' };
    });
  },

  setOption(key, value) {
    set((s) => {
      const next = { ...s, [key]: value };
      return { [key]: value, plan: key === 'dedupeAlbums' ? replan(next) : s.plan } as Partial<TakeoutState>;
    });
  },

  setDest(id, name) { set({ dest: { id, name } }); },

  async start(workspaceId) {
    const s = get();
    if (!s.plan || current) return;
    const meter = new RateMeter();
    const run = new TakeoutRun(
      readyArchives(s.archives), s.plan,
      { workspaceId, destFolderId: s.dest.id, applyDates: s.applyDates },
      realDeps(workspaceId),
      (p) => {
        meter.add(Date.now(), p.doneBytes);
        set({ progress: { ...p, failures: [...p.failures] }, bps: meter.bps() });
      },
    );
    current = run;
    meter.add(Date.now(), run.progress.doneBytes);
    set({ phase: 'running', progress: { ...run.progress }, bps: null, stoppedBecause: null });
    window.addEventListener('beforeunload', onBeforeUnload);
    const deps = realDeps(workspaceId);
    try {
      const outcome = await run.run();
      if (outcome === 'done') {
        // The folder already exists; this only reads its id back.
        set({ rootFolderId: await deps.ensureFolder(ROOT_FOLDER, s.dest.id).catch(() => null) });
      }
      set({
        phase: outcome === 'done' ? 'done' : outcome,
        progress: { ...run.progress, failures: [...run.progress.failures] },
        bps: null,
        stoppedBecause: run.stoppedBecause,
      });
    } finally {
      current = null;
      window.removeEventListener('beforeunload', onBeforeUnload);
    }
  },

  pause() { current?.pause(); },

  reset() {
    if (current) return;
    set({ archives: [], plan: null, phase: 'pick', progress: null, bps: null, stoppedBecause: null, rootFolderId: null });
  },
}));
