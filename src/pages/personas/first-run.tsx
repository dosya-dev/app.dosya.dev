// The Personas first run, for each engine state that is not ready yet:
//
// - off: what Personas does on this device, and "Start reading on this
//   device" (engine.turnOn). Free on every plan; nobody else has to agree.
// - needs_identity: the same text, the Vault line and the Vault setup form
//   (components/e2ee/unlock-gate.tsx). The new Vault identity seals the
//   user's personas key.
// - needs_unlock: the unlock line and the Vault unlock form (passphrase or
//   recovery key). When the Vault is already unlocked in this tab there is
//   nothing to type and Personas opens at once.
//
// After a Vault setup or unlock, unlockPersonas(wsId) hands the identity to
// the engine, which opens (or creates) the personas key and caches it on this
// device; the page then moves on through the engine's status.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { PersonasEngine } from '@dosya-dev/personas-engine';
import { RecoveryKeyDialog, SetupCard, UnlockCard } from '@/components/e2ee/unlock-gate';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { PERSONAS_PRIVACY_URL } from '@/lib/personas';
import { unlockPersonas } from '@/lib/personas-device/engine-host';
import { errorText, useE2ee } from '@/stores/e2ee';

// Five sample people, the same Open Peeps drawings (CC0) as dosya.dev/personas/: decoration only.
const FACES = [
  { name: 'sam', size: 'size-14', tone: 'bg-sky-100' },
  { name: 'taylor', size: 'size-16', tone: 'bg-rose-100' },
  { name: 'alex', size: 'size-20', tone: 'bg-emerald-100' },
  { name: 'jordan', size: 'size-16', tone: 'bg-amber-100' },
  { name: 'morgan', size: 'size-14', tone: 'bg-violet-100' },
];

export type FirstRunState = 'off' | 'needs_identity' | 'needs_unlock';

export function FirstRun({ wsId, state, engine }: {
  wsId: string;
  state: FirstRunState;
  engine: Pick<PersonasEngine, 'turnOn'>;
}) {
  const t = useT();
  return (
    <div className="px-4 sm:px-8 pt-12 pb-16 flex justify-center">
      <div className="w-full max-w-140 flex flex-col items-center gap-6 text-center">
        <div aria-hidden="true" className="flex items-center ps-3">
          {FACES.map((f) => (
            <img key={f.name} src={`/personas/${f.name}.svg`} alt="" className={`${f.size} ${f.tone} -ms-3 rounded-full border-3 border-background`} />
          ))}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{t('personas.heading.findPeopleInYourPhotos')}</h1>
        {state !== 'needs_unlock' && (
          <p className="text-base leading-relaxed text-muted-foreground">{t('personas.description.personasReadsFacesOnThisDevice')}</p>
        )}
        <a
          href={PERSONAS_PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80"
        >
          {t('personas.action.howPersonasProtectsYourPrivacy')}
        </a>
        {state === 'off' && <StartReading engine={engine} />}
        {state === 'needs_identity' && <VaultStep wsId={wsId} mode="setup" />}
        {state === 'needs_unlock' && <VaultStep wsId={wsId} mode="unlock" />}
      </div>
      {/* Setup shows the one-time recovery key here too (the /vault page is not mounted). */}
      <RecoveryKeyDialog />
    </div>
  );
}

function StartReading({ engine }: { engine: Pick<PersonasEngine, 'turnOn'> }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const start = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await engine.turnOn();
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <Button size="lg" disabled={busy} onClick={() => void start()}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {t('personas.action.startReadingOnThisDevice')}
      </Button>
      {failed && <p role="alert" className="text-sm text-destructive">{t('personas.error.somethingWentWrongTryAgain')}</p>}
    </div>
  );
}

/**
 * The Vault setup or unlock form, then the hand-over to Personas: as soon as
 * the Vault is unlocked in this tab (just now, or already), unlockPersonas
 * runs once. A failure says so with a retry; the Vault stays unlocked.
 */
function VaultStep({ wsId, mode }: { wsId: string; mode: 'setup' | 'unlock' }) {
  const t = useT();
  const vaultStatus = useE2ee((s) => s.status);
  const error = useE2ee((s) => errorText(s, t));
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  const open = useCallback(async () => {
    setOpening(true);
    setFailed(false);
    try {
      await unlockPersonas(wsId);
    } catch {
      setFailed(true);
    }
    setOpening(false);
  }, [wsId]);

  useEffect(() => {
    if (vaultStatus !== 'unlocked' || started.current) return;
    started.current = true;
    void open();
  }, [vaultStatus, open]);

  const unlocked = vaultStatus === 'unlocked';
  return (
    <div className="w-full max-w-sm flex flex-col items-stretch gap-4 text-start">
      <p className="text-sm leading-normal text-muted-foreground text-center">
        {mode === 'setup' ? t('personas.description.personasUsesYourVaultPassphrase') : t('personas.description.unlockWithYourVaultPassphrase')}
      </p>
      {!unlocked && (mode === 'setup' ? <SetupCard error={error} /> : <UnlockCard error={error} />)}
      {unlocked && opening && (
        <div className="flex justify-center py-4" role="status" aria-label={t('common.status.loading')}>
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      {unlocked && failed && (
        <div className="flex flex-col items-center gap-2">
          <p role="alert" className="text-sm text-destructive">{t('personas.error.somethingWentWrongTryAgain')}</p>
          <Button variant="outline" size="sm" onClick={() => void open()}>{t('common.action.tryAgain')}</Button>
        </div>
      )}
    </div>
  );
}
