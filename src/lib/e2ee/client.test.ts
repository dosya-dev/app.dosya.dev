import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildE2eeClient } from './client';

// A valid base64 encoding of 32 zero bytes — just needs to decode cleanly so
// oprfPublicKey() resolves; the actual key material is irrelevant here.
const ZERO_KEY_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildE2eeClient', () => {
  it('api calls are cookie-credentialed (credentials: "include")', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ publicKey: ZERO_KEY_B64 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { api } = buildE2eeClient();
    await api.oprfPublicKey();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    expect(String(url)).toMatch(/\/api\/e2ee\/oprf-public-key$/);
    expect(init?.credentials).toBe('include');
  });

  it('chunk transport requests are NOT credentialed (plain fetch)', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { transport } = buildE2eeClient();
    await transport.getChunk('https://example-bucket.r2.dev/some/presigned/key?sig=abc');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    expect(init?.credentials).not.toBe('include');
    expect(init?.credentials).toBeUndefined();
  });
});
