import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, CheckCircle2, CreditCard, ExternalLink, KeyRound, Loader2, Lock, RefreshCw, Ticket } from 'lucide-react';
import { api, ApiError, apiErrorMessage } from '@/api/client';
import { getBillingStatus, type BillingStatus } from '@/api/billing';
import { PublicNav } from '@/components/public-nav';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  clearRedemptionClaim,
  readRedemptionClaim,
  readRedemptionProvider,
  rememberRedemptionClaim,
  rememberRedemptionProvider,
  type RedemptionProvider,
} from '@/lib/redemption-claim';
import { formatBytes } from '@/lib/billing/cart-math';
import { formatLicenseDate } from '@/lib/license-timeline';
import { cn } from '@/lib/utils';

type Provider = RedemptionProvider;

type Preview = {
  ok: true;
  state: 'ready';
  provider: Provider;
  packageName: string;
  storageBytes: number;
  storageLabel: string;
  interval: 'month' | 'quarter' | 'half_year' | 'year' | 'two_years' | 'unknown' | null;
  endsAt: number | null;
  accountEmail: string;
};

type Activation = {
  ok: true;
  grantId: string;
  provider: Provider;
  packageName: string;
  storageBytes: number;
  contributionBytes: number;
  totalStorageBytes: number;
  interval: Preview['interval'];
  endsAt: number | null;
  alreadyActive: boolean;
};

type Status =
  | { kind: 'source' }
  | { kind: 'manual'; provider: Provider; message?: string }
  | { kind: 'loading'; label: string }
  | { kind: 'auth-required' }
  | { kind: 'verify-required' }
  | { kind: 'ready'; preview: Preview }
  | { kind: 'success'; result: Activation }
  | { kind: 'retryable'; title: string; message: string }
  | { kind: 'terminal'; title: string; message: string };

const SECURING_LABEL = 'Securing your license code';
const CHECKING_LABEL = 'Checking your package';

const PROVIDER_COPY: Record<Provider, {
  name: string; heading: string; body: string; label: string; placeholder: string; help: string; empty: string; held: string; another: string;
}> = {
  gumroad: {
    name: 'Gumroad',
    heading: 'Enter your Gumroad license code',
    body: 'Bought storage on Gumroad? Enter the license code and we add it to your dosya.dev account.',
    label: 'Gumroad license code',
    placeholder: 'XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX',
    help: 'It is on your Gumroad receipt and in your Gumroad library.',
    empty: 'Enter your Gumroad license code to continue.',
    held: 'Gumroad license',
    another: 'Enter another Gumroad license code or contact support.',
  },
  voucher: {
    name: 'Coupon code',
    heading: 'Enter your coupon code',
    body: 'Got a dosya.dev coupon code from a promotion, partner or invitation? Enter it and we add the storage to your account.',
    label: 'Coupon code',
    placeholder: 'DOSYA-XXXX-XXXX-XXXX',
    help: 'Not case sensitive. Dashes are optional.',
    empty: 'Enter your coupon code to continue.',
    held: 'Coupon code',
    another: 'Enter another code or contact support.',
  },
};

const VOUCHER_TERMINAL: Record<string, string> = {
  voucher_invalid: 'This code is not valid',
  voucher_used: 'This code was already used',
  voucher_expired: 'This code can no longer be redeemed',
};

const sourceRowClass = 'flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
const sourceIconClass = 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground';

function errorBody(error: unknown): { code?: string; retryable?: boolean } {
  if (!(error instanceof ApiError)) return {};
  try {
    return JSON.parse(error.body) as { code?: string; retryable?: boolean };
  } catch {
    return {};
  }
}

function intervalLabel(interval: NonNullable<Preview['interval']>): string {
  switch (interval) {
    case 'month': return 'Monthly';
    case 'quarter': return 'Quarterly';
    case 'half_year': return 'Every six months';
    case 'year': return 'Yearly';
    case 'two_years': return 'Every 2 years';
    default: return 'Recurring';
  }
}

