import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, Upload, Share2, Users, Settings, User, Inbox,
  MessageSquare, Activity, Search, CreditCard, Shield, ShieldCheck, LogIn,
  Building2, Bell, MapPin, Plug, RefreshCw, HardDrive, Cloud, Monitor, Code2,
  type LucideIcon,
} from 'lucide-react';

// Single source of truth for each route's browser tab title AND in-app header icon.
// Browser title format: "<Page> · dosya.dev" (or just "dosya.dev" for unknown routes).

const SUFFIX = 'dosya.dev';

// Exact pathname → title
const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/files': 'Files',
  '/file-requests': 'File requests',
  '/map': 'Map',
  '/uploads': 'Upload',
  '/settings': 'Settings',
  '/profile': 'Profile',
  '/teams': 'Team',
  '/integrations': 'Integrations',
  '/integrations/rclone': 'rclone',
  '/integrations/webdav': 'WebDAV',
  '/integrations/s3': 'S3',
  '/integrations/desktop': 'Desktop apps',
  '/integrations/rest-api': 'REST API',
  '/shared': 'Shared links',
  '/comments': 'Comments',
  '/activity': 'Activity',
  '/notifications': 'Notifications',
  '/search': 'Search',
  '/billing': 'Billing',
  '/role-create': 'Create role',
  '/login': 'Sign in',
  '/login/2fa': 'Two-factor authentication',
  '/sign-up': 'Sign up',
  '/verify': 'Verify your email',
  '/forgot-password': 'Reset password',
  '/reset-password': 'Set a new password',
  '/create-workspace': 'Create workspace',
};

// Exact pathname → header icon
const ICONS: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/files': FolderOpen,
  '/file-requests': Inbox,
  '/map': MapPin,
  '/uploads': Upload,
  '/settings': Settings,
  '/profile': User,
  '/teams': Users,
  '/integrations': Plug,
  '/integrations/rclone': RefreshCw,
  '/integrations/webdav': HardDrive,
  '/integrations/s3': Cloud,
  '/integrations/desktop': Monitor,
  '/integrations/rest-api': Code2,
  '/shared': Share2,
  '/comments': MessageSquare,
  '/activity': Activity,
  '/notifications': Bell,
  '/search': Search,
  '/billing': CreditCard,
  '/role-create': Shield,
  '/login': LogIn,
  '/login/2fa': ShieldCheck,
  '/create-workspace': Building2,
};

export function titleForPath(pathname: string): string {
  if (pathname in TITLES) return TITLES[pathname];
  if (pathname.startsWith('/file-requests/')) return 'File request';
  if (pathname.startsWith('/integrations')) return 'Integrations';
  return '';
}

export function iconForPath(pathname: string): LucideIcon | null {
  if (pathname in ICONS) return ICONS[pathname];
  if (pathname.startsWith('/file-requests/')) return Inbox;
  if (pathname.startsWith('/integrations')) return Plug;
  return null;
}

// Routes whose pages set their own title from loaded data (folder name, request name).
// RouteTitle leaves these alone so it doesn't clobber the data-driven title.
function isSelfManaged(pathname: string): boolean {
  return pathname === '/files' || pathname.startsWith('/file-requests/');
}

/** Renders nothing; keeps document.title in sync with the route. Mount once at the router root. */
export function RouteTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (isSelfManaged(pathname)) return;
    const t = titleForPath(pathname);
    document.title = t ? `${t} · ${SUFFIX}` : SUFFIX;
  }, [pathname]);
  return null;
}

/** For pages that derive their title from loaded data. Pass a falsy value to skip. */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · ${SUFFIX}`;
  }, [title]);
}
