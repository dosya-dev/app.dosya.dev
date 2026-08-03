import { useState } from 'react';
import {
  LayoutDashboard, FolderOpen, Upload, Share2, Lock, Users, Plug, Settings,
  ChevronsUpDown, Check, LayoutGrid, Plus, type LucideIcon,
} from 'lucide-react';
import { DEMO_DASHBOARD, DEMO_WORKSPACES } from '../engine/demoData';
import type { WebView } from '../WebDemo';

// Mirrors apps/web dashboard-sidebar.tsx: a main nav group + a "Workspace"
// group, workspace switcher on top, storage widget at the bottom.
const NAV: { id: string; view: WebView; icon: LucideIcon; label: string }[] = [
  { id: 'dashboard', view: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'files', view: 'files', icon: FolderOpen, label: 'Files' },
  { id: 'uploads', view: 'uploads', icon: Upload, label: 'Uploads' },
  { id: 'shared', view: 'shared', icon: Share2, label: 'Shared' },
  { id: 'vault', view: 'vault', icon: Lock, label: 'Vault' },
];
const WORKSPACE_NAV: { id: string; view: WebView; icon: LucideIcon; label: string }[] = [
  { id: 'team', view: 'team', icon: Users, label: 'Team' },
  { id: 'integrations', view: 'integrations', icon: Plug, label: 'Integrations' },
  { id: 'settings', view: 'settings', icon: Settings, label: 'Settings' },
];

export function WebSidebar({ view, onSelect }: { view: WebView; onSelect: (id: string) => void }) {
  const [wsOpen, setWsOpen] = useState(false);
  const [activeWs, setActiveWs] = useState(0);
  const ws = DEMO_WORKSPACES[activeWs];

  const navBtn = (active: boolean) =>
    `flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
      active ? 'bg-(--demo-primary)/10 text-(--demo-primary)' : 'text-(--demo-muted-fg) hover:bg-black/5 hover:text-(--demo-fg)'
    }`;

  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-(--demo-border) bg-(--demo-sidebar) sm:flex">
      {/* Workspace switcher */}
      <div className="relative p-2">
        <button onClick={() => setWsOpen((o) => !o)}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-black/5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
            style={{ background: ws.color }}>{ws.initials}</span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium leading-tight text-(--demo-fg)">{ws.name}</span>
            <span className="block text-[11px] leading-tight text-(--demo-muted-fg)">Owner</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-(--demo-muted-fg)" />
        </button>

        {wsOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setWsOpen(false)} />
            <div className="absolute inset-x-2 top-full z-50 mt-1 rounded-lg border border-(--demo-border) bg-(--demo-card) py-1 shadow-lg">
              <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-(--demo-muted-fg)">Your workspaces</p>
              {DEMO_WORKSPACES.map((w, i) => (
                <button key={w.name} onClick={() => { setActiveWs(i); setWsOpen(false); }}
                  className="flex w-full items-center gap-2.5 px-2 py-1.5 hover:bg-(--demo-muted)">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-[10px] font-bold text-white"
                    style={{ background: w.color }}>{w.initials}</span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-xs leading-tight text-(--demo-fg)">{w.name}</span>
                    <span className="block truncate text-[10px] leading-tight text-(--demo-muted-fg)">{w.free}</span>
                  </span>
                  {i === activeWs && <Check className="size-3 shrink-0 text-(--demo-primary)" />}
                </button>
              ))}
              <div className="my-1 h-px bg-(--demo-border)" />
              <button onClick={() => { setWsOpen(false); onSelect('workspace'); }}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-(--demo-muted-fg) hover:bg-(--demo-muted)">
                <span className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-(--demo-muted)"><LayoutGrid className="size-3" /></span>
                Workspace dashboard
              </button>
              <button onClick={() => { setWsOpen(false); onSelect('workspace'); }}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-(--demo-muted-fg) hover:bg-(--demo-muted)">
                <span className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-(--demo-muted)"><Plus className="size-3" /></span>
                Create new workspace
              </button>
            </div>
          </>
        )}
      </div>

      {/* Main nav */}
      <nav className="space-y-0.5 px-2">
        {NAV.map(({ id, view: v, icon: Icon, label }) => (
          <button key={id} className={navBtn(v === view)} onClick={() => onSelect(id)}>
            <Icon className="size-4 shrink-0" /> <span className="flex-1 text-left">{label}</span>
          </button>
        ))}
      </nav>

      {/* Workspace group */}
      <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-(--demo-muted-fg)">Workspace</p>
      <nav className="space-y-0.5 px-2">
        {WORKSPACE_NAV.map(({ id, view: v, icon: Icon, label }) => (
          <button key={id} className={navBtn(v === view)} onClick={() => onSelect(id)}>
            <Icon className="size-4 shrink-0" /> <span className="flex-1 text-left">{label}</span>
          </button>
        ))}
      </nav>

      {/* Storage widget */}
      <div className="mt-auto border-t border-(--demo-border) px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-(--demo-muted-fg)">Storage</span>
          <span className="text-[11px] text-(--demo-muted-fg)">{DEMO_DASHBOARD.storageUsedLabel} / {DEMO_DASHBOARD.storageCapLabel}</span>
        </div>
        <div className="h-1.5 rounded-full bg-(--demo-border)">
          <div className="h-1.5 rounded-full bg-(--demo-primary)" style={{ width: `${DEMO_DASHBOARD.storagePercent}%` }} />
        </div>
        <p className="mt-1 text-[10px] text-(--demo-muted-fg)">Acme Studio · Business</p>
      </div>
    </aside>
  );
}
