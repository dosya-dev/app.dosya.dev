import { formatDateWith, formatNumberWith } from '@/lib/format-locale';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { getBillingStatus, syncBilling, type BillingStatus } from '@/api/billing';
import { buttonVariants, Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MsStoreBadge } from '@/components/ms-store-badge';
import { activeTrialEnd, formatBytes, formatGigabytes } from '@/lib/billing/cart-math';
import { INTEGRATIONS, type IntegrationSlug } from '@/lib/integrations';
import { clearStorageBeforePurchase, readStorageBeforePurchase, takeRecentPlanChange } from '@/lib/checkout-return';
import { cn } from '@/lib/utils';
import { t as tNow, useT, currentLocale } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import { tidyText } from '@/lib/billing/catalog-select';
import type { MessageKey } from '@/i18n/keys';

type Card = { brand?: string; last4?: string } | null;

export type CheckoutReceipt = {
  ok: true;
  kind: 'checkout';
  paid: boolean;
  amount: number | null;
  currency: string | null;
  invoice_number: string | null;
  invoice_url: string | null;
  paid_at: number | null;
  email: string | null;
  card: Card;
};

export type ChangeReceipt = {
  ok: true;
  kind: 'change';
  next_amount: number | null;
  currency: string | null;
  next_invoice_at: number | null;
  email: string | null;
  card: Card;
};

type Receipt = CheckoutReceipt | ChangeReceipt;

/** Status polls after the first sync, in case Stripe has not settled yet. */
const MAX_POLLS = 8;
const POLL_MS = 2500;

