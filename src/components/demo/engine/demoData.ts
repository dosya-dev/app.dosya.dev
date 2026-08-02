// Types + seed data for the marketing demos. Pure data - no React, no browser APIs.
export type DemoThemeId =
  | 'default' | 'mono' | 'claude' | 'amber' | 'ocean' | 'bubblegum' | 'vercel' | 'neo-brutal';

// swatch = the theme's primary color. Copy each hex verbatim from
// apps/web/src/lib/themes.ts (THEMES[n].swatch.primary).
export const DEMO_THEMES: { id: DemoThemeId; label: string; swatch: string }[] = [
  { id: 'default', label: 'Default', swatch: '#2fa563' },
  { id: 'mono', label: 'Mono', swatch: '#242424' },
  { id: 'claude', label: 'Claude', swatch: '#b8623f' },
  { id: 'amber', label: 'Amber', swatch: '#e0a020' },
  { id: 'ocean', label: 'Ocean', swatch: '#2f6fd0' },
  { id: 'bubblegum', label: 'Bubblegum', swatch: '#db4d94' },
  { id: 'vercel', label: 'Vercel', swatch: '#111111' },
  { id: 'neo-brutal', label: 'Neo-Brutalism', swatch: '#ff5a4d' },
];

export type DemoKind = 'image' | 'video' | 'doc' | 'text' | 'archive' | 'audio';

export interface DemoFolder { id: string; name: string; parentId: string | null }

export interface DemoFile {
  id: string;
  name: string;
  sizeBytes: number;
  region: string;
  modified: string;      // static display label so SSR and client render identically
  modifiedRank: number;  // bigger = newer; drives the "modified" sort
  folderId: string | null;
  kind: DemoKind;
  shared?: boolean;
  thumb?: string;        // CSS background for image tiles (stand-in photo)
}

export interface DemoActivityRow { id: string; color: string; text: string; meta: string; failed?: boolean }

export interface DemoUpload { id: string; name: string; sizeBytes: number; progress: number; folderId: string | null }

export const SEED_FOLDERS: DemoFolder[] = [
  { id: 'f-projects', name: 'Projects', parentId: null },
  { id: 'f-docs', name: 'Documents', parentId: null },
  { id: 'f-design', name: 'Design', parentId: 'f-projects' },
];

