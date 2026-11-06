import {
  LayoutDashboard, FolderOpen, Upload, Share2, Lock, Users, Plug, Settings, Palette, CreditCard, Gift,
  Activity, Bell, Inbox, MessageSquare, Copy, Map as MapIcon, LifeBuoy, BarChart3, Trash2, EyeOff, Building2, Bot, ScanFace,
} from 'lucide-react';
import { NAV as PROFILE_NAV, sectionPath } from '@/pages/profile/shared';
import { SETTINGS_SECTIONS } from '@/lib/settings-sections';
import { INTEGRATIONS } from '@/lib/integrations';
import { t } from '@/lib/i18n';
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
  ai: ['ai search', 'content search', 'search inside files', 'ocr', 'semantic search', 'index'],
  roles: ['roles', 'permissions', 'access'],
  danger: ['delete workspace', 'transfer ownership'],
};

// Titles and contexts are translated here, in the language current when the list is built.
// Keywords below stay English on purpose: they are match terms, not labels.
const go = (id: string, title: string, href: string, extra: Partial<SearchItem> = {}): SearchItem =>
  ({ id: `goto:${id}`, kind: 'goto', title, href, ...extra });

/** Builds the list in the language that is current NOW. Call it per render/locale, never once at module load. */
export function goToItems(): SearchItem[] {
  return [
    go('dashboard', t('common.label.dashboard'), '/', { icon: LayoutDashboard, perm: 'access_dashboard', keywords: ['home', 'overview'] }),
    go('files', t('common.label.files'), '/files', { icon: FolderOpen, perm: 'access_files', keywords: ['documents', 'my files'] }),
    go('uploads', t('common.label.uploads'), '/uploads', { icon: Upload, perm: 'access_upload', keywords: ['upload'] }),
    go('shared', t('common.label.sharedLinks'), '/shared', { icon: Share2, perm: 'access_shared', keywords: ['share', 'links', 'shared with me'] }),
    go('vault', 'Vault', '/vault', { icon: Lock, keywords: ['encrypted', 'e2ee', 'private'] }),
    go('team', t('common.label.team'), '/teams', { icon: Users, perm: 'access_team', keywords: ['members', 'invite', 'people'] }),
    go('integrations', t('common.heading.integrations'), '/integrations', { icon: Plug, keywords: ['apps', 'connect'] }),
    go('settings', t('common.label.workspaceSettings'), '/settings', { icon: Settings, perm: 'access_settings', keywords: ['settings'] }),
    ...SETTINGS_SECTIONS.map((s) =>
      go(`settings/${s.id}`, s.label, `/settings#section-${s.id}`, {
        icon: s.icon, perm: 'access_settings', context: t('common.label.workspaceSettings'), keywords: SETTINGS_KEYWORDS[s.id] ?? [],
      })),
    go('personas-settings', t('personas.action.personasSettings'), '/personas/settings', { icon: ScanFace, perm: 'access_files', context: t('common.label.personas'), keywords: ['faces', 'people', 'face grouping', 'face recognition', 'biometric', 'personas'] }),
    go('branding', t('common.label.branding'), '/settings/branding', { icon: Palette, perm: 'manage_branding', context: t('common.label.workspaceSettings'), keywords: ['logo', 'white label', 'custom domain', 'colours', 'colors'] }),
    ...PROFILE_NAV.map((n) =>
      go(`profile/${n.id}`, n.label, sectionPath(n.id), { icon: n.icon, context: t('common.label.profile'), keywords: PROFILE_KEYWORDS[n.id] ?? [] })),
    go('billing', t('common.heading.billing'), '/billing', { icon: CreditCard, keywords: ['plan', 'invoice', 'subscription', 'upgrade', 'payment', 'pricing'] }),
    go('referrals', t('common.label.referrals'), '/referrals', { icon: Gift, keywords: ['refer', 'invite friends', 'free storage'] }),
    go('activity', t('common.label.activity'), '/activity', { icon: Activity, perm: 'view_activity', keywords: ['log', 'audit', 'history'] }),
    go('notifications', t('common.heading.notifications'), '/notifications', { icon: Bell, keywords: ['inbox', 'alerts'] }),
    go('file-requests', t('common.label.fileRequests'), '/file-requests', { icon: Inbox, keywords: ['request files', 'collect', 'receive'] }),
    go('comments', t('common.label.comments'), '/comments', { icon: MessageSquare }),
    go('duplicates', t('common.heading.duplicates'), '/duplicates', { icon: Copy, keywords: ['duplicate files', 'free space'] }),
    go('map', t('common.label.map'), '/map', { icon: MapIcon, keywords: ['photo map', 'location', 'places'] }),
    go('support', t('common.label.support'), '/support', { icon: LifeBuoy, keywords: ['ticket', 'contact', 'help'] }),
    go('api-analytics', t('common.label.apiAnalytics'), '/api-analytics', { icon: BarChart3, keywords: ['api usage', 'requests'] }),
    go('trash', t('common.label.trash'), '/files?filter=deleted', { icon: Trash2, perm: 'access_files', keywords: ['deleted', 'recycle bin', 'restore', 'bin'] }),
    go('hidden', t('common.label.hiddenFiles'), '/files?filter=hidden', { icon: EyeOff, perm: 'access_files', keywords: ['hidden'] }),
    go('workspaces', t('common.label.workspaces'), '/workspaces', { icon: Building2, keywords: ['switch workspace', 'new workspace'] }),
    go('ai', t('common.label.connectAnAiApp'), '/connect/ai', { icon: Bot, keywords: ['claude', 'chatgpt', 'mcp', 'ai'] }),
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
  // Rollout-gated pages stay out of search until GA; the directory shows them
  // to the users the API has enabled.
  return INTEGRATIONS.filter((i) => !i.rollout).map((i) => ({
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
