import { useState } from 'react';
import {
  LayoutDashboard, FolderOpen, Upload, Share2, Inbox, Users, RefreshCw,
  Settings, Search, HardDrive, LogOut, ChevronDown, Check, LayoutGrid, Plus,
  type LucideIcon,
} from 'lucide-react';
import { DEMO_DASHBOARD, DEMO_USER, DEMO_WORKSPACES } from '../engine/demoData';
import type { DesktopView } from '../DesktopDemo';

// Nav mirrors apps/desktop Sidebar.tsx exactly (same items, order, icons).
const NAV: { id: string; view?: DesktopView; icon: LucideIcon; label: string }[] = [
  { id: 'dashboard', view: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'files', view: 'files', icon: FolderOpen, label: 'Files' },
  { id: 'upload', view: 'upload', icon: Upload, label: 'Upload' },
  { id: 'shared', view: 'shared', icon: Share2, label: 'Shared' },
  { id: 'requests', view: 'requests', icon: Inbox, label: 'Requests' },
  { id: 'team', view: 'team', icon: Users, label: 'Team' },
  { id: 'sync', view: 'sync', icon: RefreshCw, label: 'Sync' },
  { id: 'settings', view: 'settings', icon: Settings, label: 'Settings' },
];

export function DesktopSidebar({ view, onSelect }: { view: DesktopView; onSelect: (id: string) => void }) {
  const [wsOpen, setWsOpen] = useState(false);
  const [activeWs, setActiveWs] = useState(0);
  const ws = DEMO_WORKSPACES[activeWs];

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-(--demo-border) bg-(--demo-sidebar) sm:flex">
      {/* Workspace switcher */}
      <div className="relative p-3 pb-1">
        <button onClick={() => setWsOpen((o) => !o)}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-black/5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white"
            style={{ background: ws.color }}>{ws.initials}</span>
          <span className="flex-1 truncate text-left font-medium text-(--demo-fg)">{ws.name}</span>
          <ChevronDown size={14} className={`text-(--demo-muted-fg) transition-transform ${wsOpen ? 'rotate-180' : ''}`} />
        </button>

        {wsOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setWsOpen(false)} />
            <div className="absolute inset-x-3 top-full z-50 mt-1 rounded-lg border border-(--demo-border) bg-(--demo-card) py-1 shadow-lg">
              {DEMO_WORKSPACES.map((w, i) => (
                <button key={w.name} onClick={() => { setActiveWs(i); setWsOpen(false); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-(--demo-muted)">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded text-xs font-semibold text-white"
                    style={{ background: w.color }}>{w.initials}</span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-(--demo-fg)">{w.name}</span>
                    <span className="block truncate text-[10px] leading-tight text-(--demo-muted-fg)">{w.free}</span>
                  </span>
                  {i === activeWs && <Check size={14} className="shrink-0 text-(--demo-primary)" />}
                </button>
              ))}
              <div className="my-1 h-px bg-(--demo-border)" />
              <button onClick={() => { setWsOpen(false); onSelect('workspace'); }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-(--demo-muted-fg) hover:bg-(--demo-muted)">
                <LayoutGrid size={14} /> Workspace dashboard
              </button>
              <button onClick={() => { setWsOpen(false); onSelect('workspace'); }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-(--demo-muted-fg) hover:bg-(--demo-muted)">
                <Plus size={14} /> Create workspace
              </button>
            </div>
          </>
        )}
      </div>

      {/* Search */}
      <div className="p-3 pt-1">
        <button onClick={() => onSelect('search')}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-(--demo-muted-fg) hover:bg-black/5">
          <Search size={16} />
          <span>Search...</span>
          <kbd className="ml-auto rounded bg-black/5 px-1.5 py-0.5 text-xs">⌘K</kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ id, view: v, icon: Icon, label }) => {
          const active = v !== undefined && v === view;
          return (
            <button key={id} onClick={() => onSelect(id)}
              className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-(--demo-primary)/10 font-medium text-(--demo-primary)'
                  : 'text-(--demo-muted-fg) hover:bg-black/5'
              }`}>
              <Icon size={18} className="shrink-0" />
              <span className="flex-1 text-left">{label}</span>
              {id === 'sync' && <span className="text-[10px] font-medium text-(--demo-primary)">Start now</span>}
            </button>
          );
        })}
      </nav>

      {/* Storage widget */}
      <div className="px-3 pb-2">
        <div className="rounded-lg bg-(--demo-muted) px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-(--demo-muted-fg)">
              <HardDrive size={12} /> Storage
            </div>
            <span className="text-xs font-medium text-(--demo-fg)">{DEMO_DASHBOARD.storagePercent}%</span>
          </div>
          <div className="mb-1.5 h-1.5 rounded-full bg-(--demo-border)">
            <div className="h-1.5 rounded-full bg-(--demo-primary)" style={{ width: `${DEMO_DASHBOARD.storagePercent}%` }} />
          </div>
          <p className="text-xs text-(--demo-muted-fg)">
            {DEMO_DASHBOARD.storageUsedLabel} / {DEMO_DASHBOARD.storageCapLabel}
          </p>
        </div>
      </div>

      {/* User profile */}
      <div className="border-t border-(--demo-border) p-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white"
            style={{ background: DEMO_WORKSPACES[0].color }}>{DEMO_USER.initial}</span>
          <div className="min-w-0 flex-1 truncate text-left">
            <p className="truncate text-sm font-medium text-(--demo-fg)">{DEMO_USER.name}</p>
            <p className="truncate text-xs text-(--demo-muted-fg)">{DEMO_USER.email}</p>
          </div>
          <button aria-label="Log out" onClick={() => onSelect('logout')}
            className="rounded p-1.5 text-(--demo-muted-fg) hover:bg-black/5">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
