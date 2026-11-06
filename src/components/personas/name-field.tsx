// Inline name editor for a persona: Enter (or Save) saves through the
// engine's rename (journaled, so the user's other devices get the name),
// Escape cancels. A taken or invalid name keeps the field open with the
// reason under it.
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { PersonasEngine } from '@dosya-dev/personas-engine';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { personasErrorCode } from '@/lib/personas';
import { cn } from '@/lib/utils';

/** Longest name the engine accepts. */
const NAME_MAX = 60;

export function PersonaNameField({ engine, personaId, initial, onSaved, onCancel, className }: {
  engine: Pick<PersonasEngine, 'rename'>;
  personaId: string;
  initial: string;
  onSaved: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const name = value.trim();
    if (!name) { setError(t('personas.error.typeAName')); return; }
    if (name === initial.trim()) { onCancel(); return; }
    setSaving(true);
    setError(null);
    try {
      await engine.rename(personaId, name);
      onSaved();
    } catch (err) {
      const code = personasErrorCode(err);
      setError(
        code === 'name_taken' ? t('personas.error.nameTaken')
          : code === 'name_invalid' ? t('personas.error.nameInvalid')
          : t('personas.error.couldNotSaveName'),
      );
      setSaving(false);
    }
  };

  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          aria-label={t('personas.label.name')}
          aria-invalid={error ? true : undefined}
          value={value}
          maxLength={NAME_MAX}
          disabled={saving}
          placeholder={t('personas.label.name')}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') { e.preventDefault(); void save(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
          }}
          className="h-7 text-sm"
          dir="auto"
        />
        <button type="button" onClick={() => void save()} disabled={saving} aria-label={t('common.save')} title={t('common.save')}
          className="size-7 shrink-0 rounded-md inline-flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
          <Check className="size-3.5" aria-hidden="true" />
        </button>
        <button type="button" onClick={onCancel} disabled={saving} aria-label={t('common.cancel')} title={t('common.cancel')}
          className="size-7 shrink-0 rounded-md inline-flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
