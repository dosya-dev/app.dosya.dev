// Pure model for the Profile → API keys section: the key shape the API
// returns, the create-form draft, and every formatter and rule the list and
// the create dialog share. Nothing here touches React or the network, so
// the whole file is unit-testable (see api-keys.test.ts).
import { timeAgo } from '@/lib/helpers';
import { gbToBytes, mbToBytes } from '@/lib/usage-units';

// Mirrors GET /api/me/api-keys (apps/api/src/pages/api/me/api-keys/index.ts).
// Usage limits (requests_per_minute etc.) are stored but not returned by that
// route, so they can't be shown for an existing key.
export interface ApiKey {
  id: string; name: string; scope: string; key_prefix: string;
  created_at: number;
  // Unix seconds; null until the key is used once.
  last_used_at: number | null;
  // Unix seconds, or null for a key that never expires. Both doors refuse an
  // expired key and the API refuses to mint S3 credentials for one.
  expires_at: number | null;
  s3_access_key_id: string | null;
  surfaces: string | null;
  // Folder anchor (migration 0095). NULL/NULL means the key sees the whole
  // account - see apps/api/src/lib/access/anchor.ts.
  workspace_id: string | null;
  root_folder_id: string | null;
  // Access conditions (migration 0097). NULL means unrestricted for that one
  // condition - see apps/api/src/lib/access/{cidr,active-hours}.ts.
  allowed_ips: string | null;
  active_hours: string | null;
}

export interface WorkspaceRef { id: string; name: string }

export const SCOPE_LABELS: Record<string, string> = { full: 'Full access', read: 'Read only', upload: 'Upload only' };

// Order is the order of the radio cards in the create dialog.
export const SCOPE_OPTIONS: { value: string; label: string; blurb: string; verb: string }[] = [
  { value: 'read', label: 'Read only', blurb: 'List and download. Cannot upload, move or delete anything.', verb: 'list and download files' },
  { value: 'upload', label: 'Upload only', blurb: 'Add new files. Cannot read or delete what is already there.', verb: 'upload new files, and nothing else' },
  { value: 'full', label: 'Full access', blurb: 'Everything your account can do: read, upload, move, delete.', verb: 'read, upload, move and delete anything' },
];

// Order also drives the create-form checkbox list.
export const SURFACE_OPTIONS: { value: string; label: string }[] = [
  { value: 'webdav', label: 'WebDAV' },
  { value: 'sftp', label: 'SFTP' },
  { value: 's3', label: 'S3 gateway' },
  { value: 'api', label: 'REST API' },
];
const SURFACE_LABELS: Record<string, string> = Object.fromEntries(SURFACE_OPTIONS.map((o) => [o.value, o.label]));

// Sentinel for the "no workspace pin" option in the create-key workspace
// Select - '' isn't usable there since an unselected/placeholder value reads
// the same way in that component.
export const WHOLE_ACCOUNT = '__whole_account__';

// Day-of-week for active_hours.days (0 = Sunday, matching
// apps/api/src/lib/access/active-hours.ts). Order is display order.
export const DAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];
const DAY_LABELS: Record<number, string> = Object.fromEntries(DAY_OPTIONS.map((d) => [d.value, d.label]));

export type Expiry = 'never' | '30' | '90';
export const EXPIRY_OPTIONS: { value: Expiry; label: string; blurb?: string }[] = [
  { value: 'never', label: 'Never expires' },
  { value: '30', label: 'Expires in 30 days', blurb: 'Good for a key you are pasting into something once.' },
  { value: '90', label: 'Expires in 90 days' },
];

const STALE_AFTER_DAYS = 90;
const EXPIRING_SOON_DAYS = 30;
const DAY = 86_400;

// IANA timezone names for the active-hours zone picker. Intl.supportedValuesOf
// isn't implemented everywhere (older Safari/WebKit) - fall back to a short
// list anchored on the browser's own zone so the picker is never empty.
export function timezoneOptions(): string[] {
  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
    if (zones && zones.length > 0) return zones;
  } catch { /* not supported in this runtime */ }
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([here, 'Etc/UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney'])];
}

// ── Existing-key formatters ────────────────────────────────

// null (or unset) means the key was created before migration 0094, or was
// created with no restriction - both are unrestricted, matching the API's
// `parseSurfaces()` in apps/api/src/lib/access/credential.ts.
export function formatSurfaces(surfaces: string | null): string {
  if (!surfaces) return 'All protocols';
  return surfaces.split(',').map((s) => SURFACE_LABELS[s] ?? s).join(', ');
}

