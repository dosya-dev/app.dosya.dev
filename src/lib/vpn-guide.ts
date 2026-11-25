/**
 * The web page's connect guide (design §6): start a location → turn the tunnel
 * on in the WireGuard app → connected. Pure, so every timing rule is testable;
 * the page feeds it each GET /api/vpn poll, when that poll was fetched, and the
 * clock.
 *
 * Only an explicit action starts it (a Start button or "I've scanned it"), never
 * the quiet pre-warm when the page opens.
 */

export const HINT_AFTER_READY_SECONDS = 30;
export const GIVE_UP_AFTER_START_SECONDS = 240;

type Problem = 'failed' | 'capacity' | 'budget' | 'unknown';

export type GuideState =
  | { phase: 'idle' }
  | { phase: 'starting'; code: string; startedAt: number; watch: string | null; restart?: boolean }
  | {
      phase: 'ready'; code: string; startedAt: number; watch: string | null; readyAt: number; hint: boolean;
      /** Each candidate device's last handshake when Ready was shown (null: had never connected). */
      baseline: Record<string, number | null>;
    }
  | { phase: 'connected'; code: string; deviceName: string }
  | { phase: 'timeout'; code: string }
  | { phase: 'problem'; code: string; problem: Problem };

export interface GuideData {
  locations: Array<{ code: string; status: string }>;
  devices: Array<{ id: string; name: string; last_handshake_at: number | null }>;
}

export const idleGuide: GuideState = { phase: 'idle' };

const STARTABLE = new Set(['booting', 'up', 'off', 'stopping']);
const PROBLEMS = new Set(['failed', 'capacity', 'budget']);

/** `startStatus` is the Start reply's status: a refusal ends the guide at once instead of waiting it out. */
export function startGuide(code: string, now: number, watchDeviceId: string | null, startStatus = 'booting'): GuideState {
  if (PROBLEMS.has(startStatus)) return { phase: 'problem', code, problem: startStatus as Problem };
  if (!STARTABLE.has(startStatus)) return { phase: 'problem', code, problem: 'unknown' };
  return { phase: 'starting', code, startedAt: now, watch: watchDeviceId };
}

/** `fetchedAt` (seconds): when this poll was fetched; a poll from before Start says nothing about it. */
export function advanceGuide(g: GuideState, data: GuideData, now: number, fetchedAt: number = now): GuideState {
  if (g.phase !== 'starting' && g.phase !== 'ready') return g;
  if (now - g.startedAt > GIVE_UP_AFTER_START_SECONDS) return { phase: 'timeout', code: g.code };
  if (fetchedAt < g.startedAt) return g;

  const candidates = g.watch ? data.devices.filter((d) => d.id === g.watch) : data.devices;
  const status = data.locations.find((l) => l.code === g.code)?.status;
  if (g.phase === 'starting') {
    if (status === 'booting') return { ...g, restart: false };
    if (status === 'off' || status === 'stopping') return { ...g, restart: true };
    if (status === 'up') {
      const baseline = Object.fromEntries(candidates.map((d) => [d.id, d.last_handshake_at]));
      return { phase: 'ready', code: g.code, startedAt: g.startedAt, watch: g.watch, readyAt: now, hint: false, baseline };
    }
    if (status && PROBLEMS.has(status)) return { phase: 'problem', code: g.code, problem: status as Problem };
    return { phase: 'problem', code: g.code, problem: 'unknown' };
  }

  // ready: a handshake NEWER than the one seen at Ready means this connection
  // worked. Server time is compared only with server time, never the browser clock.
  const hit = candidates.find((d) => {
    if (d.last_handshake_at === null) return false;
    const before = g.baseline[d.id];
    return before === undefined || before === null || d.last_handshake_at > before;
  });
  if (hit) return { phase: 'connected', code: g.code, deviceName: hit.name };
  return { ...g, hint: now - g.readyAt > HINT_AFTER_READY_SECONDS };
}
