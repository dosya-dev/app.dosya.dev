import { useState } from 'react';
import { Upload, Globe, Shield, ChevronRight, Plus, Loader2, Folder } from 'lucide-react';
import { DEMO_REGIONS, humanSize } from '../engine/demoData';
import { useDemo } from '../engine/demoState';

// Mirrors apps/desktop UploadPage.tsx: dashed dropzone + format pills and a
// live queue on the left; destination + region picker + "secure upload" box
// on the right. Clicking the dropzone (or dragging onto it) enqueues a demo
// upload that runs through the shared engine.
export function UploadView({ dragging }: { dragging: boolean }) {
  const { state, dispatch } = useDemo();
  const [region, setRegion] = useState('SYD');

  return (
    <div className="flex h-full gap-5 p-5">
      {/* Left column */}
      <div className="min-w-0 flex-1 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Upload files</h1>
          <p className="text-sm text-(--demo-muted-fg)">
            Files are end-to-end encrypted in transit. You pick the region.
          </p>
        </div>

        {/* Dropzone */}
        <button onClick={() => dispatch({ type: 'START_UPLOAD' })}
          className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition-colors ${
            dragging ? 'border-(--demo-primary) bg-(--demo-primary)/5' : 'border-(--demo-border) hover:border-(--demo-primary)/50'
          }`}>
          <Upload size={38} className={`mb-3 ${dragging ? 'text-(--demo-primary)' : 'text-(--demo-muted-fg)'}`} />
          <p className="text-sm font-medium">{dragging ? 'Drop files here' : 'Drop files here to upload'}</p>
          <p className="mt-1 text-xs text-(--demo-muted-fg)">
            Drag and drop anything, or <span className="font-semibold">browse your computer</span>
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {['Video', 'Images', 'Documents', 'Archives', 'Any format'].map((t) => (
              <span key={t} className="rounded-full bg-(--demo-muted) px-2.5 py-0.5 text-[10px] font-medium text-(--demo-muted-fg)">{t}</span>
            ))}
          </div>
        </button>

        {/* Live queue */}
        {state.uploads.length > 0 && (
          <div className="rounded-xl border border-(--demo-border) p-4">
            <h3 className="mb-2 text-sm font-semibold">Uploading</h3>
            <div className="space-y-1">
              {state.uploads.map((u) => (
                <div key={u.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
                  <Loader2 size={16} className="shrink-0 animate-spin text-(--demo-primary)" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="truncate">{u.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-(--demo-muted-fg)">
                        {humanSize((u.progress / 100) * u.sizeBytes)} / {humanSize(u.sizeBytes)}
                      </span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-(--demo-muted)">
                      <div className="h-1 rounded-full bg-(--demo-primary) transition-[width] duration-100" style={{ width: `${u.progress}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right column */}
      <div className="hidden w-60 shrink-0 space-y-4 lg:block">
        <div className="rounded-xl border border-(--demo-border) p-4">
          <p className="mb-1.5 text-xs font-medium text-(--demo-muted-fg)">Destination</p>
          <button onClick={() => dispatch({ type: 'TOAST', toast: { text: 'Pick any folder in the full app', cta: true } })}
            className="flex w-full items-center gap-2 rounded-lg border border-(--demo-border) px-3 py-2 text-sm hover:bg-(--demo-muted)">
            <Folder size={14} className="shrink-0 text-(--demo-primary)" />
            <span className="flex-1 truncate text-left text-(--demo-muted-fg)">All files (root)</span>
            <ChevronRight size={12} className="text-(--demo-muted-fg)" />
          </button>
          <button onClick={() => dispatch({ type: 'TOAST', toast: { text: 'Create folders in the full app', cta: true } })}
            className="mt-1.5 flex items-center gap-1.5 text-xs text-(--demo-muted-fg) hover:text-(--demo-fg)">
            <Plus size={11} /> Create new folder
          </button>

          <div className="my-3 h-px bg-(--demo-border)" />

          <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-(--demo-muted-fg)">
            <Globe size={13} /> Select region
            <span className="ml-auto text-[10px] font-normal">{DEMO_REGIONS.length} available</span>
          </p>
          <div className="grid gap-1.5">
            {DEMO_REGIONS.map((r) => (
              <button key={r.code} onClick={() => setRegion(r.code)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  region === r.code ? 'border-(--demo-primary) bg-(--demo-primary)/5' : 'border-(--demo-border) hover:bg-(--demo-muted)'
                }`}>
                <p className={`text-xs font-medium ${region === r.code ? 'text-(--demo-primary)' : ''}`}>{r.city}, {r.country}</p>
                <p className="text-[10px] text-(--demo-muted-fg)">{r.code}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-(--demo-muted) p-4 text-xs text-(--demo-muted-fg)">
          <div className="mb-2 flex items-center gap-2">
            <Shield size={14} /> <span className="font-medium text-(--demo-fg)">Secure upload</span>
          </div>
          <p>Encrypted in transit with TLS 1.3</p>
          <p className="mt-1">No egress fees - ever</p>
        </div>
      </div>
    </div>
  );
}
