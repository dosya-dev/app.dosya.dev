import { useState } from 'react';
import { api } from '@/api/client';
import { THEMES } from '@/lib/themes';
import { applyTheme, readCache, writeCache } from '@/lib/theme';

interface ThemeStepProps {
  /** Told the new theme id so the demo preview can restyle with the app. */
  onThemeChange: (themeId: string) => void;
}

/**
 * Theme choice, shown beside a live preview.
 *
 * One click does three things: restyles the real app, persists the choice,
 * and restyles the demo next to it. That last part is why this belongs in the
 * tour rather than buried in settings - the user sees the consequence of the
 * choice while making it.
 *
 * The app's theme ids and the demo's are the same list, so the id passes
 * straight through with no mapping.
 */
export function ThemeStep({ onThemeChange }: ThemeStepProps) {
  const [selected, setSelected] = useState<string>(() => readCache().theme);

  const pick = async (themeId: string) => {
    const pref = { theme: themeId, mode: readCache().mode };
    setSelected(themeId);
    applyTheme(pref);
    writeCache(pref);
    onThemeChange(themeId);

    // Optimistic and never reverted. The user chose; a failed write should not
    // yank the app back to a theme they just rejected.
    try {
      await api('/api/me/appearance', {
        method: 'PUT',
        body: JSON.stringify({ theme: pref.theme, mode: pref.mode }),
      });
    } catch { /* the choice stands locally */ }
  };

  return (
    <div>
      <p className="text-sm font-medium mb-1">Pick a theme</p>
      <p className="text-xs text-muted-foreground mb-3">You can change it later in settings.</p>
      <div className="flex flex-wrap items-center gap-2">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.label}
            aria-label={`Theme ${t.label}`}
            data-testid={`tour-theme-${t.id}`}
            data-selected={selected === t.id ? 'true' : 'false'}
            onClick={() => { void pick(t.id); }}
            className={`size-7 rounded-full border transition-transform hover:scale-110 ${
              selected === t.id ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : 'border-black/10'
            }`}
            style={{ background: t.swatch.primary }}
          />
        ))}
      </div>
    </div>
  );
}