// Photo-forward root so the default grid view showcases the gallery.
export const SEED_FILES: DemoFile[] = [
  { id: 'd1', name: 'launch-video.mp4', sizeBytes: 482_344_960, region: 'FRA', modified: '1h ago', modifiedRank: 100, folderId: null, kind: 'video', thumb: 'linear-gradient(160deg,#232526,#414345 55%,#0f2027)' },
  { id: 'p1', name: 'sunset-beach.jpg', sizeBytes: 5_242_880, region: 'SYD', modified: '2h ago', modifiedRank: 99, folderId: null, kind: 'image', thumb: 'radial-gradient(circle at 72% 22%,#ffe6a733,transparent 42%),linear-gradient(160deg,#ff9a56,#ff6b9d 48%,#845ec2)' },
  { id: 'p2', name: 'mountain-hike.jpg', sizeBytes: 4_128_768, region: 'FRA', modified: '3h ago', modifiedRank: 98, folderId: null, kind: 'image', thumb: 'linear-gradient(160deg,#8ec5fc,#5b7fb5 52%,#2b3a67)' },
  { id: 'p3', name: 'city-night.jpg', sizeBytes: 6_029_312, region: 'IAD', modified: '5h ago', modifiedRank: 97, folderId: null, kind: 'image', thumb: 'radial-gradient(circle at 68% 24%,#ffd98a44,transparent 40%),linear-gradient(160deg,#0f2027,#203a43 55%,#2c5364)' },
  { id: 'p4', name: 'ocean-dive.jpg', sizeBytes: 3_984_588, region: 'SIN', modified: 'Yesterday', modifiedRank: 96, folderId: null, kind: 'image', thumb: 'linear-gradient(160deg,#43cea2,#187fb5 55%,#0b3d66)' },
  { id: 'p5', name: 'forest-trail.jpg', sizeBytes: 4_823_450, region: 'SYD', modified: 'Yesterday', modifiedRank: 95, folderId: null, kind: 'image', thumb: 'linear-gradient(160deg,#a8e063,#56ab2f 50%,#1d5631)' },
  { id: 'p6', name: 'desert-road.jpg', sizeBytes: 5_557_452, region: 'FRA', modified: '2d ago', modifiedRank: 94, folderId: null, kind: 'image', thumb: 'linear-gradient(160deg,#f6d365,#e28f4c 52%,#a1522b)' },
  { id: 'p7', name: 'autumn-park.jpg', sizeBytes: 3_251_200, region: 'SYD', modified: '2d ago', modifiedRank: 93, folderId: null, kind: 'image', thumb: 'linear-gradient(160deg,#f7b733,#e0592a 55%,#7a2e0e)' },
  { id: 'p8', name: 'snow-peak.jpg', sizeBytes: 4_915_200, region: 'IAD', modified: '3d ago', modifiedRank: 92, folderId: null, kind: 'image', thumb: 'linear-gradient(160deg,#e6f0ff,#a7c0e0 50%,#5a6f8c)' },
  { id: 'p9', name: 'lake-house.jpg', sizeBytes: 5_872_026, region: 'SYD', modified: 'Jul 26', modifiedRank: 91, folderId: null, kind: 'image', thumb: 'linear-gradient(160deg,#89f7fe,#4a95c9 55%,#2a4d69)' },
  { id: 'p10', name: 'street-market.jpg', sizeBytes: 4_303_872, region: 'SIN', modified: 'Jul 25', modifiedRank: 90, folderId: null, kind: 'image', thumb: 'radial-gradient(circle at 30% 30%,#ffd16644,transparent 45%),linear-gradient(160deg,#c94b4b,#4b134f)' },
  { id: 'p11', name: 'garden-bloom.jpg', sizeBytes: 2_936_012, region: 'SYD', modified: 'Jul 24', modifiedRank: 89, folderId: null, kind: 'image', thumb: 'linear-gradient(160deg,#f78ca0,#f9748f 42%,#9b59b6)' },
  { id: 'p12', name: 'coffee-shop.jpg', sizeBytes: 3_602_432, region: 'LHR', modified: 'Jul 22', modifiedRank: 88, folderId: null, kind: 'image', thumb: 'linear-gradient(160deg,#c79081,#8a5a44 55%,#3e2723)' },
  { id: 'd2', name: 'pitch-deck.pdf', sizeBytes: 8_442_880, region: 'SYD', modified: '4h ago', modifiedRank: 87, folderId: null, kind: 'doc', shared: true },
  { id: 'd4', name: 'notes.md', sizeBytes: 2_048, region: 'IAD', modified: '3d ago', modifiedRank: 60, folderId: null, kind: 'text' },
  { id: 'd5', name: 'backup-2026-07.zip', sizeBytes: 1_254_096_640, region: 'SYD', modified: 'Jul 24', modifiedRank: 55, folderId: null, kind: 'archive' },
  { id: 'd6', name: 'roadmap.xlsx', sizeBytes: 1_843_200, region: 'SYD', modified: '1h ago', modifiedRank: 86, folderId: 'f-projects', kind: 'doc' },
  { id: 'd7', name: 'api-spec.yaml', sizeBytes: 45_056, region: 'FRA', modified: '4h ago', modifiedRank: 85, folderId: 'f-projects', kind: 'text' },
  { id: 'd9', name: 'logo-v3.svg', sizeBytes: 24_576, region: 'SYD', modified: '6h ago', modifiedRank: 84, folderId: 'f-design', kind: 'image' },
  { id: 'd10', name: 'hero-mock.png', sizeBytes: 3_670_016, region: 'SYD', modified: 'Yesterday', modifiedRank: 83, folderId: 'f-design', kind: 'image', thumb: 'linear-gradient(160deg,#c471f5,#7b4397 55%,#3a1c5e)' },
  { id: 'd14', name: 'contract.pdf', sizeBytes: 524_288, region: 'IAD', modified: 'Jul 18', modifiedRank: 50, folderId: 'f-docs', kind: 'doc' },
  { id: 'd15', name: 'invoice-0042.pdf', sizeBytes: 262_144, region: 'IAD', modified: 'Jul 15', modifiedRank: 40, folderId: 'f-docs', kind: 'doc' },
];

