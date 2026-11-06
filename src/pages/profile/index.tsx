import { useState, useEffect, useCallback } from 'react';
import { Link, NavLink, Navigate, useLocation, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { req } from '@/api/req';
import { PrivacySection } from '@/components/account/privacy-section';
import { useT } from '@/lib/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  NAV, NAV_GROUPS, GROUP_LABEL_KEYS, DEFAULT_SECTION, isSectionId, sectionPath, ProfileSkeleton,
  type ProfileContext, type SectionId, type UserProfile,
} from './shared';
import IdentityPage from './identity';
import AppearancePage from './appearance';
import PasswordPage from './password';
import ApiKeysPage from './api';
import SessionsPage from './sessions';
import NotificationsPage from './notifications';
import IntegrationsPage from './integrations';
import AiAppsPage from './ai-apps';
import WorkspacesPage from './workspaces';
import DeletePage from './delete';

// Section components are re-exported for their tests, which import them
// from '@/pages/profile' exactly as they did when this was one file.
export { IdentitySection } from './identity';
export { PasswordSection } from './password';
export { NotificationsSection } from './notifications';
export { IntegrationsSection } from './integrations';
export { DeleteAccountSection } from './delete';

/**
 * The profile is one page per section, at /profile/<section>.
 *
 * It used to be a single route that stacked all ten sections down one scroll,
 * with a side nav that only scrolled you and was hidden on phones entirely.
 * The split keeps that nav exactly where it was (same groups, same labels,
 * same order, so the recorded tutorials still match) but makes it real
 * navigation: the content column shows one section, and each page fetches
 * only what it needs. On a phone, /profile is the nav itself as a list.
 */
const NOTIFICATION_HASHES: Record<string, SectionId> = { security: 'password', danger: 'delete' };

export default function ProfilePage() {
  const t = useT();
  const { section } = useParams<{ section?: string }>();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadUser = useCallback(async () => {
    const res = await req<{ ok: boolean; user: UserProfile }>('/api/me');
    if (res.ok) setUser(res.user);
  }, []);

  useEffect(() => { void reloadUser().finally(() => setLoading(false)); }, [reloadUser]);

  // The single-page profile deep-linked as /profile?section=<id> and, from the
  // integration pages, as /profile#section-<id>. The docs, the tutorial videos
  // and anyone's bookmarks still use those forms, so both land on the page.
  // Notification emails and in-app actions sent before the split linked
  // /profile#sessions, #security and #danger; those names map onto the
  // sections that took over, so an old inbox still lands on the right page.
  const legacy = new URLSearchParams(location.search).get('section')
    ?? (location.hash.startsWith('#section-') ? location.hash.slice('#section-'.length)
      : location.hash.length > 1 ? (NOTIFICATION_HASHES[location.hash.slice(1)] ?? location.hash.slice(1)) : null);
  if (legacy !== null) return <Navigate to={isSectionId(legacy) ? sectionPath(legacy) : '/profile'} replace />;
  if (section !== undefined && !isSectionId(section)) return <Navigate to="/profile" replace />;
  if (section === undefined && !isMobile) return <Navigate to={sectionPath(DEFAULT_SECTION)} replace />;

  if (loading) return <ProfileSkeleton />;

  const ctx: ProfileContext = { user, reloadUser };

  if (isMobile) {
    if (section === undefined) return <MobileIndex user={user} />;
    return (
      <div className="p-4 space-y-4">
        <Link to="/profile" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3.5 rtl:-scale-x-100" /> {t('common.action.profile')}
        </Link>
        <SectionBody id={section} ctx={ctx} />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <nav className="w-48 shrink-0 border-e p-4 overflow-y-auto" aria-label={t('profile.accessibility.profileSections')}>
        <RailWho user={user} />
        {NAV_GROUPS.map((group) => (
          <div key={group} className="mb-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t(GROUP_LABEL_KEYS[group])}</p>
            {NAV.filter((n) => n.group === group).map((n) => (
              <NavLink
                key={n.id}
                to={sectionPath(n.id)}
                className={({ isActive }) => `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-start transition-colors mb-0.5 ${
                  isActive
                    ? n.danger ? 'bg-destructive text-destructive-foreground' : 'bg-accent text-accent-foreground'
                    : n.danger ? 'text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <n.icon className="size-3.5" />
                {t(n.labelKey)}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-6">
        {section !== undefined && <SectionBody id={section} ctx={ctx} />}
      </div>
    </div>
  );
}

function SectionBody({ id, ctx }: { id: SectionId; ctx: ProfileContext }) {
  switch (id) {
    case 'identity': return <IdentityPage {...ctx} />;
    case 'appearance': return <AppearancePage />;
    case 'password': return <PasswordPage {...ctx} />;
    case 'api': return <ApiKeysPage />;
    case 'sessions': return <SessionsPage />;
    case 'notifications': return <NotificationsPage />;
    case 'integrations': return <IntegrationsPage />;
    case 'ai-apps': return <AiAppsPage />;
    case 'workspaces': return <WorkspacesPage />;
    case 'privacy': return <PrivacySection />;
    case 'delete': return <DeletePage {...ctx} />;
  }
}

// ── Rail header ────────────────────────────────────────────

function RailWho({ user }: { user: UserProfile | null }) {
  if (!user) return null;
  return (
    <div className="flex items-center gap-2.5 px-1 pb-4 mb-2 border-b">
      <span className="size-7 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold flex items-center justify-center shrink-0">
        {user.initials}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold truncate">{user.name}</p>
        <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
      </div>
    </div>
  );
}

// ── Phone index ────────────────────────────────────────────

// Below the md breakpoint the rail used to be hidden, which left a phone with
// a ten-section scroll and no way to jump. This is the rail as a page.
function MobileIndex({ user }: { user: UserProfile | null }) {
  const t = useT();
  return (
    <div className="p-4 space-y-5">
      {user && (
        <div className="flex items-center gap-3">
          <span className="size-12 rounded-full bg-muted text-muted-foreground text-base font-semibold flex items-center justify-center shrink-0">
            {user.initials}
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        </div>
      )}
      {NAV_GROUPS.map((group) => (
        <div key={group}>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t(GROUP_LABEL_KEYS[group])}</p>
          <div className="rounded-lg border bg-card divide-y">
            {NAV.filter((n) => n.group === group).map((n) => (
              <Link
                key={n.id}
                to={sectionPath(n.id)}
                className={`flex items-center gap-3 px-3 py-3 text-sm font-medium ${n.danger ? 'text-destructive' : ''}`}
              >
                <n.icon className="size-4 shrink-0" />
                <span className="flex-1 min-w-0 truncate">{t(n.labelKey)}</span>
                <ChevronRight className="size-4 text-muted-foreground shrink-0 rtl:-scale-x-100" />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
