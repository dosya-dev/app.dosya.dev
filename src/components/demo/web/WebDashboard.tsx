import type { ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { DEMO_DASHBOARD, DEMO_REGION_BREAKDOWN, DEMO_USER, humanSize, KIND_COLORS } from '../engine/demoData';
import { useDemo } from '../engine/demoState';

// Mirrors apps/web dashboard.tsx: greeting + upload CTA, a 5-up stat row, and
// a two-column body (storage breakdown w/ ring + recent files | activity +
// storage by region). Reads live demo state so uploads/shares update it.
export function WebDashboard({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { state } = useDemo();
  const sharedCount = state.files.filter((f) => f.shared).length;
  const recent = [...state.files].sort((a, b) => b.modifiedRank - a.modifiedRank).slice(0, 5);
  const maxCat = Math.max(...DEMO_DASHBOARD.breakdown.map((b) => b.bytes), 1);
  const maxRegion = Math.max(...DEMO_REGION_BREAKDOWN.map((r) => r.bytes), 1);

  return (
    <div className="space-y-5 p-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-(--demo-fg)">Good afternoon, {DEMO_USER.name.split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-(--demo-muted-fg)">Here's your workspace at a glance</p>
        </div>
        <button onClick={() => onNavigate('uploads')}
          className="flex items-center gap-2 rounded-lg bg-(--demo-primary) px-4 py-2 text-sm font-medium text-(--demo-primary-fg) hover:opacity-90">
          <Upload className="size-4" /> Upload files
        </button>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total files" value={DEMO_DASHBOARD.totalFiles.toLocaleString()}
          sub={<><span className="font-semibold text-(--demo-primary)">+{DEMO_DASHBOARD.filesThisWeek}</span> this week</>} />
        <StatCard label="Shared externally" value={sharedCount.toLocaleString()} sub="Active share links" />
        <StatCard label="File requests" value="2" sub="Active requests" />
        <StatCard label="Storage used" value={DEMO_DASHBOARD.storageUsedLabel} sub={`of ${DEMO_DASHBOARD.storageCapLabel}`} />
        <StatCard label="Current plan" value="Business" sub="Renews monthly" />
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        {/* Left */}
        <div className="space-y-4">
          <Card title="Storage breakdown" action={<button onClick={() => onNavigate('files')} className="text-xs text-(--demo-muted-fg) hover:text-(--demo-fg)">Manage</button>}>
            <div className="mb-4 flex items-center gap-5">
              <StorageRing pct={DEMO_DASHBOARD.storagePercent} />
              <div>
                <p className="text-2xl font-semibold tracking-tight text-(--demo-fg)">
                  {DEMO_DASHBOARD.storageUsedLabel} <span className="text-sm font-normal text-(--demo-muted-fg)">used</span>
                </p>
                <p className="mt-1 text-xs text-(--demo-muted-fg)">of {DEMO_DASHBOARD.storageCapLabel} total</p>
              </div>
            </div>
            <div className="space-y-2">
              {DEMO_DASHBOARD.breakdown.map((b) => (
                <div key={b.name} className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: b.color }} />
                  <span className="flex-1 text-xs text-(--demo-muted-fg)">{b.name}</span>
                  <div className="h-1.5 flex-[2] rounded-full bg-(--demo-muted)">
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.max((b.bytes / maxCat) * 100, 2)}%`, background: b.color }} />
                  </div>
                  <span className="min-w-[44px] text-right text-[11px] text-(--demo-muted-fg)">{humanSize(b.bytes)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Recent files" action={<button onClick={() => onNavigate('files')} className="text-xs text-(--demo-muted-fg) hover:text-(--demo-fg)">View all</button>}>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              {recent.map((f) => {
                const ext = f.name.split('.').pop()?.toUpperCase() ?? '';
                return (
                  <div key={f.id} className="overflow-hidden rounded-lg border border-(--demo-border)">
                    <div className="relative grid aspect-[4/3] place-items-center" style={{ background: `linear-gradient(135deg, ${KIND_COLORS[f.kind]}26, ${KIND_COLORS[f.kind]}0d)` }}>
                      <span className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-white">{ext}</span>
                    </div>
                    <div className="p-1.5">
                      <p className="truncate text-[11px] font-medium text-(--demo-fg)">{f.name}</p>
                      <p className="text-[10px] text-(--demo-muted-fg)">{humanSize(f.sizeBytes)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Right */}
        <div className="space-y-4">
          <Card title="Activity">
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {state.activity.slice(0, 7).map((a) => (
                <div key={a.id} className="flex items-start gap-2.5 py-1">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: a.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-(--demo-fg)">{a.text}</p>
                    <p className="truncate text-[10px] text-(--demo-muted-fg)">{a.meta}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Storage by region">
            <div className="space-y-2">
              {DEMO_REGION_BREAKDOWN.map((r) => (
                <div key={r.region} className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} />
                  <span className="w-8 text-xs text-(--demo-fg)">{r.region}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-(--demo-muted)">
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.max((r.bytes / maxRegion) * 100, 2)}%`, background: r.color }} />
                  </div>
                  <span className="min-w-[44px] text-right text-[11px] text-(--demo-muted-fg)">{humanSize(r.bytes)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StorageRing({ pct }: { pct: number }) {
  const c = 188.5;
  const offset = c - (c * pct) / 100;
  return (
    <svg width="72" height="72" viewBox="0 0 80 80" className="shrink-0">
      <circle cx="40" cy="40" r="30" fill="none" stroke="var(--demo-muted)" strokeWidth="8" />
      <circle cx="40" cy="40" r="30" fill="none" stroke="var(--demo-primary)" strokeWidth="8"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 40 40)" />
      <text x="40" y="38" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--demo-fg)">{pct}%</text>
      <text x="40" y="51" textAnchor="middle" fontSize="8.5" fill="var(--demo-muted-fg)">used</text>
    </svg>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-(--demo-border) p-4">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-(--demo-muted-fg)">{label}</p>
      <p className="text-2xl font-semibold leading-none tracking-tight text-(--demo-fg)">{value}</p>
      {sub && <p className="mt-1.5 text-[11px] text-(--demo-muted-fg)">{sub}</p>}
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
