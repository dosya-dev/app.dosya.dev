import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, Upload, Share2, Users, Settings, User, Inbox,
  MessageSquare, Activity, Search, CreditCard, Shield, ShieldCheck, LogIn,
  Building2, Bell, MapPin, Plug, RefreshCw, HardDrive, Server, Cloud, Monitor,
  Terminal, Code2, FolderInput, Gift, LayoutGrid, BarChart3, CopyX, FileText, ScanFace, type LucideIcon,
} from 'lucide-react';
import { useUploads, uploadSummary, type UploadSummary } from '@/stores/uploads';
import { t, useLocale, useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';

// Single source of truth for each route's browser tab title AND in-app header icon.
// Browser title format: "<Page> · dosya.dev" (or just "dosya.dev" for unknown routes).

const SUFFIX = 'dosya.dev';

// Exact pathname → title (a catalog key, so the title follows the language)
const TITLE_KEYS: Record<string, MessageKey> = {
  '/': 'common.heading.dashboard',
  '/files': 'common.heading.files',
  '/file-requests': 'common.heading.fileRequests',
  '/map': 'common.heading.map',
  '/personas': 'common.label.personas',
  '/duplicates': 'common.heading.duplicates',
  '/uploads': 'common.heading.upload',
  '/settings': 'common.heading.settings',
  '/profile': 'common.heading.profile',
  '/api-analytics': 'common.heading.apiAnalytics',
  '/teams': 'common.heading.team',
  '/integrations': 'common.heading.integrations',
  '/integrations/desktop': 'common.heading.desktopApps',
  '/integrations/cli': 'common.heading.cli',
  '/integrations/rest-api': 'common.heading.restAPI',
  '/shared': 'common.heading.sharedLinks',
  '/comments': 'common.heading.comments',
  '/activity': 'common.heading.activity',
  '/notifications': 'common.heading.notifications',
  '/search': 'common.heading.search',
  '/billing': 'common.heading.billing',
  '/referrals': 'common.heading.referFriends',
  '/workspaces': 'common.heading.workspaceDashboard',
  '/role-create': 'common.heading.createRole',
  '/login': 'common.heading.signIn',
  '/login/2fa': 'common.heading.twoFactorAuthentication',
  '/sign-up': 'common.heading.signUp',
  '/verify': 'common.heading.verifyYourEmail',
  '/redeem': 'common.heading.redeemStoragePackage',
  '/forgot-password': 'common.heading.resetPassword',
  '/reset-password': 'common.heading.setANewPassword',
  '/create-workspace': 'common.heading.createWorkspace',
};

// Product names: the same in every language, so they have no catalog entry.
const NAME_TITLES: Record<string, string> = {
  '/integrations/rclone': 'rclone',
  '/integrations/webdav': 'WebDAV',
  '/integrations/sftp': 'SFTP',
  '/integrations/s3': 'S3',
  '/integrations/google': 'Google Drive',
  '/integrations/onedrive': 'OneDrive',
  '/integrations/dropbox': 'Dropbox',
};

// Exact pathname → header icon
const ICONS: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/files': FolderOpen,
  '/file-requests': Inbox,
  '/map': MapPin,
  '/personas': ScanFace,
  '/duplicates': CopyX,
  '/uploads': Upload,
  '/settings': Settings,
  '/profile': User,
  '/api-analytics': BarChart3,
  '/teams': Users,
  '/integrations': Plug,
  '/integrations/rclone': RefreshCw,
  '/integrations/webdav': HardDrive,
  '/integrations/sftp': Server,
  '/integrations/s3': Cloud,
  '/integrations/desktop': Monitor,
  '/integrations/cli': Terminal,
  '/integrations/rest-api': Code2,
  '/integrations/google': FolderInput,
  '/integrations/onedrive': FolderInput,
  '/integrations/dropbox': FolderInput,
  '/shared': Share2,
  '/comments': MessageSquare,
  '/activity': Activity,
  '/notifications': Bell,
  '/search': Search,
  '/billing': CreditCard,
  '/referrals': Gift,
  '/workspaces': LayoutGrid,
  '/role-create': Shield,
  '/login': LogIn,
  '/login/2fa': ShieldCheck,
  '/create-workspace': Building2,
};

/** The page's title in the current language ('' for an unknown route). */
export function titleForPath(pathname: string): string {
  if (pathname in TITLE_KEYS) return t(TITLE_KEYS[pathname]);
  if (pathname in NAME_TITLES) return NAME_TITLES[pathname];
  if (pathname.startsWith('/file-requests/')) return t('common.heading.fileRequest');
  if (pathname.startsWith('/personas/')) return t('common.label.personas');
  if (pathname.startsWith('/integrations')) return t('common.heading.integrations');
  if (pathname.startsWith('/editor/')) return t('common.heading.editor');
  if (pathname.startsWith('/family/join/')) return t('common.heading.familyInvitation');
  if (pathname.startsWith('/save/')) return t('common.action.saveToDosya');
  return '';
}

export function iconForPath(pathname: string): LucideIcon | null {
  if (pathname in ICONS) return ICONS[pathname];
  if (pathname.startsWith('/file-requests/')) return Inbox;
  if (pathname.startsWith('/personas/')) return ScanFace;
  if (pathname.startsWith('/integrations')) return Plug;
  if (pathname.startsWith('/editor/')) return FileText;
  return null;
}

// Routes whose pages set their own title from loaded data (folder name, request name).
// RouteTitle leaves these alone so it doesn't clobber the data-driven title.
function isSelfManaged(pathname: string): boolean {
  return pathname === '/files' || pathname.startsWith('/file-requests/') || pathname.startsWith('/editor/');
}

/** Tab title while a file/folder upload is active, e.g. "73% · Uploading 3 files · dosya.dev". */
export function formatUploadTitle(summary: UploadSummary): string | null {
  if (!summary.anyActive) return null;
  return t('common.description.summaryoverallpctUploadingSummaryactivePluralOneFileOtherFiles', {
    summaryOverallPct: summary.overallPct,
    summaryActive: summary.active,
    SUFFIX,
  });
}

// Reactive so RouteTitle/useDocumentTitle's effects re-run (and fall back to
// the normal title) the moment the last upload finishes, even with no route
// change to trigger them otherwise.
function useUploadTitleOverride(): string | null {
  useT(); // re-render (and re-translate the title) when the language changes
  const items = useUploads((s) => s.items);
  return formatUploadTitle(uploadSummary(items));
}

/** Renders nothing; keeps document.title in sync with the route. Mount once at the router root. */
export function RouteTitle() {
  const { pathname } = useLocation();
  const uploadTitle = useUploadTitleOverride();
  const { locale } = useLocale();
  useEffect(() => {
    if (uploadTitle) {
      document.title = uploadTitle;
      return;
    }
    if (isSelfManaged(pathname)) return;
    const title = titleForPath(pathname);
    document.title = title ? `${title} · ${SUFFIX}` : SUFFIX;
  }, [pathname, uploadTitle, locale]);
  return null;
}

/** For pages that derive their title from loaded data. Pass a falsy value to skip. */
export function useDocumentTitle(title: string | null | undefined) {
  const uploadTitle = useUploadTitleOverride();
  useEffect(() => {
    if (uploadTitle) {
      document.title = uploadTitle;
      return;
    }
    if (!title) return;
    document.title = `${title} · ${SUFFIX}`;
  }, [title, uploadTitle]);
}
