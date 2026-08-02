import {
  Search, Bell, LayoutDashboard, FolderOpen, Upload, Share2, Lock, Users,
  Plug, Settings, type LucideIcon,
} from 'lucide-react';
import { DEMO_USER } from '../engine/demoData';
import { useDemo } from '../engine/demoState';
import type { WebView } from '../WebDemo';

const TITLES: Record<WebView, { icon: LucideIcon; label: string }> = {
  dashboard: { icon: LayoutDashboard, label: 'Dashboard' },
  files: { icon: FolderOpen, label: 'Files' },
  uploads: { icon: Upload, label: 'Uploads' },
  shared: { icon: Share2, label: 'Shared' },
  vault: { icon: Lock, label: 'Vault' },
  team: { icon: Users, label: 'Team' },
  integrations: { icon: Plug, label: 'Integrations' },
  settings: { icon: Settings, label: 'Settings' },
};

// Mirrors apps/web dashboard-topbar.tsx: page title + icon, a search box, and
// a right cluster (theme control, notifications, avatar). The theme control is
// the 8-swatch palette so visitors see the theme options.
export function WebTopbar({ view, onSelect }: { view: WebView; onSelect: (id: string) => void }) {
  const { dispatch } = useDemo();
  const { icon: Icon, label } = TITLES[view];
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-(--demo-border) bg-(--demo-card) px-3">
      <div className="hidden items-center gap-2 md:flex">
        <Icon className="size-4 text-(--demo-muted-fg)" />
        <span className="whitespace-nowrap text-sm font-semibold text-(--demo-fg)">{label}</span>
      </div>
      <span className="hidden h-5 w-px bg-(--demo-border) md:block" />

      {/* Search */}
      <button onClick={() => dispatch({ type: 'TOAST', toast: { text: 'Search across everything in the full app', cta: true } })}
        className="flex h-8 max-w-[360px] flex-1 items-center gap-2 rounded-lg border border-(--demo-border) bg-(--demo-bg) px-3 text-left">
        <Search className="size-3.5 shrink-0 text-(--demo-muted-fg)" />
        <span className="flex-1 truncate text-sm text-(--demo-muted-fg)">Search files, folders, people...</span>
        <kbd className="rounded border border-(--demo-border) bg-(--demo-muted) px-1.5 py-0.5 text-[10px] font-medium leading-none text-(--demo-muted-fg)">/</kbd>
      </button>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-1.5">
        <button aria-label="Notifications" onClick={() => dispatch({ type: 'TOAST', toast: { text: 'Notifications live in the full app', cta: true } })}
          className="grid size-8 place-items-center rounded-md border border-(--demo-border) text-(--demo-muted-fg) hover:bg-black/5">
          <Bell className="size-4" />
        </button>
        <button aria-label="Account" onClick={() => onSelect('account')}
          className="grid size-8 place-items-center rounded-full text-xs font-semibold text-white"
          style={{ background: 'var(--demo-primary)' }}>{DEMO_USER.initial}</button>
      </div>
    </header>
  );
}
