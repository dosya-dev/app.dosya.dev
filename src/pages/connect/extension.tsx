// apps/web/src/pages/connect/extension.tsx
import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { humanizeApiError } from '@/api/error-copy';
import { PublicNav } from '@/components/public-nav';
import { Logo } from '@/components/brand/logo';
import { rememberPostAuthPath } from '@/lib/post-auth-path';

const BROWSER_NAMES: Record<string, string> = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari' };

/**
 * Mirrors api/client.ts's apiErrorMessage, read straight from error-copy.ts
 * instead of the client module: this page's test mocks @/api/client down to
 * `{ ApiError, API_BASE, api }` (it stands in for the network, not the error
 * copy), so importing apiErrorMessage from there would resolve to undefined
 * under that mock.
 */
function extensionErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.body) as { error?: string };
      if (parsed.error) return humanizeApiError(parsed.error);
    } catch { /* non-JSON body */ }
    if (err.body && !err.body.trimStart().startsWith('<')) return err.body;
    return `Request failed (${err.status}). Please try again.`;
  }
  return 'Could not connect the extension. Please try again.';
}

/**
 * /connect/extension - the Allow page the "Save to dosya" browser extension
 * opens. The four query fields are the extension's PKCE challenge, its CSRF
 * state and its callback; the API validates every one of them. A signed-out
 * visitor goes through the normal login (2FA, passkeys, social login
 * untouched) and is brought back here by lib/post-auth-path.ts.
 */
export default function ConnectExtensionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const client = params.get('client') ?? '';
  const codeChallenge = params.get('code_challenge') ?? '';
  const state = params.get('state') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const browser = BROWSER_NAMES[client];
  const complete = Boolean(browser && codeChallenge && state && redirectUri);

  const allow = async () => {
    setBusy(true); setError('');
    try {
      const res = await api<{ ok: boolean; redirect: string }>('/api/auth/extension/authorize', {
        method: 'POST',
        body: JSON.stringify({ client, code_challenge: codeChallenge, state, redirect_uri: redirectUri }),
      });
      // The API derives the callback from the redirect_uri in THIS page's query
      // (it refuses any uri not listed exactly), so a redirect that does not
      // extend the one we sent did not come from our request. Navigating to it
      // anyway would make this page an open redirector carrying a live code.
      if (!res.redirect.startsWith(redirectUri + '?')) {
        setError('The server returned an unexpected callback');
        setBusy(false);
        return;
      }
      window.location.assign(res.redirect);
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 401) {
        rememberPostAuthPath(`${location.pathname}${location.search}`);
        navigate('/login');
        return;
      }
      setError(extensionErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <PublicNav />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
        <Logo className="mb-6 h-8" />
        <Card className="w-full">
          <CardContent className="space-y-4 p-6">
            {complete ? (
              <>
                <h1 className="text-xl font-semibold">Connect Save to dosya for {browser}</h1>
                <p className="text-sm text-muted-foreground">
                  The extension will be able to, as you:
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  <li>Save files into your folders</li>
                  <li>Create folders</li>
                  <li>Create a share link for a file it saved</li>
                </ul>
                <p className="text-sm text-muted-foreground">
                  It cannot delete, rename or move files, change your account, or manage your team or billing.
                  You can disconnect it any time from Settings, Sessions.
                </p>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button onClick={allow} disabled={busy} className="flex-1">
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Allow
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/')} disabled={busy}>Cancel</Button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-xl font-semibold">This link is incomplete</h1>
                <p className="text-sm text-muted-foreground">
                  Open the sign-in from the Save to dosya extension's popup, not from a bookmark.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
