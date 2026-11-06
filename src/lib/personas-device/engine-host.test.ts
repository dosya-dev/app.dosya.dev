import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonasEngine, type EngineStatus } from '@dosya-dev/personas-engine';
import { useE2ee } from '@/stores/e2ee';
import { useSession } from '@/stores/session';
import { guardFiles, guardReader, personasEngine, personasPhotoRows, runReadLoop, stopPersonasEngines, unlockPersonas, type LoopDoc, type LoopEngine, type ReadLoop } from './engine-host';
import { ReaderUnavailableError } from './reader';
import { PersonasUnavailableError } from './errors';
import { teardownPersonas } from './teardown';

class FakeDoc implements LoopDoc {
  hidden = false;
  private fns = new Set<() => void>();
  addEventListener(_: 'visibilitychange', fn: () => void) {
    this.fns.add(fn);
  }
  removeEventListener(_: 'visibilitychange', fn: () => void) {
    this.fns.delete(fn);
  }
  setHidden(h: boolean) {
    this.hidden = h;
    for (const f of this.fns) f();
  }
}

const READY: EngineStatus = { state: 'ready', read: 0, total: null, reading: false, paused: false };

class FakeEngine implements LoopEngine {
  st: EngineStatus = READY;
  statusError: unknown = null;
  calls: { max: number; signal?: AbortSignal }[] = [];
  /** What each readSome resolves with, in order; then 0. */
  results: number[] = [];
  gate: Promise<void> | null = null;
  private fns = new Set<() => void>();
  async status() {
    if (this.statusError) throw this.statusError;
    return this.st;
  }
  async readSome(max: number, signal?: AbortSignal) {
    this.calls.push({ max, signal });
    if (this.gate) await this.gate;
    return this.results.shift() ?? 0;
  }
  subscribe(fn: () => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  notify() {
    for (const f of this.fns) f();
  }
}

let loop: ReadLoop | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  loop?.stop();
  loop = null;
  vi.useRealTimers();
});

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe('runReadLoop', () => {
  it('reads 50 at a time while there is work, then waits before looking again', async () => {
    const doc = new FakeDoc();
    const engine = new FakeEngine();
    engine.results = [50, 50, 3];
    loop = runReadLoop(engine, { doc, idleMs: 120_000 });
    await tick(10);
    expect(engine.calls.map((c) => c.max)).toEqual([50, 50, 50, 50]);
    await tick(119_000);
    expect(engine.calls).toHaveLength(4);
    await tick(2_000);
    expect(engine.calls).toHaveLength(5);
  });

  it('does not read while the document is hidden, and stops mid-read when it is hidden', async () => {
    const doc = new FakeDoc();
    doc.hidden = true;
    const engine = new FakeEngine();
    loop = runReadLoop(engine, { doc });
    await tick(600_000);
    expect(engine.calls).toHaveLength(0);

    let release!: () => void;
    engine.gate = new Promise((r) => (release = r));
    engine.results = [50, 50, 50];
    doc.setHidden(false);
    await tick();
    expect(engine.calls).toHaveLength(1);
    const signal = engine.calls[0].signal!;
    expect(signal.aborted).toBe(false);
    doc.setHidden(true);
    expect(signal.aborted).toBe(true);
    release();
    engine.gate = null;
    await tick(600_000);
    expect(engine.calls).toHaveLength(1);

    doc.setHidden(false);
    await tick();
    expect(engine.calls.length).toBeGreaterThan(1);
  });

  it('waits while not ready or paused and resumes when the engine says something changed', async () => {
    const doc = new FakeDoc();
    const engine = new FakeEngine();
    engine.st = { state: 'needs_unlock' };
    loop = runReadLoop(engine, { doc });
    await tick(30_000);
    expect(engine.calls).toHaveLength(0);
    engine.st = { ...READY, paused: true };
    engine.notify();
    await tick();
    expect(engine.calls).toHaveLength(0);
    engine.st = READY;
    engine.notify();
    await tick();
    expect(engine.calls).toHaveLength(1);
  });

  it('backs off after an error and tries again', async () => {
    const doc = new FakeDoc();
    const engine = new FakeEngine();
    engine.statusError = new Error('offline');
    loop = runReadLoop(engine, { doc, retryMs: 30_000 });
    await tick(29_000);
    expect(engine.calls).toHaveLength(0);
    engine.statusError = null;
    await tick(2_000);
    expect(engine.calls).toHaveLength(1);
  });

  it('stop() aborts the read and ends the loop', async () => {
    const doc = new FakeDoc();
    const engine = new FakeEngine();
    let release!: () => void;
    engine.gate = new Promise((r) => (release = r));
    engine.results = [50, 50];
    const end = runReadLoop(engine, { doc });
    await tick();
    end.stop();
    expect(engine.calls[0].signal!.aborted).toBe(true);
    release();
    await tick(600_000);
    expect(engine.calls).toHaveLength(1);
  });

  it('interrupt() aborts the read in flight and tries again after the retry delay', async () => {
    const doc = new FakeDoc();
    const engine = new FakeEngine();
    let release!: () => void;
    engine.gate = new Promise((r) => (release = r));
    engine.results = [50];
    loop = runReadLoop(engine, { doc, retryMs: 30_000 });
    await tick();
    loop.interrupt();
    expect(engine.calls[0].signal!.aborted).toBe(true);
    release();
    engine.gate = null;
    await tick(29_000);
    expect(engine.calls).toHaveLength(1);
    await tick(2_000);
    expect(engine.calls).toHaveLength(2);
  });
});

