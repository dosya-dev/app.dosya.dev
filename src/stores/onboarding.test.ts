import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOnboarding } from './onboarding';

const OK_PAYLOAD = {
  ok: true,
  purpose: null,
  dismissed: false,
  steps: {
    upload: true, share: false, import: false, api_key: false, client_used: false,
    invite: false, file_request: false, geo: false, desktop: false, mobile: false,
  },
};

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = impl(url, init);
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body } as Response;
  });
}

describe('useOnboarding', () => {
  beforeEach(() => {
    useOnboarding.setState({ purpose: null, dismissed: false, steps: null, loaded: false, failed: false });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('loads derived state from the API', async () => {
    vi.stubGlobal('fetch', mockFetch(() => OK_PAYLOAD));
    await useOnboarding.getState().refresh('ws_1');
    expect(useOnboarding.getState().steps?.upload).toBe(true);
    expect(useOnboarding.getState().loaded).toBe(true);
    expect(useOnboarding.getState().failed).toBe(false);
  });

  // Onboarding is additive. A failed fetch must leave steps null so every
  // consumer renders nothing, rather than surfacing an error the user can do
  // nothing about.
  it('leaves steps null and flags failure when the API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await useOnboarding.getState().refresh('ws_1');
    expect(useOnboarding.getState().steps).toBeNull();
    expect(useOnboarding.getState().failed).toBe(true);
  });

  it('does not fetch without a workspace id', async () => {
    const f = mockFetch(() => OK_PAYLOAD);
    vi.stubGlobal('fetch', f);
    await useOnboarding.getState().refresh('');
    expect(f).not.toHaveBeenCalled();
  });

  it('does not fetch again once dismissed', async () => {
    const f = mockFetch(() => OK_PAYLOAD);
    vi.stubGlobal('fetch', f);
    useOnboarding.setState({ dismissed: true });
    await useOnboarding.getState().refresh('ws_1');
    expect(f).not.toHaveBeenCalled();
  });

  // dashboard.tsx and setup-pill.tsx both call refresh() on mount before
  // `loaded` flips true - without an in-flight guard that is two GETs for the
  // same workspace on every dashboard load.
  it('collapses two concurrent refresh calls into a single fetch', async () => {
    const f = mockFetch(() => OK_PAYLOAD);
    vi.stubGlobal('fetch', f);
    const p1 = useOnboarding.getState().refresh('ws_1');
    const p2 = useOnboarding.getState().refresh('ws_1');
    await Promise.all([p1, p2]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(useOnboarding.getState().loaded).toBe(true);
  });

  // Regression: the in-flight guard must be keyed by workspace id. The
  // dashboard's refresh effect is keyed on [wsId] and fires again on every
  // workspace switch - a bare single in-flight promise would let a request
  // for ws_A swallow a concurrent call for ws_B, landing ws_A's state in the
  // store while the user is looking at ws_B (and, if ws_A was dismissed,
  // wrongly suppressing ws_B's onboarding for the rest of the session).
  it('issues a separate fetch for each of two different workspace ids called concurrently', async () => {
    const f = mockFetch(() => OK_PAYLOAD);
    vi.stubGlobal('fetch', f);
    const pA = useOnboarding.getState().refresh('ws_A');
    const pB = useOnboarding.getState().refresh('ws_B');
    await Promise.all([pA, pB]);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f).toHaveBeenCalledWith(expect.stringContaining('workspace_id=ws_A'), expect.anything());
    expect(f).toHaveBeenCalledWith(expect.stringContaining('workspace_id=ws_B'), expect.anything());
  });

  it('applies a purpose optimistically before the request resolves', async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => {
      resolve = () => r({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
    })));
    const pending = useOnboarding.getState().setPurpose('dev');
    expect(useOnboarding.getState().purpose).toBe('dev');
    resolve(null);
    await pending;
  });

  // A failed write must not yank the UI back. The user answered; the answer
  // stands locally even if it did not persist.
  it('keeps the optimistic purpose when the write fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await useOnboarding.getState().setPurpose('team');
    expect(useOnboarding.getState().purpose).toBe('team');
  });

  it('dismisses optimistically', async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => {
      resolve = () => r({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
    })));
    const pending = useOnboarding.getState().dismiss();
    expect(useOnboarding.getState().dismissed).toBe(true);
    resolve(null);
    await pending;
  });

  it('keeps the dismissal when the write fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await useOnboarding.getState().dismiss();
    expect(useOnboarding.getState().dismissed).toBe(true);
  });
});
