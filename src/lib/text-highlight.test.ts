import { describe, it, expect, vi } from 'vitest';
import { highlightToHtml } from './text-highlight';

describe('highlightToHtml', () => {
  it('returns Shiki <pre> HTML for a known language', async () => {
    const html = await highlightToHtml('const x = 1;', 'javascript');
    expect(html).toContain('<pre');
    expect(html).toContain('class="shiki');
  });

  it('renders unknown languages as plain text without throwing', async () => {
    const html = await highlightToHtml('just some text', 'text');
    expect(html).toContain('<pre');
    expect(html).toContain('just some text');
  });
});

describe('highlightToHtml bootstrap failure', () => {
  it('never throws and returns escaped plaintext when the Shiki bootstrap rejects', async () => {
    vi.resetModules();
    vi.doMock('@shikijs/engine-javascript', () => {
      throw new Error('simulated chunk-load failure');
    });

    const { highlightToHtml: freshHighlightToHtml } = await import('./text-highlight');

    const html = await freshHighlightToHtml('a < b & c', 'javascript');

    expect(html).toContain('a &lt; b &amp; c');

    vi.doUnmock('@shikijs/engine-javascript');
    vi.resetModules();
  });
});
