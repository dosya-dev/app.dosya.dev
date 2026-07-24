import {
  RefreshCw, HardDrive, Server, Cloud, Monitor, Terminal, Code2, type LucideIcon,
} from 'lucide-react';

export interface IntegrationCtx {
  workspaceId: string;
  email: string;
}

export type IntegrationSlug =
  | 'rclone' | 'webdav' | 'sftp' | 's3' | 'desktop' | 'cli' | 'rest-api' | 'google';

export interface IntegrationMeta {
  slug: IntegrationSlug;
  title: string;
  description: string;
  tag: string;
  icon: LucideIcon;
  /** Optional brand-logo image (public path). When set, cards/headers render it instead of `icon`. */
  iconSrc?: string;
}

export const API_HOST = 'https://api.dosya.dev';
export const S3_REGION = 'us-east-1';
export const WORKSPACE_PLACEHOLDER = 'ws_...';
export const EMAIL_PLACEHOLDER = 'you@example.com';

export const INTEGRATIONS: IntegrationMeta[] = [
  {
    slug: 'rclone',
    title: 'rclone',
    description: 'Copy, sync and mount your files from the command line with rclone.',
    tag: 'Sync & mount',
    icon: RefreshCw,
  },
  {
    slug: 'webdav',
    title: 'WebDAV',
    description: 'Mount your workspace as a network drive on macOS, Windows or Linux.',
    tag: 'Mount as drive',
    icon: HardDrive,
  },
  {
    slug: 'sftp',
    title: 'SFTP',
    description: 'Upload and manage files with any SFTP client — FileZilla, WinSCP, Cyberduck or the terminal.',
    tag: 'Secure transfer',
    icon: Server,
  },
  {
    slug: 's3',
    title: 'S3',
    description: 'Point any S3-compatible tool or SDK at your workspace.',
    tag: 'S3 API',
    icon: Cloud,
  },
  {
    slug: 'desktop',
    title: 'Desktop apps',
    description: 'Download the desktop app for macOS, Windows and Linux.',
    tag: 'Apps',
    icon: Monitor,
  },
  {
    slug: 'cli',
    title: 'CLI',
    description: 'Script uploads, downloads and folder sync from your terminal with the dosya CLI.',
    tag: 'Terminal',
    icon: Terminal,
  },
  {
    slug: 'rest-api',
    title: 'REST API',
    description: 'Automate everything with the dosya REST API and bearer tokens.',
    tag: 'HTTP API',
    icon: Code2,
  },
  {
    slug: 'google',
    title: 'Google Drive',
    description: 'Import files directly from your Google Drive into a workspace.',
    tag: 'Import',
    icon: HardDrive,
    iconSrc: '/google-color.svg',
  },
];

export function getIntegration(slug: string): IntegrationMeta | undefined {
  return INTEGRATIONS.find((i) => i.slug === slug);
}

// ---- rclone ----
export const rcloneInstall = 'go install github.com/dosya-dev/rclone@latest';

export function rcloneConfig(ctx: IntegrationCtx): string {
  return [
    '[dosya]',
    'type = dosya',
    'api_key = dos_your_api_key',
    `workspace_id = ${ctx.workspaceId}`,
    `api_url = ${API_HOST}`,
  ].join('\n');
}

export const rcloneExamples = [
  'rclone copy ./local dosya:/backups',
  'rclone sync dosya:/photos ./photos',
  'rclone mount dosya: /mnt/dosya',
  'rclone ls dosya:',
].join('\n');

// ---- WebDAV ----
export function webdavUrl(ctx: IntegrationCtx): string {
  return `${API_HOST}/webdav/${ctx.workspaceId}/`;
}

export function webdavLinuxMount(ctx: IntegrationCtx): string {
  return `sudo mount -t davfs ${webdavUrl(ctx)} /mnt/dosya`;
}

export function webdavWindowsMount(ctx: IntegrationCtx): string {
  return `net use Z: ${webdavUrl(ctx)} /user:${ctx.email} dos_your_api_key`;
}

// ---- SFTP ----
export const SFTP_HOST = 'sftp.dosya.dev';
export const SFTP_PORT = 2222;

export function sftpConnect(ctx: IntegrationCtx): string {
  // Username is your dosya.dev email; SFTP prompts for the password (your API key).
  return `sftp -P ${SFTP_PORT} ${ctx.email}@${SFTP_HOST}`;
}

export function sftpConfig(ctx: IntegrationCtx): string {
  return [
    'Host dosya',
    `    HostName ${SFTP_HOST}`,
    `    Port ${SFTP_PORT}`,
    `    User ${ctx.email}`,
  ].join('\n');
}

// ---- S3 ----
export function s3Endpoint(): string {
  return `${API_HOST}/s3`;
}

export function s3AwsConfig(): string {
  return [
    'aws configure set aws_access_key_id DOSYA_your_access_key',
    'aws configure set aws_secret_access_key your_secret_key',
  ].join('\n');
}

export function s3Examples(ctx: IntegrationCtx): string {
  return [
    `aws --endpoint-url ${s3Endpoint()} --region ${S3_REGION} \\`,
    `  s3 ls s3://${ctx.workspaceId}/`,
    `aws --endpoint-url ${s3Endpoint()} \\`,
    `  s3 cp ./file.txt s3://${ctx.workspaceId}/`,
  ].join('\n');
}

// ---- Desktop ----
export function desktopDownload(apiBase: string, platform: 'windows' | 'mac' | 'linux'): string {
  const base = apiBase || API_HOST;
  return `${base}/api/desktop/latest?platform=${platform}`;
}

// ---- CLI ----
export const cliInstall = `curl -fsSL ${API_HOST}/api/cli/install | sh`;
export const cliInstallWindows = `curl -fsSL -o dosya.exe ${API_HOST}/api/cli/latest?platform=windows`;

export const cliExamples = [
  'dosya auth login',
  'dosya upload ./report.pdf',
  'dosya ls',
  'dosya download report.pdf',
  'dosya share report.pdf',
  'dosya sync run',
].join('\n');

// ---- REST API ----
export function restExample(): string {
  return [
    `curl ${API_HOST}/api/me \\`,
    '  -H "Authorization: Bearer dos_your_api_key"', // gitleaks:allow (documentation placeholder, not a real token)
  ].join('\n');
}
