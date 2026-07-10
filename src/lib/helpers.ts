export function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  const d = new Date(ts * 1000);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m[d.getMonth()]} ${d.getDate()}`;
}

export function humanSize(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

export function humanSizeShort(b: number): string {
  if (b < 1073741824) return (b / 1048576).toFixed(0) + ' MB';
  return (b / 1073741824).toFixed(1) + ' GB';
}

const EXT_COLORS: Record<string, string> = {
  mp4: '#EF4444', mov: '#EF4444', avi: '#EF4444', mkv: '#EF4444', webm: '#EF4444',
  fig: '#7C3AED', sketch: '#7C3AED', xd: '#7C3AED',
  pdf: '#2563EB', doc: '#D97706', docx: '#D97706', pptx: '#D97706', ppt: '#D97706',
  xls: '#059669', xlsx: '#059669', csv: '#374151',
  zip: '#0891B2', rar: '#0891B2',
  png: '#059669', jpg: '#059669', jpeg: '#059669', gif: '#059669', svg: '#059669', webp: '#059669',
};

export function extOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

export function colorFor(name: string): string {
  return EXT_COLORS[extOf(name)] ?? '#706E69';
}

export function labelFor(name: string): string {
  const e = extOf(name);
  return e ? e.toUpperCase() : 'FILE';
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
export function isImage(name: string): boolean {
  return IMAGE_EXTS.has(extOf(name));
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv']);
export function isVideo(name: string): boolean {
  return VIDEO_EXTS.has(extOf(name));
}

const TEXT_EXTS = new Set([
  'txt', 'md', 'json', 'xml', 'csv', 'log', 'yml', 'yaml', 'toml', 'ini', 'cfg',
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'cpp', 'h',
  'cs', 'php', 'swift', 'sh', 'bash', 'zsh', 'sql', 'html', 'css', 'scss', 'less',
  'env', 'gitignore', 'dockerfile', 'makefile',
]);
export function isText(name: string): boolean {
  return TEXT_EXTS.has(extOf(name));
}

const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma']);
export function isAudio(name: string): boolean {
  return AUDIO_EXTS.has(extOf(name));
}

// File type icon mapping → /file-icons/{icon}.svg
const EXT_ICON_MAP: Record<string, string> = {
  pdf: '001-pdf', xls: '002-xls', xlsx: '002-xls', doc: '003-doc', docx: '003-doc',
  ppt: '004-ppt', pptx: '004-ppt', txt: '005-txt', svg: '006-svg', sql: '007-sql',
  js: '008-js', ts: '008-js', jpg: '009-jpg', jpeg: '009-jpg', png: '010-png',
  ai: '011-ai', mp3: '012-mp3', wav: '012-mp3', ogg: '012-mp3', flac: '012-mp3',
  mp4: '013-mp4', gif: '014-gif', iso: '015-iso', exe: '016-exe', msi: '016-exe',
  apk: '017-apk', php: '018-php', avi: '019-avi', mov: '020-mov', css: '021-css',
  zip: '022-zip', '7z': '022-zip', tar: '022-zip', gz: '022-zip', rar: '026-rar',
  java: '023-java', eps: '024-eps', ics: '025-ics', xml: '027-xml',
  otp: '028-otp', ttf: '029-ttf', otf: '029-ttf', woff: '029-ttf', woff2: '029-ttf',
};

export function fileIconSrc(name: string): string {
  const ext = extOf(name);
  const icon = EXT_ICON_MAP[ext] ?? '005-txt';
  return `/file-icons/${icon}.svg`;
}

export function folderIconSrc(fileCount: number, isSynced?: boolean): string {
  if (isSynced) return '/sync.svg';
  return fileCount > 0 ? '/file-icons/folder-full.svg' : '/file-icons/folder-empty.svg';
}

const AVATAR_COLORS = ['#7C3AED', '#059669', '#2563EB', '#EA580C', '#DB2777', '#0891B2', '#D97706'];
export function avatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(name: string | null | undefined): string {
  // Guard against null/undefined: activity rows from anonymous actions
  // (public share-link views/downloads) or deleted users have no name.
  const parts = (name ?? '').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function todayStr(): string {
  const d = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

const REGION_LABELS: Record<string, string> = {
  'us-east-1': 'US East', 'us-west-1': 'US West', 'us-west-2': 'US West 2',
  'eu-west-1': 'EU West', 'eu-central-1': 'EU Central',
  'ap-southeast-1': 'Singapore', 'ap-southeast-2': 'Sydney', 'ap-northeast-1': 'Tokyo',
  'sa-east-1': 'Sao Paulo', 'me-south-1': 'Bahrain',
  'af-south-1': 'Cape Town', 'auto': 'Auto',
};

export function regionLabel(code: string): string {
  return REGION_LABELS[code] ?? code;
}

const ACTION_LABELS: Record<string, string> = {
  file_uploaded: 'uploaded',
  file_deleted: 'deleted',
  file_shared: 'shared',
  file_downloaded: 'downloaded',
  link_revoked: 'revoked link for',
  member_invited: 'invited',
  member_removed: 'removed',
  role_changed: 'changed role of',
  settings_updated: 'updated settings',
  workspace_created: 'created workspace',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
