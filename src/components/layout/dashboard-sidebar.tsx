import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LayoutDashboard, FolderOpen, Upload, Share2, Users, Settings,
  ChevronsUpDown, Plus, Check,
} from 'lucide-react';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';

interface Workspace {
  id: string; name: string; slug: string; icon_initials: string; icon_color: string;
  icon_image_url: string | null; role_id: string;
}

interface StorageInfo {
  plan: { name: string; storage_label: string };
  usage: { used_label: string; pct: number };
}

const navItems = [
  { title: 'Dashboard', url: '/', icon: LayoutDashboard },
  { title: 'Files', url: '/files', icon: FolderOpen },
  { title: 'Uploads', url: '/uploads', icon: Upload },
  { title: 'Shared', url: '/shared', icon: Share2 },
];

const workspaceItems = [
  { title: 'Team', url: '/teams', icon: Users },
  { title: 'Settings', url: '/settings', icon: Settings },
];

// Fast labels for the built-in roles so the header doesn't flash before the
// roles list resolves; custom roles fall back to their fetched name.
const ROLE_LABELS: Record<string, string> = {
  role_owner: 'Owner',
  role_admin: 'Admin',
  role_member: 'Member',
  role_viewer: 'Viewer',
};

// Match the profile-page nav treatment: xs muted text, active = accent pill
// (accent-foreground text over a green pill). The pill background itself is a
// single absolutely-positioned div that slides between items on navigation —
// so the active button's own background stays transparent while the sidebar is
// expanded. In icon-collapsed mode the pill is hidden and the button paints
// its own bg-accent instead. Pressed (active:) overrides keep the shadcn base
// from flashing bg-sidebar-accent (saturated green in this theme) on click.
const NAV_BTN_CLASS =
  'gap-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground ' +
  'active:bg-muted/50 active:text-foreground ' +
  'data-active:bg-transparent data-active:font-medium data-active:text-accent-foreground ' +
  'data-active:hover:bg-transparent data-active:hover:text-accent-foreground ' +
  'data-active:active:bg-transparent data-active:active:text-accent-foreground ' +
  'group-data-[collapsible=icon]:data-active:bg-accent';

