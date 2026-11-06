import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { t, useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';
import {
  User, Lock, Key, Monitor, Bell, Plug, Building2, Trash2, Check, Loader2, ShieldCheck, Palette, Bot,
  type LucideIcon,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────

export interface UserProfile {
  id: string; name: string; email: string; initials: string;
  avatar_url: string | null; preferred_language: string;
  created_at: number; email_verified_at: number | null; workspace_count: number;
  // False for OAuth-created accounts: their stored password is a random value they were
  // never told, so every password-gated action fails permanently.
  has_password: boolean;
}
export interface TfaStatus {
  method: string | null; totp_enabled: boolean; recovery_codes_remaining: number;
}
// Mirrors what GET /api/me/sessions actually returns. It previously declared
// ip/user_agent/login_method/last_active_at - none of which the API sends - so every
// row rendered "undefined · undefined · undefined NaN". `device`/`browser`/`meta` come
// pre-formatted from the server, which also classifies mobile app devices.
export interface Session {
  id: string;
  device: string;
  kind: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  browser: string;
  meta: string;
  is_current: boolean;
  created_at: number;
}
export interface Workspace {
  id: string; name: string; icon_initials: string; icon_color: string;
  role_id: string; joined_at: number;
}
// Shape of GET /api/cloud/accounts rows (see apps/api/src/pages/api/cloud/accounts/index.ts):
// id/provider/account_email/account_name/created_at only - tokens never leave that route.
export interface DriveAccount {
  id: string; provider: string; account_email: string; account_name: string; created_at: number;
}

/** What the profile layout hands every section page. */
export interface ProfileContext {
  user: UserProfile | null;
  reloadUser: () => Promise<void>;
}

// ── Sections ───────────────────────────────────────────────

// One entry per page under /profile/<id>. The ids are the same strings the
// single-page profile used for its ?section= deep links and its DOM anchors,
// so every old link, bookmark and recorded tutorial still lands on the right
// page without a mapping table.
export type SectionId =
  | 'identity' | 'appearance' | 'password' | 'api' | 'sessions'
  | 'notifications' | 'integrations' | 'ai-apps' | 'workspaces' | 'privacy' | 'delete';

/** Group ids stay English (they are identifiers); GROUP_LABEL_KEYS holds the words. */
export const NAV_GROUPS = ['Profile', 'Workspaces', 'Your data'] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export const GROUP_LABEL_KEYS: Record<NavGroup, MessageKey> = {
  Profile: 'common.label.profile',
  Workspaces: 'common.label.workspaces',
  'Your data': 'profile.label.yourData',
};

export interface NavEntry {
  id: SectionId;
  /** Catalog key of the section label; translate at render. */
  labelKey: MessageKey;
  /** The label in the current language, read when accessed (the command palette uses it). */
  readonly label: string;
  icon: LucideIcon;
  group: NavGroup;
  danger?: boolean;
}

function entry(id: SectionId, labelKey: MessageKey, icon: LucideIcon, group: NavGroup, danger?: boolean): NavEntry {
  return { id, labelKey, get label() { return t(labelKey); }, icon, group, ...(danger ? { danger } : {}) };
}

export const NAV: readonly NavEntry[] = [
  entry('identity', 'profile.label.identity', User, 'Profile'),
  entry('appearance', 'common.label.appearance', Palette, 'Profile'),
  entry('password', 'profile.label.password2fa', Lock, 'Profile'),
  entry('api', 'profile.label.apiKeys', Key, 'Profile'),
  entry('sessions', 'profile.label.sessions', Monitor, 'Profile'),
  entry('notifications', 'profile.label.notifications', Bell, 'Profile'),
  entry('integrations', 'common.label.integrations', Plug, 'Profile'),
  entry('ai-apps', 'profile.label.connectedAiApps', Bot, 'Profile'),
  entry('workspaces', 'common.label.myWorkspaces', Building2, 'Workspaces'),
  entry('privacy', 'profile.label.privacyAndYourData', ShieldCheck, 'Your data'),
  entry('delete', 'profile.label.deleteAccount', Trash2, 'Your data', true),
];

export const DEFAULT_SECTION: SectionId = 'identity';

export function isSectionId(value: string | null | undefined): value is SectionId {
  return NAV.some((n) => n.id === value);
}

export function sectionPath(id: SectionId): string {
  return `/profile/${id}`;
}

// ── Shared ─────────────────────────────────────────────────

export function SettingRow({ label, desc, badge, children }: { label: string; desc: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          {badge}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SaveBtn({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <Button size="sm" className="h-7 text-xs gap-1" onClick={onClick} disabled={loading}>
      {loading ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} {t('common.save')}
    </Button>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <div className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-56" /></div>
      </div>
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}><CardContent className="pt-6 space-y-4">
          <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
        </CardContent></Card>
      ))}
    </div>
  );
}

/** One card's worth of placeholder while a section page fetches its own data. */
export function SectionSkeleton() {
  return (
    <Card><CardContent className="pt-6 space-y-4">
      <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
    </CardContent></Card>
  );
}
