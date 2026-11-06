// /personas and /personas/:personaId, for every signed-in member.
//
// Personas runs on this device (lib/personas-device/engine-host.ts): the
// engine's status picks the screen. off / needs_identity / needs_unlock: the
// first run (first-run.tsx). ready: the progress card over the grid
// (grid.tsx), or one persona on /personas/:personaId (persona.tsx). The page
// re-renders whenever the engine reports a change (a read batch, another
// device's names). The Files sections sidebar stays, as on /map and
// /file-requests, with Personas lit.
import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2, ScanFace, Settings } from 'lucide-react';
import type { PersonasEngine } from '@dosya-dev/personas-engine';
import { FilesSidebar } from '@/components/files-sidebar';
import { PersonasProgressCard } from '@/components/personas/progress-card';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { filterNavParams, groupNavParams } from '@/lib/files-params';
import { useT } from '@/lib/i18n';
import { personasReaderSupported, usePersonasEngine } from '@/lib/personas-device/engine-host';
import type { ReadyStatus } from '@/lib/personas-progress';
import { useWorkspace } from '@/stores/workspace';
import { FirstRun } from './first-run';
import { PersonasGrid } from './grid';
import { PersonaView } from './persona';

export default function PersonasPage() {
  const t = useT();
  const navigate = useNavigate();
  const { personaId } = useParams();
  const wsId = useWorkspace((s) => s.activeId);
  const { engine, status, error, refresh } = usePersonasEngine(wsId);

  let body;
  if (!engine || (!status && !error)) {
    body = (
      <div className="flex justify-center py-24" role="status" aria-label={t('common.status.loading')}>
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  } else if (!status) {
    body = (
      <EmptyState
        icon={ScanFace}
        title={t('personas.error.couldNotLoadPersonas')}
        actions={<Button variant="outline" size="sm" onClick={refresh}>{t('common.action.tryAgain')}</Button>}
      />
    );
  } else if (status.state !== 'ready') {
    body = <FirstRun key={wsId} wsId={wsId} state={status.state} engine={engine} />;
  } else if (personaId) {
    body = <PersonaView key={`${wsId}:${personaId}`} wsId={wsId} personaId={personaId} engine={engine} status={status} />;
  } else {
    body = <PersonasOn key={wsId} engine={engine} status={status} />;
  }

  return (
    <div className="flex h-full overflow-hidden">
      <FilesSidebar
        onFilterChange={(filter) => navigate(`/files?${filterNavParams(new URLSearchParams(), filter)}`)}
        onFavouriteClick={() => navigate('/files')}
        onGroupClick={(groupId) => navigate(`/files?${groupNavParams(new URLSearchParams(), groupId)}`)}
      />
      <div className="flex-1 min-w-0 overflow-y-auto">{body}</div>
    </div>
  );
}

/**
 * Personas ready: the progress card (this device's reading) over the grid,
 * named first. `status` is a new object after every engine change, so the
 * list is read from the engine again then.
 */
function PersonasOn({ engine, status }: { engine: PersonasEngine; status: ReadyStatus }) {
  const t = useT();
  const supported = personasReaderSupported();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- status is the engine's change signal
  const personas = useMemo(() => engine.listPersonas(), [engine, status]);
  const reading = supported && !status.paused && (status.total === null || status.read < status.total);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <h1 className="flex-1 min-w-0 text-xl font-semibold tracking-tight">{t('common.label.personas')}</h1>
        <Link to="/personas/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <Settings aria-hidden="true" />
          {t('personas.action.personasSettings')}
        </Link>
      </div>
      <div className="mb-6 empty:hidden">
        <PersonasProgressCard status={status} supported={supported} onPause={(p) => engine.setPaused(p)} />
      </div>
      {personas.length === 0 && !reading && <EmptyState icon={ScanFace} title={t('personas.heading.noPeopleYet')} />}
      {(personas.length > 0 || reading) && <PersonasGrid engine={engine} personas={personas} reading={reading} />}
    </div>
  );
}
