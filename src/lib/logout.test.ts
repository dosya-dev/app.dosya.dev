import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cancelAll = vi.fn();
vi.mock('./upload-runner', () => ({ cancelAll: () => cancelAll() }));

const { logoutAndRedirect, logoutAndRedirectTo } = await import('./logout');
const { rememberShareDefault, readShareDefault } = await import('./share-defaults');
const { useUploads } = await import('@/stores/uploads');

let hrefs: string[] = [];

beforeEach(() => {
  hrefs = [];
  cancelAll.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  // jsdom refuses a real navigation; capture the assignment instead.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { set href(v: string) { hrefs.push(v); }, get href() { return hrefs.at(-1) ?? ''; } },
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

// Fix round 2, MINOR 2: every per-account memo has to die with the session.
// The share modal's default-expiry cache is keyed by workspace id, and the
// next account to sign in on this browser may be a member of the same
// workspace with a different answer - or of none at all.
describe('logoutAndRedirect', () => {
  it('forgets the cached share defaults', async () => {
    rememberShareDefault('ws_1', 30);
    expect(readShareDefault('ws_1')).toEqual({ days: 30 });

    await logoutAndRedirect();

    expect(readShareDefault('ws_1')).toBeNull();
  });

  it('still cancels uploads, clears the queue and redirects', async () => {
    useUploads.setState({ items: [{
      id: 'u1', session_id: null, fileName: 'a', fileSize: 1, mimeType: 't', workspace_id: 'ws',
      folder_id: null, status: 'queued', progress: 0, bytesUploaded: 0,
      part_size: null, total_parts: null, uploaded_parts: [],
    }] });

    await logoutAndRedirect();

    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(useUploads.getState().items).toEqual([]);
    expect(hrefs).toEqual(['/login']);
  });

  // logoutAndRedirect is passed by reference as a click handler
  // (MaintenanceScreen's onSignOut, create-workspace's footer button), so React
  // calls it with the event. An optional destination parameter would have
  // swallowed that event as the destination, and no typecheck would have caught
  // it: `(to?: string) => Promise<void>` is assignable to `() => void`.
  it('ignores whatever a click handler passes it', async () => {
    await (logoutAndRedirect as unknown as (e: unknown) => Promise<void>)(
      new MouseEvent('click'),
    );

    expect(hrefs).toEqual(['/login']);
  });
});

describe('logoutAndRedirectTo', () => {
  it('lands on the page it was given', async () => {
    await logoutAndRedirectTo('/sign-up');

    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(hrefs).toEqual(['/sign-up']);
  });
});
