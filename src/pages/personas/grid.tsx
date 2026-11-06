// The Personas grid (Main.dc.html): named personas first, then the groups
// nobody has named yet, each with "Add a name" (inline rename). The engine
// decides what is shown (≥ 3 faces for an unnamed group, ≥ 1 for a named one).
// While photos are still being read (`reading`), a dashed "More coming" tile
// closes the not-named section (progress-card Reading artboard). A saved name
// reaches the list through the engine's change notice.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus } from 'lucide-react';
import type { PersonasEngine } from '@dosya-dev/personas-engine';
import { FaceAvatar } from '@/components/personas/face-avatar';
import { PersonaNameField } from '@/components/personas/name-field';
import { localDigits } from '@/lib/format-locale';
import { useT } from '@/lib/i18n';
import { personaHref, type PersonaCard } from '@/lib/personas';

export function PersonasGrid({ engine, personas, reading = false, onChanged }: {
  engine: Pick<PersonasEngine, 'rename'>;
  personas: PersonaCard[];
  /** Photos are still being read: a "More coming" tile ends the not-named section. */
  reading?: boolean;
  /** A name was saved. */
  onChanged?: () => void;
}) {
  const t = useT();
  const named = personas.filter((p) => p.name);
  const unnamed = personas.filter((p) => !p.name);

  return (
    <div className="space-y-8">
      {named.length > 0 && (
        <section aria-labelledby="personas-named">
          <h2 id="personas-named" className="text-sm font-semibold mb-3 flex items-center gap-2">
            {t('personas.heading.named')}
            <span className="text-xs font-medium text-muted-foreground">{localDigits(named.length)}</span>
          </h2>
          <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]">
            {named.map((p) => (
              <li key={p.id}>
                <Link
                  to={personaHref(p.id)}
                  className="group flex flex-col items-center gap-2 rounded-xl p-2 text-center hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <FaceAvatar fileId={p.cover_file_id} box={p.cover_box} name={p.name} className="size-24" />
                  <span className="w-full truncate text-sm font-medium" dir="auto">{p.name}</span>
                  <span className="text-xs text-muted-foreground -mt-1.5">{t('personas.label.photoCount', { count: p.photo_count })}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(unnamed.length > 0 || reading) && (
        <section aria-labelledby="personas-unnamed">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="personas-unnamed" className="text-sm font-semibold flex items-center gap-2">
              {t('personas.heading.notNamedYet')}
              {unnamed.length > 0 && <span className="text-xs font-medium text-muted-foreground">{localDigits(unnamed.length)}</span>}
            </h2>
            <span className="text-xs text-muted-foreground">{t('personas.description.addANameToFindThemInSearch')}</span>
          </div>
          <ul className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]">
            {unnamed.map((p) => <UnnamedCard key={p.id} engine={engine} persona={p} onChanged={onChanged} />)}
            {reading && (
              <li data-testid="personas-more-coming" className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-center text-muted-foreground min-h-36">
                <span className="size-18 rounded-full border border-dashed flex items-center justify-center" aria-hidden="true">
                  <Loader2 className="size-5 animate-spin" />
                </span>
                <span className="text-xs">{t('personas.label.moreComing')}</span>
              </li>
            )}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">{t('personas.description.aFaceNeedsToAppearInAtLeastThreePhotos')}</p>
        </section>
      )}
    </div>
  );
}

function UnnamedCard({ engine, persona: p, onChanged }: { engine: Pick<PersonasEngine, 'rename'>; persona: PersonaCard; onChanged?: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex flex-col items-center gap-2 rounded-xl border bg-card p-3 text-center">
      <Link to={personaHref(p.id)} className="rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <FaceAvatar fileId={p.cover_file_id} box={p.cover_box} name={null} className="size-18" />
      </Link>
      <span className="text-xs text-muted-foreground">{t('personas.label.photoCount', { count: p.photo_count })}</span>
      {editing ? (
        <PersonaNameField
          engine={engine}
          personaId={p.id}
          initial=""
          onSaved={() => { setEditing(false); onChanged?.(); }}
          onCancel={() => setEditing(false)}
          className="w-full"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {t('personas.action.addAName')}
        </button>
      )}
    </li>
  );
}
