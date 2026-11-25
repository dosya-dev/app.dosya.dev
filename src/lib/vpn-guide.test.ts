import { describe, expect, it } from 'vitest';
import { startGuide, advanceGuide, type GuideState } from './vpn-guide';

const T = 1_795_500_000;
const data = (status: string, devices: Array<{ id: string; name: string; last_handshake_at: number | null }> = []) => ({
  locations: [{ code: 'de', status }], devices,
});

describe('connect guide', () => {
  it('stays starting while the location boots, then asks to turn the tunnel on', () => {
    let g: GuideState = startGuide('de', T, null);
    g = advanceGuide(g, data('booting'), T + 30);
    expect(g.phase).toBe('starting');
    g = advanceGuide(g, data('up'), T + 80);
    expect(g).toMatchObject({ phase: 'ready', readyAt: T + 80, hint: false });
  });

  it('a device handshake after Ready → connected, naming the device', () => {
    let g = advanceGuide(startGuide('de', T, null), data('up', [{ id: 'd1', name: 'Laptop', last_handshake_at: T + 10 }, { id: 'd2', name: "Firat's iPhone", last_handshake_at: null }]), T + 80);
    g = advanceGuide(g, data('up', [{ id: 'd1', name: 'Laptop', last_handshake_at: T + 10 }, { id: 'd2', name: "Firat's iPhone", last_handshake_at: T + 95 }]), T + 96);
    expect(g).toMatchObject({ phase: 'connected', deviceName: "Firat's iPhone" });
  });

  it('a handshake already there at Ready does not count (an always-on laptop)', () => {
    let g = advanceGuide(startGuide('de', T, null), data('up', [{ id: 'd1', name: 'Laptop', last_handshake_at: T + 79 }]), T + 80);
    g = advanceGuide(g, data('up', [{ id: 'd1', name: 'Laptop', last_handshake_at: T + 79 }]), T + 90);
    expect(g.phase).toBe('ready');
  });

  it('watching one device ignores the others', () => {
    let g = advanceGuide(startGuide('de', T, 'd2'), data('up', [{ id: 'd1', name: 'Laptop', last_handshake_at: null }, { id: 'd2', name: 'New', last_handshake_at: null }]), T + 80);
    g = advanceGuide(g, data('up', [{ id: 'd1', name: 'Laptop', last_handshake_at: T + 90 }]), T + 91);
    expect(g.phase).toBe('ready');
  });

  it('shows the toggle hint 30 s after Ready without a handshake', () => {
    let g = advanceGuide(startGuide('de', T, null), data('up'), T + 80);
    expect(advanceGuide(g, data('up'), T + 109)).toMatchObject({ hint: false });
    g = advanceGuide(g, data('up'), T + 111);
    expect(g).toMatchObject({ phase: 'ready', hint: true });
  });

  it('gives up 4 minutes after Start', () => {
    const g = advanceGuide(advanceGuide(startGuide('de', T, null), data('up'), T + 80), data('up'), T + 241);
    expect(g.phase).toBe('timeout');
  });

  it.each(['failed', 'capacity', 'budget'])('a %s status ends the guide with that outcome', (status) => {
    expect(advanceGuide(startGuide('de', T, null), data(status), T + 5)).toMatchObject({ phase: 'problem', problem: status });
  });

  it('stopping keeps waiting (the page starts it again)', () => {
    expect(advanceGuide(startGuide('de', T, null), data('stopping'), T + 5)).toMatchObject({ phase: 'starting', restart: true });
  });

  it('an unknown status from a newer server shows the neutral problem state', () => {
    expect(advanceGuide(startGuide('de', T, null), data('migrating'), T + 5)).toMatchObject({ phase: 'problem', problem: 'unknown' });
  });
});

describe('review fixes', () => {
  it.each(['capacity', 'budget', 'failed'])('a Start reply of %s goes straight to that problem', (status) => {
    expect(startGuide('de', T, null, status)).toMatchObject({ phase: 'problem', problem: status });
  });

  it('a Start reply the client does not know is the neutral problem', () => {
    expect(startGuide('de', T, null, 'migrating')).toMatchObject({ phase: 'problem', problem: 'unknown' });
  });

  it.each(['booting', 'up', 'off', 'stopping'])('a Start reply of %s starts the guide', (status) => {
    expect(startGuide('de', T, null, status).phase).toBe('starting');
  });

  it('ignores a poll fetched before Start (cached "failed" must not end a retry)', () => {
    const g = startGuide('de', T, null, 'booting');
    expect(advanceGuide(g, data('failed'), T + 1, T - 5).phase).toBe('starting');
    expect(advanceGuide(g, data('failed'), T + 4, T + 3)).toMatchObject({ phase: 'problem', problem: 'failed' });
  });

  it('connected means a handshake newer than the one seen at Ready, whatever the browser clock says', () => {
    const dev = (h: number | null) => [{ id: 'd1', name: 'Phone', last_handshake_at: h }];
    // The browser clock runs 2 minutes FAST: real handshakes look "older" than Ready.
    let g = advanceGuide(startGuide('de', T, null), data('up', dev(T - 500)), T + 120);
    expect(g.phase).toBe('ready');
    g = advanceGuide(g, data('up', dev(T - 500)), T + 125);
    expect(g.phase).toBe('ready');
    g = advanceGuide(g, data('up', dev(T + 10)), T + 135);
    expect(g).toMatchObject({ phase: 'connected', deviceName: 'Phone' });
  });

  it('a device that had never connected counts as connected on its first handshake', () => {
    let g = advanceGuide(startGuide('de', T, 'd1'), data('up', [{ id: 'd1', name: 'New', last_handshake_at: null }]), T + 80);
    g = advanceGuide(g, data('up', [{ id: 'd1', name: 'New', last_handshake_at: T - 9999 }]), T + 90);
    expect(g.phase).toBe('connected');
  });
});
