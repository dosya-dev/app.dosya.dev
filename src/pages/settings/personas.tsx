// This member's Personas settings, shown on /personas/settings
// (pages/personas/settings-page.tsx). Personas is each member's own, on their
// own devices, so everything here is about this user in this workspace:
//
// - "Personas in this workspace": on = engine.turnOn. Off asks "Are you
//   sure?" and then engine.turnOff, which deletes the people, names and
//   corrections from all the user's devices.
// - "Read on this device": pause / resume reading in this browser.
// - "Skipped folders": photos under them are never read (engine.skipFolder).
// - "Delete my people in this workspace": the same as switching off.
// - Locked or without a Vault: a line and a link to the Personas page, which
//   has the Vault step.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, X } from 'lucide-react';
import { api } from '@/api/client';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';
import { PERSONAS_PRIVACY_URL } from '@/lib/personas';
import { personasReaderSupported, usePersonasEngine } from '@/lib/personas-device/engine-host';
import { toast } from '@/lib/toast';
import { useSession } from '@/stores/session';
import { clearKeyIfLastWorkspace } from '@/lib/personas-device/wipe';

function Switch({ checked, label, disabled, onClick }: { checked: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`relative w-9 h-5 shrink-0 rounded-full transition-colors ${checked ? 'bg-green-600' : 'bg-muted'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${checked ? 'inset-s-4.5' : 'inset-s-0.5'}`} />
    </button>
  );
}