export function DashboardSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeId, setActiveId } = useWorkspace();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [roleName, setRoleName] = useState<string | null>(null);

  // Sliding active pill: measure the active menu button and glide one shared
  // indicator to it whenever the route changes.
  const contentRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const c = contentRef.current;
      if (!c) return;
      const el = c.querySelector<HTMLElement>('[data-active]');
      if (!el) { setPill(null); return; }
      const cRect = c.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setPill({ top: r.top - cRect.top + c.scrollTop, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [location.pathname]);

  const activeWs = workspaces.find((w) => w.id === activeId);
  const roleLabel = activeWs
    ? ROLE_LABELS[activeWs.role_id] ?? roleName ?? 'Member'
    : '';

  // Load workspaces
  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
        if (data.ok) {
          setWorkspaces(data.workspaces);
          if (!activeId && data.workspaces.length > 0) {
            setActiveId(data.workspaces[0].id);
          }
        }
      } catch { /* */ }
    })();
  }, [activeId, setActiveId]);

  // Load storage
  useEffect(() => {
    if (!activeId) return;
    (async () => {
      try {
        const data = await api<{ ok: boolean; plan: StorageInfo['plan']; usage: StorageInfo['usage'] }>('/api/billing/status');
        if (data.ok) setStorage({ plan: data.plan, usage: data.usage });
      } catch { /* */ }
    })();
  }, [activeId]);

  // Resolve the current user's role name (covers custom roles, not just built-ins)
  useEffect(() => {
    if (!activeId || !activeWs) { setRoleName(null); return; }
    if (ROLE_LABELS[activeWs.role_id]) { setRoleName(ROLE_LABELS[activeWs.role_id]); return; }
    (async () => {
      try {
        const data = await api<{ ok: boolean; roles?: { id: string; name: string }[] }>(`/api/roles?workspace_id=${activeId}`);
        const match = data.roles?.find((r) => r.id === activeWs.role_id);
        setRoleName(match?.name ?? 'Member');
      } catch { setRoleName('Member'); }
    })();
  }, [activeId, activeWs?.role_id]);

  const switchWorkspace = (id: string) => {
    if (id === activeId) return;
    setActiveId(id);
    // Land on the dashboard so it refetches for the new workspace — no hard reload.
    navigate('/');
  };

  const storagePct = storage?.usage.pct ?? 0;
  const storageColor = storagePct > 90 ? '#ef4444' : storagePct > 70 ? '#D97706' : '#22c55e';

  return (
    <Sidebar collapsible="icon">
      {/* Workspace switcher */}
      <SidebarHeader className="px-2 pt-2 pb-0 group-data-[collapsible=icon]:px-0">
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-md outline-none">
            <div className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 cursor-pointer hover:bg-muted/60 transition-colors group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
              {activeWs ? (
                <>
                  <div className="flex h-8 w-8 items-center justify-center rounded-md text-[11px] font-bold text-white shrink-0" style={{ background: activeWs.icon_color }}>
                    {activeWs.icon_initials}
                  </div>
                  <div className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
                    <p className="truncate text-sm font-medium leading-tight">{activeWs.name}</p>
                    <p className="text-[11px] leading-tight text-muted-foreground">{roleLabel}</p>
                  </div>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-data-[collapsible=icon]:hidden" />
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Loading...</p>
              )}
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5">Your workspaces</p>
            {workspaces.map((ws) => (
              <DropdownMenuItem key={ws.id} onClick={() => switchWorkspace(ws.id)} className="gap-2.5">
                <div className="w-6 h-6 rounded-[5px] flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: ws.icon_color }}>
                  {ws.icon_initials}
                </div>
                <span className="flex-1 truncate text-xs">{ws.name}</span>
                {ws.id === activeId && <Check className="size-3 text-green-600" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <Link to="/create-workspace">
              <DropdownMenuItem className="gap-2">
                <div className="w-6 h-6 rounded-[5px] bg-muted flex items-center justify-center shrink-0">
                  <Plus className="size-3 text-muted-foreground" />
                </div>
                <span className="text-xs text-muted-foreground">Create new workspace</span>
              </DropdownMenuItem>
            </Link>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      <SidebarContent ref={contentRef} className="relative">
        {/* Sliding active-item pill (hidden in icon-collapsed mode; the button
            paints its own bg-accent there instead) */}
        {pill && (
          <div
            aria-hidden
            className="absolute left-2 right-2 rounded-md bg-accent transition-[top,height] duration-200 ease-out group-data-[collapsible=icon]:hidden"
            style={{ top: pill.top, height: pill.height }}
          />
        )}
        {/* Main nav */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <Link to={item.url} className="w-full">
                    <SidebarMenuButton className={NAV_BTN_CLASS} isActive={location.pathname === item.url || (item.url !== '/' && location.pathname.startsWith(item.url))}>
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </Link>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Workspace nav */}
        <SidebarGroup className="mt-2">
          <SidebarGroupLabel className="px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {workspaceItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <Link to={item.url} className="w-full">
                    <SidebarMenuButton className={NAV_BTN_CLASS} isActive={location.pathname === item.url || location.pathname.startsWith(item.url + '/')}>
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </Link>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Storage widget */}
      <SidebarFooter className="px-4 py-3 border-t group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center">
        {storage ? (
          <>
            {/* Expanded: linear bar */}
            <div className="group-data-[collapsible=icon]:hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Storage</span>
                <span className="text-[11px] text-muted-foreground">{storage.usage.used_label} / {storage.plan.storage_label}</span>
              </div>
              <Progress
                value={Math.min(storagePct, 100)}
                className="mb-1.5 **:data-[slot=progress-track]:bg-border **:data-[slot=progress-indicator]:bg-(--storage-color)"
                style={{ '--storage-color': storageColor } as React.CSSProperties}
              />
              {storagePct >= 80 && (
                <p className={`text-[10px] font-medium ${storagePct >= 95 ? 'text-red-600' : 'text-amber-600'}`}>
                  {storagePct >= 95 ? 'Storage almost full. Upgrade your plan.' : `${Math.round(100 - storagePct)}% remaining`}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">{activeWs?.name} · {storage.plan.name}</p>
            </div>
            {/* Collapsed: circle progress */}
            <div className="hidden group-data-[collapsible=icon]:block">
              <Tooltip>
                <TooltipTrigger>
                  <svg width="32" height="32" viewBox="0 0 36 36" className="cursor-default">
                    <circle cx="18" cy="18" r="14" fill="none" stroke="var(--border)" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="14" fill="none"
                      stroke={storageColor}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={`${Math.min(storagePct, 100) * 0.88} 88`}
                      transform="rotate(-90 18 18)"
                    />
                    <text x="18" y="19.5" textAnchor="middle" fontSize="8" fontWeight="600" fill="currentColor" className="text-muted-foreground">
                      {Math.round(storagePct)}%
                    </text>
                  </svg>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="text-xs leading-relaxed">
                    <p className="font-semibold">{storage.usage.used_label} / {storage.plan.storage_label}</p>
                    <p className="opacity-70">{storage.plan.name} plan</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">Loading...</p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
