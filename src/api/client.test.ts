import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, apiErrorMessage, ApiError } from './client';

// Verifies the end-to-end error path that the workspace-delete UI relies on:
// a server jsonError body must survive api() -> ApiError -> apiErrorMessage()
// and come out as the exact human-readable message (never the generic fallback).

function mockFetchOnce(status: number, body: string, contentType = 'application/json') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(body, { status, headers: { 'Content-Type': contentType } }),
    ),
  );
}

/** Reproduce exactly what handleDelete does: call api(), catch, run apiErrorMessage. */
async function deleteAndGetMessage(): Promise<string> {
  try {
    await api<{ ok: boolean }>('/api/workspaces/ws_1', { method: 'DELETE' });
    throw new Error('expected api() to throw on a non-2xx response');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return apiErrorMessage(err, 'The workspace could not be deleted.');
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workspace-delete error surfacing', () => {
  it('shows the "last workspace" guard message verbatim (400)', async () => {
    const serverMsg = 'Cannot delete your last workspace. You must always have at least one.';
    mockFetchOnce(400, JSON.stringify({ ok: false, error: serverMsg }));
    expect(await deleteAndGetMessage()).toBe(serverMsg);
  });

  it('shows the "members present" guard message verbatim (400)', async () => {
    const serverMsg =
      'There are members in this workspace and you cannot delete it. First you have to remove them.';
    mockFetchOnce(400, JSON.stringify({ ok: false, error: serverMsg }));
    expect(await deleteAndGetMessage()).toBe(serverMsg);
  });

  it('shows the clean batch-failure message from the hardened 500', async () => {
    const serverMsg = 'Failed to delete workspace. Please try again.';
    mockFetchOnce(500, JSON.stringify({ ok: false, error: serverMsg }));
    expect(await deleteAndGetMessage()).toBe(serverMsg);
  });

  it('never leaks a raw HTML gateway error page to the user (falls back to a safe status message)', async () => {
    mockFetchOnce(500, '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>', 'text/html');
    const msg = await deleteAndGetMessage();
    expect(msg).not.toContain('<');
    expect(msg).toMatch(/Request failed \(500\)/);
  });
});
