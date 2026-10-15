import { describe, it, expect } from 'vitest';
import { collectDiagnostics, diagnosticsRows } from './bug-report';

describe('collectDiagnostics', () => {
  it('builds a v1 web document from explicit inputs', () => {
    const d = collectDiagnostics({
      workspaceId: 'ws_1', page: '/files?folder=fld_1', errorRef: 'abc123', errorMessage: 'boom',
      userAgent: 'UA/1', locale: 'en-GB', now: 1_760_000_000,
    });
    expect(d).toEqual({
      v: 1, client: 'web', app_version: expect.any(String), build: expect.anything(), platform: 'UA/1', locale: 'en-GB',
      workspace_id: 'ws_1', page: '/files', error_ref: 'abc123', error_message: 'boom', extra: {}, captured_at: 1_760_000_000,
    });
  });

  it('never carries a query string in page', () => {
    expect(collectDiagnostics({ page: '/shared/sl_1?token=x#y' }).page).toBe('/shared/sl_1');
  });

  it('turns empty strings and undefined into null, never the string "undefined"', () => {
    const d = collectDiagnostics({ errorRef: undefined, errorMessage: '', workspaceId: '' });
    expect(d.error_ref).toBeNull();
    expect(d.error_message).toBeNull();
    expect(d.workspace_id).toBeNull();
    expect(JSON.stringify(d)).not.toContain('undefined');
  });

  it('reads the browser when nothing is passed (jsdom)', () => {
    const d = collectDiagnostics();
    expect(d.platform).toBe(navigator.userAgent);
    expect(d.page).toBe(window.location.pathname);
    expect(typeof d.captured_at).toBe('number');
  });
});

describe('diagnosticsRows', () => {
  it('lists the rows the card shows, skipping empty ones, and labels the id "Error reference"', () => {
    const rows = diagnosticsRows(collectDiagnostics({ errorRef: 'abc', workspaceId: null, page: '/files', userAgent: 'UA', now: 1 }));
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('Error reference');
    expect(labels).not.toContain('Workspace');
    expect(labels).toContain('Page');
    expect(rows.find((r) => r.label === 'Error reference')?.value).toBe('abc');
    expect(JSON.stringify(rows).toLowerCase()).not.toContain('sentry');
  });
});