async function requestRedemptionIntent(code: string, provider: Provider) {
  const response = await api<{ ok: true; claim: string }>('/api/licenses/redemption-intents', {
    method: 'POST',
    body: JSON.stringify({ provider, code }),
  });
  const stored = rememberRedemptionClaim(response.claim);
  if (!stored) throw new Error('Invalid redemption claim');
  // Kept beside the claim so the copy survives the sign-in round trip.
  rememberRedemptionProvider(provider);
  return stored;
}

export default function RedeemPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [initial] = useState(() => {
    const provider = searchParams.get('provider');
    const code = searchParams.get('code');
    const hadQuery = provider !== null || code !== null;
    const capture: { provider: Provider; code: string } | null =
      hadQuery && (provider === 'gumroad' || provider === 'voucher') && code
        ? { provider, code }
        : null;
    return {
      capture,
      hadQuery,
      invalidCapture: hadQuery && !capture,
      claim: hadQuery ? null : readRedemptionClaim(),
    };
  });
  const [claim, setClaim] = useState<string | null>(initial.claim);
  const [capture, setCapture] = useState(initial.capture);
  const [provider, setProvider] = useState<Provider | null>(
    initial.capture?.provider ?? (initial.claim ? readRedemptionProvider() : null),
  );
  const [sourceMessage, setSourceMessage] = useState(
    initial.invalidCapture ? 'Enter a valid code to continue.' : '',
  );
  const [manualCode, setManualCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  // undefined = not requested yet, null = unavailable (the page still works without it)
  const [billing, setBilling] = useState<BillingStatus | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>(() => {
    if (initial.capture) return { kind: 'loading', label: SECURING_LABEL };
    if (initial.claim) return { kind: 'loading', label: CHECKING_LABEL };
    return { kind: 'source' };
  });

  // The source URL contains a secret. Install the referrer policy before any
  // passive effect can start provider verification.
  useLayoutEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    meta.dataset.redemptionPage = 'true';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  // This is deliberately the first passive effect: remove the secret-bearing
  // history entry before the later capture effect sends the code to the API.
  useEffect(() => {
    if (initial.hadQuery && location.search) navigate('/redeem', { replace: true });
  }, [initial.hadQuery, location.search, navigate]);

  const createIntent = async (code: string, chosen: Provider) => {
    try {
      const stored = await requestRedemptionIntent(code, chosen);
      setManualCode('');
      setCapture(null);
      setClaim(stored);
    } catch (error) {
      setCapture(null);
      setStatus({
        kind: 'manual',
        provider: chosen,
        message: apiErrorMessage(error, 'We could not save this code. Check your connection and try again.'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!capture) return;
    let cancelled = false;
    requestRedemptionIntent(capture.code, capture.provider)
      .then((stored) => {
        if (cancelled) return;
        setCapture(null);
        setClaim(stored);
      })
      .catch((error) => {
        if (cancelled) return;
        setCapture(null);
        setStatus({
          kind: 'manual',
          provider: capture.provider,
          message: apiErrorMessage(error, 'We could not save this code. Check your connection and try again.'),
        });
      });
    // The captured raw code is intentionally consumed once.
    return () => { cancelled = true; };
  }, [capture]);

  useEffect(() => {
    if (!claim) return;
    let cancelled = false;
    api<Preview>(`/api/licenses/redemption-claims/${encodeURIComponent(claim)}`)
      .then((preview) => {
        if (cancelled) return;
        setProvider(preview.provider);
        setStatus({ kind: 'ready', preview });
      })
      .catch((error) => {
        if (cancelled) return;
        const body = errorBody(error);
        if (error instanceof ApiError && error.status === 401) {
          setStatus({ kind: 'auth-required' });
          return;
        }
        if (body.code === 'email_unverified') {
          setStatus({ kind: 'verify-required' });
          return;
        }
        if (body.code === 'redeem_locked') {
          setStatus({ kind: 'retryable', title: 'Too many attempts', message: apiErrorMessage(error, 'Wait a while, then try again.') });
          return;
        }
        if (!(error instanceof ApiError) || body.retryable || error.status >= 500) {
          setStatus({
            kind: 'retryable',
            title: 'Package could not be checked',
            message: apiErrorMessage(error, 'Check your connection and try again.'),
          });
          return;
        }
        clearRedemptionClaim();
        setClaim(null);
        setStatus({
          kind: 'terminal',
          title: terminalTitle(body.code, error.status),
          message: apiErrorMessage(error, PROVIDER_COPY[provider ?? 'gumroad'].another),
        });
      });
    return () => { cancelled = true; };
    // `provider` only picks the fallback copy, so a change to it must not re-run the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim, previewAttempt]);

  // A ready preview proves a signed-in, verified session, so the storage
  // breakdown can be read. It only feeds the side panel; failure is quiet.
  const readyForBilling = status.kind === 'ready' && billing === undefined;
  useEffect(() => {
    if (!readyForBilling) return;
    let cancelled = false;
    getBillingStatus()
      .then((result) => { if (!cancelled) setBilling(result); })
      .catch(() => { if (!cancelled) setBilling(null); });
    return () => { cancelled = true; };
  }, [readyForBilling]);

  const activate = async () => {
    if (!claim) return;
    setSubmitting(true);
    try {
      const result = await api<Activation>(
        `/api/licenses/redemption-claims/${encodeURIComponent(claim)}/activate`,
        { method: 'POST' },
      );
      clearRedemptionClaim();
      setClaim(null);
      setStatus({ kind: 'success', result });
    } catch (error) {
      const body = errorBody(error);
      if (body.code === 'redeem_locked') {
        setStatus({ kind: 'retryable', title: 'Too many attempts', message: apiErrorMessage(error, 'Wait a while, then try again.') });
      } else if (!(error instanceof ApiError) || body.retryable || error.status >= 500) {
        setStatus({
          kind: 'retryable',
          title: 'Package was not added',
          message: apiErrorMessage(error, 'Check your connection and try again.'),
        });
      } else {
        clearRedemptionClaim();
        setClaim(null);
        const fallback = PROVIDER_COPY[provider ?? 'gumroad'].another;
        setStatus({
          kind: 'terminal',
          title: terminalTitle(body.code, error.status),
          message: error.status === 409 && provider !== 'voucher'
            ? 'A Gumroad license can belong to only one dosya.dev account. Contact support if you believe this is yours.'
            : apiErrorMessage(error, fallback),
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitManual = (event: React.FormEvent) => {
    event.preventDefault();
    const chosen = status.kind === 'manual' ? status.provider : provider ?? 'gumroad';
    if (!manualCode.trim()) {
      setStatus({ kind: 'manual', provider: chosen, message: PROVIDER_COPY[chosen].empty });
      return;
    }
    setSubmitting(true);
    setStatus({ kind: 'loading', label: SECURING_LABEL });
    void createIntent(manualCode, chosen);
  };

  const chooseSource = (chosen: Provider) => {
    setSourceMessage('');
    setManualCode('');
    setProvider(chosen);
    setStatus({ kind: 'manual', provider: chosen });
  };

  const backToSource = () => {
    setSourceMessage('');
    setManualCode('');
    setProvider(null);
    setStatus({ kind: 'source' });
  };

  const retryPreview = () => {
    setStatus({ kind: 'loading', label: CHECKING_LABEL });
    setPreviewAttempt((attempt) => attempt + 1);
  };

  const startOver = () => {
    clearRedemptionClaim();
    setClaim(null);
    backToSource();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ backgroundImage: 'url(/grid.svg)', backgroundRepeat: 'repeat' }}>
      <div className="p-4 sm:p-6 lg:p-8"><PublicNav cta="login" /></div>
      <main className="flex flex-1 items-start justify-center p-4 pb-10 sm:items-center sm:pb-16">
        <Card className="w-full max-w-4xl gap-0 overflow-hidden py-0">
          <StepRail status={status} providerName={provider ? PROVIDER_COPY[provider].name : null} />
          <div className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <section className="px-5 py-7 sm:px-8 sm:py-9" aria-live="polite" aria-atomic="true">
              {status.kind === 'loading' && <LoadingState label={status.label} />}

              {status.kind === 'source' && (
                <div className="space-y-6">
                  <Heading
                    title="Where did you get your code?"
                    body="Pick the source and we ask for the matching code on the next step."
                  />
                  {sourceMessage ? <Notice tone="error" title={sourceMessage} /> : null}
                  <ul className="divide-y overflow-hidden rounded-lg border">
                    <li>
                      <button type="button" data-source="gumroad" onClick={() => chooseSource('gumroad')} className={sourceRowClass}>
                        <span className={sourceIconClass}><KeyRound className="size-4" aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-sm font-semibold">Gumroad</span>
                          <span className="block text-xs text-muted-foreground">License code from your receipt or Gumroad library.</span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </button>
                    </li>
                    <li>
                      <button type="button" data-source="voucher" onClick={() => chooseSource('voucher')} className={sourceRowClass}>
                        <span className={sourceIconClass}><Ticket className="size-4" aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-sm font-semibold">Coupon code</span>
                          <span className="block text-xs text-muted-foreground">A dosya.dev code from a promotion, partner or invitation.</span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </button>
                    </li>
                    <li>
                      <Link to="/billing" data-source="billing" className={cn(sourceRowClass, 'bg-muted/40')}>
                        <span className={cn(sourceIconClass, 'border border-dashed bg-transparent')}><CreditCard className="size-4" aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-sm font-semibold">I bought on dosya.dev</span>
                          <span className="block text-xs text-muted-foreground">Plans and add-ons from checkout are already active. Manage them in Billing.</span>
                        </span>
                        <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    </li>
                  </ul>
                </div>
              )}

              {status.kind === 'manual' && (
                <form onSubmit={submitManual} className="space-y-6">
                  <Heading title={PROVIDER_COPY[status.provider].heading} body={PROVIDER_COPY[status.provider].body} />
                  <div className="space-y-2">
                    <Label htmlFor="license-code">{PROVIDER_COPY[status.provider].label}</Label>
                    <Input
                      id="license-code"
                      name="license-code"
                      value={manualCode}
                      onChange={(event) => setManualCode(event.target.value)}
                      placeholder={PROVIDER_COPY[status.provider].placeholder}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-describedby="license-code-help"
                      aria-invalid={status.message ? true : undefined}
                      className="h-11 font-mono text-sm"
                    />
                    <p id="license-code-help" className="text-xs leading-5 text-muted-foreground">
                      {PROVIDER_COPY[status.provider].help}
                    </p>
                  </div>
                  {status.message ? <Notice tone="error" title={status.message} /> : null}
                  <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      The code is swapped for a one-time claim and is not saved in this browser.
                    </p>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                      <Button type="button" variant="ghost" onClick={backToSource} disabled={submitting} className="h-10 w-full text-muted-foreground sm:w-auto">
                        Back
                      </Button>
                      <Button type="submit" disabled={submitting} className="h-10 w-full sm:w-auto">
                        {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                        Continue
                        {!submitting ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
                      </Button>
                    </div>
                  </div>
                </form>
              )}

              {status.kind === 'auth-required' && (
                <div className="space-y-6">
                  <HeldClaim name={PROVIDER_COPY[provider ?? 'gumroad'].held} />
                  <Heading
                    title="Sign in to continue"
                    body={provider === 'voucher'
                      ? 'Sign in to the account that should get the storage. You come back here to review the package.'
                      : 'Sign in to the account that should get the storage. It can use a different email from your Gumroad purchase. You come back here to review the package.'}
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Link to="/login" className={cn(buttonVariants(), 'h-10 w-full sm:w-auto')}>Sign in</Link>
                    <Link to="/sign-up" className={cn(buttonVariants({ variant: 'outline' }), 'h-10 w-full sm:w-auto')}>Create account</Link>
                  </div>
                </div>
              )}

              {status.kind === 'verify-required' && (
                <div className="space-y-6">
                  <HeldClaim name={PROVIDER_COPY[provider ?? 'gumroad'].held} />
                  <Notice
                    tone="error"
                    title="Verify your email first"
                    body={provider === 'voucher'
                      ? 'Your dosya.dev account must be verified before a code can add storage to it.'
                      : 'The license can use a different Gumroad email, but your existing dosya.dev account must be verified.'}
                  />
                  <Link to="/verify" className={cn(buttonVariants(), 'h-10 w-full sm:w-auto')}>Verify email</Link>
                </div>
              )}

              {status.kind === 'ready' && (
                <div className="space-y-6">
                  <Heading
                    title={`Add ${status.preview.packageName}?`}
                    body="Check the details, then accept to add the storage to this account."
                  />
                  <dl className="divide-y rounded-lg border">
                    <Detail label="Package" value={status.preview.packageName} detail={PROVIDER_COPY[status.preview.provider].name} />
                    <Detail
                      label="Adds"
                      value={`+${status.preview.storageLabel}`}
                      detail={status.preview.provider === 'voucher'
                        ? (status.preview.endsAt ? `Ends ${formatLicenseDate(status.preview.endsAt)}` : 'Does not end')
                        : intervalLabel(status.preview.interval ?? 'unknown')}
                      mono
                    />
                    <Detail label="Account" value={status.preview.accountEmail} detail="Verified" />
                  </dl>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button onClick={activate} disabled={submitting} className="h-10 w-full sm:w-auto">
                      {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
                      Accept package
                    </Button>
                    <Button variant="ghost" onClick={startOver} disabled={submitting} className="h-10 w-full text-muted-foreground sm:w-auto">
                      Use another code
                    </Button>
                  </div>
                </div>
              )}

              {status.kind === 'success' && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                      <Check className="size-3.5" aria-hidden="true" />
                      Package added
                    </span>
                    <Heading
                      title={`${status.result.packageName} is on your account`}
                      body={`${status.result.packageName} adds ${formatBytes(status.result.contributionBytes)}. You now have ${formatBytes(status.result.totalStorageBytes)} total storage.`}
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Link to="/files" className={cn(buttonVariants(), 'h-10 w-full sm:w-auto')}>Open files</Link>
                    <Link to="/billing" className={cn(buttonVariants({ variant: 'outline' }), 'h-10 w-full sm:w-auto')}>View billing</Link>
                    <Button variant="ghost" onClick={startOver} className="h-10 w-full text-muted-foreground sm:w-auto">Redeem another</Button>
                  </div>
                </div>
              )}

              {status.kind === 'retryable' && (
                <div className="space-y-6">
                  <Notice tone="error" title={status.title} body={status.message} />
                  <p className="text-sm leading-6 text-muted-foreground">Your code is still held in this tab, so you do not need to enter it again.</p>
                  <Button onClick={retryPreview} className="h-10 w-full sm:w-auto">
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Try again
                  </Button>
                </div>
              )}

              {status.kind === 'terminal' && (
                <div className="space-y-6">
                  <Notice tone="error" title={status.title} body={status.message} />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="outline" onClick={backToSource} className="h-10 w-full sm:w-auto">Enter another code</Button>
                    <a href="https://dosya.dev/contact?topic=billing" className={cn(buttonVariants({ variant: 'ghost' }), 'h-10 w-full text-muted-foreground sm:w-auto')}>Contact support</a>
                  </div>
                </div>
              )}
            </section>

            <aside className="border-t bg-muted/40 px-5 py-7 sm:px-8 sm:py-9 md:border-l md:border-t-0">
              <StoragePanel status={status} billing={billing} provider={provider} />
            </aside>
          </div>
        </Card>
      </main>
    </div>
  );
}

type StepState = 'todo' | 'current' | 'done' | 'failed';

const STEPS = ['Source', 'Code', 'Account', 'Review', 'Added'] as const;

function terminalTitle(code: string | undefined, httpStatus: number): string {
  if (code && VOUCHER_TERMINAL[code]) return VOUCHER_TERMINAL[code];
  if (code === 'claim_expired') return 'This redemption link has expired';
  return httpStatus === 409 ? 'This code is already linked' : 'This code cannot be redeemed';
}

function stepStates(status: Status, providerName: string | null): { states: StepState[]; notes: string[] } {
  const src = providerName ?? 'Pick one';
  switch (status.kind) {
    case 'source':
      return { states: ['current', 'todo', 'todo', 'todo', 'todo'], notes: ['Pick one', 'Enter it', 'Sign in', 'Confirm', 'Storage live'] };
    case 'manual':
      return { states: ['done', 'current', 'todo', 'todo', 'todo'], notes: [src, 'Enter it', 'Sign in', 'Confirm', 'Storage live'] };
    case 'loading':
      return status.label === SECURING_LABEL
        ? { states: ['done', 'current', 'todo', 'todo', 'todo'], notes: [src, 'Securing', 'Sign in', 'Confirm', 'Storage live'] }
        : { states: ['done', 'done', 'current', 'todo', 'todo'], notes: [src, 'Held', 'Checking', 'Confirm', 'Storage live'] };
    case 'auth-required':
      return { states: ['done', 'done', 'current', 'todo', 'todo'], notes: [src, 'Held', 'Sign in', 'Confirm', 'Storage live'] };
    case 'verify-required':
      return { states: ['done', 'done', 'failed', 'todo', 'todo'], notes: [src, 'Held', 'Verify email', 'Confirm', 'Storage live'] };
    case 'ready':
      return { states: ['done', 'done', 'done', 'current', 'todo'], notes: [src, 'Checked', 'Signed in', 'Confirm', 'Storage live'] };
    case 'success':
      return { states: ['done', 'done', 'done', 'done', 'done'], notes: [src, 'Checked', 'Signed in', 'Accepted', `+${formatBytes(status.result.contributionBytes)}`] };
    case 'retryable':
    case 'terminal':
      return { states: ['done', 'done', 'done', 'failed', 'todo'], notes: [src, 'Checked', 'Signed in', 'Stopped', 'Storage live'] };
  }
}

function StepRail({ status, providerName }: { status: Status; providerName: string | null }) {
  const { states, notes } = stepStates(status, providerName);
  return (
    <ol className="grid grid-cols-2 border-b sm:grid-cols-5" aria-label="Redemption progress">
      {STEPS.map((step, index) => {
        const state = states[index];
        return (
          <li
            key={step}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(
              'relative flex items-center gap-3 px-4 pb-3 pt-3.5 sm:px-5',
              index % 2 === 1 && 'max-sm:border-l',
              index > 0 && 'sm:border-l',
              index >= 2 && 'max-sm:border-t',
              index === 4 && 'max-sm:col-span-2',
              state === 'current' && 'bg-primary/[0.06]',
              state === 'failed' && 'bg-destructive/[0.06]',
            )}
          >
            <span
              className={cn(
                'absolute inset-x-0 top-0 h-[3px]',
                (state === 'done' || state === 'current') && 'bg-primary',
                state === 'failed' && 'bg-destructive',
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums',
                state === 'todo' && 'text-muted-foreground',
                state === 'current' && 'border-primary text-primary',
                state === 'done' && 'border-primary bg-primary text-primary-foreground',
                state === 'failed' && 'border-destructive bg-destructive text-white',
              )}
              aria-hidden="true"
            >
              {state === 'done' ? <Check className="size-3.5" /> : state === 'failed' ? <AlertCircle className="size-3.5" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className={cn('block text-sm font-semibold leading-5', state === 'todo' ? 'text-muted-foreground' : state === 'failed' ? 'text-destructive' : 'text-foreground')}>
                {step}
              </span>
              <span className="block truncate text-xs leading-4 text-muted-foreground">{notes[index]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-[-0.02em] text-balance">{title}</h1>
      <p className="mt-2 max-w-[60ch] text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

function Notice({ tone, title, body }: { tone: 'error'; title: string; body?: string }) {
  return (
    <div role="alert" className={cn('rounded-lg border p-4', tone === 'error' && 'border-destructive/30 bg-destructive/10')}>
      <h2 className="text-[15px] font-semibold text-destructive">{title}</h2>
      {body ? <p className="mt-1.5 text-sm leading-6 text-destructive/90">{body}</p> : null}
    </div>
  );
}

function HeldClaim({ name }: { name: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border bg-muted/50 px-4 py-3">
      <span className="flex items-center gap-2.5 text-sm font-medium">
        <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
        {name}
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
        <Lock className="size-3" aria-hidden="true" />
        Held in this tab
      </span>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="space-y-5" aria-label={label}>
      <div className="space-y-2">
        <Skeleton className="h-7 w-2/3 rounded-md" />
        <Skeleton className="h-4 w-full rounded-md" />
      </div>
      <Skeleton className="h-36 w-full rounded-lg" />
      <Skeleton className="h-10 w-40 rounded-lg" />
      <p className="text-xs text-muted-foreground">{label}...</p>
    </div>
  );
}

function Detail({ label, value, detail, mono = false }: {
  label: string;
  value: string;
  detail: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className={cn('block break-words text-sm font-semibold text-foreground', mono && 'font-mono')}>{value}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </dd>
    </div>
  );
}

type LedgerRow = { label: string; bytes: number; tone: 'plan' | 'packages' | 'new'; badge?: string };

function StoragePanel({ status, billing, provider }: {
  status: Status;
  billing: BillingStatus | null | undefined;
  provider: Provider | null;
}) {
  if (status.kind === 'ready') {
    const pending = status.preview.storageBytes;
    if (!billing) {
      return (
        <Ledger
          eyebrow="This package"
          total={`+${status.preview.storageLabel}`}
          caption={billing === undefined ? 'Loading your current storage...' : 'Your new total appears after you accept.'}
          rows={[{ label: status.preview.packageName, bytes: pending, tone: 'new', badge: 'pending' }]}
          pendingNew
        />
      );
    }
    const limit = billing.usage.limit_bytes;
    const activeGrants = (billing.license_grants ?? []).filter((grant) => grant.contribution_bytes > 0);
    const packages = activeGrants.reduce((sum, grant) => sum + grant.contribution_bytes, 0);
    const rows: LedgerRow[] = [{ label: 'Plan, add-ons and bonuses', bytes: Math.max(limit - packages, 0), tone: 'plan' }];
    if (packages > 0) {
      rows.push({ label: `Redeemed packages (${activeGrants.length})`, bytes: packages, tone: 'packages' });
    }
    rows.push({ label: status.preview.packageName, bytes: pending, tone: 'new', badge: 'pending' });
    return (
      <Ledger
        eyebrow="After you accept"
        total={formatBytes(limit + pending)}
        caption={`Up from ${formatBytes(limit)}. You are using ${billing.usage.used_label}.`}
        rows={rows}
        pendingNew
      />
    );
  }

  if (status.kind === 'success') {
    const { result } = status;
    const rows: LedgerRow[] = [
      { label: 'Plan, add-ons and other packages', bytes: Math.max(result.totalStorageBytes - result.contributionBytes, 0), tone: 'plan' },
      { label: result.packageName, bytes: result.contributionBytes, tone: 'new', badge: result.alreadyActive ? 'already active' : 'added' },
    ];
    return (
      <Ledger
        eyebrow="Your storage now"
        total={formatBytes(result.totalStorageBytes)}
        caption={result.provider === 'voucher'
          ? (result.endsAt ? `Ready to use now. The package stays until ${formatLicenseDate(result.endsAt)}.` : 'Ready to use now. This package does not end.')
          : 'Ready to use now. The package stays while its Gumroad membership is active.'}
        rows={rows}
      />
    );
  }

  if (status.kind === 'auth-required') {
    return (
      <div className="space-y-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">While you sign in</p>
        <ul className="space-y-3 text-sm leading-6">
          <PanelPoint icon={<Lock className="size-4" />} text="Your code stays held in this tab until you finish or close it." />
          <PanelPoint icon={<ArrowRight className="size-4" />} text="After sign-in you land back here with the package ready to review." />
          <PanelPoint icon={<CheckCircle2 className="size-4" />} text="Nothing is added until you accept." />
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">How packages stack</p>
      <StackDiagram />
      <ul className="space-y-3 text-sm leading-6">
        <PanelPoint icon={<Check className="size-4" />} text="Each package adds its storage on top of your plan." />
        <PanelPoint icon={<Check className="size-4" />} text="Different packages add together." />
        <PanelPoint
          icon={<Check className="size-4" />}
          text={provider === 'voucher'
            ? "Storage counts until the code's end date."
            : provider === 'gumroad'
              ? 'Storage counts while the Gumroad membership is active.'
              : 'Storage counts while the package is active.'}
        />
      </ul>
    </div>
  );
}

function PanelPoint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-3 text-muted-foreground">
      <span className="mt-1 shrink-0 text-primary" aria-hidden="true">{icon}</span>
      <span>{text}</span>
    </li>
  );
}

function StackDiagram() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="flex h-3 overflow-hidden rounded-sm border bg-card">
        <span className="h-full w-[45%] bg-chart-2" />
        <span className="h-full w-[25%] bg-chart-2/45" />
        <span className="h-full w-[30%] bg-[repeating-linear-gradient(45deg,var(--primary)_0_4px,transparent_4px_8px)] opacity-70" />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>Plan</span>
        <span>Packages</span>
        <span>This code</span>
      </div>
    </div>
  );
}

function Ledger({ eyebrow, total, caption, rows, pendingNew = false }: {
  eyebrow: string;
  total: string;
  caption: string;
  rows: LedgerRow[];
  pendingNew?: boolean;
}) {
  const sum = rows.reduce((acc, row) => acc + row.bytes, 0) || 1;
  const toneClass = (tone: LedgerRow['tone']) => (
    tone === 'plan' ? 'bg-chart-2' : tone === 'packages' ? 'bg-chart-2/45' : 'bg-primary'
  );
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{eyebrow}</p>
        <p className="mt-2 font-mono text-4xl font-bold leading-none tracking-[-0.03em] tabular-nums">{total}</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{caption}</p>
      </div>
      <div className="flex h-3 overflow-hidden rounded-sm border bg-card" aria-hidden="true">
        {rows.map((row) => (
          <span
            key={row.label}
            className={cn('h-full', toneClass(row.tone), row.tone === 'new' && pendingNew && 'opacity-60')}
            style={{ width: `${(row.bytes / sum) * 100}%` }}
          />
        ))}
      </div>
      <ul className="divide-y text-sm">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3 py-2.5">
            <span className={cn('size-2.5 shrink-0 rounded-[3px]', toneClass(row.tone))} aria-hidden="true" />
            <span className="min-w-0 flex-1 break-words">
              {row.label}
              {row.badge ? (
                <span className="ml-2 inline-flex rounded-full bg-primary/10 px-2 py-0.5 align-middle text-[11px] font-semibold text-primary">{row.badge}</span>
              ) : null}
            </span>
            <span className="shrink-0 font-mono tabular-nums">{row.tone === 'new' ? '+' : ''}{formatBytes(row.bytes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
