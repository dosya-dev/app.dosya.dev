import { describe, it, expect } from 'vitest';
import { viewerHref, readViewerIntent } from './deep-link';

describe('deep links', () => {
  it('builds viewer links for time, page and plain comments', () => {
    expect(viewerHref('f1', { id: 'c1', anchor_ms: 42_000, anchor_page: null })).toBe('/files?view=f1&tab=comments&comment=c1&t=42000');
    expect(viewerHref('f1', { id: 'c1', anchor_ms: null, anchor_page: 4 })).toBe('/files?view=f1&tab=comments&comment=c1&p=4');
    expect(viewerHref('f1', { id: 'c1', anchor_ms: null, anchor_page: null })).toBe('/files?view=f1&tab=comments&comment=c1');
  });
  it('reads them back and rejects junk', () => {
    expect(readViewerIntent(new URLSearchParams('tab=comments&comment=c1&t=42000')))
      .toEqual({ tab: 'comments', anchor: { ms: 42000 }, commentId: 'c1' });
    expect(readViewerIntent(new URLSearchParams('p=4'))).toEqual({ tab: null, anchor: { page: 4 }, commentId: null });
    expect(readViewerIntent(new URLSearchParams('tab=versions')).tab).toBe('versions');
    expect(readViewerIntent(new URLSearchParams('t=-5&p=0&tab=x'))).toEqual({ tab: null, anchor: null, commentId: null });
  });
});
