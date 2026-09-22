import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { fetchDashboard, prefetchDashboard, dashboardQueryOptions } = await import('./dashboard-query');

const payload = { ok: true, user_name: 'Ada', stats: { total_files: 1 } };

describe('dashboard query', () => {
  afterEach(() => apiMock.mockReset());

  it('fetchDashboard asks for the workspace and rejects an ok:false body', async () => {
    apiMock.mockResolvedValueOnce(payload);
    await expect(fetchDashboard('ws1')).resolves.toMatchObject({ user_name: 'Ada' });
    expect(apiMock).toHaveBeenCalledWith('/api/dashboard?workspace_id=ws1');

    apiMock.mockResolvedValueOnce({ ok: false });
    await expect(fetchDashboard('ws1')).rejects.toThrow('could not be loaded');
  });

  it('prefetchDashboard fills the cache so the page mount reads it without a second request', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    apiMock.mockResolvedValue(payload);
    prefetchDashboard(qc, 'ws1');
    // Same key, same fetch: the page's own query dedupes onto the in-flight
    // prefetch instead of starting another.
    const fromPage = await qc.fetchQuery(dashboardQueryOptions('ws1'));
    expect(fromPage).toMatchObject({ user_name: 'Ada' });
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('prefetchDashboard swallows a failed request and does nothing for an empty id', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    prefetchDashboard(qc, '');
    expect(apiMock).not.toHaveBeenCalled();

    apiMock.mockRejectedValueOnce(new Error('401'));
    prefetchDashboard(qc, 'gone');
    await new Promise((r) => setTimeout(r, 0));
    expect(qc.getQueryState(['dashboard', 'gone'])?.status).toBe('error');
  });
});
