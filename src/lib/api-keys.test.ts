import { describe, expect, it } from 'vitest';
import {
  type ApiKey,
  buildCreateBody, describeDraft, draftFromKey, draftGuards, emptyDraft,
  filterKeys, formatActiveHours, formatLastUsed, isStale, isUnrestricted,
  keyGuards, restrictionCount, summarizeKeys,
} from './api-keys';

const DAY = 86_400;
const NOW = 1_800_000_000;

const key = (over: Partial<ApiKey> = {}): ApiKey => ({
  id: 'k', name: 'key', scope: 'full', key_prefix: 'abcd', created_at: NOW - DAY,
  last_used_at: null, expires_at: null, s3_access_key_id: null, surfaces: null,
  workspace_id: null, root_folder_id: null, allowed_ips: null, active_hours: null,
  ...over,
});

const WS = [{ id: 'ws_1', name: 'Design Studio' }];

describe('formatLastUsed', () => {
  it('says Never for a key that has not been used', () => {
    expect(formatLastUsed(key(), NOW)).toBe('Never');
  });
  it('uses the relative clock for a used key', () => {
    expect(formatLastUsed(key({ last_used_at: NOW - 4 * 60 }), NOW)).toBe('4m ago');
  });
});

describe('isStale', () => {
  it('is stale when last used more than 90 days ago', () => {
    expect(isStale(key({ last_used_at: NOW - 91 * DAY }), NOW)).toBe(true);
    expect(isStale(key({ last_used_at: NOW - 89 * DAY }), NOW)).toBe(false);
  });
  it('falls back to the creation date for a key never used', () => {
    expect(isStale(key({ created_at: NOW - 91 * DAY }), NOW)).toBe(true);
    expect(isStale(key({ created_at: NOW - DAY }), NOW)).toBe(false);
  });
});

describe('keyGuards / isUnrestricted', () => {
  it('reports every guard off for a full-access, whole-account, immortal key', () => {
    const guards = keyGuards(key());
    expect(guards.map((g) => g.id)).toEqual(['scope', 'reach', 'origin', 'expiry']);
    expect(guards.every((g) => !g.on)).toBe(true);
    expect(isUnrestricted(key())).toBe(true);
  });
  it('counts a narrowed scope, a workspace pin, a protocol list, an IP list, hours and an expiry as guards', () => {
    const on = (k: ApiKey) => keyGuards(k).filter((g) => g.on).map((g) => g.id);
    expect(on(key({ scope: 'read' }))).toEqual(['scope']);
    expect(on(key({ workspace_id: 'ws_1' }))).toEqual(['reach']);
    expect(on(key({ surfaces: 'webdav,s3' }))).toEqual(['reach']);
    expect(on(key({ allowed_ips: '10.0.0.0/8' }))).toEqual(['origin']);
    expect(on(key({ active_hours: '{"tz":"UTC","days":[1],"from":"09:00","to":"17:00"}' }))).toEqual(['origin']);
    expect(on(key({ expires_at: NOW + DAY }))).toEqual(['expiry']);
    expect(isUnrestricted(key({ scope: 'read' }))).toBe(false);
  });
});

describe('summarizeKeys', () => {
  it('counts total, unrestricted, stale and expiring-within-30-days keys', () => {
    const s = summarizeKeys([
      key({ id: 'a' }),
      key({ id: 'b', scope: 'read', last_used_at: NOW - 100 * DAY }),
      key({ id: 'c', expires_at: NOW + 10 * DAY }),
      key({ id: 'd', expires_at: NOW + 60 * DAY }),
    ], NOW);
    expect(s).toEqual({ total: 4, unrestricted: 1, stale: 1, expiringSoon: 1 });
  });
});

describe('filterKeys', () => {
  const keys = [
    key({ id: 'a', name: 'rclone backup', key_prefix: 'a3f9zzzz' }),
    key({ id: 'b', name: 'CI uploader', key_prefix: '71cdzzzz', scope: 'upload', workspace_id: 'ws_1' }),
  ];
  it('matches the name or the token prefix, case-insensitively', () => {
    expect(filterKeys(keys, { q: 'RCLONE' }).map((k) => k.id)).toEqual(['a']);
    expect(filterKeys(keys, { q: '71cd' }).map((k) => k.id)).toEqual(['b']);
  });
  it('filters by permission and by unrestricted-only', () => {
    expect(filterKeys(keys, { scope: 'upload' }).map((k) => k.id)).toEqual(['b']);
    expect(filterKeys(keys, { unrestrictedOnly: true }).map((k) => k.id)).toEqual(['a']);
  });
});

describe('formatActiveHours', () => {
  it('collapses Mon-Fri and shows the window', () => {
    expect(formatActiveHours('{"tz":"Europe/Istanbul","days":[1,2,3,4,5],"from":"09:00","to":"17:00"}'))
      .toBe('Mon–Fri 09:00–17:00 (Europe/Istanbul)');
  });
  it('lists other day sets and survives bad JSON', () => {
    expect(formatActiveHours('{"tz":"UTC","days":[0,6],"from":"08:00","to":"12:00"}')).toBe('Sun, Sat 08:00–12:00 (UTC)');
    expect(formatActiveHours('not json')).toBe('Restricted hours');
  });
});

