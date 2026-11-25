import { describe, expect, it } from 'vitest';
import { activityFromApi, downloadEventFromHref, sanitizeAppPath, sizeBand } from './analytics-events';

describe('activityFromApi', () => {
  it('names the action, never the thing acted on', () => {
    expect(activityFromApi('POST', '/api/shares')).toEqual({ name: 'share_create' });
    expect(activityFromApi('POST', '/api/shares/sh_8f3kd93/revoke')).toEqual({ name: 'share_revoke' });
    expect(activityFromApi('DELETE', '/api/files/f_123abc')).toEqual({ name: 'file_delete', params: { batch: false } });
    expect(activityFromApi('POST', '/api/files/batch-delete')).toEqual({ name: 'file_delete', params: { batch: true } });
    expect(activityFromApi('POST', '/api/folders')).toEqual({ name: 'folder_create' });
    expect(activityFromApi('POST', '/api/file-requests')).toEqual({ name: 'file_request_create' });
    expect(activityFromApi('POST', '/api/e2ee/user-keys')).toEqual({ name: 'vault_create' });
    expect(activityFromApi('POST', '/api/team/invite')).toEqual({ name: 'team_invite' });
    expect(activityFromApi('POST', '/api/cloud/imports')).toEqual({ name: 'cloud_import_start' });
    expect(activityFromApi('POST', '/api/billing/cancel')).toEqual({ name: 'cancel_subscription' });
  });

  it('tells sign-in methods apart and treats a logout as an action', () => {
    expect(activityFromApi('POST', '/api/auth/login')).toEqual({ name: 'login', params: { method: 'password' } });
    expect(activityFromApi('POST', '/api/auth/2fa/verify')).toEqual({ name: 'login', params: { method: 'two_factor' } });
    expect(activityFromApi('POST', '/api/auth/logout')).toEqual({ name: 'logout' });
  });

  it('counts a search by mode and ignores its query string', () => {
    expect(activityFromApi('POST', '/api/search')).toEqual({ name: 'search', params: { mode: 'files' } });
    expect(activityFromApi('POST', '/api/search/content')).toEqual({ name: 'search', params: { mode: 'content' } });
    expect(activityFromApi('GET', '/api/search?q=tax%20return')).toEqual({ name: 'search', params: { mode: 'files' } });
  });

  it('stays silent on reads and polls', () => {
    expect(activityFromApi('GET', '/api/me')).toBeNull();
    expect(activityFromApi('GET', '/api/files')).toBeNull();
    expect(activityFromApi('GET', '/api/billing/status')).toBeNull();
    expect(activityFromApi('GET', '/api/notifications/summary')).toBeNull();
    expect(activityFromApi(undefined, '/api/workspaces')).toBeNull();
  });

  it('is case-insensitive on the method and ignores a trailing slash', () => {
    expect(activityFromApi('post', '/api/folders/')).toEqual({ name: 'folder_create' });
  });

  it('never carries anything from the path into the event', () => {
    for (const [m, p] of [['DELETE', '/api/files/secret-name.pdf'], ['PATCH', '/api/workspaces/ws_1/settings'], ['GET', '/api/shares/tok_abc/analytics']] as const) {
      const e = activityFromApi(m, p);
      expect(JSON.stringify(e)).not.toMatch(/secret|ws_1|tok_abc/);
    }
  });
});

describe('downloadEventFromHref', () => {
  it('recognises a file download link and drops the id', () => {
    const e = downloadEventFromHref('https://api.dosya.dev/api/files/f_9x8/download');
    expect(e).toEqual({ name: 'file_download', params: { kind: 'file' } });
    expect(JSON.stringify(e)).not.toContain('f_9x8');
  });
  it('ignores every other link', () => {
    expect(downloadEventFromHref('https://api.dosya.dev/api/files/f_9x8')).toBeNull();
    expect(downloadEventFromHref('/files')).toBeNull();
    expect(downloadEventFromHref('not a url')).toBeNull();
  });
});

describe('sanitizeAppPath', () => {
  it('replaces identifiers in known routes', () => {
    expect(sanitizeAppPath('/editor/f_8dk3k')).toBe('/editor/:id');
    expect(sanitizeAppPath('/shared/sh_1')).toBe('/shared/:id');
    expect(sanitizeAppPath('/save/0123456789abcdef')).toBe('/save/:id');
    expect(sanitizeAppPath('/family/join/tok')).toBe('/family/join/:id');
    expect(sanitizeAppPath('/personas/p_1')).toBe('/personas/:id');
    expect(sanitizeAppPath('/personas')).toBe('/personas');
  });
  it('keeps plain routes and strips queries', () => {
    expect(sanitizeAppPath('/files?folder=abc')).toBe('/files');
    expect(sanitizeAppPath('/profile/security')).toBe('/profile/security');
    expect(sanitizeAppPath('/')).toBe('/');
  });
  it('redacts unknown segments that look like ids', () => {
    expect(sanitizeAppPath('/x/9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c')).toBe('/x/:id');
    expect(sanitizeAppPath('/x/abc123')).toBe('/x/:id');
  });
});

describe('sizeBand', () => {
  it('bands sizes', () => {
    expect(sizeBand(10)).toBe('under_1mb');
    expect(sizeBand(5 * 1_048_576)).toBe('1_10mb');
    expect(sizeBand(50 * 1_048_576)).toBe('10_100mb');
    expect(sizeBand(500 * 1_048_576)).toBe('100mb_1gb');
    expect(sizeBand(5 * 1024 * 1_048_576)).toBe('1_10gb');
    expect(sizeBand(50 * 1024 * 1_048_576)).toBe('over_10gb');
    expect(sizeBand(Number.NaN)).toBe('unknown');
  });
});
