import {
  RefreshCw, HardDrive, Server, Cloud, Monitor, Terminal, Code2, Webhook, CloudDownload, Zap, Puzzle, DatabaseBackup, Workflow, Aperture, type LucideIcon,
} from 'lucide-react';

export interface IntegrationCtx {
  workspaceId: string;
  /** Display name of the active workspace; '' until loaded. */
  workspaceName: string;
  email: string;
}

export type IntegrationSlug =
  | 'rclone' | 'webdav' | 'sftp' | 's3' | 'desktop' | 'cli' | 'rest-api' | 'extension' | 'zapier' | 'n8n' | 'lightroom' | 'wordpress' | 'google'
  | 'onedrive' | 'dropbox' | 'webhooks' | 'remote-download';

export interface IntegrationMeta {
  slug: IntegrationSlug;
  title: string;
  description: string;
  tag: string;
  icon: LucideIcon;
  /** Optional brand-logo image (public path). When set, cards/headers render it instead of `icon`. */
  iconSrc?: string;
  /** External marketing docs page for this integration (omitted when none exists, e.g. Google Drive). */
  docsUrl?: string;
}

export const API_HOST = 'https://api.dosya.dev';

/**
 * Zapier invite link, from `zapier-platform users:links`.
 *
 * The integration is private while it waits for Zapier's directory review, so
 * searching for dosya inside Zapier finds nothing and this link is the only
 * way in. It covers every pushed version and works on any Zapier plan.
 *
 * It is duplicated from src/lib/zapier-integration.ts on the marketing site,
 * which cannot be imported across the app seam. integrations.test.ts reads
 * that file and fails if the two ever disagree, because a stale invite link
 * is a dead end for anyone who follows it from here.
 */
export const ZAPIER_INVITE_URL =
  'https://zapier.com/developer/public-invite/247442/f692cdfd82a0f6db941dab2e3aa8f952/';

/**
 * The WordPress plugin zip, served by the marketing site while the plugin
 * waits for WordPress.org review. Duplicated from WORDPRESS_ZIP_PATH in
 * src/lib/wordpress-integration.ts, which integrations.test.ts compares,
 * because a download link that drifts is a 404 in the middle of a setup.
 */
export const WORDPRESS_ZIP_URL = 'https://dosya.dev/downloads/wordpress/dosya-backup.zip';

/**
 * Store listings for the desktop app.
 *
 * Two details in the Mac App Store URL are load-bearing and are copied, with
 * the reasoning, from the marketing site's src/lib/store-links.ts: no locale
 * segment, so each visitor lands on their own storefront rather than the US
 * one, and mt=12, without which the same id resolves through the iOS
 * storefront where a Mac-only app reads as unavailable.
 *
 * integrations.test.ts compares these against that file, because this app
 * cannot import across the seam and a store link that drifts is a link into
 * someone else's error page.
 */
/**
 * The n8n community node (apps/n8n). Copied from the marketing site's
 * src/lib/n8n-integration.ts, which integrations.test.ts compares, because
 * the app cannot import across that seam. Flip N8N_NODE_PUBLISHED in both
 * once n8n-nodes-dosya is on npm: until then the page never tells anyone to
 * install a package that does not exist yet.
 */
export const N8N_NODE_PUBLISHED = true;
export const N8N_PACKAGE_NAME = 'n8n-nodes-dosya';
export const N8N_EXAMPLES_URL = 'https://github.com/dosya-dev/n8n-nodes-dosya/tree/main/examples';
/** The name the page gives the keys it creates, and how it finds them again. */
export const N8N_KEY_NAME = 'n8n';

/**
 * The Lightroom Classic plug-in (apps/lightroom). The marketing site hosts the
 * zip at this address; until it is uploaded the link 404s. The key prefix is
 * how the page finds the keys the plug-in's connect flow created.
 */
export const LIGHTROOM_PLUGIN_URL = 'https://dosya.dev/downloads/lightroom/dosya-lightroom.zip';
export const LIGHTROOM_KEY_PREFIX = 'Lightroom Classic:';