describe('guardReader', () => {
  it('reports an unavailable reader before the engine sees the error, and passes everything else through', async () => {
    const seen: string[] = [];
    let fail: Error | null = new ReaderUnavailableError('models missing');
    const reader = guardReader({ read: async () => { if (fail) throw fail; return []; } }, () => seen.push('unavailable'));
    await expect(reader.read(new Uint8Array())).rejects.toBeInstanceOf(ReaderUnavailableError);
    expect(seen).toEqual(['unavailable']);
    fail = new Error('photo');
    await expect(reader.read(new Uint8Array())).rejects.toThrow('photo');
    expect(seen).toEqual(['unavailable']);
    fail = null;
    expect(await reader.read(new Uint8Array())).toEqual([]);
  });
});

describe('guardFiles', () => {
  it('reports a rendition that is unavailable (not the photo\'s fault) before the engine sees it', async () => {
    const seen: string[] = [];
    let fail: Error | null = new PersonasUnavailableError('offline');
    const files = guardFiles({ candidates: async function* () {}, rendition: async () => { if (fail) throw fail; return new Uint8Array([1]); } }, () => seen.push('x'));
    await expect(files.rendition('f', 1)).rejects.toBeInstanceOf(PersonasUnavailableError);
    expect(seen).toEqual(['x']);
    fail = new Error('404');
    await expect(files.rendition('f', 1)).rejects.toThrow('404');
    expect(seen).toEqual(['x']);
  });
});

describe('personasEngine and unlockPersonas', () => {
  afterEach(() => {
    stopPersonasEngines();
    useSession.setState({ user: null });
    vi.restoreAllMocks();
  });

  it('"Read on this device" off is remembered per user and workspace on this device', () => {
    localStorage.clear();
    useSession.setState({ user: { id: 'u1' } as never });
    const a = personasEngine('w1');
    expect(a.isPaused()).toBe(false);
    a.setPaused(true);
    expect(a.isPaused()).toBe(true);
    expect(localStorage.getItem('dosya.personas.paused:u1:w1')).toBe('1');
    stopPersonasEngines();
    const b = personasEngine('w1');
    expect(b).not.toBe(a);
    expect(b.isPaused()).toBe(true);
    expect(personasEngine('w2').isPaused()).toBe(false);
    useSession.setState({ user: { id: 'u2' } as never });
    expect(personasEngine('w1').isPaused()).toBe(false);
    useSession.setState({ user: { id: 'u1' } as never });
    personasEngine('w1').setPaused(false);
    expect(localStorage.getItem('dosya.personas.paused:u1:w1')).toBeNull();
    stopPersonasEngines();
    expect(personasEngine('w1').isPaused()).toBe(false);
    localStorage.clear();
  });

  it('a storage that throws reads as not paused, and pausing still works for the session', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    useSession.setState({ user: { id: 'u1' } as never });
    const a = personasEngine('w9');
    expect(a.isPaused()).toBe(false);
    a.setPaused(true);
    expect(a.isPaused()).toBe(true);
    get.mockRestore();
    set.mockRestore();
  });

  it('one engine per user and workspace per tab', () => {
    useSession.setState({ user: { id: 'u1' } as never });
    const a = personasEngine('w1');
    expect(personasEngine('w1')).toBe(a);
    expect(personasEngine('w2')).not.toBe(a);
    useSession.setState({ user: { id: 'u2' } as never });
    expect(personasEngine('w1')).not.toBe(a);
    useSession.setState({ user: null });
    expect(() => personasEngine('w1')).toThrow();
  });

  it('sign-out teardown forgets every engine and makes none until the session user changes', () => {
    useSession.setState({ user: { id: 'u1' } as never });
    const a = personasEngine('w1');
    teardownPersonas();
    // Signing out: the session still names the user for a moment.
    expect(() => personasEngine('w1')).toThrow();
    useSession.setState({ user: null });
    useSession.setState({ user: { id: 'u1' } as never });
    const b = personasEngine('w1');
    expect(b).not.toBe(a);
  });

  it('personasPhotoRows reads the shared photo listing, and refuses while signed out', async () => {
    useSession.setState({ user: null });
    await expect(personasPhotoRows('w1')).rejects.toThrow();
    useSession.setState({ user: { id: 'u1' } as never });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = new URL(String(url), 'https://x.test');
      if (u.pathname === '/api/folders/tree') return new Response(JSON.stringify({ ok: true, folders: [] }));
      return new Response(JSON.stringify({ ok: true, months: [{ files: [{ id: 'p1', name: 'a.jpg', folder_id: null, current_version: 1, taken_at: 5, is_hidden: 0, lock_mode: 'none' }] }], next_cursor: null }));
    });
    const rows = await personasPhotoRows('w1');
    expect(rows.get('p1')?.name).toBe('a.jpg');
    expect(await personasPhotoRows('w1')).toBe(rows);
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/library'))).toHaveLength(1);
  });

  it('unlockPersonas hands the unlocked identity to the engine and wipes the private key copy', async () => {
    useSession.setState({ user: { id: 'u1' } as never });
    const priv = new Uint8Array(32).fill(9);
    const pub = new Uint8Array(32).fill(8);
    const vault = useE2ee.getState().engine;
    const spy = vi.spyOn(PersonasEngine.prototype, 'unlockWith').mockImplementation(async (id) => {
      expect(id).toEqual({ userId: 'u1', x25519Pub: pub, x25519Priv: new Uint8Array(32).fill(9) });
    });
    useE2ee.getState().__setEngine({ ...vault, personasIdentity: () => null });
    await expect(unlockPersonas('w1')).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
    useE2ee.getState().__setEngine({ ...vault, personasIdentity: () => ({ x25519Pub: pub, x25519Priv: priv }) });
    await unlockPersonas('w1');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(priv.every((b) => b === 0)).toBe(true);
    useE2ee.getState().__setEngine(vault);
  });
});
