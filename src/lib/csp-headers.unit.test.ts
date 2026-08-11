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
});
