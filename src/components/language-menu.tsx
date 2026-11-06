import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { LOCALES, LOCALE_LABELS, localeDir, type Locale } from '@/i18n/locales';
import { useLocale } from '@/lib/i18n';

/**
 * Language menu: the button shows the active language's code, the panel lists
 * every shipped language by its own name in its own script, with no flags
 * (names always read in their own language, so the menu needs no translated
 * words). `variant="field"` is the Profile > Appearance picker: a full-size
 * button naming the language, opening the same scrolling list.
 */
export function LanguageMenu({
  align = 'end',
  variant = 'compact',
}: { align?: 'start' | 'end'; variant?: 'compact' | 'field' } = {}) {
  const field = variant === 'field';
  const [open, setOpen] = useState(false);
  const { locale, setLocale } = useLocale();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The list scrolls; open it with the current language in view.
  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>('[role=menuitemradio][aria-checked=true]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);

  const pick = (id: Locale) => {
    setLocale(id).catch((err) => console.error('[i18n] could not change language:', err));
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className={field ? 'relative inline-block max-w-full' : 'relative'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          field
            ? 'flex min-w-56 max-w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors'
            : 'flex h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
        }
        title={LOCALE_LABELS[locale]}
        aria-label={LOCALE_LABELS[locale]}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={field ? 'language-field-button' : 'language-menu-button'}
      >
        {field ? (
          <>
            {/* Sized to the name so an rtl name still sits at the inline start; truncates in a narrow container. */}
            <span className="lang-name min-w-0 truncate" lang={locale} dir={localeDir(locale)}>{LOCALE_LABELS[locale]}</span>
            <ChevronDown className="ms-auto size-3.5 shrink-0 text-muted-foreground" />
          </>
        ) : (
          <span className="uppercase">{locale}</span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute top-full z-50 mt-1 max-h-[min(70vh,30rem)] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg ${
            align === 'end' ? 'end-0' : 'start-0'
          } ${field ? 'w-full' : 'w-52'}`}
        >
          {LOCALES.map((id) => {
            const active = id === locale;
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => pick(id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm transition-colors hover:bg-muted ${
                  active ? 'font-medium' : ''
                }`}
              >
                {/* The name in its own language and script. Sized to its text, so an rtl
                    name lines up at the inline start with the others. */}
                <span className="lang-name min-w-0 truncate" lang={id} dir={localeDir(id)}>{LOCALE_LABELS[id]}</span>
                {active && <Check className="ms-auto size-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
