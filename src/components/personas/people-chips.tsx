// "In this photo": the people this device's Personas found in one photo
// (engine.peopleInFile), as chips linking to each persona page. Nothing is
// asked of a server: the engine answers from the decrypted index. The engine
// is loaded on demand, so the viewer (main bundle) does not carry it. Shown
// only while Personas is ready; off, locked, signed out or a failure hide
// the row. It follows the index: a rename elsewhere shows at once.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import type { Box, PersonasEngine } from '@dosya-dev/personas-engine';
import { FaceAvatar } from '@/components/personas/face-avatar';
import { useT } from '@/lib/i18n';
import { personaHref } from '@/lib/personas';

type Chip = { persona_id: string; name: string | null; box: Box };

/** One chip per shown persona (a persona can have two faces in a photo); faces of no shown persona have no page. */
function chipsOf(engine: PersonasEngine, fileId: string): Chip[] {
  const seen = new Set<string>();
  const out: Chip[] = [];
  for (const f of engine.peopleInFile(fileId)) {
    if (!f.persona_id || seen.has(f.persona_id)) continue;
    seen.add(f.persona_id);
    out.push({ persona_id: f.persona_id, name: f.name, box: f.box });
  }
  return out;
}

export function PeopleChips({ wsId, fileId }: { wsId: string; fileId: string }) {
  const t = useT();
  // The viewer can be mounted outside a router (tests, embeds): plain links then.
  const routed = useInRouterContext();
  const [people, setPeople] = useState<{ fileId: string; list: Chip[] } | null>(null);

  useEffect(() => {
    if (!wsId) return;
    let cancelled = false;
    let unsubscribe = () => {};
    const show = (list: Chip[]) => { if (!cancelled) setPeople({ fileId, list }); };
    void (async () => {
      let engine: PersonasEngine;
      try {
        engine = (await import('@/lib/personas-device/engine-host')).personasEngine(wsId);
      } catch {
        show([]);
        return;
      }
      const update = async () => {
        try {
          const st = await engine.status();
          show(st.state === 'ready' ? chipsOf(engine, fileId) : []);
        } catch {
          show([]);
        }
      };
      if (cancelled) return;
      unsubscribe = engine.subscribe(() => { void update(); });
      await update();
    })();
    return () => { cancelled = true; unsubscribe(); };
  }, [wsId, fileId]);

  if (!people || people.fileId !== fileId || people.list.length === 0) return null;

  return (
    <div className="mt-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{t('personas.label.inThisPhoto')}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {people.list.map((p) => (
          <li key={p.persona_id}>
            <ChipLink routed={routed} to={personaHref(p.persona_id)}>
              <FaceAvatar fileId={fileId} box={p.box} name={p.name} className="size-6" />
              <span className="max-w-32 truncate" dir="auto">{p.name ?? t('personas.label.unnamed')}</span>
            </ChipLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CHIP = 'inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 ps-0.5 pe-2.5 text-xs font-medium hover:bg-muted';

function ChipLink({ routed, to, children }: { routed: boolean; to: string; children: ReactNode }) {
  return routed ? <Link to={to} className={CHIP}>{children}</Link> : <a href={to} className={CHIP}>{children}</a>;
}
