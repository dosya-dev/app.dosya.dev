import { describe, expect, it } from 'vitest';
import type { RcloneBackend } from '@/api/rclone-import';
import { collectOptions, joinPath, missingRequired, optionLabel, parentPath, visibleOptions } from './form-model';

const s3: RcloneBackend = {
  name: 's3', label: 'S3', description: '', category: 'object', oauth: false,
  options: [
    { name: 'provider', help: '', type: 'string', required: true, password: false, sensitive: false, default: '', exclusive: true, examples: [{ value: 'AWS', help: 'AWS' }, { value: 'Cloudflare', help: 'R2' }] },
    { name: 'region', help: 'aws', type: 'string', required: false, password: false, sensitive: false, default: '', provider: 'AWS' },
    { name: 'region', help: 'other', type: 'string', required: false, password: false, sensitive: false, default: '', provider: 'Cloudflare,Other' },
    { name: 'endpoint', help: '', type: 'string', required: true, password: false, sensitive: false, default: '', provider: 'Cloudflare' },
    { name: 'key_pem', help: '', type: 'string', required: false, password: false, sensitive: true, default: '' },
  ],
};

describe('form-model', () => {
  it('labels', () => expect(optionLabel('access_key_id')).toBe('Access key id'));

  it('filters by provider and keeps one option per name', () => {
    expect(visibleOptions(s3, {}).map((o) => o.name)).toEqual(['provider', 'key_pem']);
    const r2 = visibleOptions(s3, { provider: 'Cloudflare' });
    expect(r2.map((o) => o.name)).toEqual(['provider', 'region', 'endpoint', 'key_pem']);
    expect(r2[1].help).toBe('other');
  });

  it('required follows the provider', () => {
    expect(missingRequired(s3, { provider: 'AWS' })).toEqual([]);
    expect(missingRequired(s3, { provider: 'Cloudflare' })).toEqual(['endpoint']);
  });

  it('collects only visible, trimmed, single-line values', () => {
    const out = collectOptions(s3, {
      provider: 'AWS', region: ' us-east-1 ', endpoint: 'hidden-for-aws',
      key_pem: '-----BEGIN-----\nabc\n-----END-----',
    });
    expect(out).toEqual({ provider: 'AWS', region: 'us-east-1', key_pem: '-----BEGIN-----\\nabc\\n-----END-----' });
  });

  it('collapses pasted JSON to one line', () => {
    const b: RcloneBackend = { ...s3, options: [{ name: 'token', help: '', type: 'string', required: true, password: false, sensitive: true, default: '' }] };
    expect(collectOptions(b, { token: '{\n  "access_token": "x"\n}' })).toEqual({ token: '{"access_token":"x"}' });
  });

  it('paths', () => {
    expect(joinPath('', 'bucket')).toBe('bucket');
    expect(joinPath('bucket/', 'dir')).toBe('bucket/dir');
    expect(parentPath('bucket/dir')).toBe('bucket');
    expect(parentPath('bucket')).toBe('');
    expect(parentPath('/home/me')).toBe('/home');
    expect(parentPath('/home')).toBe('/');
  });
});

import { errorKind, jobTone, meterTone, monogram } from './form-model';

describe('presentation helpers', () => {
  it('monograms', () => {
    expect(monogram('s3', 'Amazon S3 & S3-compatible')).toBe('S3');
    expect(monogram('pcloud', 'pCloud')).toBe('Pc');
    expect(monogram('mega', 'MEGA')).toBe('Me');
  });
  it('job tone', () => {
    expect(jobTone({ status: 'complete', files_failed: 2, error_code: 'partial' })).toBe('partial');
    expect(jobTone({ status: 'complete', files_failed: 0, error_code: null })).toBe('done');
    expect(jobTone({ status: 'failed', files_failed: 0, error_code: 'x' })).toBe('failed');
    expect(jobTone({ status: 'queued', files_failed: 0, error_code: null })).toBe('waiting');
  });
  it('error kinds and meter tone', () => {
    expect(errorKind('source_not_found')).toBe('not_found');
    expect(errorKind('rclone_error')).toBe('connect');
    expect(errorKind('worker_lost')).toBe('stopped');
    expect(meterTone(10, 100)).toBe('ok');
    expect(meterTone(75, 100)).toBe('warn');
    expect(meterTone(95, 100)).toBe('full');
  });
});

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BRAND_ICONS } from './form-model';

describe('brand icons', () => {
  it('every listed icon ships in public/rclone-icons', () => {
    const missing = [...BRAND_ICONS].filter((n) => !existsSync(resolve(import.meta.dirname, '../../../public/rclone-icons', `${n}.webp`)));
    expect(missing).toEqual([]);
  });
});
