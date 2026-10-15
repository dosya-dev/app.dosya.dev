import {
  LayoutDashboard, FolderOpen, Upload, Share2, Lock, Users, Plug, Settings, Palette, CreditCard, Gift,
  Activity, Bell, Inbox, MessageSquare, Copy, Map as MapIcon, LifeBuoy, BarChart3, Trash2, EyeOff, Building2, Bot,
} from 'lucide-react';
import { NAV as PROFILE_NAV, sectionPath } from '@/pages/profile/shared';
import { SETTINGS_SECTIONS } from '@/lib/settings-sections';
import { INTEGRATIONS } from '@/lib/integrations';
import type { SearchItem } from './types';

/** Synonyms per profile section id. Keys must be profile NAV ids. */
const PROFILE_KEYWORDS: Record<string, string[]> = {
  identity: ['name', 'avatar', 'email', 'profile', 'photo'],
  appearance: ['theme', 'dark mode', 'light mode'],
  password: ['password', '2fa', 'two-factor', 'authenticator', 'otp', 'security'],
  api: ['api key', 'token', 'developer'],
  sessions: ['devices', 'sign out', 'logged in'],
  notifications: ['email', 'alerts'],
  integrations: ['google drive', 'onedrive', 'dropbox', 'connected accounts'],
  'ai-apps': ['claude', 'chatgpt', 'mcp', 'ai', 'connector'],
  workspaces: ['workspace', 'leave workspace'],
  privacy: ['export', 'gdpr', 'download my data', 'data'],
  delete: ['close account', 'remove account', 'delete account'],
};

const SETTINGS_KEYWORDS: Record<string, string[]> = {
  info: ['workspace name', 'region'],
  limits: ['quota', 'limit', 'storage', 'file size'],
  security: ['ip allowlist', '2fa policy', 'workspace security'],
  roles: ['roles', 'permissions', 'access'],
  danger: ['delete workspace', 'transfer ownership'],
};

const go = (id: string, title: string, href: string, extra: Partial<SearchItem> = {}): SearchItem =>
  ({ id: `goto:${id}`, kind: 'goto', title, href, ...extra });

export function goToItems(): SearchItem[] {
  return [
    go('dashboard', 'Dashboard', '/', { icon: LayoutDashboard, perm: 'access_dashboard', keywords: ['home', 'overview'] }),
    go('files', 'Files', '/files', { icon: FolderOpen, perm: 'access_files', keywords: ['documents', 'my files'] }),
    go('uploads', 'Uploads', '/uploads', { icon: Upload, perm: 'access_upload', keywords: ['upload'] }),
    go('shared', 'Shared links', '/shared', { icon: Share2, perm: 'access_shared', keywords: ['share', 'links', 'shared with me'] }),
    go('vault', 'Vault', '/vault', { icon: Lock, keywords: ['encrypted', 'e2ee', 'private'] }),
    go('team', 'Team', '/teams', { icon: Users, perm: 'access_team', keywords: ['members', 'invite', 'people'] }),
    go('integrations', 'Integrations', '/integrations', { icon: Plug, keywords: ['apps', 'connect'] }),
    go('settings', 'Workspace settings', '/settings', { icon: Settings, perm: 'access_settings', keywords: ['settings'] }),
    ...SETTINGS_SECTIONS.map((s) =>
      go(`settings/${s.id}`, s.label, `/settings#section-${s.id}`, {
        icon: s.icon, perm: 'access_settings', context: 'Workspace settings', keywords: SETTINGS_KEYWORDS[s.id] ?? [],
      })),
    go('branding', 'Branding', '/settings/branding', { icon: Palette, perm: 'manage_branding', context: 'Workspace settings', keywords: ['logo', 'white label', 'custom domain', 'colours', 'colors'] }),
    ...PROFILE_NAV.map((n) =>
      go(`profile/${n.id}`, n.label, sectionPath(n.id), { icon: n.icon, context: 'Profile', keywords: PROFILE_KEYWORDS[n.id] ?? [] })),
    go('billing', 'Billing', '/billing', { icon: CreditCard, keywords: ['plan', 'invoice', 'subscription', 'upgrade', 'payment', 'pricing'] }),
    go('referrals', 'Referrals', '/referrals', { icon: Gift, keywords: ['refer', 'invite friends', 'free storage'] }),
    go('activity', 'Activity', '/activity', { icon: Activity, perm: 'view_activity', keywords: ['log', 'audit', 'history'] }),
    go('notifications', 'Notifications', '/notifications', { icon: Bell, keywords: ['inbox', 'alerts'] }),
    go('file-requests', 'File requests', '/file-requests', { icon: Inbox, keywords: ['request files', 'collect', 'receive'] }),
    go('comments', 'Comments', '/comments', { icon: MessageSquare }),
    go('duplicates', 'Duplicates', '/duplicates', { icon: Copy, keywords: ['duplicate files', 'free space'] }),
    go('map', 'Map', '/map', { icon: MapIcon, keywords: ['photo map', 'location', 'places'] }),
    go('support', 'Support', '/support', { icon: LifeBuoy, keywords: ['ticket', 'contact', 'help'] }),
    go('api-analytics', 'API analytics', '/api-analytics', { icon: BarChart3, keywords: ['api usage', 'requests'] }),
    go('trash', 'Trash', '/files?filter=deleted', { icon: Trash2, perm: 'access_files', keywords: ['deleted', 'recycle bin', 'restore', 'bin'] }),
    go('hidden', 'Hidden files', '/files?filter=hidden', { icon: EyeOff, perm: 'access_files', keywords: ['hidden'] }),
    go('workspaces', 'Workspaces', '/workspaces', { icon: Building2, keywords: ['switch workspace', 'new workspace'] }),
    go('ai', 'Connect an AI app', '/connect/ai', { icon: Bot, keywords: ['claude', 'chatgpt', 'mcp', 'ai'] }),
  ];
}

/** Extra words people type for an integration. Keys are integration slugs. */
const INTEGRATION_KEYWORDS: Record<string, string[]> = {
  sftp: ['ftp', 'filezilla', 'winscp', 'cyberduck'],
  s3: ['aws', 'bucket', 's3 compatible'],
  wordpress: ['wp', 'website backup'],
  google: ['google drive', 'gdrive', 'import'],
  onedrive: ['microsoft', 'import'],
  dropbox: ['import'],
  webdav: ['network drive', 'mount'],
  rclone: ['sync', 'mount'],
  desktop: ['mac', 'windows', 'linux', 'app'],
  cli: ['terminal', 'command line'],
  'rest-api': ['api', 'developer'],
  extension: ['chrome', 'firefox', 'edge', 'safari', 'browser'],
  zapier: ['automation', 'zap'],
  webhooks: ['webhook', 'events'],
  'remote-download': ['url', 'download from link'],
};

export function integrationItems(): SearchItem[] {
  return INTEGRATIONS.map((i) => ({
    id: `integration:${i.slug}`,
    kind: 'integration' as const,
    title: i.title,
    context: i.description,
    href: `/integrations/${i.slug}`,
    icon: i.icon,
    iconSrc: i.iconSrc,
    keywords: INTEGRATION_KEYWORDS[i.slug] ?? [],
  }));
}

/** Drop items whose permission the role is known to lack. `can` fails open while loading, like everywhere else. */
export function visibleItems(items: SearchItem[], can: (perm: string) => boolean): SearchItem[] {
  return items.filter((i) => !i.perm || can(i.perm));
}
