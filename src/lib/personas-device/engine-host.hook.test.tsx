import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PersonasEngine, type EngineStatus } from '@dosya-dev/personas-engine';
import { useE2ee } from '@/stores/e2ee';
import { useSession } from '@/stores/session';
import { teardownPersonas } from './teardown';
import { stopPersonasEngines, unlockPersonas, usePersonasEngine, type PersonasEngineState } from './engine-host';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  stopPersonasEngines();
  useSession.setState({ user: null });
  vi.restoreAllMocks();
});

describe('usePersonasEngine', () => {
  it('shows the engine status and asks again after a Personas unlock', async () => {
    useSession.setState({ user: { id: 'u1' } as never });
    let next: EngineStatus = { state: 'needs_unlock' };
    vi.spyOn(PersonasEngine.prototype, 'status').mockImplementation(async () => next);
    vi.spyOn(PersonasEngine.prototype, 'unlockWith').mockResolvedValue();
    const vault = useE2ee.getState().engine;
    useE2ee.getState().__setEngine({ ...vault, personasIdentity: () => ({ x25519Pub: new Uint8Array(32), x25519Priv: new Uint8Array(32) }) });

    const seen: PersonasEngineState[] = [];
    function Probe() {
      seen.push(usePersonasEngine('w1'));
      return null;
    }
    root = createRoot(document.createElement('div'));
    await act(async () => root!.render(<Probe />));
    expect(seen[0].status).toBeNull();
    expect(seen.at(-1)!.status).toEqual({ state: 'needs_unlock' });

    next = { state: 'off' };
    await act(async () => unlockPersonas('w1'));
    expect(seen.at(-1)!.status).toEqual({ state: 'off' });
    expect(new Set(seen.map((s) => s.engine)).size).toBe(1);
    useE2ee.getState().__setEngine(vault);
  });

  it('signed out: no engine and no throw during render', async () => {
    const seen: PersonasEngineState[] = [];
    function Probe() {
      seen.push(usePersonasEngine('w1'));
      return null;
    }
    root = createRoot(document.createElement('div'));
    await act(async () => root!.render(<Probe />));
    expect(seen.at(-1)!.engine).toBeNull();
    expect(seen.at(-1)!.status).toBeNull();
  });

  it('after sign-out teardown, a mounted screen holds no engine while the session still names the user', async () => {
    useSession.setState({ user: { id: 'u1' } as never });
    vi.spyOn(PersonasEngine.prototype, 'status').mockResolvedValue({ state: 'off' });
    const seen: PersonasEngineState[] = [];
    function Probe() {
      seen.push(usePersonasEngine('w1'));
      return null;
    }
    root = createRoot(document.createElement('div'));
    await act(async () => root!.render(<Probe />));
    expect(seen.at(-1)!.engine).not.toBeNull();
    const made = vi.spyOn(PersonasEngine.prototype, 'subscribe');
    await act(async () => teardownPersonas());
    expect(seen.at(-1)!.engine).toBeNull();
    expect(made).not.toHaveBeenCalled();
    await act(async () => useSession.setState({ user: null }));
    expect(seen.at(-1)!.engine).toBeNull();
  });
});

