import type { ReactNode } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { ThemeSwitcher } from '../core/ThemeSwitcher';

// Mirrors the real desktop app's macOS TitleBar: traffic lights at the left,
// the dosya.dev logo + wordmark centered, and the LAN-transfer button at the
// right, over the cream titlebar. The app body (sidebar + content) is passed
// as children.
export function DesktopShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-(--demo-border) bg-(--demo-card) shadow-2xl">
      <div className="flex h-10 items-center justify-between border-b border-(--demo-border) bg-(--demo-sidebar) px-4">
        <div className="flex flex-1 items-center gap-1.5">
          <span className="size-3 rounded-full bg-red-400" />
          <span className="size-3 rounded-full bg-yellow-400" />
          <span className="size-3 rounded-full bg-green-400" />
          {/* Theme palette surfaced top-left so visitors see the themes on offer. */}
          <div className="ml-3">
            <ThemeSwitcher align="left" label />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="size-5" width={20} height={20} />
          <span className="text-sm font-semibold text-(--demo-fg)">dosya.dev</span>
        </div>
        <div className="flex flex-1 items-center justify-end">
          <span className="flex items-center rounded-lg px-2.5 py-1 text-(--demo-muted-fg)" title="LAN transfer">
            <ArrowUpDown size={13} />
          </span>
        </div>
      </div>
      <div className="flex h-[640px]">{children}</div>
    </div>
  );
}
