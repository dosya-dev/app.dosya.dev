import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  browserSupportsWebAuthn, platformAuthenticatorIsAvailable, type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import { KeyRound, Loader2 } from 'lucide-react';
import { req } from '@/api/req';
import { Button } from '@/components/ui/button';
import { AddPasskeyModal, type PasskeyCeremony } from '@/pages/profile/passkeys';
import { useUploads, uploadSummary } from '@/stores/uploads';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';

type PromptProof = 'password' | 'code' | 'none';

// Where someone has arrived and is not in the middle of something.
const PROMPT_PATHS = new Set(['/', '/files']);

/**
 * The offer to add a passkey, just after a sign-in. The API decides whether it
 * is due, so "Not now" holds across browsers; this only adds what the API cannot
 * see: whether the device can make one, and whether now is a bad moment.
 */
export default function PasskeyPrompt() {
  const t = useT();
  const { pathname } = useLocation();
  const uploading = useUploads((s) => uploadSummary(s.items).anyActive);
  const [proof, setProof] = useState<PromptProof | null>(null);
  const [modalProof, setModalProof] = useState<'password' | 'code'>('password');
  const [ceremony, setCeremony] = useState<PasskeyCeremony | undefined>();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!browserSupportsWebAuthn() || !(await platformAuthenticatorIsAvailable())) return;
      const res = await req<{ ok: boolean; show?: boolean; proof?: PromptProof }>('/api/me/passkeys/prompt');
      if (live && res.ok && res.show && res.proof) setProof(res.proof);
    })();
    return () => { live = false; };
  }, []);

  const add = async () => {
    setBusy(true);
    let needsCode = proof === 'code';
    if (proof === 'none') {
      // The options request is made here, so the dialog's own click opens the
      // device prompt with nothing in between (Safari requires that).
      const res = await req<{ ok: boolean; challenge_token?: string; options?: PublicKeyCredentialCreationOptionsJSON }>('/api/me/passkeys/options', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (res.ok && res.challenge_token && res.options) {
        setCeremony({ token: res.challenge_token, options: res.options });
        setAdding(true);
        setBusy(false);
        return;
      }
      // The sign-in is no longer recent, so this falls back to the emailed code.
      needsCode = true;
    }
    if (needsCode) {
      const res = await req('/api/me/passkeys/code', { method: 'POST' });
      if (!res.ok) { toast.error(t('profile.error.theConfirmationCodeCouldNotBeSent'), res.error); setBusy(false); return; }
    }
    setCeremony(undefined);
    setModalProof(needsCode ? 'code' : 'password');
    setAdding(true);
    setBusy(false);
  };

  const notNow = () => {
    setProof(null);
    void req('/api/me/passkeys/prompt', { method: 'POST' });
  };

  if (!proof) return null;

  return (
    <>
      {PROMPT_PATHS.has(pathname) && !uploading && (
        <div className="flex items-center gap-2 px-4 py-2 border-b" data-testid="passkey-prompt">
          <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs flex-1 min-w-0">{t('profile.description.signInFasterWithYourFaceOrFingerprint')}</p>
          <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={notNow} disabled={busy}>{t('profile.action.notNow')}</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs shrink-0 gap-1" onClick={add} disabled={busy}>
            {busy && <Loader2 className="size-3 animate-spin" />} {t('profile.action.addPasskey')}
          </Button>
        </div>
      )}
      <AddPasskeyModal open={adding} onOpenChange={setAdding} proof={modalProof} initialCeremony={ceremony} onAdded={() => setProof(null)} />
    </>
  );
}
