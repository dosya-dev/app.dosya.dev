import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildE2eeClient, normalizeRecoveryKey } from './client';

// A valid base64 encoding of 32 zero bytes - just needs to decode cleanly so
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

// Fix round 2, test hygiene: the recovery key is displayed as one hex string
// and pasted back with whatever spacing, dashes or line breaks the password
// manager added (Contract 6 calls it whitespace- and dash-insensitive). The
// tests that exercised the UI and the store were asserting the raw string
// passed through, so deleting the normalisation would have kept them green.
describe('normalizeRecoveryKey', () => {
  it('drops every kind of whitespace and dash a paste can carry', () => {
    expect(normalizeRecoveryKey('  ab12-cd34 ef56\n')).toBe('ab12cd34ef56');
    expect(normalizeRecoveryKey('ab12\tcd34\r\nef56')).toBe('ab12cd34ef56');
    expect(normalizeRecoveryKey('ab12 - cd34 - ef56')).toBe('ab12cd34ef56');
  });

  it('changes nothing else - the key is hex and case is not ours to touch', () => {
    expect(normalizeRecoveryKey('AB12cd34')).toBe('AB12cd34');
    expect(normalizeRecoveryKey('')).toBe('');
  });
});
