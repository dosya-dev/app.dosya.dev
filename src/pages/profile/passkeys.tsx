import { useState, useEffect, useCallback } from 'react';
import {
  browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import { req } from '@/api/req';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { KeyRound, Loader2, Pencil, Trash2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import { formatDate } from '@/lib/format-locale';
import { isPasskeyCeremonyCancelled } from '@/lib/passkey-sign-in';
import { richText } from '@/lib/rich-text';
import { SectionSkeleton, SettingRow, type Passkey, type PasskeyProof } from './shared';

const MAX_NAME_LENGTH = 60;

/** A starting name for a new passkey. Product names, so they stay in English. */
export function defaultPasskeyName(ua: string = navigator.userAgent, touchPoints: number = navigator.maxTouchPoints): string | null {
  if (/iPhone/.test(ua)) return 'iPhone';
  // iPadOS Safari reports itself as a Mac; only the touch screen gives it away.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

export function PasskeysSection() {
  const t = useT();
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [proof, setProof] = useState<PasskeyProof>(null);
  const [supported] = useState(() => browserSupportsWebAuthn());
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);

  const load = useCallback(async () => {
    const res = await req<{ ok: boolean; passkeys: Passkey[]; proof: PasskeyProof; error?: string }>('/api/me/passkeys');
    if (res.ok) { setPasskeys(res.passkeys ?? []); setProof(res.proof ?? null); }
    else { setPasskeys((p) => p ?? []); toast.error(t('profile.error.yourPasskeysCouldNotBeLoaded'), res.error); }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  // The code goes out from this click, not an effect on the dialog opening, so
  // a re-render can never mail a second one.
  const startAdding = async () => {
    if (proof === 'code') {
      setStarting(true);
      const res = await req('/api/me/passkeys/code', { method: 'POST' });
      setStarting(false);
      if (!res.ok) { toast.error(t('profile.error.theConfirmationCodeCouldNotBeSent'), res.error); return; }
    }
    setAdding(true);
  };

  if (passkeys === null) return <SectionSkeleton />;

  return (
    <section id="section-passkeys">
      <h2 className="text-base font-semibold mb-3">{t('profile.heading.passkeys')}</h2>
      <Card>
        <CardContent className="divide-y">
          <SettingRow label={t('profile.heading.passkeys')} desc={t('profile.description.aPasskeySignsYouInWithoutAPasswordOr2faCodeTheVaultStillUsesItsOwnPassphrase')}>
            <Button variant="outline" size="sm" className="text-xs gap-1" onClick={startAdding} disabled={!supported || !proof || starting}>
              {starting ? <Loader2 className="size-3 animate-spin" /> : <KeyRound className="size-3" />} {t('profile.action.newPasskey')}
            </Button>
          </SettingRow>
          {!supported && (
            <p role="alert" className="py-4 text-xs text-muted-foreground">{t('sign-in.error.thisBrowserDoesNotSupportPasskeys')}</p>
          )}
          {passkeys.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('profile.label.noPasskeysYet')}</p>
          ) : passkeys.map((p) => (
            <SettingRow
              key={p.id}
              label={p.name}
              badge={p.backed_up ? <Badge variant="secondary" className="text-[10px]">{t('profile.status.synced')}</Badge> : undefined}
              desc={p.last_used_at
                ? t('profile.label.addedAddedLastUsedLastused', { added: formatDate(p.created_at, 'medium'), lastUsed: formatDate(p.last_used_at, 'medium') })
                : t('profile.label.addedAddedNotUsedYet', { added: formatDate(p.created_at, 'medium') })}
            >
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setRenaming(p)}>
                  <Pencil className="size-3" /> {t('common.action.rename')}
                </Button>
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setRemoving(p)}>
                  <Trash2 className="size-3" /> {t('common.remove')}
                </Button>
              </div>
            </SettingRow>
          ))}
        </CardContent>
      </Card>

      {proof && <AddPasskeyModal open={adding} onOpenChange={setAdding} proof={proof} onAdded={load} />}
      <RenamePasskeyModal passkey={renaming} onClose={() => setRenaming(null)} onRenamed={load} />
      <RemovePasskeyModal passkey={removing} onClose={() => setRemoving(null)} onRemoved={load} />
    </section>
  );
}

export interface PasskeyCeremony { token: string; options: PublicKeyCredentialCreationOptionsJSON }

