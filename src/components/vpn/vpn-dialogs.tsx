import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { generateDeviceKeys, parseLocalConfig, publicKeyFor } from '@/lib/vpn-config';
import { createDevice, isFailure, type VpnDevice, type VpnLocation, type VpnPlatform } from '@/api/vpn';
import { ProfilePicker } from './vpn-profiles';
import { PLATFORM_CHOICES } from './vpn-parts';

/** The machine reasons the API sends on a refused device creation (open enum). */
function deviceError(t: ReturnType<typeof useT>, reason: string | undefined, fallback: string): string {
  switch (reason) {
    case 'device_limit': return t('vpn.error.deviceLimit');
    case 'duplicate_key': return t('vpn.error.duplicateKey');
    case 'device_churn': return t('vpn.error.deviceChurn');
    case 'pool_exhausted': return t('vpn.error.poolExhausted');
    default: return fallback;
  }
}

/**
 * Add a device. The key pair is made here; only the public key is sent. The
 * private key lives in this component's state and is gone when it closes.
 */
export function AddDeviceDialog({ open, onOpenChange, locations, dns, defaultLocation, onCreated, onScanned }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: VpnLocation[];
  dns: string[];
  defaultLocation: string;
  onCreated: () => void;
  onScanned: (deviceId: string, location: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<VpnPlatform>('ios');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ device: VpnDevice; privateKey: string } | null>(null);
  const [selected, setSelected] = useState(defaultLocation);

  function close(next: boolean) {
    if (!next) { setMade(null); setName(''); setError(null); setBusy(false); }
    onOpenChange(next);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      let keys: { privateKey: string; publicKey: string };
      try {
        keys = await generateDeviceKeys();
      } catch {
        setError(t('vpn.error.browserCannotMakeKey'));
        return;
      }
      const res = await createDevice(name.trim(), keys.publicKey, platform);
      if (isFailure(res)) { setError(deviceError(t, res.reason, res.error)); return; }
      setMade({ device: res.device, privateKey: keys.privateKey });
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        // Once the key exists it cannot be shown again: only the explicit buttons close this step.
        const reason = (details as { reason?: string } | undefined)?.reason;
        if (!next && made && (reason === 'outside-press' || reason === 'escape-key')) return;
        close(next);
      }}
    >
      <DialogContent className="sm:max-w-[640px]" showCloseButton={!made}>
        {!made ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('vpn.heading.addADevice')}</DialogTitle>
              <DialogDescription>{t('vpn.description.addADeviceIntro')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t('vpn.label.deviceName')}
                <Input value={name} maxLength={64} placeholder={t('vpn.label.deviceNameExample')} onChange={(e) => setName(e.target.value)} autoFocus />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t('vpn.label.whatIsIt')}
                <select className="h-[38px] rounded-[10px] border bg-background px-3 text-sm font-normal" value={platform} onChange={(e) => setPlatform(e.target.value as VpnPlatform)}>
                  {PLATFORM_CHOICES.map((c) => <option key={c.value} value={c.value}>{t(c.label)}</option>)}
                </select>
              </label>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>{t('vpn.action.cancel')}</Button>
              <Button disabled={busy || !name.trim()} onClick={create}>{t('vpn.action.create')}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('vpn.heading.addNamedDevice', { name: made.device.name })}</DialogTitle>
              <DialogDescription>{t('vpn.description.scanInstructions')}</DialogDescription>
            </DialogHeader>
            <ProfilePicker privateKey={made.privateKey} device={made.device} locations={locations} dns={dns} selected={selected} onSelect={setSelected} />
            <div className="rounded-xl border bg-muted px-4 py-3 text-sm leading-relaxed">
              <strong className="font-semibold">{t('vpn.label.weCantShowThisAgain')}</strong>{' '}
              {t('vpn.description.keyNeverSentToUs')}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>{t('vpn.action.illDoThisLater')}</Button>
              <Button onClick={() => { onScanned(made.device.id, selected); close(false); }}>{t('vpn.action.iveScannedIt')}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * More locations for an existing device: the user picks one of that device's
 * .conf files. It is read here only, accepted only if its key matches the
 * device, and nothing is uploaded or stored.
 */
export function GetProfilesDialog({ device, onOpenChange, locations, dns, defaultLocation }: {
  device: VpnDevice | null;
  onOpenChange: (open: boolean) => void;
  locations: VpnLocation[];
  dns: string[];
  defaultLocation: string;
}) {
  const t = useT();
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(defaultLocation);

  function close(next: boolean) {
    if (!next) { setPrivateKey(null); setError(null); }
    onOpenChange(next);
  }

  async function pick(file: File | undefined) {
    setError(null);
    if (!file || !device) return;
    const parsed = parseLocalConfig(await readText(file));
    if (!parsed) { setError(t('vpn.error.notAProfile')); return; }
    let pub: string | null = null;
    try { pub = await publicKeyFor(parsed.privateKey); } catch { /* bad key */ }
    // Match on the key, never the address: addresses are reused after a device is removed.
    if (pub !== device.public_key) { setError(t('vpn.error.profileBelongsToAnotherDevice')); return; }
    setPrivateKey(parsed.privateKey);
  }

  return (
    <Dialog open={device !== null} onOpenChange={close}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t('vpn.heading.profilesForDevice', { name: device?.name ?? '' })}</DialogTitle>
          <DialogDescription>{privateKey ? t('vpn.description.scanInstructions') : t('vpn.description.pickAProfileFile')}</DialogDescription>
        </DialogHeader>
        {!privateKey ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('vpn.label.profileFile')}
              <input type="file" accept=".conf,text/plain" data-testid="vpn-conf-input" onChange={(e) => pick(e.target.files?.[0])} className="text-sm" />
            </label>
            <p className="text-sm text-muted-foreground">{t('vpn.description.profileFileStaysOnThisComputer')}</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        ) : (
          device && <ProfilePicker privateKey={privateKey} device={device} locations={locations} dns={dns} selected={selected} onSelect={setSelected} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{t('vpn.action.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Confirm before removing a device (house standard: "Are you sure?"). */
export function ConfirmRemoveDialog({ device, onCancel, onConfirm }: { device: VpnDevice | null; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  return (
    <Dialog open={device !== null} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('vpn.heading.areYouSure')}</DialogTitle>
          <DialogDescription>{t('vpn.description.removeDeviceExplain', { name: device?.name ?? '' })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t('vpn.action.cancel')}</Button>
          <Button variant="destructive" onClick={onConfirm}>{t('vpn.action.remove')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
