import {
  RefreshCw, HardDrive, Cloud, Monitor, Code2, type LucideIcon,
} from 'lucide-react';

export interface IntegrationCtx {
  workspaceId: string;
  email: string;
}

export type IntegrationSlug = 'rclone' | 'webdav' | 's3' | 'desktop' | 'rest-api';

export interface IntegrationMeta {
  slug: IntegrationSlug;
  title: string;
  description: string;
  tag: string;
  icon: LucideIcon;
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
    slug: 's3',
    title: 'S3',
    description: 'Point any S3-compatible tool or SDK at your workspace.',
    tag: 'S3 API',
    icon: Cloud,
  },
  {
    slug: 'desktop',
    title: 'Desktop apps',
    description: 'Download the desktop app and CLI for your platform.',
    tag: 'Apps & CLI',
    icon: Monitor,
  },
  {
    slug: 'rest-api',
    title: 'REST API',
    description: 'Automate everything with the dosya REST API and bearer tokens.',
    tag: 'HTTP API',
    icon: Code2,
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

// ---- Desktop / CLI ----
export const cliInstall = `curl -fsSL ${API_HOST}/api/cli/install | sh`;

export function desktopDownload(apiBase: string, platform: 'windows' | 'mac' | 'linux'): string {
  const base = apiBase || API_HOST;
  return `${base}/api/desktop/latest?platform=${platform}`;
}

// ---- REST API ----
export function restExample(): string {
  return [
    `curl ${API_HOST}/api/me \\`,
    '  -H "Authorization: Bearer dos_your_api_key"', // gitleaks:allow (documentation placeholder, not a real token)
  ].join('\n');
}
