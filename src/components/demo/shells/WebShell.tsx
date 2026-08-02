import type { ReactNode } from 'react';

export function WebShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-(--demo-border) bg-(--demo-card) shadow-2xl">
      <div className="flex items-center gap-2 border-b border-(--demo-border) bg-(--demo-muted) px-3 py-2">
        <span className="size-2.5 rounded-full bg-red-400" />
        <span className="size-2.5 rounded-full bg-yellow-400" />
        <span className="size-2.5 rounded-full bg-green-400" />
        <div className="mx-auto rounded-md bg-(--demo-bg) px-3 py-1 text-[11px] text-(--demo-muted-fg)">
          app.dosya.dev
        </div>
        <span className="w-14" />
      </div>
      {children}
    </div>
  );
}