// Mirrors credentialAllowsSurface() in apps/api/src/lib/access/credential.ts,
// which is what the API's s3-credentials route and the S3 door both apply:
// null is unrestricted, an empty list is a restriction to zero surfaces. The
// page must agree with the server here or it offers an "Enable" the server
// refuses (bounty report 2026-09-05).
export function keyAllowsS3(surfaces: string | null): boolean {
  if (surfaces === null) return true;
  return surfaces.split(',').map((s) => s.trim()).includes('s3');
}

export function keyExpired(k: { expires_at: number | null }, now = Math.floor(Date.now() / 1000)): boolean {
  return k.expires_at !== null && k.expires_at <= now;
}

// A key with no workspace_id sees the whole account (see anchor.ts's
// isAnchored/workspaceAllowed). A workspace_id with no root_folder_id is
// pinned to that workspace but not narrowed inside it, so it shows just the
// workspace name; a root_folder_id narrows further to "workspace / folder".
export function formatAnchor(
  k: { workspace_id: string | null; root_folder_id: string | null },
  workspaces: WorkspaceRef[],
  folderNames: Record<string, string>,
): string {
  if (!k.workspace_id) return 'Whole account';
  const wsName = workspaces.find((w) => w.id === k.workspace_id)?.name ?? 'Unknown workspace';
  if (!k.root_folder_id) return wsName;
  const folderName = folderNames[k.root_folder_id] ?? '…';
  return `${wsName} / ${folderName}`;
}

export function formatLastUsed(k: { last_used_at: number | null }, now = Math.floor(Date.now() / 1000)): string {
  return k.last_used_at === null ? 'Never' : timeAgo(k.last_used_at, now);
}

// A key nobody has touched for 90 days is the one worth revoking. A key
// never used at all is judged by its age instead, so a fresh key isn't
// flagged the moment it's made.
export function isStale(k: { last_used_at: number | null; created_at: number }, now = Math.floor(Date.now() / 1000)): boolean {
  const ref = k.last_used_at ?? k.created_at;
  return now - ref > STALE_AFTER_DAYS * DAY;
}

function countIpRanges(allowedIps: string | null | undefined): number {
  if (!allowedIps) return 0;
  return allowedIps.split(',').map((s) => s.trim()).filter(Boolean).length;
}

function formatDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.join(',') === '1,2,3,4,5') return 'Mon–Fri';
  if (sorted.length === 7) return 'Every day';
  return sorted.map((d) => DAY_LABELS[d] ?? String(d)).join(', ');
}

interface ActiveHours { tz: string; days: number[]; from: string; to: string }

function parseActiveHours(raw: string | null): ActiveHours | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ActiveHours>;
    if (typeof v?.tz !== 'string' || !Array.isArray(v.days) || typeof v.from !== 'string' || typeof v.to !== 'string') return null;
    return { tz: v.tz, days: v.days.filter((d): d is number => typeof d === 'number'), from: v.from, to: v.to };
  } catch { return null; }
}

// "Mon–Fri 09:00–17:00 (Europe/Istanbul)" for the expanded row. The column
// stores JSON the API wrote, so a parse failure is a bug elsewhere - fall
// back to naming the kind rather than throwing.
export function formatActiveHours(raw: string | null): string {
  const h = parseActiveHours(raw);
  if (!h) return 'Restricted hours';
  return `${formatDays(h.days)} ${h.from}–${h.to} (${h.tz})`;
}

// ── Guards ─────────────────────────────────────────────────
// The four ways a key can be narrower than the account that owns it. The
// same four show as the rail under the create dialog and as the
// "unrestricted" count on the list, so both surfaces agree on the word.

export type GuardId = 'scope' | 'reach' | 'origin' | 'expiry';
export interface Guard { id: GuardId; label: string; on: boolean }

interface KeyFacts {
  scope: string; surfacesRestricted: boolean; anchored: boolean;
  ipRestricted: boolean; hoursRestricted: boolean; expires: boolean;
}

function guardsFrom(f: KeyFacts): Guard[] {
  return [
    { id: 'scope', label: 'Narrowed permission', on: f.scope !== 'full' },
    { id: 'reach', label: 'Narrowed reach', on: f.anchored || f.surfacesRestricted },
    { id: 'origin', label: 'IP or hours', on: f.ipRestricted || f.hoursRestricted },
    { id: 'expiry', label: 'Expiry', on: f.expires },
  ];
}

