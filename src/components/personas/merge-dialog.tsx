// "Merge with <name>" (Merge.dc.html): pick another persona that is the same
// person. The engine keeps the named side's name and cover when exactly one
// side is named (R25), so the copy says the target keeps them only when the
// target has a name. Neutral wording, no pronouns (R55). The list and the
// merge are this device's engine (journaled for the user's other devices).
import { useMemo, useState } from 'react';
import type { PersonasEngine } from '@dosya-dev/personas-engine';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FaceAvatar } from '@/components/personas/face-avatar';
import { useT } from '@/lib/i18n';
import type { PersonaCard } from '@/lib/personas';
import { cn } from '@/lib/utils';

export function MergeDialog({ open, engine, target, onClose, onMerged }: {
  open: boolean;
  engine: Pick<PersonasEngine, 'listPersonas' | 'merge'>;
  target: PersonaCard;
  onClose: () => void;
  /** Called with the surviving persona id. */
  onMerged: (survivorId: string) => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [failed, setFailed] = useState(false);
  // Each opening starts with nothing picked and no error.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) { setPicked(null); setFailed(false); }
  }
  const options = useMemo(
    () => (open ? engine.listPersonas().filter((p) => p.id !== target.id) : []),
    [open, engine, target.id],
  );

  const merge = async () => {
    if (!picked) return;
    setMerging(true);
    setFailed(false);
    try {
      const survivor = await engine.merge(target.id, picked);
      onMerged(survivor || target.id);
    } catch {
      setFailed(true);
    } finally {
      setMerging(false);
    }
  };

  const name = target.name;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !merging) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{name ? t('personas.heading.mergeWithName', { name }) : t('personas.heading.mergeWithThisPersona')}</DialogTitle>
          <DialogDescription>
            {name ? t('personas.description.pickThePersonaThatIsAlsoName', { name }) : t('personas.description.pickThePersonaThatIsAlsoThisPerson')}
          </DialogDescription>
        </DialogHeader>

        {options.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('personas.description.noOtherPersonasToMerge')}</p>
        )}
        {options.length > 0 && (
          <fieldset className="min-w-0">
            <legend className="sr-only">{t('personas.label.personaToMerge')}</legend>
            <RadioGroup value={picked} onValueChange={(v) => setPicked(v as string)} className="max-h-72 overflow-y-auto gap-1.5">
              {options.map((p) => (
                <label
                  key={p.id}
                  className={cn('flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer hover:bg-muted/50', picked === p.id && 'border-foreground bg-muted/60')}
                >
                  <RadioGroupItem value={p.id} />
                  <FaceAvatar fileId={p.cover_file_id} box={p.cover_box} name={p.name} className="size-9" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" dir="auto">{p.name ?? t('personas.label.unnamed')}</span>
                    <span className="block text-xs text-muted-foreground">{t('personas.label.photoCount', { count: p.photo_count })}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
        )}
        {failed && <p role="alert" className="text-sm text-destructive">{t('personas.error.couldNotMerge')}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={merging}>{t('common.cancel')}</Button>
          <Button onClick={() => void merge()} disabled={!picked || merging}>
            {name ? t('personas.action.mergeIntoName', { name }) : t('personas.action.merge')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