export const SEED_ACTIVITY: DemoActivityRow[] = [
  { id: 'a1', color: '#22c55e', text: 'You uploaded launch-video.mp4', meta: 'Chrome · Sydney, AU · 2h ago' },
  { id: 'a2', color: '#3b82f6', text: 'You shared pitch-deck.pdf', meta: 'Chrome · Sydney, AU · 5h ago' },
  { id: 'a3', color: '#22c55e', text: 'Desktop app synced Projects', meta: 'dosya Desktop · macOS · 6h ago' },
  { id: 'a4', color: '#a855f7', text: 'anna@studio.co viewed pitch-deck.pdf', meta: 'Share link · Berlin, DE · 8h ago' },
  { id: 'a5', color: '#22c55e', text: 'You uploaded sunset-beach.jpg', meta: 'iPhone · Sydney, AU · Yesterday' },
  { id: 'a6', color: '#ef4444', text: 'Blocked download of contract.pdf', meta: 'Expired link · Unknown · 2d ago', failed: true },
  { id: 'a7', color: '#f59e0b', text: 'New login to your account', meta: 'Safari · Melbourne, AU · 3d ago' },
  { id: 'a8', color: '#22c55e', text: 'You created folder Design', meta: 'Web · Sydney, AU · 4d ago' },
];

export const CANNED_UPLOADS: { name: string; sizeBytes: number }[] = [
  { name: 'quarterly-report.pdf', sizeBytes: 12_582_912 },
  { name: 'holiday-photos.zip', sizeBytes: 268_435_456 },
  { name: 'demo-track.mp3', sizeBytes: 9_437_184 },
  { name: 'screen-recording.mov', sizeBytes: 154_140_672 },
];

export const KIND_COLORS: Record<DemoKind, string> = {
  image: '#8b5cf6', video: '#ef4444', doc: '#3b82f6',
  text: '#64748b', archive: '#f59e0b', audio: '#ec4899',
};

export function humanSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export function kindOf(name: string): DemoKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'm4a'].includes(ext)) return 'audio';
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return 'archive';
  if (['md', 'txt', 'csv', 'json', 'yaml', 'yml'].includes(ext)) return 'text';
  return 'doc';
}

export function shareSlug(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

// File-type icon mapping → /file-icons/{icon}.svg — copied verbatim from
// apps/web/src/lib/helpers.ts so the demo uses the exact same glyph assets.
export function extOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}
const EXT_ICON_MAP: Record<string, string> = {
  pdf: '001-pdf', xls: '002-xls', xlsx: '002-xls', doc: '003-doc', docx: '003-doc',
  ppt: '004-ppt', pptx: '004-ppt', txt: '005-txt', svg: '006-svg', sql: '007-sql',
  js: '008-js', ts: '008-js', jpg: '009-jpg', jpeg: '009-jpg', heic: '009-jpg', heif: '009-jpg', png: '010-png',
  ai: '011-ai', mp3: '012-mp3', wav: '012-mp3', ogg: '012-mp3', flac: '012-mp3',
  mp4: '013-mp4', gif: '014-gif', iso: '015-iso', exe: '016-exe', msi: '016-exe',
  apk: '017-apk', php: '018-php', avi: '019-avi', mov: '020-mov', css: '021-css',
  zip: '022-zip', '7z': '022-zip', tar: '022-zip', gz: '022-zip', rar: '026-rar',
  java: '023-java', eps: '024-eps', ics: '025-ics', xml: '027-xml',
  otp: '028-otp', ttf: '029-ttf', otf: '029-ttf', woff: '029-ttf', woff2: '029-ttf',
  yaml: '005-txt', yml: '005-txt', md: '005-txt',
};
export function fileIconSrc(name: string): string {
  return `/file-icons/${EXT_ICON_MAP[extOf(name)] ?? '005-txt'}.svg`;
}
export function folderIconSrc(hasChildren: boolean): string {
  return hasChildren ? '/file-icons/folder-full.svg' : '/file-icons/folder-empty.svg';
}