export function PersonasSection({ wsId }: { wsId: string }) {
  const t = useT();
  const { engine, status, error, refresh } = usePersonasEngine(wsId);
  const [busy, setBusy] = useState<'on' | 'skip' | null>(null);
  const [offOpen, setOffOpen] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [offFailed, setOffFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [folderNames, setFolderNames] = useState<Record<string, string>>({});

  const ready = status?.state === 'ready';
  // Read on every render: the hook re-renders on every engine change.
  const skipped = engine && ready ? engine.skippedFolders() : [];
  const skippedKey = skipped.join(',');

  // Skipped folders are kept as bare ids; names come from GET /api/folders/:id.
  useEffect(() => {
    const missing = skippedKey.split(',').filter((id) => id && !(id in folderNames));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(missing.map(async (id) => {
        try {
          const res = await api<{ ok?: boolean; folder?: { name?: string } }>(`/api/folders/${encodeURIComponent(id)}`);
          return [id, res?.ok && res.folder?.name ? res.folder.name : t('file-requests.label.unknownFolder')] as const;
        } catch {
          return [id, t('file-requests.label.unknownFolder')] as const;
        }
      }));
      if (!cancelled) setFolderNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
    return () => { cancelled = true; };
  }, [skippedKey, folderNames, t]);

  const header = (
    <div className="mb-3">
      <h1 className="text-xl font-semibold tracking-tight">{t('personas.action.personasSettings')}</h1>
      <p className="text-xs text-muted-foreground mt-0.5">{t('personas.description.groupsThePhotosInThisWorkspaceByThePeopleInThem')}</p>
      <p className="mt-1.5">
          <a
            href={PERSONAS_PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80"
          >
            {t('personas.action.howPersonasProtectsYourPrivacy')}
          </a>
      </p>
    </div>
  );
  if (!engine || (!status && !error)) {
    return (
      <>
        {header}
        <div className="flex justify-center py-10" role="status" aria-label={t('common.status.loading')}>
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      </>
    );
  }
  if (!status) {
    return (
      <>
        {header}
        <div className="rounded-xl border bg-card p-5 mb-4 flex flex-wrap items-center gap-4">
          <p role="alert" className="flex-1 basis-72 min-w-0 text-sm text-muted-foreground">{t('personas.error.couldNotLoadPersonas')}</p>
          <Button variant="outline" size="sm" onClick={refresh}>{t('common.action.tryAgain')}</Button>
        </div>
      </>
    );
  }

  if (status.state === 'needs_identity' || status.state === 'needs_unlock') {
    return (
      <>
        {header}
        <div className="rounded-xl border bg-card p-5 mb-4 flex flex-wrap items-center gap-4">
          <p className="flex-1 basis-72 min-w-0 text-sm text-muted-foreground">
            {status.state === 'needs_identity' ? t('personas.description.personasUsesYourVaultPassphrase') : t('personas.description.unlockWithYourVaultPassphrase')}
          </p>
          <Link to="/personas" className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t('personas.action.openPersonas')}</Link>
        </div>
      </>
    );
  }

  const supported = personasReaderSupported();
  const paused = ready && status.paused;

  const turnOn = async () => {
    setBusy('on');
    try {
      await engine.turnOn();
      toast.success(t('settings.feedback.settingsUpdated'));
    } catch {
      toast.error(t('common.error.couldnTSave'), t('personas.error.somethingWentWrongTryAgain'));
    }
    setBusy(null);
  };

  const turnOff = async () => {
    setTurningOff(true);
    setOffFailed(false);
    try {
      await engine.turnOff();
      // The last workspace on this device: its cached key goes too.
      await clearKeyIfLastWorkspace(useSession.getState().user?.id ?? null);
      setOffOpen(false);
      toast.success(t('settings.feedback.settingsUpdated'));
    } catch {
      setOffFailed(true);
    }
    setTurningOff(false);
  };
  const openOff = () => { setOffFailed(false); setOffOpen(true); };

  const skip = async (id: string, on: boolean) => {
    setBusy('skip');
    try {
      await engine.skipFolder(id, on);
    } catch {
      toast.error(t('common.error.couldnTSave'), t('personas.error.somethingWentWrongTryAgain'));
    }
    setBusy(null);
  };
  const addFolder = (id: string | null, name: string) => {
    setPickerOpen(false);
    if (!id || skipped.includes(id)) return;
    if (name) setFolderNames((prev) => ({ ...prev, [id]: name }));
    void skip(id, true);
  };

  return (
    <>
      {header}

      <div className="rounded-xl border bg-card p-5 flex flex-col gap-5 mb-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium">{t('personas.label.personasInThisWorkspace')}</p>
          <Switch
            checked={ready}
            label={t('personas.label.personasInThisWorkspace')}
            disabled={busy !== null}
            onClick={() => (ready ? openOff() : void turnOn())}
          />
        </div>

        {ready && (
          supported ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium">{t('personas.label.readOnThisDevice')}</p>
              <Switch checked={!paused} label={t('personas.label.readOnThisDevice')} onClick={() => engine.setPaused(!paused)} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('personas.description.thisBrowserCantReadPhotos')}</p>
          )
        )}

        {ready && (
          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-medium">{t('personas.label.skippedFolders')}</span>
            <ul className="flex flex-wrap gap-2">
              {skipped.map((id) => {
                const name = folderNames[id] ?? '…';
                return (
                  <li key={id} className="inline-flex items-center gap-1 h-7 rounded-md border ps-2.5 pe-1 text-xs">
                    <span className="truncate max-w-48" dir="auto">{name}</span>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
                      aria-label={t('personas.action.stopSkippingFolder', { folder: name })}
                      disabled={busy !== null}
                      onClick={() => void skip(id, false)}
                    ><X className="size-3" aria-hidden="true" /></button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 h-7 rounded-md border border-dashed px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  disabled={busy !== null}
                  onClick={() => setPickerOpen(true)}
                >
                  {busy === 'skip' ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <Plus className="size-3" aria-hidden="true" />}
                  {t('settings.action.addFolder')}
                </button>
              </li>
            </ul>
          </div>
        )}
      </div>

      {ready && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-card px-5 py-4 flex flex-wrap items-center gap-4">
          <p className="flex-1 basis-72 min-w-0 text-xs text-muted-foreground">{t('personas.description.yourPeopleNamesAndCorrectionsAreDeleted')}</p>
          <Button variant="destructive" size="sm" onClick={openOff}>{t('personas.action.deleteMyPeopleInThisWorkspace')}</Button>
        </div>
      )}

      {pickerOpen && (
        <FolderPickerDialog
          open
          onClose={() => setPickerOpen(false)}
          workspaceId={wsId}
          onSelect={addFolder}
          title={t('personas.label.skippedFolders')}
          confirmLabel={t('settings.action.addFolder')}
        />
      )}

      <Dialog open={offOpen} onOpenChange={(o) => { if (!turningOff) setOffOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('common.heading.areYouSure')}</DialogTitle>
            <DialogDescription className="break-words">{t('personas.description.yourPeopleNamesAndCorrectionsAreDeleted')}</DialogDescription>
          </DialogHeader>
          {offFailed && <p role="alert" className="text-sm text-destructive">{t('personas.error.somethingWentWrongTryAgain')}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOffOpen(false)} disabled={turningOff}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={() => void turnOff()} disabled={turningOff}>
              {turningOff && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t('personas.action.turnOffAndDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