export function AddPasskeyModal({ open, onOpenChange, proof, onAdded, initialCeremony }: {
  open: boolean; onOpenChange: (v: boolean) => void; proof: 'password' | 'code'; onAdded: () => void;
  /** Already proven, so the dialog starts at naming the passkey. */
  initialCeremony?: PasskeyCeremony;
}) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [ceremony, setCeremony] = useState<PasskeyCeremony | null>(null);

  useEffect(() => {
    if (open) { setName(defaultPasskeyName() ?? t('profile.label.passkey')); if (initialCeremony) setCeremony(initialCeremony); }
    else { setPassword(''); setCode(''); setCeremony(null); }
  }, [open, t, initialCeremony]);

  const proofReady = proof === 'password' ? password.length > 0 : code.length === 6;

  const confirmProof = async () => {
    if (!proofReady) return;
    setBusy(true);
    const res = await req<{ ok: boolean; challenge_token?: string; options?: PublicKeyCredentialCreationOptionsJSON; error?: string }>('/api/me/passkeys/options', {
      method: 'POST', body: JSON.stringify(proof === 'password' ? { password } : { code }),
    });
    if (res.ok && res.challenge_token && res.options) {
      setCeremony({ token: res.challenge_token, options: res.options });
      setPassword(''); setCode('');
    } else toast.error(t('common.error.verificationFailed'), res.error ?? t('profile.error.thePasskeyCouldNotBeAdded'));
    setBusy(false);
  };

  // A step of its own, so the OS prompt opens straight from a click: Safari
  // refuses a ceremony that is too far from one, and checking a password first
  // can take that long. It also means a cancelled prompt costs nothing, as the
  // challenge and the already-spent emailed code are still good for a retry.
  const create = async () => {
    if (!ceremony || !name.trim()) return;
    setBusy(true);
    let response: Awaited<ReturnType<typeof startRegistration>>;
    try {
      response = await startRegistration({ optionsJSON: ceremony.options });
    } catch (e) {
      setBusy(false);
      if (isPasskeyCeremonyCancelled(e)) return;
      toast.error(
        t('common.error.updateFailed'),
        (e as { name?: unknown } | null)?.name === 'InvalidStateError'
          ? t('profile.error.thisDeviceAlreadyHasAPasskeyForYourAccount')
          : t('profile.error.thePasskeyCouldNotBeAdded'),
      );
      return;
    }
    const res = await req('/api/me/passkeys', {
      method: 'POST', body: JSON.stringify({ challenge_token: ceremony.token, response, name: name.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(t('profile.feedback.passkeyAdded'), t('profile.feedback.youCanNowSignInWithThisPasskey'));
      onOpenChange(false);
      onAdded();
    } else {
      toast.error(t('common.error.updateFailed'), res.error ?? t('profile.error.thePasskeyCouldNotBeAdded'));
      // The API spent the challenge on that attempt, so the owner has to prove
      // themselves again rather than retry a request that can only say expired.
      if (initialCeremony) onOpenChange(false);
      else setCeremony(null);
    }
  };

  const resend = async () => {
    setResending(true);
    const res = await req('/api/me/passkeys/code', { method: 'POST' });
    if (res.ok) toast.success(t('profile.feedback.checkYourInboxForThe6DigitCode'));
    else toast.error(t('profile.error.theConfirmationCodeCouldNotBeSent'), res.error);
    setResending(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('profile.heading.newPasskey')}</DialogTitle></DialogHeader>
        {ceremony ? (
          <>
            <p className="text-xs text-muted-foreground">{t('profile.description.nameThisPasskeySoYouCanRecognizeItThenCreateIt')}</p>
            <Input
              aria-label={t('common.label.name')}
              dir="auto"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              className="h-9 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t('common.cancel')}</Button>
              <Button onClick={create} disabled={busy || !name.trim()}>
                {busy ? <Loader2 className="size-4 animate-spin me-1.5" /> : null} {t('profile.action.createPasskey')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {proof === 'password' ? (
              <>
                <p className="text-xs text-muted-foreground">{t('profile.description.enterYourPasswordToAddAPasskey')}</p>
                <Input type="password" placeholder={t('profile.placeholder.currentPassword')} value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} className="h-9 text-sm" onKeyDown={(e) => e.key === 'Enter' && confirmProof()} />
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{t('profile.description.weSentA6DigitCodeToYourEmailEnterItToAddAPasskey')}</p>
                <Input
                  value={code}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={t('common.placeholder.6DigitCode')} inputMode="numeric" autoComplete="one-time-code"
                  className="h-9 text-sm text-center tracking-[6px] font-semibold"
                  onKeyDown={(e) => e.key === 'Enter' && confirmProof()}
                />
                <button type="button" onClick={resend} disabled={resending} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50">
                  {t('common.action.resendCode')}
                </button>
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t('common.cancel')}</Button>
              <Button onClick={confirmProof} disabled={busy || !proofReady}>
                {busy ? <Loader2 className="size-4 animate-spin me-1.5" /> : null} {t('common.continue')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenamePasskeyModal({ passkey, onClose, onRenamed }: { passkey: Passkey | null; onClose: () => void; onRenamed: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (passkey) setName(passkey.name); }, [passkey]);

  const save = async () => {
    if (!passkey || !name.trim()) return;
    setBusy(true);
    const res = await req(`/api/me/passkeys/${encodeURIComponent(passkey.id)}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
    if (res.ok) { toast.success(t('profile.feedback.passkeyRenamed')); onClose(); onRenamed(); }
    else toast.error(t('common.error.updateFailed'), res.error ?? t('profile.error.thePasskeyCouldNotBeRenamed'));
    setBusy(false);
  };

  return (
    <Dialog open={passkey !== null} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('profile.heading.renamePasskey')}</DialogTitle></DialogHeader>
        <Input
          aria-label={t('common.label.name')}
          dir="auto"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          className="h-9 text-sm"
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin me-1.5" /> : null} {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemovePasskeyModal({ passkey, onClose, onRemoved }: { passkey: Passkey | null; onClose: () => void; onRemoved: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!passkey) return;
    setBusy(true);
    const res = await req(`/api/me/passkeys/${encodeURIComponent(passkey.id)}`, { method: 'DELETE' });
    if (res.ok) { toast.success(t('profile.feedback.passkeyRemoved')); onClose(); onRemoved(); }
    else toast.error(t('common.error.updateFailed'), res.error ?? t('profile.error.thePasskeyCouldNotBeRemoved'));
    setBusy(false);
  };

  return (
    <Dialog open={passkey !== null} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('common.heading.areYouSure')}</DialogTitle>
          <DialogDescription className="break-words">
            {richText(t('profile.description.youAreRemovingNameItWillNoLongerBeAbleToSignInToYourAccount'), { name: <strong dir="auto">{passkey?.name}</strong> })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={remove} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin me-1.5" /> : null} {t('common.remove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