export const MAC_APP_STORE_URL = 'https://apps.apple.com/app/id6818700723?mt=12';
export const MS_STORE_URL = 'https://apps.microsoft.com/store/detail/9p1q4pm856st';
export const SNAP_STORE_URL = 'https://snapcraft.io/dosya';
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
    iconSrc: '/rclone-color.svg',
    docsUrl: 'https://dosya.dev/developer/rclone',
  },
  {
    slug: 'webdav',
    title: 'WebDAV',
    description: 'Mount your workspace as a network drive on macOS, Windows or Linux.',
    tag: 'Mount as drive',
    icon: HardDrive,
    docsUrl: 'https://dosya.dev/developer/webdav',
  },
  {
    slug: 'sftp',
    title: 'SFTP',
    description: 'Upload and manage files with any SFTP client - FileZilla, WinSCP, Cyberduck or the terminal.',
    tag: 'Secure transfer',
    icon: Server,
    docsUrl: 'https://dosya.dev/developer/sftp',
  },
  {
    slug: 's3',
    title: 'S3',
    description: 'Point any S3-compatible tool or SDK at your workspace.',
    tag: 'S3 API',
    icon: Cloud,
    docsUrl: 'https://dosya.dev/developer/s3',
  },
  {
    slug: 'desktop',
    title: 'Desktop apps',
    description: 'Download the desktop app for macOS, Windows and Linux.',
    tag: 'Apps',
    icon: Monitor,
    docsUrl: 'https://dosya.dev/desktop',
  },
  {
    slug: 'cli',
    title: 'CLI',
    description: 'Script uploads, downloads and folder sync from your terminal with the dosya CLI.',
    tag: 'Terminal',
    icon: Terminal,
    docsUrl: 'https://dosya.dev/developer/cli',
  },
  {
    slug: 'rest-api',
    title: 'REST API',
    description: 'Automate everything with the dosya REST API and bearer tokens.',
    tag: 'HTTP API',
    icon: Code2,
    docsUrl: 'https://dosya.dev/developer/api',
  },
  {
    slug: 'extension',
    title: 'Browser extension',
    description: 'Right-click any image, selection or page and save it straight into dosya, with no download and re-upload.',
    tag: 'Browser',
    icon: Puzzle,
    docsUrl: 'https://dosya.dev/browser-extension',
  },
  {
    slug: 'zapier',
    title: 'Zapier',
    description: 'Connect dosya to thousands of other apps without writing code. A new file can start a Zap, and other apps can upload, share and request files.',
    tag: 'No-code',
    icon: Zap,
    iconSrc: '/zapier-color.svg',
    docsUrl: 'https://dosya.dev/integration/zapier',
  },
  {
    slug: 'n8n',
    title: 'n8n',
    description: 'Save files from your n8n workflows into dosya, and create folders and share links, with ready-made workflows to import.',
    tag: 'Automation',
    icon: Workflow,
    iconSrc: '/n8n-color.svg',
    docsUrl: 'https://dosya.dev/integration/n8n',
  },
  {
    slug: 'lightroom',
    title: 'Lightroom Classic',
    description: 'Publish albums from Lightroom Classic as client galleries on dosya, with selections coming back to your catalog.',
    tag: 'Photography',
    icon: Aperture,
    iconSrc: '/lightroom-color.svg',
    docsUrl: 'https://dosya.dev/integration/lightroom/',
  },
  {
    slug: 'wordpress',
    title: 'WordPress',
    description: 'Back up your WordPress site into dosya with the free plugin, and restore or move it at any size.',
    tag: 'Backups',
    icon: DatabaseBackup,
    // Not /wordpress-color.svg: the edge firewall blocks every root path
    // starting with /wordpress or /wp- (scanner traffic), and served our
    // 403 page in place of the icon.
    iconSrc: '/logo-wordpress.svg',
    docsUrl: 'https://dosya.dev/integration/wordpress',
  },
  {
    slug: 'google',
    title: 'Google Drive',
    description: 'Import folders and files from Google Drive, with your folder structure preserved.',
    tag: 'Import',
    icon: HardDrive,
    iconSrc: '/google-color.svg',
  },
  {
    slug: 'onedrive',
    title: 'OneDrive',
    description: 'Import folders and files from OneDrive, with your folder structure preserved.',
    tag: 'Import',
    icon: HardDrive,
    iconSrc: '/onedrive-color.svg',
  },
  {
    slug: 'dropbox',
    title: 'Dropbox',
    description: 'Import folders and files from Dropbox, with your folder structure preserved.',
    tag: 'Import',
    icon: HardDrive,
    iconSrc: '/dropbox-color.svg',
  },
  {
    slug: 'webhooks',
    title: 'Webhooks',
    description: 'Get realtime HTTP notifications when files are uploaded, deleted, or shares are accessed.',
    tag: 'Events',
    icon: Webhook,
    docsUrl: 'https://dosya.dev/developer/api#webhooks',
  },
  {
    slug: 'remote-download',
    title: 'Remote download',
    description: 'Paste a direct file link and dosya downloads it into your workspace server-side - ideal on slow connections.',
    tag: 'Import',
    icon: CloudDownload,
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
// Finder names the volume after the LAST path segment and ignores DAV
// displayname, so the workspace id identifies the mount and a trailing copy
// of the name supplies the caption. Emitted for everyone, not only when a
// name collides: a collision-conditional URL would break a mount that
// already worked the moment someone is added to a second workspace of the
// same name. The trailing segment is display-only, so renaming a workspace
// no longer breaks the mount either.
export function webdavUrl(ctx: IntegrationCtx): string {
  const label = ctx.workspaceName || ctx.workspaceId;
  return `${API_HOST}/webdav/mount/${ctx.workspaceId}/${encodeURIComponent(label)}/`;
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