describe('draft: guards, count and description', () => {
  it('starts with no restrictions and full access, and says so', () => {
    const d = emptyDraft('Europe/Istanbul');
    expect(restrictionCount(d)).toBe(0);
    expect(draftGuards(d).every((g) => !g.on)).toBe(true);
    const text = describeDraft(d, WS).map((s) => s.text).join('');
    expect(text).toBe('This key will be able to read, upload, move and delete anything in your whole account, over every protocol, from any address at any time, and it never expires.');
  });
  it('reads a narrowed key back in plain words', () => {
    const d = {
      ...emptyDraft('Europe/Istanbul'),
      scope: 'read', protocolMode: 'some' as const, surfaces: new Set(['webdav', 's3']),
      workspaceId: 'ws_1', folderId: 'f_1', folderName: 'Archive',
      allowedIps: '10.0.0.0/8, 192.168.1.0/24', hoursEnabled: true, expiry: '30' as const,
    };
    expect(restrictionCount(d)).toBe(5);
    expect(draftGuards(d).every((g) => g.on)).toBe(true);
    const segs = describeDraft(d, WS);
    expect(segs.map((s) => s.text).join('')).toBe('This key will be able to list and download files in Design Studio / Archive, over WebDAV and the S3 gateway, from 2 IP ranges, Mon–Fri 09:00–17:00, and it expires in 30 days.');
    expect(segs.filter((s) => s.strong).map((s) => s.text)).toEqual([
      'list and download files', 'Design Studio / Archive', 'WebDAV and the S3 gateway', '2 IP ranges, Mon–Fri 09:00–17:00', 'expires in 30 days',
    ]);
  });
});

describe('buildCreateBody', () => {
  it('sends only the name and scope for an unrestricted draft', () => {
    expect(buildCreateBody({ ...emptyDraft('UTC'), name: '  rclone backup ' })).toEqual({ name: 'rclone backup', scope: 'full' });
  });
  it('sends an absent surfaces field when "some" is picked but nothing is ticked', () => {
    const d = { ...emptyDraft('UTC'), name: 'x', protocolMode: 'some' as const };
    expect(buildCreateBody(d)).not.toHaveProperty('surfaces');
  });
  it('sends every restriction in the shape the endpoint expects', () => {
    const d = {
      ...emptyDraft('UTC'), name: 'x', scope: 'upload', protocolMode: 'some' as const, surfaces: new Set(['api', 'webdav']),
      workspaceId: 'ws_1', folderId: 'f_1', allowedIps: ' 10.0.0.0/8 ', hoursEnabled: true, days: new Set([5, 1]), from: '08:00', to: '18:00',
      requestsPerMinute: '60', egressGbPerDay: '2', maxFileSizeMb: '100', maxConcurrentTransfers: '4', expiry: '90' as const,
    };
    expect(buildCreateBody(d)).toEqual({
      name: 'x', scope: 'upload', surfaces: ['webdav', 'api'], workspace_id: 'ws_1', root_folder_id: 'f_1',
      allowed_ips: '10.0.0.0/8', active_hours: { tz: 'UTC', days: [1, 5], from: '08:00', to: '18:00' },
      requests_per_minute: 60, egress_bytes_per_day: 2 * 1024 ** 3, max_file_size_bytes: 100 * 1024 ** 2,
      max_concurrent_transfers: 4, expires_in_days: 90,
    });
  });
  it('drops the folder when the workspace is the whole account', () => {
    const d = { ...emptyDraft('UTC'), name: 'x', folderId: 'f_1' };
    expect(buildCreateBody(d)).not.toHaveProperty('root_folder_id');
  });
});

describe('draftFromKey', () => {
  it('copies what the list knows about a key so it can be recreated', () => {
    const d = draftFromKey(key({
      name: 'old', scope: 'read', surfaces: 'webdav', workspace_id: 'ws_1', root_folder_id: 'f_1',
      allowed_ips: '10.0.0.0/8', active_hours: '{"tz":"UTC","days":[1,2],"from":"09:00","to":"17:00"}',
    }), 'Archive');
    expect(d.name).toBe('old copy');
    expect(d.scope).toBe('read');
    expect(d.protocolMode).toBe('some');
    expect([...d.surfaces]).toEqual(['webdav']);
    expect(d.workspaceId).toBe('ws_1');
    expect(d.folderId).toBe('f_1');
    expect(d.folderName).toBe('Archive');
    expect(d.allowedIps).toBe('10.0.0.0/8');
    expect(d.hoursEnabled).toBe(true);
    expect([...d.days]).toEqual([1, 2]);
    expect(d.tz).toBe('UTC');
  });
});
