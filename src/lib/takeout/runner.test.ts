// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildPlan, type Archive } from './plan';
import { resumeKey, TakeoutRun, type Deps, type MetaItem } from './runner';
import { UploadError } from './upload';
import type { ZipEntry } from './zip';

let crc = 1;
const entry = (name: string, size = 10): ZipEntry => ({
  name, isDir: false, size, storedSize: size, method: 0, localHeaderOffset: 0, crc32: crc++, encrypted: false, mtime: null,
});
const sidecar = JSON.stringify({ photoTakenTime: { timestamp: '1563096600' }, geoData: { latitude: 41.9, longitude: 12.5 } });

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

function setup(over: Partial<Deps> = {}, extra: ZipEntry[] = []) {
  const archives: Archive[] = [{
    file: { name: 'takeout-1-001.zip', size: 99 } as File,
    entries: [
      entry('Takeout/Google Photos/Trip/a.jpg'),
      entry('Takeout/Google Photos/Trip/a.jpg.supplemental-metadata.json'),
      entry('Takeout/Google Photos/Trip/b.jpg'),
      entry('Takeout/Drive/notes.txt'),
      ...extra,
    ],
  }];
  const plan = buildPlan(archives);
  const uploads: { folderId: string | null; name: string; mtimeMs: number }[] = [];
  const meta: MetaItem[][] = [];
  const folders: string[] = [];
  const storage = memoryStorage();
  const deps: Deps = {
    readEntry: async (_f, e) => new Blob([e.name.endsWith('.json') ? sidecar : 'bytes']),
    ensureFolder: async (path) => { folders.push(path); return `fld:${path}`; },
    upload: async (_b, t) => { uploads.push(t); return `file:${t.name}`; },
    postMeta: async (items) => { meta.push(items); },
    sleep: async () => {},
    storage,
    ...over,
  };
  return { archives, plan, deps, uploads, meta, folders, storage };
}

describe('TakeoutRun', () => {
  it('uploads every item into its folder and sends Google\'s date and place for the photo that has one', async () => {
    const s = setup();
    const run = new TakeoutRun(s.archives, s.plan, { workspaceId: 'w1', destFolderId: null, applyDates: true }, s.deps);
    expect(await run.run()).toBe('done');
    expect(s.uploads.map((u) => `${u.folderId}/${u.name}`).sort()).toEqual([
      'fld:Google Takeout/Drive/notes.txt', 'fld:Google Takeout/Google Photos/Trip/a.jpg', 'fld:Google Takeout/Google Photos/Trip/b.jpg',
    ]);
    // One create per folder, however many files land in it.
    expect(new Set(s.folders).size).toBe(s.folders.length);
    expect(s.meta.flat()).toEqual([{ file_id: 'file:a.jpg', captured_at: expect.stringMatching(/^2019-07-1\dT/), latitude: 41.9, longitude: 12.5 }]);
    expect(run.progress).toMatchObject({ total: 3, done: 3, datesApplied: 1, placesApplied: 1, failures: [] });
    // Finished runs leave no resume record behind.
    expect(s.storage.m.size).toBe(0);
  });

  it('sends no dates when the option is off', async () => {
    const s = setup();
    await new TakeoutRun(s.archives, s.plan, { workspaceId: 'w1', destFolderId: null, applyDates: false }, s.deps).run();
    expect(s.meta).toEqual([]);
  });

  it('resumes: files a previous session finished are not uploaded again', async () => {
    const s = setup();
    const first = s.plan.items.find((i) => i.name === 'a.jpg')!;
    s.storage.setItem(resumeKey('w1', 'dest'), JSON.stringify([first.key]));
    const run = new TakeoutRun(s.archives, s.plan, { workspaceId: 'w1', destFolderId: 'dest', applyDates: true }, s.deps);
    expect(run.progress).toMatchObject({ done: 1, resumed: 1 });
    await run.run();
    expect(s.uploads.map((u) => u.name).sort()).toEqual(['b.jpg', 'notes.txt']);
  });

  it('waits out the upload ceiling instead of failing the file', async () => {
    // A reloaded tab leaves its uploads counted for 10 minutes: 200 refusals at 3 s.
    let refusals = 200;
    const sleep = vi.fn(async () => {});
    const s = setup({ sleep });
    const upload = s.deps.upload;
    s.deps.upload = async (b, t) => {
      if (refusals-- > 0) throw new UploadError('Too many uploads in progress', 429);
      return upload(b, t);
    };
    const run = new TakeoutRun(s.archives, s.plan, { workspaceId: 'w1', destFolderId: null, applyDates: true }, s.deps);
    expect(await run.run()).toBe('done');
    expect(run.progress.failures).toEqual([]);
    expect(sleep).toHaveBeenCalledWith(3_000);
  });

  it('records a file that keeps failing and carries on with the rest', async () => {
    const s = setup();
    const upload = s.deps.upload;
    s.deps.upload = async (b, t) => { if (t.name === 'b.jpg') throw new UploadError('Server error', 500); return upload(b, t); };
    const run = new TakeoutRun(s.archives, s.plan, { workspaceId: 'w1', destFolderId: null, applyDates: true }, s.deps);
    expect(await run.run()).toBe('done');
    expect(run.progress.failures).toEqual([{ name: 'b.jpg', dir: 'Google Takeout/Google Photos/Trip', reason: 'Server error' }]);
    expect(s.uploads).toHaveLength(2);
  });

  it('stops at once when the workspace is out of storage', async () => {
    const s = setup({ upload: async () => { throw new UploadError('Storage limit reached', 413); } });
    const run = new TakeoutRun(s.archives, s.plan, { workspaceId: 'w1', destFolderId: null, applyDates: true }, s.deps);
    expect(await run.run()).toBe('stopped');
    expect(run.stoppedBecause).toBe('Storage limit reached');
  });

  it('pauses after the files in flight, and keeps what finished for the resume', async () => {
    const s = setup({}, ['1', '2', '3', '4', '5'].map((n) => entry(`Takeout/Drive/more-${n}.txt`)));
    let run!: TakeoutRun;
    const upload = s.deps.upload;
    s.deps.upload = async (b, t) => { run.pause(); return upload(b, t); };
    run = new TakeoutRun(s.archives, s.plan, { workspaceId: 'w1', destFolderId: null, applyDates: true }, s.deps);
    expect(await run.run()).toBe('paused');
    const saved = JSON.parse(s.storage.getItem(resumeKey('w1', null))!);
    expect(saved).toHaveLength(s.uploads.length);
    expect(s.uploads.length).toBeLessThan(s.plan.items.length);
  });
});
