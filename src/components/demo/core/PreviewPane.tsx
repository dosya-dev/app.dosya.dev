import { humanSize, KIND_COLORS } from '../engine/demoData';
import { useDemo } from '../engine/demoState';
import { IconFile, IconX } from './icons';

export function PreviewPane({ variant = 'panel' }: { variant?: 'panel' | 'sheet' }) {
  const { state, dispatch } = useDemo();
  const file = state.files.find((f) => f.id === state.previewFileId);
  if (!file) return null;
  // Images open in the full-screen Lightbox instead of this side panel.
  if (file.kind === 'image' && file.thumb) return null;
  const cls = variant === 'panel'
    ? 'w-52 shrink-0 border-l border-(--demo-border) bg-(--demo-card)'
    : 'absolute inset-x-0 bottom-0 z-30 h-2/3 rounded-t-2xl border-t border-(--demo-border) bg-(--demo-card) shadow-2xl';
  return (
    <aside className={`${cls} flex flex-col p-3`} aria-label={`Preview of ${file.name}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold">{file.name}</p>
        <button aria-label="Close preview" onClick={() => dispatch({ type: 'PREVIEW', fileId: null })}
          className="rounded p-1 text-(--demo-muted-fg) hover:text-(--demo-fg)">
          <IconX className="size-3.5" />
        </button>
      </div>
      <div className="mb-3 grid h-24 shrink-0 place-items-center rounded-lg"
        style={{ background: `linear-gradient(135deg, ${KIND_COLORS[file.kind]}33, ${KIND_COLORS[file.kind]}11)` }}>
        <IconFile className="size-8" style={{ color: KIND_COLORS[file.kind] }} />
      </div>
      <dl className="grid grid-cols-[60px_1fr] gap-y-1 text-[11px]">
        <dt className="text-(--demo-muted-fg)">Size</dt><dd>{humanSize(file.sizeBytes)}</dd>
        <dt className="text-(--demo-muted-fg)">Region</dt><dd>{file.region}</dd>
        <dt className="text-(--demo-muted-fg)">Modified</dt><dd>{file.modified}</dd>
        <dt className="text-(--demo-muted-fg)">Sharing</dt><dd>{file.shared ? 'Link active' : 'Private'}</dd>
      </dl>
      <div className="mt-auto flex gap-1.5 pt-3">
        <button onClick={() => dispatch({ type: 'OPEN_SHARE', fileId: file.id })}
          className="flex-1 rounded-lg bg-(--demo-primary) py-1.5 text-[11px] font-semibold text-(--demo-primary-fg) hover:opacity-90">
          Share
        </button>
        <button onClick={() => dispatch({ type: 'TOAST', toast: { text: 'This is a demo - sign up to download for real.', cta: true } })}
          className="flex-1 rounded-lg border border-(--demo-border) py-1.5 text-[11px] font-semibold hover:bg-(--demo-muted)">
          Download
        </button>
      </div>
    </aside>
  );
}
