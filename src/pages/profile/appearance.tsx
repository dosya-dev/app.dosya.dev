import { useState, useEffect } from 'react';
import { req } from '@/api/req';
import { Card, CardContent } from '@/components/ui/card';
import { Check } from 'lucide-react';
import { toast } from '@/lib/toast';
import { THEMES, type Mode } from '@/lib/themes';
import { readCache, writeCache, applyTheme, applyThemeAnimated, subscribeThemeChange, type ThemePref } from '@/lib/theme';

// ── Appearance ─────────────────────────────────────────────

export default function AppearanceSection() {
  const [pref, setPref] = useState<ThemePref>(() => readCache());

  useEffect(() => subscribeThemeChange((next) => setPref(next)), []);

  const save = async (next: ThemePref) => {
    const prev = pref;
    setPref(next);
    applyThemeAnimated(next);
    writeCache(next);
    const res = await req('/api/me/appearance', {
      method: 'PUT', body: JSON.stringify(next),
    });
    if (!res.ok) {
      setPref(prev);
      applyTheme(prev); // instant: a second wipe on a failed save reads as a bug
      writeCache(prev);
      toast.error('Couldn\'t save', res.error ?? 'Your theme could not be saved.');
    }
  };

  const MODES: { value: Mode; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];

  return (
    <section id="section-appearance">
      <h2 className="text-base font-semibold mb-3">Appearance</h2>
      <Card>
        <CardContent className="divide-y">
          <div className="py-4">
            <p className="text-xs font-medium mb-0.5">Mode</p>
            <p className="text-[11px] text-muted-foreground mb-3">Light, dark, or follow your device.</p>
            <div className="inline-flex gap-1 bg-muted rounded-lg p-1">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => save({ ...pref, mode: m.value })}
                  className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    pref.mode === m.value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="py-4">
            <p className="text-xs font-medium mb-0.5">Theme</p>
            <p className="text-[11px] text-muted-foreground mb-3">Applies instantly and saves to your account, so it follows you across devices.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => save({ ...pref, theme: t.id })}
                  className={`text-left rounded-lg border overflow-hidden transition-all ${
                    pref.theme === t.id ? 'ring-2 ring-primary border-transparent' : 'hover:border-foreground/30'
                  }`}
                >
                  <div className="h-11 flex items-center gap-1.5 px-2.5" style={{ background: t.swatch.bg }}>
                    <span className="size-4 rounded" style={{ background: t.swatch.primary }} />
                    <span className="h-1.5 flex-1 max-w-[42px] rounded" style={{ background: t.swatch.accent }} />
                  </div>
                  <div className="px-2.5 py-1.5 text-[11px] font-medium flex items-center justify-between">
                    {t.label}
                    {pref.theme === t.id && <Check className="size-3 text-primary" />}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