export function keyGuards(k: ApiKey): Guard[] {
  return guardsFrom({
    scope: k.scope,
    surfacesRestricted: k.surfaces !== null,
    anchored: k.workspace_id !== null,
    ipRestricted: countIpRanges(k.allowed_ips) > 0,
    hoursRestricted: parseActiveHours(k.active_hours) !== null,
    expires: k.expires_at !== null,
  });
}

export function isUnrestricted(k: ApiKey): boolean {
  return keyGuards(k).every((g) => !g.on);
}

export interface KeySummary { total: number; unrestricted: number; stale: number; expiringSoon: number }

export function summarizeKeys(keys: ApiKey[], now = Math.floor(Date.now() / 1000)): KeySummary {
  return {
    total: keys.length,
    unrestricted: keys.filter(isUnrestricted).length,
    stale: keys.filter((k) => isStale(k, now)).length,
    expiringSoon: keys.filter((k) => k.expires_at !== null && k.expires_at > now && k.expires_at - now <= EXPIRING_SOON_DAYS * DAY).length,
  };
}

export interface KeyFilter { q?: string; scope?: string; unrestrictedOnly?: boolean }

export function filterKeys(keys: ApiKey[], f: KeyFilter): ApiKey[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return keys.filter((k) => {
    if (q && !k.name.toLowerCase().includes(q) && !k.key_prefix.toLowerCase().includes(q)) return false;
    if (f.scope && f.scope !== 'all' && k.scope !== f.scope) return false;
    if (f.unrestrictedOnly && !isUnrestricted(k)) return false;
    return true;
  });
}

// ── Create-form draft ──────────────────────────────────────

export interface KeyDraft {
  name: string;
  scope: string;
  // 'all' sends no surfaces field (unrestricted); 'some' sends the ticked
  // list. Replaces the old "leave every box unchecked to allow all" rule.
  protocolMode: 'all' | 'some';
  surfaces: Set<string>;
  workspaceId: string;
  folderId: string | null;
  folderName: string;
  allowedIps: string;
  hoursEnabled: boolean;
  tz: string;
  days: Set<number>;
  from: string;
  to: string;
  // Kept as strings so an input can be legitimately empty without coercing
  // to 0 - see buildCreateBody's conversion.
  requestsPerMinute: string;
  egressGbPerDay: string;
  maxFileSizeMb: string;
  maxConcurrentTransfers: string;
  expiry: Expiry;
}

export function emptyDraft(tz = Intl.DateTimeFormat().resolvedOptions().timeZone): KeyDraft {
  return {
    name: '', scope: 'full', protocolMode: 'all', surfaces: new Set(),
    workspaceId: WHOLE_ACCOUNT, folderId: null, folderName: '',
    allowedIps: '', hoursEnabled: false, tz, days: new Set([1, 2, 3, 4, 5]), from: '09:00', to: '17:00',
    requestsPerMinute: '', egressGbPerDay: '', maxFileSizeMb: '', maxConcurrentTransfers: '',
    expiry: 'never',
  };
}

// "Duplicate settings" on an existing key: keys can't be edited, so the way
// to change one is to recreate it. Usage limits aren't returned by the list
// route, so they start blank; expiry starts at never because the original's
// remaining lifetime isn't a sensible thing to copy.
export function draftFromKey(k: ApiKey, folderName = ''): KeyDraft {
  const hours = parseActiveHours(k.active_hours);
  const base = emptyDraft(hours?.tz);
  return {
    ...base,
    name: `${k.name} copy`.slice(0, 64),
    scope: k.scope,
    protocolMode: k.surfaces === null ? 'all' : 'some',
    surfaces: new Set(k.surfaces ? k.surfaces.split(',').map((s) => s.trim()).filter(Boolean) : []),
    workspaceId: k.workspace_id ?? WHOLE_ACCOUNT,
    folderId: k.workspace_id ? k.root_folder_id : null,
    folderName: k.workspace_id && k.root_folder_id ? folderName : '',
    allowedIps: k.allowed_ips ?? '',
    hoursEnabled: hours !== null,
    days: hours ? new Set(hours.days) : base.days,
    from: hours?.from ?? base.from,
    to: hours?.to ?? base.to,
  };
}

function draftFacts(d: KeyDraft): KeyFacts {
  return {
    scope: d.scope,
    surfacesRestricted: d.protocolMode === 'some' && d.surfaces.size > 0,
    anchored: d.workspaceId !== WHOLE_ACCOUNT,
    ipRestricted: countIpRanges(d.allowedIps) > 0,
    hoursRestricted: d.hoursEnabled,
    expires: d.expiry !== 'never',
  };
}

export function draftGuards(d: KeyDraft): Guard[] {
  return guardsFrom(draftFacts(d));
}

