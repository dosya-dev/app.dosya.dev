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
import { useT } from '@/lib/i18n';

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
  const t = useT();
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
        else setState({ kind: 'error', message: apiErrorMessage(e, t('family-join.error.couldNotLoadThisInvitation')) });
      });
    return () => { cancelled = true; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      const r = await acceptFamilyJoin(token);
      setState({ kind: 'accepted', planName: r.plan.name });
    } catch (e) {
      setState({ kind: 'error', message: apiErrorMessage(e, t('family-join.error.couldNotAcceptTheInvitation')) });
    } finally { setBusy(false); }
  };

  let body: JSX.Element;
  switch (state.kind) {
    case 'loading':
      body = <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t('family-join.label.loadingInvitation')}</div>;
      break;
    case 'signed_out':
      body = (
        <>
          <h1 className="text-xl font-semibold">{t('family-join.heading.signInToSeeThisInvitation')}</h1>
          <p className="text-sm text-muted-foreground">{t('family-join.description.signInWithTheAddressTheInvitationWasSentToThe')}</p>
          <Link to="/login" onClick={() => rememberPostAuthPath(location.pathname)} className={cn(buttonVariants(), 'h-10')}>{t('common.action.signIn')}</Link>
        </>
      );
      break;
    case 'missing':
      body = <><h1 className="text-xl font-semibold">{t('family-join.heading.invitationNotFound')}</h1><p className="text-sm text-muted-foreground">{t('family-join.description.itMayHaveBeenRevokedOrAlreadyUsedAskThePerson')}</p></>;
      break;
    case 'accepted':
      body = (
        <>
          <CheckCircle2 className="size-8 text-primary" />
          <h1 className="text-xl font-semibold">{t('family-join.heading.youAreNowOnTheStateplannamePlan', { statePlanName: state.planName })}</h1>
          <p className="text-sm text-muted-foreground">{t('family-join.description.yourFilesStayYoursYouCanSeeTheSharedPoolAnd')}</p>
          <Link to="/billing" className={cn(buttonVariants(), 'h-10')}>{t('family-join.action.openBilling')}</Link>
        </>
      );
      break;
    case 'error':
      body = <><AlertCircle className="size-8 text-destructive" /><h1 className="text-xl font-semibold">{t('family-join.heading.somethingWentWrong')}</h1><p dir="auto" className="text-sm text-muted-foreground">{state.message}</p></>;
      break;
    case 'preview': {
      const d = state.data;
      body = (
        <>
          <Users className="size-8" />
          <h1 className="text-xl font-semibold">{t('family-join.heading.payernameInvitedYouToShareTheirPlannamePlan', { payerName: d.payer.name, planName: d.plan.name })}</h1>
          <p className="text-sm text-muted-foreground">
            {t('family-join.description.dpoolLabelOfStorageSharedBetweenEveryoneInTheFamilyYouKeep', { dPool_label: d.pool_label, dInvited_email: d.invited_email })}
          </p>
          {d.state === 'expired' && <p className="text-sm text-destructive">{t('family-join.description.thisInvitationHasExpiredAskPayernameToSendANewOne', { payerName: d.payer.name })}</p>}
          {d.state === 'blocked' && d.block && <p dir="auto" className="text-sm text-destructive">{d.block.message}</p>}
          {d.state === 'ready' && (
            <Button onClick={() => void accept()} disabled={busy} className="h-10">
              {busy ? <Loader2 className="size-4 animate-spin" /> : t('family-join.action.acceptInvitation')}
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