function money(cents: number | null, currency: string | null): string | null {
  if (cents === null || !currency) return null;
  try {
    return formatNumberWith(cents / 100, { style: 'currency', currency: currency.toUpperCase() }, 'en-US');
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function longDate(unix: number | null): string | null {
  return unix ? formatDateWith(unix, { year: 'numeric', month: 'long', day: 'numeric' }, 'en-US') : null;
}

function cardLabel(card: Card): string | null {
  if (!card?.last4) return null;
  const brand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : tNow('common.label.card');
  return `${brand} •••• ${card.last4}`;
}

const COUNT_MS = 1400;

/**
 * Counts from the storage they had to the storage they bought, so the size of
 * the jump is something you watch rather than read. Starts only once the tab is
 * actually being looked at: a purchase finished in a background tab would
 * otherwise play its one animation to nobody.
 *
 * Honours prefers-reduced-motion, and skips the animation entirely where
 * matchMedia is unavailable (jsdom), so tests read the settled figure.
 */
function useCountUp(from: number, to: number, enabled: boolean): number {
  const [value, setValue] = useState(to);

  useEffect(() => {
    if (!enabled || from >= to) { setValue(to); return; }
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (!media || media.matches) { setValue(to); return; }

    let frame = 0;
    // null, not 0: a first frame timestamp of exactly 0 would otherwise read as
    // "not started yet" and restart the clock on every frame.
    let started: number | null = null;
    const tick = (now: number) => {
      if (started === null) started = now;
      const progress = Math.min(1, (now - started) / COUNT_MS);
      // easeOutExpo: fast at first, then settles onto the real number.
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(from + (to - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    const start = () => { setValue(from); frame = requestAnimationFrame(tick); };
    if (document.visibilityState === 'visible') {
      start();
    } else {
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', onVisible);
        start();
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => { document.removeEventListener('visibilitychange', onVisible); cancelAnimationFrame(frame); };
    }
    return () => cancelAnimationFrame(frame);
  }, [from, to, enabled]);

  return value;
}

/** "2,048 GB" -> ["2,048", "GB"], so the figure and its unit can be set apart. */
function splitSize(bytes: number): [string, string] {
  const parts = formatGigabytes(bytes).split(' ');
  return [parts[0], parts[1] ?? ''];
}

export default function CheckoutSuccessPage() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  // This page is only ever reached one of two ways: back from a Stripe Checkout
  // that just completed, carrying its session id, or straight from a plan change
  // this tab just made. A typed-in URL is neither, and goes to Billing - the
  // session id is checked against the signed-in customer by the API, and the
  // plan-change marker is written by the chooser and consumed once, here.
  const [entry] = useState(() => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session_id');
    const change = params.get('change') === '1' && takeRecentPlanChange();
    return {
      sessionId,
      kind: sessionId ? 'checkout' as const : change ? 'change' as const : null,
      // Read, not taken: StrictMode runs this initializer twice. Cleared below.
      before: readStorageBeforePurchase(),
    };
  });

  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [synced, setSynced] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptFailed, setReceiptFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const polls = useRef(0);

  useEffect(() => { clearStorageBeforePurchase(); }, []);

  // The session id is not a secret on its own, but it has done its job once read.
  // Skipped when there is nothing to show: this effect runs after the redirect
  // below has already fired, and would otherwise navigate straight back here.
  useEffect(() => {
    if (entry.kind && location.search) navigate('/checkout/success', { replace: true });
  }, [entry.kind, location.search, navigate]);

  useEffect(() => {
    if (!entry.kind) return;
    const query = entry.sessionId ? `?session_id=${encodeURIComponent(entry.sessionId)}` : '';
    let cancelled = false;
    api<Receipt>(`/api/billing/receipt${query}`, { cache: 'no-store' })
      .then((result) => { if (!cancelled) setReceipt(result); })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A session id that is not this customer's (or not a session at all)
        // comes back as "not found": there is no purchase to say thank you for.
        if (error instanceof ApiError && (error.status === 404 || error.status === 401 || error.status === 403)) {
          navigate('/billing', { replace: true });
          return;
        }
        // Stripe being unreachable is not the same thing: the purchase happened,
        // so the page stays and says the receipt could not be loaded.
        setReceiptFailed(true);
      });
    return () => { cancelled = true; };
  }, [entry, navigate]);

  // Reconcile from Stripe first (the webhook can lag a redirect by seconds),
  // then read the settled plan. Poll only while the subscription is not there yet.
  useEffect(() => {
    if (!entry.kind) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    polls.current = 0;
    setGaveUp(false);

    const read = () => getBillingStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        if (next.subscription.has_subscription) return;
        if (polls.current >= MAX_POLLS) { setGaveUp(true); return; }
        polls.current += 1;
        timer = setTimeout(() => { void syncBilling().catch(() => {}).finally(read); }, POLL_MS);
      })
      .catch(() => { if (!cancelled) setGaveUp(true); });

    syncBilling().catch(() => {}).finally(() => {
      if (cancelled) return;
      setSynced(true);
      void read();
    });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [entry, attempt]);

  if (!entry.kind) return <Navigate to="/billing" replace />;

  const isChange = entry.kind === 'change';
  const settled = synced && !!status?.subscription.has_subscription;
  const total = status?.usage.limit_bytes ?? 0;
  const added = status && entry.before !== null ? total - entry.before : null;
  const showsAdded = added !== null && added > 0;
  // A change that bought places, or swapped add-ons of equal size, added no
  // storage; calling it "Storage added" would be a lie on the thank-you page.
  const unchanged = isChange && added !== null && added <= 0;
  const target = showsAdded ? added! : total;
  const counted = useCountUp(entry.before ?? 0, target, !!status);
  const [figure, unit] = splitSize(counted);
  const fillShare = target > 0 ? Math.max(0, Math.min(1, counted / target)) : 1;
  // TODO(catalog): the interval word has no lower-case entry: the capitalised label is lowered in the chosen language.
  const planName = status ? `${status.plan.name} · ${t(status.interval === 'year' ? 'common.label.yearly' : 'common.label.monthly').toLocaleLowerCase(currentLocale())}` : null;
  const paymentPending = receipt?.kind === 'checkout' && !receipt.paid;
  // A trial's first invoice is $0. The server marks the subscription active, so
  // the trial shows only through trial_end.
  const trialEnd = activeTrialEnd(status?.subscription);
  const trialStarted = receipt?.kind === 'checkout' && receipt.paid && receipt.amount === 0 && trialEnd !== null;
  const beforeShare = showsAdded && total > 0 ? Math.max(0, Math.min(1, entry.before! / total)) : 0;

  return (
    <div className="mx-auto w-full max-w-6xl pb-16">
      {/* Capacity band */}
      <section className="relative overflow-hidden border-b px-4 pb-8 pt-8 sm:px-6 lg:px-8 lg:pb-12 lg:pt-12">
        <Fireworks active={!!status && showsAdded} />
        {/* Headline left, the figure it is all about on the right. */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <div className="min-w-0">
            <span className="whitespace-nowrap inline-flex items-center gap-1.5 rounded-full border border-green-600/30 bg-green-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-green-700 dark:border-green-400/25 dark:bg-green-500/10 dark:text-green-400">
              <Check className="size-3.5" strokeWidth={2.6} aria-hidden="true" />
              {isChange ? t('checkout-success.label.planUpdated') : trialStarted ? t('checkout-success.label.trialStarted') : t('checkout-success.label.purchaseComplete')}
            </span>

            <h1 className="mt-5 max-w-[18ch] text-balance text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
              <span>{isChange ? t('checkout-success.description.yourPlanIsUpdated') : trialStarted ? t('checkout-success.description.your7DayTrialHasStarted') : t('checkout-success.description.thankYouForYourPurchase')}</span>
              {trialStarted ? null : (
                <>
                  {' '}
                  <span className="text-muted-foreground">{showsAdded ? t('checkout-success.description.hereIsYourNewSpace') : t('checkout-success.description.hereIsYourSpaceNow')}</span>
                </>
              )}
            </h1>
            {trialStarted ? (
              <p className="mt-3 max-w-[48ch] text-base text-muted-foreground sm:text-lg">
                {t('checkout-success.description.youWonTBeChargedUntilTrialendCancelAnyTimeBeforeThen', { trialEnd: longDate(trialEnd) ?? '' })}
              </p>
            ) : null}
          </div>

          {status ? (
            <p
              className="flex shrink-0 items-start font-mono font-bold leading-none tracking-tighter tabular-nums lg:justify-end"
              data-testid="capacity-figure"
            >
              {showsAdded ? <span className="me-1 mt-[0.2em] text-[clamp(1.75rem,6vw,3.5rem)] text-green-600 dark:text-green-400">+</span> : null}
              <span className="text-[clamp(3.25rem,12vw,7rem)]">{figure}</span>
              <span className="ms-2 mt-[0.35em] text-lg font-semibold tracking-normal text-green-600 sm:text-2xl dark:text-green-400">{unit}</span>
            </p>
          ) : (
            <Skeleton className="h-20 w-56 shrink-0 rounded-lg" />
          )}
        </div>

        {status ? (
          <div className="mt-10">
            <div>
              <div
                className="flex h-4 overflow-hidden rounded-full border bg-muted sm:h-5"
                role="img"
                aria-label={showsAdded
                  ? t('checkout-success.accessibility.formattedvalueAddedTotalInTotal', { formattedValue: formatGigabytes(added!), total: formatGigabytes(total) })
                  : t('checkout-success.accessibility.totalInTotal', { total: formatGigabytes(total) })}
              >
                {showsAdded ? <span className="h-full bg-muted-foreground/35" style={{ width: `${beforeShare * 100}%` }} /> : null}
                <span
                  className="checkout-fill h-full flex-1 ltr:origin-left rtl:origin-right"
                  style={{
                    ...(showsAdded ? {} : { background: 'var(--primary)' }),
                    transform: `scaleX(${fillShare})`,
                  }}
                />
              </div>
              <div className="relative mt-2 h-4 font-mono text-[11px] text-muted-foreground tabular-nums sm:text-xs" aria-hidden="true">
                {[0, 0.25, 0.5, 0.75, 1].map((share) => (
                  <span
                    key={share}
                    className={cn(
                      'absolute whitespace-nowrap',
                      share === 0 ? 'inset-s-0' : share === 1 ? 'inset-e-0' : 'ltr:-translate-x-1/2 rtl:translate-x-1/2',
                      share > 0 && share < 1 && 'max-sm:hidden',
                    )}
                    style={share > 0 && share < 1 ? { insetInlineStart: `${share * 100}%` } : undefined}
                  >
                    {share === 0 ? '0' : formatGigabytes(total * share)}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="flex flex-wrap items-center gap-x-5 gap-y-2 text-muted-foreground">
                  {showsAdded ? (
                    <>
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block h-3 w-5 rounded-sm bg-muted-foreground/35" aria-hidden="true" />
                        {t('checkout-success.label.before')} {formatGigabytes(entry.before!)}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="checkout-fill inline-block h-3 w-5 rounded-sm" aria-hidden="true" />
                        {t('checkout-success.label.addedByThis')} {isChange ? t('checkout-success.label.change') : t('checkout-success.label.purchase')}
                      </span>
                    </>
                  ) : (
                    <span>{t('checkout-success.label.yourStorageOnPlanname', { planName: status.plan.name })}</span>
                  )}
                </span>
                <span className="font-mono font-semibold tabular-nums">{t('checkout-success.label.totalTotal', { total: formatGigabytes(total) })}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-10" aria-label={t('checkout-success.accessibility.loadingYourStorage')}>
            <Skeleton className="h-5 w-full rounded-full" />
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-10 px-4 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12 lg:px-8 lg:pt-12">
        {/* Steps */}
        <section aria-labelledby="checkout-steps-title">
          <h2 id="checkout-steps-title" className="sr-only">{t('checkout-success.heading.whatHappensNext')}</h2>
          <ol>
            <Step
              state={paymentPending ? 'current' : 'done'}
              eyebrow={paymentPending ? t('checkout-success.label.processing') : t('common.done')}
              title={isChange ? t('checkout-success.tooltip.planChanged') : paymentPending ? t('checkout-success.tooltip.paymentProcessing') : trialStarted ? t('checkout-success.tooltip.trialStarted') : t('checkout-success.tooltip.paymentReceived')}
            >
              {isChange
                ? t('checkout-success.description.stripeAddsTheProratedDifferenceToYourNextInvoice')
                : paymentPending
                  ? t('checkout-success.description.stripeIsStillConfirmingThePaymentStorageIsAddedAsSoon')
                  : trialStarted
                    ? t('checkout-success.description.youWonTBeChargedUntilTrialend', { trialEnd: longDate(trialEnd) ?? '' })
                  : [planName, longDate(receipt?.kind === 'checkout' ? receipt.paid_at : null)].filter(Boolean).join(' · ') || t('checkout-success.description.yourPaymentWentThrough')}
            </Step>

            <Step
              state={settled ? 'done' : gaveUp ? 'failed' : 'current'}
              eyebrow={settled ? t('common.done') : gaveUp ? t('checkout-success.label.takingLonger') : t('checkout-success.label.inProgress')}
              title={settled ? (unchanged ? t('checkout-success.tooltip.subscriptionUpdated') : t('checkout-success.tooltip.storageAdded')) : (unchanged ? t('checkout-success.tooltip.updatingYourSubscription') : t('checkout-success.tooltip.addingYourStorage'))}
            >
              {settled ? (
                added === 0 ? t('checkout-success.description.yourStorageStaysAtTotal', { total: formatGigabytes(total) }) : t('checkout-success.description.yourAccountNowHasTotalOfStorage', { total: formatGigabytes(total) })
              ) : gaveUp ? (
                <span className="flex flex-col items-start gap-3">
                  <span>{t('checkout-success.description.stripeHasNotConfirmedTheSubscriptionYetItNormallyAppearsWithin')}</span>
                  <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    {t('checkout-success.action.checkAgain')}
                  </Button>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  {t('checkout-success.description.thisUsuallyTakesAFewSeconds')}
                </span>
              )}
            </Step>

            <Step state={settled ? 'current' : 'todo'} eyebrow={t('checkout-success.label.nextStep')} title={t('checkout-success.tooltip.uploadAnything')} last>
              <span className="flex flex-col items-start gap-4">
                <span>
                  {richText(t('checkout-success.description.useTheWebAppOrConnectLink1Link2Link3OrLink4', { link1: '{link1}', link2: '{link2}', link3: '{link3}', link4: '{link4}' }), {
                    link1: <Link className="underline-offset-2 hover:underline" to="/integrations/desktop">{t('checkout-success.action.desktop')}</Link>,
                    link2: <Link className="underline-offset-2 hover:underline" to="/integrations/cli">{t('checkout-success.action.cli')}</Link>,
                    link3: <Link className="underline-offset-2 hover:underline" to="/integrations/webdav">WebDAV</Link>,
                    link4: <Link className="underline-offset-2 hover:underline" to="/integrations/s3">S3</Link>,
                  })}
                </span>
                <span className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <Link to="/files" className={cn(buttonVariants(), 'h-10 w-full sm:w-auto')}>
                    {t('common.action.openFiles')}
                    <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
                  </Link>
                  <Link to="/billing" className={cn(buttonVariants({ variant: 'outline' }), 'h-10 w-full sm:w-auto')}>
                    {t('common.action.viewBilling')}
                  </Link>
                </span>
              </span>
            </Step>
          </ol>
        </section>

        {/* Receipt slip */}
        <aside aria-labelledby="checkout-receipt-title">
          <div className="checkout-slip-wrap">
            <div className="checkout-slip relative rounded-t-xl bg-card px-5 pb-5 pt-5 font-mono text-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 id="checkout-receipt-title" className="text-xs font-semibold uppercase tracking-[0.12em]">
                  {t('checkout-success.heading.ischangeSelectTruePlanChangeOtherOrderReceiptStripe', { isChange: String(isChange) })}
                </h2>
                <span className={trialStarted
                  ? 'rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground'
                  : 'rounded border border-green-600/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-green-700 dark:text-green-400'}>
                  {isChange ? t('checkout-success.label.updated') : trialStarted ? t('checkout-success.label.trial') : paymentPending ? t('common.label.pending') : t('checkout-success.label.paid')}
                </span>
              </div>
              <ReceiptRows receipt={receipt} failed={receiptFailed} status={status} planName={planName} trial={trialStarted} />
            </div>
          </div>
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            {isChange
              ? `${t('checkout-success.description.invoicesAndYourPaymentMethodAreInBilling')} `
              : trialStarted
                ? `${t('checkout-success.description.afterYourTrialPaymentsAreCoveredByOur14DayMoneyBackGuarantee')} `
                : `${t('checkout-success.description.everyPackageIsCoveredByOur14DayMoneyBackGuarantee')} `}
            {receipt?.kind === 'checkout' && receipt.invoice_url ? (
              <a className="inline-flex items-center gap-1 text-foreground underline underline-offset-2" href={receipt.invoice_url} target="_blank" rel="noreferrer">
                {t('checkout-success.action.viewInvoice')} <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            ) : null}
          </p>
        </aside>
      </div>

      <AppsSection />

      <ConnectSection />

      <FaqSection />

      <div className="px-4 pt-10 sm:px-6 lg:px-8">
        <div className="rounded-xl border bg-muted/40 p-5 text-sm text-muted-foreground">
          <SupportLine invoiceNumber={receipt?.kind === 'checkout' ? receipt.invoice_number : null} />
        </div>
      </div>

      <style>{`
        .checkout-fill { background: repeating-linear-gradient(135deg, #16a34a 0 7px, #22c55e 7px 14px); }
        .checkout-slip-wrap { padding-bottom: 10px; filter: drop-shadow(0 0 0.75px var(--border)) drop-shadow(0 2px 3px rgb(0 0 0 / 0.06)); }
        .dark .checkout-slip-wrap { filter: drop-shadow(0 0 0.75px var(--border)) drop-shadow(0 2px 4px rgb(0 0 0 / 0.35)); }
        .checkout-slip::after { content: ""; position: absolute; inset-inline: 0; bottom: -10px; height: 10px;
          background: radial-gradient(circle at 8px 10px, transparent 6.5px, var(--card) 7px) repeat-x; background-size: 16px 10px; }
      `}</style>
    </div>
  );
}

// ── Fireworks ──────────────────────────────────────────────────────────────
//
// Two volleys, one from each side of the band, while the figure counts up. On a
// canvas rather than DOM nodes so a few hundred sparks cost nothing, and gone
// for good once they fade: this is a moment, not an ambient effect.

const BURSTS = [
  { x: 0.13, y: 0.42, delay: 0 },
  { x: 0.87, y: 0.38, delay: 260 },
  { x: 0.22, y: 0.62, delay: 720 },
  { x: 0.78, y: 0.66, delay: 980 },
];
const SPARKS = 46;
const SPARK_LIFE = 1500;
const GRAVITY = 0.00028;
const COLORS = ['#22c55e', '#16a34a', '#4ade80', '#86efac', '#bbf7d0'];

type Spark = { x: number; y: number; vx: number; vy: number; born: number; color: string; size: number };

function Fireworks({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [allowed, setAllowed] = useState(false);

  // Same gate as the count-up: only for someone actually looking, and never
  // for someone who asked for less motion.
  useEffect(() => {
    if (!active) return;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (!media || media.matches) return;
    if (document.visibilityState === 'visible') { setAllowed(true); return; }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      setAllowed(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    // Some environments throw here rather than returning null (jsdom does).
    // Fireworks are decoration: never let them take the page down with them.
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas?.getContext('2d') ?? null;
    } catch {
      return;
    }
    if (!allowed || !canvas || !context) return;
    const ctx = context;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const sparks: Spark[] = [];
    let frame = 0;
    let started: number | null = null;
    let fired = 0;

    const launch = (burst: (typeof BURSTS)[number], now: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      for (let i = 0; i < SPARKS; i++) {
        const angle = (Math.PI * 2 * i) / SPARKS + Math.random() * 0.2;
        const speed = 0.09 + Math.random() * 0.16;
        sparks.push({
          x: burst.x * width,
          y: burst.y * height,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          born: now,
          color: COLORS[i % COLORS.length],
          size: 1.3 + Math.random() * 1.7,
        });
      }
    };

    const tick = (now: number) => {
      if (started === null) started = now;
      const elapsed = now - started;
      while (fired < BURSTS.length && BURSTS[fired].delay <= elapsed) launch(BURSTS[fired++], now);

      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      let alive = false;
      for (const spark of sparks) {
        const age = now - spark.born;
        if (age > SPARK_LIFE) continue;
        alive = true;
        const fade = 1 - age / SPARK_LIFE;
        ctx.globalAlpha = fade * fade;
        ctx.fillStyle = spark.color;
        ctx.beginPath();
        ctx.arc(
          spark.x + spark.vx * age,
          spark.y + spark.vy * age + GRAVITY * age * age,
          spark.size * fade,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (alive || fired < BURSTS.length) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); };
  }, [allowed]);

  if (!allowed) return null;
  return (
    <canvas
      ref={canvasRef}
      data-testid="fireworks"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full"
    />
  );
}

function Step({ state, eyebrow, title, children, last = false }: {
  state: 'done' | 'current' | 'todo' | 'failed';
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <li className="flex gap-4" aria-current={state === 'current' ? 'step' : undefined}>
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full',
            state === 'done' && 'bg-green-600 text-white',
            state === 'current' && 'border-2 border-green-600 bg-background text-green-700 dark:text-green-400',
            state === 'failed' && 'border-2 border-amber-500 bg-background text-amber-600',
            state === 'todo' && 'border bg-background text-muted-foreground',
          )}
          aria-hidden="true"
        >
          {state === 'done' ? <Check className="size-4" strokeWidth={2.8} /> : <span className="size-2 rounded-full bg-current" />}
        </span>
        {!last ? <span className={cn('w-px flex-1', state === 'done' ? 'bg-green-600/40' : 'bg-border')} aria-hidden="true" /> : null}
      </div>
      <div
        className={cn(
          'min-w-0 flex-1 rounded-xl border p-5',
          !last && 'mb-4',
          state === 'done' && 'border-green-600/25 bg-green-50/70 dark:border-green-400/20 dark:bg-green-500/[0.07]',
          state === 'current' && 'border-t-4 border-t-green-600 bg-card shadow-sm sm:p-6',
          state === 'failed' && 'border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/[0.07]',
          state === 'todo' && 'border-dashed',
        )}
      >
        <p
          className={cn(
            'text-xs font-semibold uppercase tracking-wide',
            state === 'done' ? 'text-green-700 dark:text-green-400' : state === 'failed' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {eyebrow}
        </p>
        <h3 className={cn('mt-1 font-semibold', state === 'current' && 'text-lg')}>{title}</h3>
        <div className="mt-1.5 text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function ReceiptRows({ receipt, failed, status, planName, trial = false }: {
  receipt: Receipt | null;
  failed: boolean;
  status: BillingStatus | null;
  planName: string | null;
  trial?: boolean;
}) {
  const t = useT();
  if (failed) {
    return (
      <p className="mt-4 border-t border-dashed pt-4 font-sans text-xs text-muted-foreground">
        {richText(t('checkout-success.error.theReceiptDetailsCouldNotBeLoadedFromStripeYourInvoices', { link1: '{link1}' }), {
          link1: <Link className="text-foreground underline underline-offset-2" to="/billing">{t('common.action.billing')}</Link>,
        })}
      </p>
    );
  }
  if (!receipt) {
    return (
      <div className="mt-4 space-y-3 border-t border-dashed pt-4" aria-label={t('checkout-success.accessibility.loadingReceipt')}>
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full rounded" />)}
      </div>
    );
  }

  const rows: Array<[string, string | null]> = receipt.kind === 'checkout'
    ? [
      [t('checkout-success.label.invoice'), receipt.invoice_number],
      [t('checkout-success.label.date'), longDate(receipt.paid_at)],
      [t('common.label.plan'), planName],
      [trial ? t('checkout-success.label.dueToday') : t('checkout-success.label.amount'), money(receipt.amount, receipt.currency)],
      [t('common.label.card'), cardLabel(receipt.card)],
      [t('common.label.email'), receipt.email],
    ]
    : [
      [t('common.label.plan'), planName],
      [t('common.label.storage'), status ? formatGigabytes(status.usage.limit_bytes) : null],
      [t('checkout-success.label.nextInvoice'), money(receipt.next_amount, receipt.currency)],
      [t('checkout-success.label.invoiceDate'), longDate(receipt.next_invoice_at)],
      [t('common.label.card'), cardLabel(receipt.card)],
      [t('common.label.email'), receipt.email],
    ];

  return (
    <dl className="mt-4 border-t border-dashed">
      {rows.filter(([, value]) => value).map(([label, value]) => (
        <div key={label} className="border-b border-dashed py-2.5">
          <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 break-words font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Put the storage to work ────────────────────────────────────────────────
//
// The ways people actually fill a new plan, in the order they tend to reach for
// them: the desktop app first, then the terminal, then mounting it as a drive.
// Each card links to the setup page in the app and to its guide on the site.

const CONNECT: IntegrationSlug[] = ['desktop', 'cli', 'webdav', 's3', 'rclone'];

function ConnectSection() {
  const t = useT();
  const cards = CONNECT
    .map((slug) => INTEGRATIONS.find((integration) => integration.slug === slug))
    .filter((integration): integration is NonNullable<typeof integration> => !!integration);

  return (
    <section className="px-4 pt-12 sm:px-6 lg:px-8" aria-labelledby="connect-title">
      <h2 id="connect-title" className="text-lg font-semibold">{t('checkout-success.heading.putYourStorageToWork')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('checkout-success.description.uploadFromYourComputerYourTerminalOrAnyToolThatSpeaks')}</p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((integration) => {
          const Icon = integration.icon;
          return (
            <li key={integration.slug} className="flex gap-3 rounded-xl border p-4">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">
                <Icon className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0">
                <p className="font-medium">{integration.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{integration.description}</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <Link className="font-medium text-primary hover:underline underline-offset-2" to={`/integrations/${integration.slug}`}>
                    {t('common.action.setUp')}
                  </Link>
                  {integration.docsUrl ? (
                    <a
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      href={`${integration.docsUrl}/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('checkout-success.action.guide')} <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Static badges link straight to each store listing: the iPhone app on the App
 * Store (live 2026-10-14, app id 6796702157), Google Play (Android shipped
 * 2026-10-02) and the Mac App Store (the desktop app shipped there 2026-10-08,
 * app id 6818700723 - mt=12 is what makes that id resolve as Mac software).
 * The Microsoft one is not here: it is the real <ms-store-badge> web component
 * now (see ../components/ms-store-badge), which goes to the Store itself.
 */
const BADGES: Array<{ src: string; altKey: MessageKey; href: string; width: number }> = [
  { src: '/badges/appstore.svg', altKey: 'checkout-success.label.downloadOnTheAppStore', href: 'https://apps.apple.com/app/id6796702157', width: 114 },
  { src: '/badges/googleplay.svg', altKey: 'checkout-success.label.getItOnGooglePlay', href: 'https://play.google.com/store/apps/details?id=dev.dosya', width: 129 },
  { src: '/badges/mac-appstore.svg', altKey: 'common.label.downloadOnTheMacAppStore', href: 'https://apps.apple.com/app/id6818700723?mt=12', width: 149 },
];

function AppsSection() {
  const t = useT();
  return (
    <section className="px-4 pt-10 sm:px-6 lg:px-8" aria-labelledby="apps-title">
      <div className="rounded-xl border p-5 sm:p-6">
        <h2 id="apps-title" className="text-lg font-semibold">{t('checkout-success.heading.getTheApps')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {richText(t('checkout-success.description.keepAFolderInSyncOnYourComputerAndBackUp', { link1: '{link1}', link2: '{link2}' }), {
            link1: <a className="font-medium text-foreground underline underline-offset-2" href="https://dosya.dev/desktop/" target="_blank" rel="noreferrer">{t('common.action.desktop')}</a>,
            link2: <a className="font-medium text-foreground underline underline-offset-2" href="https://dosya.dev/mobile/" target="_blank" rel="noreferrer">{t('checkout-success.action.mobile')}</a>,
          })}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {BADGES.map((badge) => (
            <a key={badge.altKey} href={badge.href} target="_blank" rel="noreferrer" className="transition-opacity hover:opacity-80">
              <img src={badge.src} alt={t(badge.altKey)} width={badge.width} height={38} className="h-[38px] w-auto" loading="lazy" />
            </a>
          ))}
          <MsStoreBadge />
        </div>
      </div>
    </section>
  );
}

// ── FAQ ────────────────────────────────────────────────────────────────────
//
// The questions a purchase actually raises, answered where the answer lives.
// <details> rather than a JS accordion: every answer is in the page at rest,
// findable with the browser's own find-in-page.

const L = 'underline underline-offset-2';
const FAQ: Array<{ q: MessageKey; a: (t: ReturnType<typeof useT>) => React.ReactNode }> = [
  {
    q: 'checkout-success.description.whenDoesMyNewStorageAppear',
    a: (t) => richText(t('checkout-success.description.withinSecondsOfThePaymentClearingThisPageChecksWithStripe', { link1: '{link1}' }), {
      link1: <Link className={L} to="/billing">{t('common.action.billing')}</Link>,
    }),
  },
  {
    q: 'checkout-success.description.whereDoIFindMyInvoices',
    a: (t) => richText(t('checkout-success.description.everyInvoiceIsListedOnLink1WithAPdfForEach', { link1: '{link1}' }), {
      link1: <Link className={L} to="/billing">{t('common.action.billing')}</Link>,
    }),
  },
  {
    q: 'checkout-success.description.canIChangeOrCancelMyPlanLater',
    a: (t) => richText(t('checkout-success.description.yesFromLink1AtAnyTimeACancellationKeepsYourAccess', { link1: '{link1}', link2: '{link2}' }), {
      link1: <Link className={L} to="/billing">{t('common.action.billing')}</Link>,
      link2: <a className={L} href="https://dosya.dev/terms-of-service/" target="_blank" rel="noreferrer">{t('checkout-success.action.terms')}</a>,
    }),
  },
  {
    q: 'checkout-success.description.howDoIUploadALotOfFilesAtOnce',
    a: (t) => richText(t('checkout-success.description.installTheLink1AndKeepAFolderInSyncOrScript', { link1: '{link1}', link2: '{link2}', link3: '{link3}', link4: '{link4}' }), {
      link1: <Link className={L} to="/integrations/desktop">{t('checkout-success.action.desktopApp')}</Link>,
      link2: <Link className={L} to="/integrations/cli">{t('checkout-success.action.cli')}</Link>,
      link3: <Link className={L} to="/integrations/rclone">rclone</Link>,
      link4: <Link className={L} to="/integrations/google">{t('checkout-success.action.googleDriveOnedriveAndDropboxImport')}</Link>,
    }),
  },
  {
    q: 'checkout-success.description.canIMountMyStorageAsADrive',
    a: (t) => richText(t('checkout-success.description.yesLink1MountsItAsANetworkDriveOnMacosWindows', { link1: '{link1}', link2: '{link2}' }), {
      link1: <Link className={L} to="/integrations/webdav">WebDAV</Link>,
      link2: <Link className={L} to="/integrations/sftp">SFTP</Link>,
    }),
  },
  {
    q: 'checkout-success.description.doesItWorkWithMyS3Tools',
    a: (t) => richText(t('checkout-success.description.pointAnyS3CompatibleToolOrSdkAtYourWorkspaceWithLink1', { link1: '{link1}', link2: '{link2}' }), {
      link1: <Link className={L} to="/integrations/s3">{t('checkout-success.action.s3Credentials')}</Link>,
      link2: <Link className={L} to="/integrations/rest-api">{t('checkout-success.action.restApi')}</Link>,
    }),
  },
  {
    q: 'checkout-success.description.doesMyStorageWorkOnMyPhone',
    a: (t) => richText(t('checkout-success.description.yesTheLink1UploadsPhotosAndVideosInTheBackgroundAnd', { link1: '{link1}' }), {
      link1: <a className={L} href="https://dosya.dev/mobile/" target="_blank" rel="noreferrer">{t('checkout-success.action.mobileApp')}</a>,
    }),
  },
  {
    q: 'checkout-success.description.canIShareFilesWithPeopleWhoHaveNoAccount',
    a: (t) => richText(t('checkout-success.description.yesWithShareLinksWhichCanCarryAPasswordAndAn', { link1: '{link1}', link2: '{link2}' }), {
      link1: <a className={L} href="https://dosya.dev/resources/share-links/" target="_blank" rel="noreferrer">{t('checkout-success.action.howShareLinksWork')}</a>,
      link2: <Link className={L} to="/file-requests">{t('checkout-success.action.fileRequest')}</Link>,
    }),
  },
];

function FaqSection() {
  const t = useT();
  return (
    <section className="px-4 pt-10 sm:px-6 lg:px-8" aria-labelledby="faq-title">
      <h2 id="faq-title" className="text-lg font-semibold">{t('checkout-success.heading.questionsPeopleAskAfterBuying')}</h2>
      <div className="mt-4 divide-y rounded-xl border">
        {FAQ.map(({ q, a }) => (
          <details key={q} className="group px-4 py-3 [&_a]:font-medium">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium marker:hidden">
              {t(q)}
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="pb-1 pt-2 text-sm leading-6 text-muted-foreground">{a(t)}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

/**
 * "Something not right? Email support@dosya.dev with invoice N." One catalog
 * sentence. TODO(catalog): its tail leaves a space before the full stop and a
 * double space around the empty invoice branch (tidyText closes both), and the
 * bold lead-in is part of the message, so it is cut off at the first question mark.
 */
function SupportLine({ invoiceNumber }: { invoiceNumber: string | null }) {
  const t = useT();
  // The template is tidied with the invoice number held back as a token, so the data is never touched.
  const sentence = tidyText(t('checkout-success.description.somethingNotRightEmailLink1ReceiptkindcheckoutSelectTrueWithInvoice', {
    link1: '{link1}',
    receiptKindCheckout: String(!!invoiceNumber),
    receiptInvoice_number: '\uE004',
  })).split('\uE004').join(invoiceNumber ?? '');
  const cut = sentence.search(/[?\uFF1F]/);
  const lead = cut >= 0 ? sentence.slice(0, cut + 1) : '';
  const rest = cut >= 0 ? sentence.slice(cut + 1) : sentence;
  return (
    <>
      {lead ? <><span className="font-medium text-foreground">{lead}</span>{' '}</> : null}
      {richText(rest.replace(/^ +/, ''), {
        link1: <a className="font-medium text-foreground underline underline-offset-2" href="mailto:support@dosya.dev">{t('checkout-success.action.supportDosyaDev')}</a>,
      })}
    </>
  );
}
