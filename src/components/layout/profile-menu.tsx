import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { User, LogOut, LifeBuoy, Sun, Moon, Palette, Gift, Bug, CreditCard, MessageCircle } from 'lucide-react';
import { api, API_BASE } from '@/api/client';
import { readCache, writeCache, applyThemeAnimated, subscribeThemeChange } from '@/lib/theme';
import { useSession } from '@/stores/session';
import { useWorkspace } from '@/stores/workspace';
import { logoutAndRedirect } from '@/lib/logout';
import { initials } from '@/lib/helpers';
import { formatBytes } from '@/lib/billing/cart-math';
import { openReport } from '@/stores/report-problem';
import { useSupportChat } from '@/stores/support-chat';
import { PresenceDot } from '@/components/support-chat/panel';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/**
 * The menu under the avatar in the dashboard top bar.
 *
 * A card at the top says who you are, what you pay for and how much room you
 * have, with Manage as a shortcut into billing. Below it the account pages
 * (Profile, then Billing as its own row, since the storage card's Manage link
 * only shows once the storage total is known), the
 * help actions and Log out. Workspace settings is not here on purpose: it is a
 * workspace page and the sidebar already shows it.
 *
 * The light/dark switch lives on the Appearance row (it used to be its own
 * top-bar button). The two states are menu radio items, so arrow keys reach
 * them and choosing one keeps the menu open.
 */
