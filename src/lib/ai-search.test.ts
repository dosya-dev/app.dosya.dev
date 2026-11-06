import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  debounced, searchContent, searchContentWithRetry, resetContentSearchState, forgetContentAvailability, pauseReason,
  CONTENT_DEBOUNCE_MS, type AiSearchStatus,
} from './ai-search';

const HIT = {
  id: 'f1', name: 'lease.pdf', size_bytes: 10, mime_type: 'application/pdf', extension: 'pdf', region: 'eu',
  folder_id: null, uploaded_by: 'u1', created_at: 1, lock_mode: null, uploader_name: 'Ada',
  score: 0.9, snippet: 'the rent is due', page: 3, source: 'both',
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetContentSearchState();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('debounced', () => {
  it('runs 400 ms after the last call, once, with the last arguments', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounced(fn, CONTENT_DEBOUNCE_MS);
    expect(CONTENT_DEBOUNCE_MS).toBe(400);
    d('a'); vi.advanceTimersByTime(200);
    d('ab'); vi.advanceTimersByTime(399);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('ab');
  });

  it('cancel drops the pending call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounced(fn, 400);
    d('x'); d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('searchContent', () => {
  it('returns ok with files and partial', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, files: [HIT], partial: true, took_ms: 12 }));
    const r = await searchContent('ws1', 'rent');
    expect(r).toEqual({ kind: 'ok', files: [HIT], partial: true });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/search/content?');
    expect(url).toContain('workspace_id=ws1');
    expect(url).toContain('q=rent');
  });

  it('passes from / to as unix seconds', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, files: [], partial: false }));
    await searchContent('ws1', 'rent', { from: 100, to: 200 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('from=100');
    expect(url).toContain('to=200');
  });

  it('shares an identical in-flight request (same promise, one fetch)', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { release = r; }));
    const a = searchContent('ws1', 'rent');
    const b = searchContent('ws1', 'rent');
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(jsonResponse(200, { ok: true, files: [HIT], partial: false }));
    expect(await a).toEqual(await b);
    // Settled: the next identical call is a new request.
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, files: [], partial: false }));
    await searchContent('ws1', 'rent');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not share different queries or workspaces', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true, files: [], partial: false }));
    await Promise.all([searchContent('ws1', 'rent'), searchContent('ws1', 'lease'), searchContent('ws2', 'rent')]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shares with signals and only cancels the request when every waiter aborted', async () => {
    let seenSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      seenSignal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const c1 = new AbortController();
    const c2 = new AbortController();
    const a = searchContent('ws1', 'rent', { signal: c1.signal });
    const b = searchContent('ws1', 'rent', { signal: c2.signal });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    c1.abort();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    expect(seenSignal!.aborted).toBe(false);
    c2.abort();
    await expect(b).rejects.toMatchObject({ name: 'AbortError' });
    expect(seenSignal!.aborted).toBe(true);
  });

  it('maps 429 to busy with the Retry-After seconds', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { ok: false, error: 'rate_limited', retryable: true }, { 'Retry-After': '7' }));
    expect(await searchContent('ws1', 'rent')).toEqual({ kind: 'busy', retryAfterS: 7 });
  });

  it('maps 402 and 409 to unavailable and does not ask that workspace again', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(402, { ok: false, error: 'ai_search_not_in_plan' }));
    expect(await searchContent('ws1', 'rent')).toEqual({ kind: 'unavailable' });
    expect(await searchContent('ws1', 'lease')).toEqual({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(jsonResponse(409, { ok: false, error: 'ai_search_off' }));
    expect(await searchContent('ws2', 'rent')).toEqual({ kind: 'unavailable' });

    forgetContentAvailability('ws1');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, files: [], partial: false }));
    expect(await searchContent('ws1', 'rent')).toEqual({ kind: 'ok', files: [], partial: false });
  });

  it('maps a network failure or 5xx to error, never to an empty answer', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await searchContent('ws1', 'rent')).toEqual({ kind: 'error' });
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { ok: false, error: 'AI search is unavailable' }));
    expect(await searchContent('ws1', 'rent')).toEqual({ kind: 'error' });
  });
});

describe('searchContentWithRetry', () => {
  it('reports busy, waits Retry-After, retries once', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, files: [HIT], partial: false }));
    const onBusy = vi.fn();
    const p = searchContentWithRetry('ws1', 'rent', { onBusy });
    await vi.advanceTimersByTimeAsync(0);
    expect(onBusy).toHaveBeenCalledWith(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ kind: 'ok', files: [HIT], partial: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second busy', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => jsonResponse(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '1' }));
    const p = searchContentWithRetry('ws1', 'rent');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ kind: 'busy', retryAfterS: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('pauseReason', () => {
  const base: AiSearchStatus = {
    files_total: 10, indexed: 5, pending: 5, partial: 0, unsupported: 0, capped: 0, failed: 0, images: 1, documents: 1, chunks: 3,
    limits: { vectorBudget: 1000, imagesMax: 100, documentsMax: 100, docChunksMax: 900, backfillUnits: 100, monthUnits: 50 },
    backfill_units_remaining: 10, month_units_remaining: 10, month_reset_at: null, estimated_finish_at: null, paused: false,
  };
  it('is null while indexing moves', () => { expect(pauseReason(base)).toBeNull(); });
  it('names a platform pause first', () => { expect(pauseReason({ ...base, paused: true, capped: 3 })).toBe('maintenance'); });
  it('names the plan limit when files are capped', () => { expect(pauseReason({ ...base, capped: 2 })).toBe('planLimit'); });
  it('names the monthly allowance when both pools are spent', () => {
    expect(pauseReason({ ...base, backfill_units_remaining: 0, month_units_remaining: 0 })).toBe('monthlyAllowance');
  });
  it('a trial (no monthly pool) with its backfill spent is a plan limit', () => {
    expect(pauseReason({ ...base, limits: { ...base.limits!, monthUnits: 0 }, backfill_units_remaining: 0, month_units_remaining: 0 })).toBe('planLimit');
  });
});
