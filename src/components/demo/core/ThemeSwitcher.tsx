import { useState } from 'react';
import { DEMO_THEMES } from '../engine/demoData';
import { useDemo } from '../engine/demoState';
import { IconPalette } from './icons';

export function ThemeSwitcher({ align = 'right', label = false }: { align?: 'left' | 'right'; label?: boolean } = {}) {
  const { state, dispatch } = useDemo();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button aria-label="Demo theme" onClick={() => setOpen((o) => !o)}
        className={label
          ? 'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-(--demo-muted-fg) hover:bg-black/5 hover:text-(--demo-fg)'
          : 'rounded-md p-1.5 text-(--demo-muted-fg) hover:text-(--demo-fg)'}>
        <IconPalette className="size-4" />
        {label && <span>Theme</span>}
      </button>
      {open && (
        <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-8 z-40 flex gap-1.5 rounded-lg border border-(--demo-border) bg-(--demo-card) p-2 shadow-xl`}>
          {DEMO_THEMES.map((t) => (
            <button key={t.id} title={t.label} aria-label={`Theme ${t.label}`}
              onClick={() => { dispatch({ type: 'SET_THEME', theme: t.id }); setOpen(false); }}
              className={`size-5 rounded-full border-2 ${state.theme === t.id ? 'border-(--demo-fg)' : 'border-transparent'}`}
              style={{ background: t.swatch }} />
          ))}
        </div>
      )}
    </div>
  );
}