// Dashboard figures for the desktop demo (mirrors the real app's landing
// view). Storage strings are display-fixed so they read cleanly; the
// "shared externally" count is derived live from the file list instead so
// sharing a file in the demo bumps it.
export const DEMO_DASHBOARD = {
  totalFiles: 1284,
  filesThisWeek: 142,
  storageUsedLabel: '24.3 GB',
  storageCapLabel: '100 GB',
  storagePercent: 24,
  breakdown: [
    { name: 'Videos', bytes: 12_400_000_000, color: '#ef4444' },
    { name: 'Images', bytes: 7_800_000_000, color: '#8b5cf6' },
    { name: 'Documents', bytes: 2_900_000_000, color: '#3b82f6' },
    { name: 'Archives', bytes: 1_100_000_000, color: '#f59e0b' },
    { name: 'Other', bytes: 3_100_000_000, color: '#94a3b8' },
  ] as { name: string; bytes: number; color: string }[],
};

// Every demo CTA links to the real app's signup (app.dosya.dev in prod),
// not the marketing site. Mirrors APP_BASE in src/lib/app-url.ts.
export const SIGNUP_URL = import.meta.env.PROD
  ? 'https://app.dosya.dev/sign-up'
  : 'http://localhost:5173/sign-up';

// The demo workspace identity, shared by every shell.
export const DEMO_WORKSPACE = { name: 'Acme Studio', initials: 'A', color: '#2fa563' };
export const DEMO_USER = { name: 'Alex Rivera', email: 'alex@acme.studio', initial: 'A' };

// Extra workspaces the desktop switcher dropdown lists (first is active).
export const DEMO_WORKSPACES: { name: string; initials: string; color: string; free: string }[] = [
  { name: 'Acme Studio', initials: 'A', color: '#2fa563', free: '76 GB free of 100 GB' },
  { name: 'Personal', initials: 'P', color: '#7c3aed', free: '3.2 GB free of 5 GB' },
  { name: 'Side Projects', initials: 'S', color: '#2563eb', free: '48 GB free of 50 GB' },
];

// Regions offered on the Upload page (subset of dosya's real edges).
export const DEMO_REGIONS: { code: string; city: string; country: string }[] = [
  { code: 'SYD', city: 'Sydney', country: 'Australia' },
  { code: 'FRA', city: 'Frankfurt', country: 'Germany' },
  { code: 'IAD', city: 'Virginia', country: 'United States' },
  { code: 'SIN', city: 'Singapore', country: 'Singapore' },
  { code: 'LHR', city: 'London', country: 'United Kingdom' },
  { code: 'NRT', city: 'Tokyo', country: 'Japan' },
];

// "Storage by region" breakdown for the web dashboard.
export const DEMO_REGION_BREAKDOWN: { region: string; bytes: number; color: string }[] = [
  { region: 'SYD', bytes: 14_200_000_000, color: '#22c55e' },
  { region: 'FRA', bytes: 6_100_000_000, color: '#3b82f6' },
  { region: 'IAD', bytes: 3_900_000_000, color: '#f59e0b' },
  { region: 'SIN', bytes: 1_900_000_000, color: '#8b5cf6' },
];

// Team members for the web dashboard "Team usage" card.
export const DEMO_TEAM: { name: string; initial: string; color: string; bytes: number }[] = [
  { name: 'Alex Rivera', initial: 'A', color: '#22c55e', bytes: 14_800_000_000 },
  { name: 'Sam Okafor', initial: 'S', color: '#3b82f6', bytes: 7_200_000_000 },
  { name: 'Mia Chen', initial: 'M', color: '#f59e0b', bytes: 4_100_000_000 },
];
