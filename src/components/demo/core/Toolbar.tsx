import { breadcrumbs, useDemo } from '../engine/demoState';
import { IconGrid, IconList, IconUpload } from './icons';

export function Toolbar() {
  const { state, dispatch } = useDemo();
  const trail = breadcrumbs(state);
  const viewBtn = (active: boolean) =>
    `rounded-md p-1.5 ${active ? 'bg-(--demo-muted) text-(--demo-fg)' : 'text-(--demo-muted-fg) hover:text-(--demo-fg)'}`;
  return (
    <div className="flex items-center gap-2 border-b border-(--demo-border) px-3 py-2">
      <nav className="flex min-w-0 items-center gap-1 text-xs text-(--demo-muted-fg)" aria-label="Breadcrumbs">
        <button className="hover:text-(--demo-fg)" onClick={() => dispatch({ type: 'NAVIGATE', folderId: null })}>Home</button>
        {trail.map((f) => (
          <span key={f.id} className="flex items-center gap-1">
            <span>/</span>
            <button className="truncate hover:text-(--demo-fg)" onClick={() => dispatch({ type: 'NAVIGATE', folderId: f.id })}>
              {f.name}
            </button>
          </span>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1.5">
        <button aria-label="List view" className={viewBtn(state.view === 'list')} onClick={() => dispatch({ type: 'SET_VIEW', view: 'list' })}>
          <IconList className="size-4" />
        </button>
        <button aria-label="Grid view" className={viewBtn(state.view === 'grid')} onClick={() => dispatch({ type: 'SET_VIEW', view: 'grid' })}>
          <IconGrid className="size-4" />
        </button>
        <button onClick={() => dispatch({ type: 'START_UPLOAD' })}
          className="ml-1 flex items-center gap-1.5 rounded-lg bg-(--demo-primary) px-3 py-1.5 text-xs font-semibold text-(--demo-primary-fg) hover:opacity-90">
          <IconUpload className="size-3.5" /> Upload
        </button>
      </div>
    </div>
  );
}
