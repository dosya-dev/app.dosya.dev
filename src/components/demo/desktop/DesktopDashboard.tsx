import type { ReactNode } from 'react';
import { FileText, Share2, HardDrive, Upload, FolderSync, CheckCircle2 } from 'lucide-react';
import { DEMO_DASHBOARD, DEMO_USER, humanSize, KIND_COLORS } from '../engine/demoData';
import { useDemo } from '../engine/demoState';

// Mirrors apps/desktop DashboardPage.tsx: welcome header + upload CTA, three
// stat cards, storage breakdown, recent files, activity, and a sync card.
// Shared-count and recent files/activity read live demo state so uploading or
// sharing in the demo updates the dashboard.
export function DesktopDashboard({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { state, dispatch } = useDemo();
  const sharedCount = state.files.filter((f) => f.shared).length;
  const recent = [...state.files].sort((a, b) => b.modifiedRank - a.modifiedRank).slice(0, 5);
  const maxCat = Math.max(...DEMO_DASHBOARD.breakdown.map((b) => b.bytes), 1);

  return (
    <div className="space-y-5 p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {/* Not an <h1>: see WebDashboard.tsx. On /desktop this mockup rendered
              *before* the real page H1, so "Welcome back, Alex" was the first
              heading a crawler saw on the site's most-linked page. */}
          <div className="text-xl font-semibold text-(--demo-fg)">Welcome back, {DEMO_USER.name.split(' ')[0]}</div>
          <p className="text-sm text-(--demo-muted-fg)">Here's what's happening in your workspace</p>
        </div>
        <button onClick={() => onNavigate('upload')}
          className="flex items-center gap-2 rounded-lg bg-(--demo-primary) px-4 py-2 text-sm font-medium text-(--demo-primary-fg) hover:opacity-90">
          <Upload size={16} /> Upload files
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<FileText size={20} />} value={DEMO_DASHBOARD.totalFiles.toLocaleString()}
          label="Total files" sub={`${DEMO_DASHBOARD.filesThisWeek} added this week`} />
        <StatCard icon={<Share2 size={20} />} value={sharedCount.toLocaleString()}
          label="Shared externally" sub="Active share links" />
        <StatCard icon={<HardDrive size={20} />} value={DEMO_DASHBOARD.storageUsedLabel}
          label="Storage used" sub={`${DEMO_DASHBOARD.storagePercent}% of ${DEMO_DASHBOARD.storageCapLabel}`} />
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-3">
          {/* Storage breakdown */}
          <Card title="Storage breakdown">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-lg font-semibold text-(--demo-fg)">
                  {DEMO_DASHBOARD.storageUsedLabel}{' '}
                  <span className="text-sm font-normal text-(--demo-muted-fg)">used</span>
                </p>
                <p className="text-xs text-(--demo-muted-fg)">of {DEMO_DASHBOARD.storageCapLabel} total</p>
              </div>
              <p className="text-2xl font-bold text-(--demo-fg)">{DEMO_DASHBOARD.storagePercent}%</p>
            </div>
            <div className="mb-3 h-2.5 rounded-full bg-(--demo-muted)">
              <div className="h-2.5 rounded-full bg-(--demo-primary)" style={{ width: `${DEMO_DASHBOARD.storagePercent}%` }} />
            </div>
            <div className="space-y-2">
              {DEMO_DASHBOARD.breakdown.map((cat) => (
                <div key={cat.name} className="flex items-center gap-3">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: cat.color }} />
                  <span className="w-20 text-xs text-(--demo-fg)">{cat.name}</span>
                  <div className="flex-1">
                    <div className="h-2 rounded-full bg-(--demo-muted)">
                      <div className="h-2 rounded-full" style={{ width: `${Math.max((cat.bytes / maxCat) * 100, 2)}%`, background: cat.color }} />
                    </div>
                  </div>
                  <span className="w-16 text-right text-xs text-(--demo-muted-fg)">{humanSize(cat.bytes)}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Recent files */}
          <Card title="Recent files" action={
            <button onClick={() => onNavigate('files')} className="text-xs text-(--demo-primary) hover:underline">View all</button>
          }>
            <div className="space-y-1">
              {recent.map((f) => (
                <div key={f.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-(--demo-muted)">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: KIND_COLORS[f.kind] }} />
                  <span className="flex-1 truncate text-sm text-(--demo-fg)">{f.name}</span>
                  <span className="text-xs text-(--demo-muted-fg)">{humanSize(f.sizeBytes)}</span>
                  <span className="w-16 text-right text-xs text-(--demo-muted-fg)">{f.modified}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="col-span-1 space-y-3">
          {/* Activity */}
          <Card title="Activity" action={
            <button onClick={() => onNavigate('activity')} className="text-xs text-(--demo-primary) hover:underline">All</button>
          }>
            <div className="space-y-1">
              {state.activity.slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-start gap-2.5 rounded-lg px-1 py-1.5">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: a.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-(--demo-fg)">{a.text}</p>
                    <p className="truncate text-[10px] text-(--demo-muted-fg)">{a.meta}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Sync */}
          <Card title="Sync" action={
            <button onClick={() => dispatch({ type: 'TOAST', toast: { text: 'Set up sync in the full app', cta: true } })}
              className="text-xs text-(--demo-primary) hover:underline">Manage</button>
          }>
            <div className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
              <CheckCircle2 size={16} className="shrink-0 text-(--demo-primary)" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-(--demo-fg)">Projects</p>
                <p className="truncate text-xs text-(--demo-muted-fg)">Acme Studio</p>
              </div>
              <span className="text-xs text-(--demo-muted-fg)">Synced</span>
            </div>
            <div className="mt-1 flex items-center gap-2.5 rounded-lg px-1 py-1.5">
              <FolderSync size={16} className="shrink-0 text-(--demo-muted-fg)" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-(--demo-fg)">Photos</p>
                <p className="truncate text-xs text-(--demo-muted-fg)">Acme Studio</p>
              </div>
              <span className="text-xs text-(--demo-muted-fg)">Synced</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, value, label, sub }: { icon: ReactNode; value: string; label: string; sub: string }) {
  return (
    <div className="rounded-xl border border-(--demo-border) p-4">
      <div className="mb-2 text-(--demo-muted-fg)">{icon}</div>
      <p className="text-2xl font-semibold text-(--demo-fg)">{value}</p>
      <p className="text-sm text-(--demo-muted-fg)">{label}</p>
      <p className="mt-0.5 text-xs text-(--demo-muted-fg)">{sub}</p>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-(--demo-border) p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-(--demo-fg)">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
