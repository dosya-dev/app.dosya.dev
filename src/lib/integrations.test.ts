import { describe, it, expect } from 'vitest';
import {
  INTEGRATIONS, getIntegration, API_HOST, S3_REGION,
  rcloneConfig, webdavUrl, webdavWindowsMount, webdavLinuxMount,
  s3Endpoint, s3Examples, desktopDownload, restExample,
} from './integrations';

const ctx = { workspaceId: 'ws_abc123', email: 'ada@example.com' };

describe('integrations metadata', () => {
  it('exposes exactly the five integrations in order', () => {
    expect(INTEGRATIONS.map((i) => i.slug)).toEqual([
      'rclone', 'webdav', 's3', 'desktop', 'rest-api',
    ]);
  });
  it('resolves a slug, and returns undefined for unknown', () => {
    expect(getIntegration('s3')?.title).toBe('S3');
    expect(getIntegration('nope')).toBeUndefined();
  });
});

describe('snippet builders inject context + use the API host', () => {
  it('rclone config carries workspace id and explicit api_url', () => {
    const cfg = rcloneConfig(ctx);
    expect(cfg).toContain('type = dosya');
    expect(cfg).toContain('workspace_id = ws_abc123');
    expect(cfg).toContain(`api_url = ${API_HOST}`);
    expect(cfg).toContain('api_key = dos_your_api_key');
  });
  it('webdav url + mounts use the api host and workspace id', () => {
    expect(webdavUrl(ctx)).toBe('https://api.dosya.dev/webdav/ws_abc123/');
    expect(webdavLinuxMount(ctx)).toContain('mount -t davfs https://api.dosya.dev/webdav/ws_abc123/');
    expect(webdavWindowsMount(ctx)).toContain('/user:ada@example.com');
  });
  it('s3 endpoint/region/bucket', () => {
    expect(s3Endpoint()).toBe('https://api.dosya.dev/s3');
    expect(S3_REGION).toBe('us-east-1');
    expect(s3Examples(ctx)).toContain('s3://ws_abc123/');
  });
  it('desktop download builds a platform url from the given base', () => {
    expect(desktopDownload('https://api.dosya.dev', 'mac'))
      .toBe('https://api.dosya.dev/api/desktop/latest?platform=mac');
  });
  it('rest example uses bearer auth against the api host', () => {
    const c = restExample();
    expect(c).toContain('https://api.dosya.dev/api/me');
    expect(c).toContain('Authorization: Bearer dos_your_api_key');
  });
});
