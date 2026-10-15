import { useEffect, useState, type JSX } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Users, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { ApiError, apiErrorMessage } from '@/api/client';
import { previewFamilyJoin, acceptFamilyJoin, type FamilyJoinPreview } from '@/api/family';
import { PublicNav } from '@/components/public-nav';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { rememberPostAuthPath } from '@/lib/post-auth-path';
import { cn } from '@/lib/utils';

type State =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  | { kind: 'missing' }
  | { kind: 'preview'; data: FamilyJoinPreview }
  | { kind: 'accepted'; planName: string }
  | { kind: 'error'; message: string };

/**
 * /family/join/:token. Public shell like /redeem: the API gates preview and
 * accept on a cookie session, so a signed-out visitor is sent to sign in. The
 * page is remembered (post-auth path) so signing in returns here, and the
 * emailed link stays valid for 7 days either way.
 */
export default function FamilyJoinPage() {
  const { token = '' } = useParams();
  const location = useLocation();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    previewFamilyJoin(token)
      .then((data) => { if (!cancelled) setState({ kind: 'preview', data }); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) setState({ kind: 'signed_out' });
        else if (e instanceof ApiError && e.status === 404) setState({ kind: 'missing' });
        else setState({ kind: 'error', message: apiErrorMessage(e, 'Could not load this invitation') });
      });
    return () => { cancelled = true; };
  }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      const r = await acceptFamilyJoin(token);
      setState({ kind: 'accepted', planName: r.plan.name });
    } catch (e) {
      setState({ kind: 'error', message: apiErrorMessage(e, 'Could not accept the invitation') });
    } finally { setBusy(false); }
  };

  let body: JSX.Element;
  switch (state.kind) {
    case 'loading':
      body = <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading invitation</div>;
      break;
    case 'signed_out':
      body = (
        <>
          <h1 className="text-xl font-semibold">Sign in to see this invitation</h1>
          <p className="text-sm text-muted-foreground">Sign in with the address the invitation was sent to. The link in your email stays valid for 7 days.</p>
          <Link to="/login" onClick={() => rememberPostAuthPath(location.pathname)} className={cn(buttonVariants(), 'h-10')}>Sign in</Link>
        </>
      );
      break;
    case 'missing':
      body = <><h1 className="text-xl font-semibold">Invitation not found</h1><p className="text-sm text-muted-foreground">It may have been revoked or already used. Ask the person who invited you to send a new one.</p></>;
      break;
    case 'accepted':
      body = (
        <>
          <CheckCircle2 className="size-8 text-primary" />
          <h1 className="text-xl font-semibold">You are now on the {state.planName} plan</h1>
          <p className="text-sm text-muted-foreground">Your files stay yours. You can see the shared pool and leave at any time from Billing.</p>
          <Link to="/billing" className={cn(buttonVariants(), 'h-10')}>Open Billing</Link>
        </>
      );
      break;
    case 'error':
      body = <><AlertCircle className="size-8 text-destructive" /><h1 className="text-xl font-semibold">Something went wrong</h1><p className="text-sm text-muted-foreground">{state.message}</p></>;
      break;
    case 'preview': {
      const d = state.data;
      body = (
        <>
          <Users className="size-8" />
          <h1 className="text-xl font-semibold">{d.payer.name} invited you to share their {d.plan.name} plan</h1>
          <p className="text-sm text-muted-foreground">
            {d.pool_label} of storage, shared between everyone in the family. You keep your own account and your files stay private.
            Sent to {d.invited_email}.
          </p>
          {d.state === 'expired' && <p className="text-sm text-destructive">This invitation has expired. Ask {d.payer.name} to send a new one.</p>}
          {d.state === 'blocked' && d.block && <p className="text-sm text-destructive">{d.block.message}</p>}
          {d.state === 'ready' && (
            <Button onClick={() => void accept()} disabled={busy} className="h-10">
              {busy ? <Loader2 className="size-4 animate-spin" /> : 'Accept invitation'}
            </Button>
          )}
        </>
      );
      break;
    }
  }

  return (
    <div className="min-h-screen">
      <div className="p-4 sm:p-6 lg:p-8"><PublicNav cta="login" /></div>
      <main className="mx-auto max-w-lg px-4 pb-16">
        <Card className="p-6 sm:p-8 flex flex-col items-start gap-4">{body}</Card>
      </main>
    </div>
  );
}
