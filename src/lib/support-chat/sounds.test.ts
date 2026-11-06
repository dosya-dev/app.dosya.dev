import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A minimal Web Audio stand-in: records oscillators and lets a test decide how resume() behaves.
class FakeParam {
  calls: Array<[string, number, number]> = [];
  setValueAtTime(v: number, t: number) { this.calls.push(['set', v, t]); }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push(['lin', v, t]); }
  exponentialRampToValueAtTime(v: number, t: number) { this.calls.push(['exp', v, t]); }
}
class FakeNode {
  frequency = new FakeParam();
  gain = new FakeParam();
  type = '';
  started: number[] = [];
  stopped: number[] = [];
  connect() {}
  start(t: number) { this.started.push(t); }
  stop(t: number) { this.stopped.push(t); }
}
let resumeImpl: () => Promise<void> = async () => undefined;
const contexts: FakeCtx[] = [];
class FakeCtx {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  oscillators: FakeNode[] = [];
  gains: FakeNode[] = [];
  constructor() { contexts.push(this); }
  resume() { return resumeImpl(); }
  createOscillator() { const n = new FakeNode(); this.oscillators.push(n); return n; }
  createGain() { const n = new FakeNode(); this.gains.push(n); return n; }
}

async function load() {
  vi.resetModules();
  return import('./sounds');
}

beforeEach(() => {
  contexts.length = 0;
  resumeImpl = async () => undefined;
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('support chat sounds', () => {
  it('is a no-op without AudioContext', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const s = await load();
    expect(() => { s.playSend(); s.playReceive(); }).not.toThrow();
  });

  it('swallows a rejected resume() (autoplay policy) and still schedules the notes', async () => {
    vi.stubGlobal('AudioContext', FakeCtx);
    resumeImpl = () => Promise.reject(new DOMException('not allowed', 'NotAllowedError'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const s = await load();
    expect(() => s.playReceive()).not.toThrow();
    expect(() => s.playSend()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(1); // one lazy context, reused
    expect(contexts[0].oscillators).toHaveLength(3);
  });

  it('survives a resume() that throws synchronously or returns nothing', async () => {
    vi.stubGlobal('AudioContext', FakeCtx);
    const s = await load();
    resumeImpl = () => { throw new Error('boom'); };
    expect(() => s.playReceive()).not.toThrow();
    resumeImpl = () => undefined as unknown as Promise<void>;
    expect(() => s.playSend()).not.toThrow();
    expect(contexts[0].oscillators).toHaveLength(3);
  });

  it('creates no context before the first call', async () => {
    vi.stubGlobal('AudioContext', FakeCtx);
    await load();
    expect(contexts).toHaveLength(0);
  });

  it('send is a 120 ms pop from 520 to 380 Hz at gain 0.15', async () => {
    vi.stubGlobal('AudioContext', FakeCtx);
    const s = await load();
    s.playSend();
    const [osc] = contexts[0].oscillators;
    const [gain] = contexts[0].gains;
    expect(osc.frequency.calls[0]).toEqual(['set', 520, 0]);
    expect(osc.frequency.calls.at(-1)?.[1]).toBe(380);
    expect(Math.max(...gain.gain.calls.map((c) => c[1]))).toBeCloseTo(0.15);
    expect(osc.stopped[0]).toBeCloseTo(0.12);
  });

  it('receive is E5 then A5 over 180 ms at gain 0.2', async () => {
    vi.stubGlobal('AudioContext', FakeCtx);
    const s = await load();
    s.playReceive();
    const [a, b] = contexts[0].oscillators;
    expect(a.frequency.calls[0][1]).toBe(659);
    expect(b.frequency.calls[0][1]).toBe(880);
    expect(b.stopped[0]).toBeCloseTo(0.18);
    expect(Math.max(...contexts[0].gains[0].gain.calls.map((c) => c[1]))).toBeCloseTo(0.2);
  });

  it('mute persists under dosya.supportChat.sound and silences both sounds', async () => {
    vi.stubGlobal('AudioContext', FakeCtx);
    const s = await load();
    expect(s.isMuted()).toBe(false);
    s.setMuted(true);
    expect(localStorage.getItem('dosya.supportChat.sound')).toBe('off');
    expect(s.isMuted()).toBe(true);
    s.playSend();
    s.playReceive();
    expect(contexts).toHaveLength(0);
    s.setMuted(false);
    expect(s.isMuted()).toBe(false);
  });
});
