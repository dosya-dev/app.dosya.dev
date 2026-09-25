import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The CSP lives in a static Pages headers file, so no browser-less test can
// observe it being enforced - jsdom ignores CSP entirely. That gap shipped a
// real production bug: OfficePreview frames a blob: URL it builds from the
// preview-pdf response, and frame-src did not allow blob:, so every office
// preview was blocked at the browser. These assertions pin the directives the
// app actually depends on at runtime.
const HEADERS = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8');
const CSP = HEADERS.split('\n').find((l) => l.includes('Content-Security-Policy')) ?? '';

function directive(name: string): string {
  const match = CSP.match(new RegExp(`${name} ([^;]*)`));
  return match ? match[1] : '';
}

describe('web CSP invariants', () => {
  it('allows framing blob: URLs (office preview builds one from the pdf response)', () => {
    expect(directive('frame-src')).toContain('blob:');
  });

  it('allows the document server for the editor iframe and its api.js', () => {
    expect(directive('frame-src')).toContain('https://docs.dosya.dev');
    expect(directive('script-src')).toContain('https://docs.dosya.dev');
    expect(directive('connect-src')).toContain('https://docs.dosya.dev');
  });

  it('keeps the api origin reachable for fetches and framed raw files', () => {
    expect(directive('connect-src')).toContain('https://api.dosya.dev');
    expect(directive('frame-src')).toContain('https://api.dosya.dev');
  });

  // Audio and video elements load from the api origin. Without an explicit
  // media-src they fall back to default-src 'self' and every play is blocked
  // at the browser with "Loading media from ... violates ... default-src".
  // Nothing in a build or a jsdom test can see this.
  it('allows media from the api origin, explicitly', () => {
    expect(CSP).toContain('media-src');
    expect(directive('media-src')).toContain('https://api.dosya.dev');
  });

  it('allows media from blob: and self, for locally produced sources', () => {
    expect(directive('media-src')).toContain('blob:');
    expect(directive('media-src')).toContain("'self'");
  });

  // The Vault (E2EE Spaces) PUTs and GETs encrypted chunks straight against
  // the R2 S3 endpoint with presigned URLs (apps/api/src/pages/api/e2ee/
  // chunk-upload-url.ts). Bucket CORS was right and the presign was right,
  // and every upload still died as "TypeError: Failed to fetch": connect-src
  // did not list the R2 host, so the browser refused the request before it
  // left the page. Explicit account hosts, not *.r2.cloudflarestorage.com, so
  // an injected script cannot exfiltrate to a foreign R2 account. The EU
  // jurisdiction bucket lives on its own hostname (lib/r2-buckets.ts).
  it('allows presigned R2 chunk fetches for the Vault, on both R2 hostnames', () => {
    expect(directive('connect-src')).toContain('https://0b25394b353c95a526538e19706809e8.r2.cloudflarestorage.com');
    expect(directive('connect-src')).toContain('https://0b25394b353c95a526538e19706809e8.eu.r2.cloudflarestorage.com');
    expect(directive('connect-src')).not.toContain('*.r2.cloudflarestorage.com');
  });

  // Cloudflare Web Analytics is auto-injected at the edge for this zone: a
  // <script src="https://static.cloudflareinsights.com/beacon.min.js/..."> that
  // then POSTs to https://cloudflareinsights.com/cdn-cgi/rum. Neither host was
  // allowed, so the app had no browser analytics at all while every build and
  // test stayed green. These are the two hosts Cloudflare documents for it
  // (developers.cloudflare.com/fundamentals/reference/policies-compliances/
  // content-security-policies/).
  it('allows the Cloudflare Web Analytics beacon and its RUM endpoint', () => {
    expect(directive('script-src')).toContain('https://static.cloudflareinsights.com');
    expect(directive('connect-src')).toContain('https://cloudflareinsights.com');
  });

  // Crash reports are a fetch from the browser to the Sentry ingest host
  // (src/lib/sentry.ts). Nothing in a build or a jsdom test can see a CSP
  // refusal; the error page would keep saying "We've been notified" while
  // every report died at the browser.
  it('allows crash reports to reach the Sentry ingest host, and only that host', () => {
    expect(directive('connect-src')).toContain('https://o4512130123825152.ingest.de.sentry.io');
    expect(directive('connect-src')).not.toContain('*.sentry.io');
  });
});
