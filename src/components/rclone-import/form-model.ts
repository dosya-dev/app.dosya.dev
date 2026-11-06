import type { RcloneBackend, RcloneOption } from '@/api/rclone-import';

/** Pure helpers behind the remote-import form and dialog (kept out of the component files for fast refresh). */

/** "access_key_id" -> "Access key id". */
export function optionLabel(name: string): string {
  const s = name.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** S3-style options carry a provider filter; everything else always applies. */
export function appliesTo(o: { provider?: string }, provider: string | undefined): boolean {
  if (!o.provider) return true;
  if (!provider) return false;
  return o.provider.split(',').includes(provider);
}

/**
 * The options to render: provider-filtered, and de-duplicated by name (S3 has
 * one `region`/`endpoint` per provider family; after filtering, the first that
 * applies wins).
 */
export function visibleOptions(backend: RcloneBackend, values: Record<string, string>): RcloneOption[] {
  const provider = values.provider;
  const seen = new Set<string>();
  const out: RcloneOption[] = [];
  for (const o of backend.options) {
    if (seen.has(o.name) || !appliesTo(o, provider)) continue;
    seen.add(o.name);
    out.push(o);
  }
  return out;
}

/** What gets sent: only visible, non-empty values; multi-line pastes collapsed the way rclone wants them. */
export function collectOptions(backend: RcloneBackend, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of visibleOptions(backend, values)) {
    let v = (values[o.name] ?? '').trim();
    if (!v) continue;
    // rclone takes a PEM key as one line with literal "\n" separators, and a
    // JSON blob (service account, token) as one line. A pasted multi-line
    // value would otherwise be refused by the API's single-line rule.
    if (o.name === 'key_pem') v = v.replace(/\r?\n/g, '\\n');
    else if (/^[[{]/.test(v)) {
      try { v = JSON.stringify(JSON.parse(v)); } catch { /* left as typed; the API will say why */ }
    }
    out[o.name] = v;
  }
  return out;
}

export function missingRequired(backend: RcloneBackend, values: Record<string, string>): string[] {
  return visibleOptions(backend, values).filter((o) => o.required && !(values[o.name] ?? '').trim()).map((o) => o.name);
}

/** Join "a/b" + "c" the way rclone paths join; "" is the remote's root. */
export function joinPath(base: string, name: string): string {
  const b = base.replace(/\/+$/, '');
  return b ? `${b}/${name}` : name;
}

export function parentPath(path: string): string {
  const p = path.replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  return i <= 0 ? (p.startsWith('/') ? '/' : '') : p.slice(0, i);
}

/** Two-letter mark for a service tile. Brand logos are not ours to ship for 47 services; a mark is honest. */
const MONOGRAMS: Record<string, string> = {
  s3: 'S3', b2: 'B2', gcs: 'GC', azureblob: 'Az', azurefiles: 'Az', sftp: 'SF', ftp: 'FT', smb: 'SM',
  webdav: 'DV', http: 'HT', internetarchive: 'IA', fichier: '1F', mailru: 'MR', premiumizeme: 'PM', putio: 'PI',
};

export function monogram(name: string, label: string): string {
  if (MONOGRAMS[name]) return MONOGRAMS[name];
  const letters = label.replace(/[^A-Za-z0-9 ]/g, '').trim();
  return (letters.charAt(0).toUpperCase() + (letters.charAt(1) ?? '').toLowerCase()) || '?';
}

/** Category hue for a mark, from the app's categorical chart ramp. */
export const CATEGORY_HUE: Record<RcloneBackend['category'], string> = {
  object: 'var(--chart-2)',
  drive: 'var(--chart-4)',
  server: 'var(--chart-3)',
};

export type JobTone = 'waiting' | 'running' | 'done' | 'partial' | 'failed' | 'cancelled';

export function jobTone(j: { status: string; files_failed: number; error_code: string | null }): JobTone {
  if (j.status === 'queued') return 'waiting';
  if (j.status === 'running') return 'running';
  if (j.status === 'cancelled') return 'cancelled';
  if (j.status === 'complete') return j.files_failed > 0 || j.error_code === 'partial' ? 'partial' : 'done';
  return 'failed';
}

/** Which short, plain explanation a worker error code gets; the raw rclone text stays behind "Details". */
export type ErrorKind = 'not_found' | 'allowance' | 'stopped' | 'not_started' | 'unsafe' | 'plan' | 'connect';

export function errorKind(code: string | null): ErrorKind {
  switch (code) {
    case 'source_not_found': return 'not_found';
    case 'allowance_used': return 'allowance';
    case 'worker_lost': case 'timeout': case 'temporary': return 'stopped';
    case 'not_started': case 'config_missing': case 'config_unreadable': case 'worker_error': return 'not_started';
    case 'unsafe_config': return 'unsafe';
    case 'free_plan': case 'grace_period': case 'concurrency': return 'plan';
    default: return 'connect';
  }
}

/** Meter colour by fill, the app's status rule: green, amber over 70%, red over 90%. */
export function meterTone(used: number, limit: number): 'ok' | 'warn' | 'full' {
  const pct = limit > 0 ? used / limit : 1;
  return pct >= 0.9 ? 'full' : pct >= 0.7 ? 'warn' : 'ok';
}

/**
 * Brand icons in public/rclone-icons/<name>.webp: each service's own favicon
 * or app icon (Akamai from Simple Icons, CC0), normalised to 64px lossless
 * WebP. A service missing here falls back to its two-letter mark.
 */
export const BRAND_ICONS: ReadonlySet<string> = new Set([
  'azureblob', 'azurefiles', 'b2', 'box', 'cloudinary', 'fichier', 'filelu', 'filen', 'filescom', 'gcs', 'gofile',
  'hidrive', 'imagekit', 'internetarchive', 'internxt', 'koofr', 'linkbox', 'mailru', 'mega', 'netstorage', 'opendrive',
  'pcloud', 'pikpak', 'pixeldrain', 'premiumizeme', 'putio', 'qingstor', 'quatrix', 's3', 'seafile', 'sharefile',
  'storj', 'sugarsync', 'swift', 'ulozto', 'yandex', 'zoho', 'drime', 'shade', 'huaweidrive', 'doi',
  'drive', 'onedrive', 'dropbox',
]);
