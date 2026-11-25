// apps/web/src/pages/connect/desktop-passkey.tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { KeyRound, Loader2 } from 'lucide-react';
import { PublicNav } from '@/components/public-nav';
import { Logo } from '@/components/brand/logo';
import { passkeySignInError, signInWithPasskey } from '@/lib/passkey-sign-in';
import { useT } from '@/lib/i18n';

// The same shape POST /api/auth/passkey/verify accepts. Checked here so a bad
// link says so before the person has touched their fingerprint reader.
const DESKTOP_STATE = /^[A-Za-z0-9_-]{16,128}$/;
const DESKTOP_CALLBACK = 'dosya://auth/callback?';

/**
 * /connect/desktop-passkey?state=<nonce> - where the desktop app sends someone
 * to use a passkey, because its own window cannot run the ceremony. Signed out
 * by design: the session token goes to the app in the dosya:// callback and this
 * browser keeps nothing.
 *
 * It waits for a click. The app opens this page by itself, and a passkey prompt
 * nobody asked for is exactly what a person should learn to refuse.
 */
export default function ConnectDesktopPasskeyPage() {
  const t = useT();
  const [params] = useSearchParams();
  const [supported] = useState(() => browserSupportsWebAuthn());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const state = params.get('state') ?? '';
  const complete = DESKTOP_STATE.test(state);

  const signIn = async () => {
    setBusy(true); setError('');
    const result = await signInWithPasskey(state);
    if (result.status !== 'ok') {
      setError(passkeySignInError(result, t));
      setBusy(false);
      return;
    }
    const redirect = result.data.redirect ?? '';
    // This URL carries a live session token, so it only ever goes to the app.
    if (!redirect.startsWith(DESKTOP_CALLBACK)) {
      setError(t('connect-extension.error.theServerReturnedAnUnexpectedCallback'));
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
    window.location.href = redirect;
  };

  return (
    <div className="min-h-screen bg-background">
      <PublicNav />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
        <Logo className="mb-6 h-8" />
        <Card className="w-full">
          <CardContent className="space-y-4 p-6">
            {!complete ? (
              <>
                <h1 className="text-xl font-semibold">{t('connect-extension.heading.thisLinkIsIncomplete')}</h1>
                <p role="alert" className="text-sm text-muted-foreground">{t('sign-in.description.startThePasskeySignInFromTheDosyaDesktopAppAgain')}</p>
              </>
            ) : done ? (
              <>
                <h1 className="text-xl font-semibold">{t('sign-in.heading.youCanReturnToTheDesktopApp')}</h1>
                <p className="text-sm text-muted-foreground">{t('sign-in.description.youAreSignedInIfTheAppDidNotOpenSwitchBackToIt')}</p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-semibold">{t('sign-in.heading.signInToTheDosyaDesktopApp')}</h1>
                <p className="text-sm text-muted-foreground">{t('sign-in.description.useYourPasskeyHereAndWeWillSendYouBackToTheApp')}</p>
                {error && <p dir="auto" role="alert" className="text-sm text-destructive">{error}</p>}
                {supported ? (
                  <Button onClick={signIn} disabled={busy} className="w-full gap-2">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    {t('sign-in.action.signInWithAPasskey')}
                  </Button>
                ) : (
                  <p role="alert" className="text-sm text-destructive">{t('sign-in.error.thisBrowserDoesNotSupportPasskeys')}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
