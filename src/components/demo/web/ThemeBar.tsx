import { DEMO_THEMES } from '../engine/demoData';
import { useDemo } from '../engine/demoState';

// Theme picker shown OUTSIDE the app window so visitors can see the demo (and
// the product) ships multiple themes. Lives inside the DemoProvider so it can
// drive the demo's theme, but sits above the browser chrome.
export function ThemeBar() {
  const { state, dispatch } = useDemo();
  // Hidden when a host page (the tour) supplies its own theme picker that
  // actually changes the real app - showing this one alongside it would be a
  // second, non-functional picker.
  if (!state.showThemeControls) return null;
  return (
    <div className="mx-auto mb-3 flex max-w-5xl flex-wrap items-center justify-center gap-2 px-1">
      <span className="text-xs font-medium text-muted-foreground">Preview a theme:</span>
      <div className="flex items-center gap-1.5">
        {DEMO_THEMES.map((t) => {
          const active = state.theme === t.id;
          return (
            <button key={t.id} title={t.label} aria-label={`Theme ${t.label}`}
              aria-pressed={active}
              onClick={() => dispatch({ type: 'SET_THEME', theme: t.id })}
              // Every swatch keeps a ring in its *unselected* state too. The
              // old `border-black/10` was invisible on the dark theme, so the
              // near-black swatches (Mono #242424, Vercel #111111) read as a
              // gap in the row rather than as pickable colors. ring-offset
              // paints the gap in the page background, so the outline stays
              // legible whichever theme is behind it.
              className={`size-6 rounded-full transition-transform hover:scale-110 ring-offset-2 ring-offset-background ${
                active
                  ? 'ring-2 ring-foreground'
                  : 'ring-1 ring-foreground/30 hover:ring-foreground/60'
              }`}
              style={{ background: t.swatch }} />
          );
        })}
      </div>
    </div>
  );
}
