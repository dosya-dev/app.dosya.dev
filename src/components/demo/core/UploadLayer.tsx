import { useDemo } from '../engine/demoState';

export function UploadLayer({ dragging, offset = 'bottom-3' }: { dragging: boolean; offset?: string }) {
  const { state } = useDemo();
  return (
    <>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center border-2 border-dashed border-(--demo-primary) bg-(--demo-primary)/10">
          <span className="rounded-lg bg-(--demo-card) px-3 py-1.5 text-xs font-semibold shadow">
            Drop to upload (demo)
          </span>
        </div>
      )}
      {state.uploads.length > 0 && (
        <div className={`absolute ${offset} right-3 z-30 w-60 rounded-xl border border-(--demo-border) bg-(--demo-card) p-2.5 shadow-xl`}>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-(--demo-muted-fg)">Uploading</p>
          {state.uploads.map((u) => (
            <div key={u.id} className="mb-1.5 last:mb-0">
              <div className="flex justify-between gap-2 text-[11px]">
                <span className="truncate">{u.name}</span>
                <span className="shrink-0 tabular-nums text-(--demo-muted-fg)">{Math.round(u.progress)}%</span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-(--demo-muted)">
                <div className="h-full rounded-full bg-(--demo-primary) transition-[width] duration-100"
                  style={{ width: `${u.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