function hasLimits(d: KeyDraft): boolean {
  return [d.requestsPerMinute, d.egressGbPerDay, d.maxFileSizeMb, d.maxConcurrentTransfers].some((v) => v.trim() !== '');
}

// How many things under "Restrictions and expiry" are actually set - the
// count on the collapsed disclosure, so nothing set there feels hidden.
export function restrictionCount(d: KeyDraft): number {
  const f = draftFacts(d);
  return [f.surfacesRestricted, f.anchored, f.ipRestricted, f.hoursRestricted, f.expires, hasLimits(d)].filter(Boolean).length;
}

export interface Segment { text: string; strong?: boolean }

function joinNatural(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// The sentence under the create form that reads the key back before it
// exists. Segments, not a string, so the dialog can bold the parts that
// matter without parsing prose.
export function describeDraft(d: KeyDraft, workspaces: WorkspaceRef[]): Segment[] {
  const f = draftFacts(d);
  const verb = SCOPE_OPTIONS.find((o) => o.value === d.scope)?.verb ?? SCOPE_LABELS[d.scope] ?? d.scope;

  let reach = 'your whole account';
  if (f.anchored) {
    const ws = workspaces.find((w) => w.id === d.workspaceId)?.name ?? 'one workspace';
    reach = d.folderId ? `${ws} / ${d.folderName || 'one folder'}` : ws;
  }

  const protocols = f.surfacesRestricted
    ? joinNatural(SURFACE_OPTIONS.filter((o) => d.surfaces.has(o.value)).map((o) => o.value === 's3' ? 'the S3 gateway' : o.label))
    : 'every protocol';

  const ipCount = countIpRanges(d.allowedIps);
  const originParts: string[] = [];
  if (ipCount > 0) originParts.push(`${ipCount} IP range${ipCount === 1 ? '' : 's'}`);
  else originParts.push('any address');
  if (d.hoursEnabled) originParts.push(`${formatDays([...d.days])} ${d.from}–${d.to}`);
  else originParts.push('at any time');
  const origin = d.hoursEnabled || ipCount > 0 ? originParts.join(', ') : originParts.join(' ');

  const expiry = d.expiry === 'never' ? 'never expires' : `expires in ${d.expiry} days`;

  return [
    { text: 'This key will be able to ' }, { text: verb, strong: true },
    { text: ' in ' }, { text: reach, strong: true },
    { text: ', over ' }, { text: protocols, strong: true },
    { text: ', from ' }, { text: origin, strong: true },
    { text: ', and it ' }, { text: expiry, strong: true },
    { text: '.' },
  ];
}

// The POST /api/me/api-keys body. Every optional field is sent only when it
// was actually set: an absent field (not an empty array, not 0) is what the
// endpoint treats as unrestricted, so the server's own normalisation never
// runs on a value the user didn't mean to set.
export function buildCreateBody(d: KeyDraft): Record<string, unknown> {
  const f = draftFacts(d);
  const egressBytesPerDay = gbToBytes(d.egressGbPerDay);
  const maxFileSizeBytes = mbToBytes(d.maxFileSizeMb);
  return {
    name: d.name.trim(),
    scope: d.scope,
    ...(f.surfacesRestricted ? { surfaces: SURFACE_OPTIONS.map((o) => o.value).filter((v) => d.surfaces.has(v)) } : {}),
    // root_folder_id requires workspace_id (see the endpoint's validation
    // order) - only send the folder when a real workspace is pinned.
    ...(f.anchored ? { workspace_id: d.workspaceId } : {}),
    ...(f.anchored && d.folderId ? { root_folder_id: d.folderId } : {}),
    ...(f.ipRestricted ? { allowed_ips: d.allowedIps.trim() } : {}),
    ...(d.hoursEnabled ? { active_hours: { tz: d.tz, days: [...d.days].sort((a, b) => a - b), from: d.from, to: d.to } } : {}),
    ...(d.requestsPerMinute.trim() ? { requests_per_minute: Math.round(Number(d.requestsPerMinute)) } : {}),
    ...(egressBytesPerDay !== null ? { egress_bytes_per_day: egressBytesPerDay } : {}),
    ...(maxFileSizeBytes !== null ? { max_file_size_bytes: maxFileSizeBytes } : {}),
    ...(d.maxConcurrentTransfers.trim() ? { max_concurrent_transfers: Math.round(Number(d.maxConcurrentTransfers)) } : {}),
    ...(d.expiry !== 'never' ? { expires_in_days: Number(d.expiry) } : {}),
  };
}