export function ProfileMenu() {
  const t = useT();
  // Fetched once by the boot gate (dashboard-layout.tsx).
  const user = useSession((s) => s.user);
  const activeId = useWorkspace((s) => s.activeId);
  const workspace = useSession((s) => s.workspaces?.find((w) => w.id === activeId) ?? null);

  const chatEnabled = !!user?.features?.support_chat;
  const unread = useSupportChat((s) => s.unread);
  const staffOnline = useSupportChat((s) => s.staffOnline);
  const openPanel = useSupportChat((s) => s.openPanel);
  const refreshSummary = useSupportChat((s) => s.refreshSummary);

  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  // Keep the switch in sync when the theme is applied elsewhere (account
  // reconcile on load, the Appearance picker).
  useEffect(() => subscribeThemeChange(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }), []);

  const setMode = (mode: 'light' | 'dark') => {
    const pref = { theme: readCache().theme, mode };
    applyThemeAnimated(pref);
    writeCache(pref);
    setDark(mode === 'dark');
    api('/api/me/appearance', { method: 'PUT', body: JSON.stringify(pref) }).catch(() => { /* fire-and-forget */ });
  };

  // Account-wide figures when the API sends them; the workspace's own slice
  // is the fallback. The sidebar footer shows the per-workspace view, this
  // card the one that decides whether an upload fits.
  const storage = workspace?.storage ?? null;
  const used = storage ? (storage.account_used_bytes ?? storage.used) : 0;
  const total = storage ? (storage.account_limit_bytes ?? storage.total) : 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const storageColor = pct > 90 ? '#ef4444' : pct > 70 ? '#D97706' : '#22c55e';

  return (
    <DropdownMenu onOpenChange={(open) => { if (open && chatEnabled) void refreshSummary(); }}>
      <DropdownMenuTrigger
        aria-label={t('common.accessibility.accountMenu')}
        className="size-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold cursor-pointer overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {user?.avatar_url ? (
          <img src={`${API_BASE}/api/me/avatar?u=${encodeURIComponent(user.id)}`} alt="" crossOrigin="use-credentials" className="w-full h-full object-cover" />
        ) : (
          initials(user?.name || '?')
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-68">
        {user && (
          <div className="rounded-md bg-muted p-2.5 flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="size-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[13px] font-semibold shrink-0 overflow-hidden">
                {user.avatar_url ? (
                  <img src={`${API_BASE}/api/me/avatar?u=${encodeURIComponent(user.id)}`} alt="" crossOrigin="use-credentials" className="w-full h-full object-cover" />
                ) : (
                  initials(user.name || '?')
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-[18px] truncate" dir="auto">{user.name}</p>
                <p className="text-xs text-muted-foreground leading-4 truncate" dir="auto">{user.email}</p>
              </div>
              {user.plan && (
                <span data-slot="plan-chip" className="whitespace-nowrap self-start text-[11px] font-semibold px-1.75 py-0.5 rounded-full bg-(--tone-yes-bg) text-(--tone-yes-ink)">
                  {user.plan.name}{user.family?.role === 'member' ? ` ${t('common.label.family')}` : ''}
                </span>
              )}
            </div>
            {total > 0 && (
              <div className="flex flex-col gap-1.5">
                <Progress
                  value={pct}
                  aria-label={t('common.accessibility.storageUsed')}
                  className="**:data-[slot=progress-track]:h-1.5 **:data-[slot=progress-track]:bg-border **:data-[slot=progress-indicator]:bg-(--storage-color)"
                  style={{ '--storage-color': storageColor } as React.CSSProperties}
                />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground leading-4">
                  <span>{t('common.label.usedOfTotalUsed', { used: formatBytes(used), total: formatBytes(total) })}</span>
                  <DropdownMenuItem
                    render={<Link to="/billing" />}
                    className="px-1 py-0 h-4 text-[11px] font-medium text-(--brand-text) no-underline focus:bg-transparent focus:underline focus:text-(--brand-text)"
                  >
                    {t('common.action.manage')}
                  </DropdownMenuItem>
                </div>
              </div>
            )}
          </div>
        )}
        {user && <DropdownMenuSeparator className="mt-1.5" />}

        <DropdownMenuItem render={<Link to="/profile" />}><User /> {t('common.action.profile')}</DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/billing" />}><CreditCard /> {t('common.action.billing')}</DropdownMenuItem>
        <div className="flex items-center">
          <DropdownMenuItem render={<Link to="/profile/appearance" />} className="flex-1"><Palette /> {t('common.action.appearance')}</DropdownMenuItem>
          <MenuPrimitive.RadioGroup
            value={dark ? 'dark' : 'light'}
            onValueChange={(v) => setMode(v === 'dark' ? 'dark' : 'light')}
            aria-label={t('common.accessibility.colorMode')}
            className="flex items-center p-px me-1.5 rounded-md border border-border bg-card"
          >
            <ModeItem value="light" label={t('common.label.lightMode')} active={!dark}><Sun /></ModeItem>
            <ModeItem value="dark" label={t('common.label.darkMode')} active={dark}><Moon /></ModeItem>
          </MenuPrimitive.RadioGroup>
        </div>
        <DropdownMenuItem render={<Link to="/referrals" />}><Gift /> {t('common.action.referFriends')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {chatEnabled && (
          <DropdownMenuItem onClick={openPanel}>
            <MessageCircle /> {t('common.action.liveChat')}
            <span className="ms-auto flex items-center">
              {unread > 0 ? (
                <span
                  aria-label={t('support-chat.label.unreadCount', { count: unread })}
                  className="min-w-4.5 rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold leading-4.5 text-primary-foreground"
                >
                  {unread}
                </span>
              ) : (
                <PresenceDot online={staffOnline} />
              )}
            </span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem render={<Link to="/support" />}><LifeBuoy /> {t('common.action.getHelp')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openReport()}><Bug /> {t('common.action.reportABug')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => { void logoutAndRedirect(); }}><LogOut className="rtl:-scale-x-100" /> {t('common.action.logOut')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModeItem({ value, label, active, children }: { value: 'light' | 'dark'; label: string; active: boolean; children: React.ReactNode }) {
  return (
    <MenuPrimitive.RadioItem
      value={value}
      closeOnClick={false}
      aria-label={label}
      className={cn(
        'size-5.5 rounded-[5px] flex items-center justify-center outline-hidden select-none cursor-default [&_svg]:size-3 [&_svg]:pointer-events-none',
        active ? 'bg-foreground text-background' : 'text-muted-foreground focus:bg-accent focus:text-accent-foreground',
      )}
    >
      {children}
    </MenuPrimitive.RadioItem>
  );
}
