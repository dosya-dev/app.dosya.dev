import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getBillingStatus, syncBilling, createPortalSession, type BillingStatus, resumeSubscription } from '@/api/billing';
import { api, apiErrorMessage } from '@/api/client';
import { formatBytes, formatCents, formatGigabytes } from '@/lib/billing/cart-math';
import { PlanChooser } from '@/components/billing/plan-chooser';
import { Button } from '@/components/ui/button';
import { CancelSubscriptionDialog } from '@/components/billing/cancel-dialog';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle, CalendarClock, CreditCard, Download, ExternalLink, PackageCheck,
} from 'lucide-react';
import { licenseIntervalLabel, licenseProviderLabel, licenseTimeline, formatLicenseDate } from '@/lib/license-timeline';
import { cn } from '@/lib/utils';

/** A colour per storage source, used by both the ledger dots and the bar. */
const SOURCE_COLORS = {
  plan: 'bg-primary',
  addon: 'bg-blue-500',
  package: 'bg-violet-500',
  referral: 'bg-amber-500',
} as const;

type SourceKind = keyof typeof SOURCE_COLORS;
type LedgerRow = { key: string; label: string; detail?: string; bytes: number; kind: SourceKind };

function longDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function shortDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BillingPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  // ?upgrade=1 opens the plan chooser straight away, so "Upgrade now" elsewhere
  // in the app is one click rather than "land on billing, then find the button".
  const [showChooser, setShowChooser] = useState(
    () => new URLSearchParams(window.location.search).get('upgrade') === '1',
  );
  // "Add storage" must not be able to swap the plan: it opens the chooser with
  // the plan cards hidden. See the 2026-09-16 downgrade incident.
  const [chooserMode, setChooserMode] = useState<'plan' | 'addons'>('plan');
  const openChooser = (mode: 'plan' | 'addons') => { setChooserMode(mode); setShowChooser(true); };
  const [portalOpening, setPortalOpening] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Card digits are the one fact /api/billing/status does not carry. Quiet extra:
  // the payment line is simply left out when it cannot be read.
  const [card, setCard] = useState<{ brand?: string; last4?: string } | null>(null);

  const reload = () => getBillingStatus().then((d) => setData(d)).catch(() => {});

  const onResume = async () => {
    setResuming(true);
    setCancelError(null);
    try {
      await resumeSubscription();
      await reload();
    } catch (err) {
      setCancelError(apiErrorMessage(err, 'Could not resume the subscription.'));
    }
    setResuming(false);
  };

  useEffect(() => {
    getBillingStatus()
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Handle the return from Stripe Checkout (?success / ?canceled). New checkouts
  // land on /checkout/success instead; this stays for links issued before that.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) {
      syncBilling().finally(reload);
      const t = setTimeout(reload, 2500);
      window.history.replaceState({}, '', '/billing');
      return () => clearTimeout(t);
    }
    if (params.get('canceled')) window.history.replaceState({}, '', '/billing');
  }, []);

  const hasSubscription = !!data?.subscription.has_subscription;
  useEffect(() => {
    if (!hasSubscription) return;
    let cancelled = false;
    api<{ card: { brand?: string; last4?: string } | null }>('/api/billing/receipt', { cache: 'no-store' })
      .then((result) => { if (!cancelled) setCard(result.card); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [hasSubscription]);

  const openPortal = () => {
    setPortalOpening(true); setPortalError(null);
    createPortalSession()
      .then(({ url }) => { window.location.href = url; })
      .catch((e) => { setPortalError(apiErrorMessage(e)); setPortalOpening(false); });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Failed to load billing information.</p>
      </div>
    );
  }

  const { plan, usage, subscription: sub, interval } = data;
  const licenseGrants = data.license_grants ?? [];
  const overBytes = usage.used_bytes - usage.limit_bytes;
  const overLimit = overBytes > 0;
  const usedShare = usage.limit_bytes > 0 ? Math.min(1, usage.used_bytes / usage.limit_bytes) : 0;
  const price = interval === 'year' && plan.price_yearly != null ? plan.price_yearly : plan.price_monthly;
  const upcoming = data.invoices.find((invoice) => invoice.status === 'upcoming') ?? null;

  // One row per thing that adds storage, in the order they stack.
  const ledger: LedgerRow[] = [];
  ledger.push({ key: 'plan', kind: 'plan', label: `${plan.name} plan`, bytes: plan.storage_bytes });
  for (const item of data.items.filter((i) => i.kind !== 'plan')) {
    ledger.push({
      key: `${item.kind}-${item.ref_id}`,
      kind: 'addon',
      label: item.kind === 'custom' ? 'Custom package' : `${item.ref_id} × ${item.quantity}`,
      bytes: item.total_bytes,
    });
  }
  for (const grant of licenseGrants.filter((g) => g.status === 'active')) {
    ledger.push({
      key: grant.id,
      kind: 'package',
      label: grant.package_name,
      detail: licenseProviderLabel(grant.provider),
      bytes: grant.contribution_bytes,
    });
  }
  if (data.referral_bonus_bytes > 0) {
    ledger.push({ key: 'referral', kind: 'referral', label: 'Referral bonus', bytes: data.referral_bonus_bytes });
  }
  const ledgerTotal = ledger.reduce((sum, row) => sum + row.bytes, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold tracking-tight">Billing</h1>

      {/* The two states worth shouting about, each leading with the number. */}
      {overLimit && (
        <StateHero
          tone="red"
          eyebrow="Over the limit"
          figure={formatGigabytes(usage.used_bytes)}
          caption={`used of ${formatGigabytes(usage.limit_bytes)}`}
          body="Uploads are paused across every workspace. Nothing has been deleted."
          bar={<><span className="h-full bg-primary" style={{ width: '96%' }} /><span className="h-full bg-destructive" style={{ width: '4%' }} /></>}
          actions={(
            <>
              <Button size="sm" onClick={() => openChooser('addons')}>Add storage</Button>
              <Link to="/files" className="text-sm font-medium text-muted-foreground underline underline-offset-2">Free up space</Link>
            </>
          )}
          note={`${formatGigabytes(overBytes)} over`}
        />
      )}

      {sub.cancel_at_period_end && sub.current_period_end && (
        <StateHero
          tone="amber"
          eyebrow={`Ends ${longDate(sub.current_period_end)}`}
          figure={formatGigabytes(usage.limit_bytes)}
          caption="until then"
          body="Your subscription will not renew. You keep this storage until the end date, then your paid storage for 14 more days before the free limit applies. Your files are never deleted."
          bar={<><span className="h-full bg-primary" style={{ width: `${usedShare * 100}%` }} /><span className="h-full bg-muted-foreground/25" style={{ width: `${(1 - usedShare) * 100}%` }} /></>}
          actions={(
            <Button size="sm" variant="outline" onClick={onResume} disabled={resuming}>
              {resuming ? 'Resuming…' : 'Resume subscription'}
            </Button>
          )}
          note={`${formatGigabytes(usage.used_bytes)} in use`}
        />
      )}
      {cancelError && <p className="text-xs text-red-600">{cancelError}</p>}

      {/* Statement: the subscription on the left, what it buys on the right. */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="grid md:grid-cols-[320px_minmax(0,1fr)]">
          <div className="border-b p-5 md:border-b-0 md:border-r">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Subscription</p>
            <p className="mt-2 font-mono text-4xl font-bold tracking-[-0.03em] tabular-nums">
              {formatCents(price)}
              <span className="text-sm font-medium text-muted-foreground">/{interval === 'year' ? 'yr' : 'mo'}</span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {sub.current_period_end
                ? `${plan.name} plan · ${sub.cancel_at_period_end ? 'ends' : 'renews'} ${longDate(sub.current_period_end)}`
                : `${plan.name} plan`}
            </p>
            {card?.last4 && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CreditCard className="size-3.5" aria-hidden="true" />
                {card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card'} •••• {card.last4}
              </p>
            )}
            {upcoming && !sub.cancel_at_period_end && (
              <p className="mt-1 text-xs text-muted-foreground">
                Next invoice {formatCents(upcoming.amount)} on {shortDate(upcoming.period_end)}
              </p>
            )}
            <div className="mt-3">
              {sub.cancel_at_period_end
                ? <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">Cancelling</Badge>
                : sub.status === 'active'
                  ? <Badge variant="outline" className="text-[10px] text-green-600 border-green-200">Active</Badge>
                  : <Badge variant="outline" className="text-[10px] text-muted-foreground">{hasSubscription ? sub.status ?? 'Inactive' : 'No subscription'}</Badge>}
            </div>

            <div className="mt-4 grid gap-2">
                <Button size="sm" onClick={() => openChooser('plan')}>
                  {hasSubscription ? 'Change plan' : 'Choose a plan'}
                </Button>
                {hasSubscription && (
                  <Button size="sm" variant="outline" onClick={() => openChooser('addons')}>Add storage</Button>
                )}
                {hasSubscription && (
                  <Button size="sm" variant="outline" onClick={openPortal} disabled={portalOpening}>
                    {portalOpening ? 'Opening…' : 'Manage payment method'}
                  </Button>
                )}
              {hasSubscription && !sub.cancel_at_period_end && (
                <button
                  type="button"
                  onClick={() => setShowCancel(true)}
                  className="justify-self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Cancel subscription
                </button>
              )}
            </div>
            {portalError && <p className="mt-2 text-xs text-red-600">{portalError}</p>}
          </div>

          <div className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Storage ledger</p>
              <p className="text-xs text-muted-foreground">
                {usage.used_label} used · {overLimit ? `${formatGigabytes(overBytes)} over` : `${formatGigabytes(usage.limit_bytes - usage.used_bytes)} free`}
              </p>
            </div>

            <dl className="mt-3 border-t border-dashed font-mono text-[13px]">
              {ledger.map((row) => (
                <div key={row.key} className="flex items-baseline justify-between gap-3 border-b border-dashed py-2">
                  <dt className="flex min-w-0 items-baseline gap-2">
                    <span className={cn('size-2 shrink-0 translate-y-[-1px] rounded-sm', SOURCE_COLORS[row.kind])} aria-hidden="true" />
                    <span className="truncate">{row.label}</span>
                    {row.detail && <span className="shrink-0 text-muted-foreground">· {row.detail}</span>}
                  </dt>
                  <dd className="shrink-0 tabular-nums">{formatGigabytes(row.bytes)}</dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 border-t pt-2 font-bold">
                <dt>Total limit</dt>
                <dd className="tabular-nums">{formatGigabytes(usage.limit_bytes)}</dd>
              </div>
            </dl>
            {ledgerTotal !== usage.limit_bytes && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                The total is what your account is entitled to; a line above can lag a change by a few seconds.
              </p>
            )}

            <div className="mt-4 flex h-3 overflow-hidden rounded-full border bg-muted" role="img" aria-label={`${usage.used_label} used of ${formatGigabytes(usage.limit_bytes)}`}>
              <span className={cn('h-full', overLimit ? 'bg-destructive' : 'bg-primary')} style={{ width: `${usedShare * 100}%` }} />
              <span className="h-full bg-muted-foreground/25" style={{ width: `${(1 - usedShare) * 100}%` }} />
            </div>
            {!overLimit && usedShare >= 0.8 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                {Math.round((1 - usedShare) * 100)}% remaining
              </p>
            )}
          </div>
        </div>
      </Card>

      {showChooser && (
        <PlanChooser
          hasSubscription={hasSubscription}
          usedBytes={usage.used_bytes}
          limitBytes={usage.limit_bytes}
          currentPlanId={plan.id}
          mode={chooserMode}
          initial={{
            interval,
            planId: plan.id === 'free' ? (hasSubscription ? plan.id : 'starter') : plan.id,
            addonQty: Object.fromEntries(data.items.filter((i) => i.kind === 'addon').map((i) => [i.ref_id, i.quantity])),
          }}
          onUpdated={() => navigate('/checkout/success?change=1')}
          onClose={() => setShowChooser(false)}
        />
      )}

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
          <h2 className="text-sm font-semibold">Invoices</h2>
          {hasSubscription && (
            <button type="button" onClick={openPortal} className="text-xs font-medium text-primary hover:underline underline-offset-2">
              Open Stripe portal
            </button>
          )}
        </div>
        {data.invoices.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">No invoices yet</p>
        ) : (
          data.invoices.map((invoice) => (
            <div key={invoice.id} className="flex items-center gap-3 border-b px-5 py-2.5 font-mono text-[13px] last:border-b-0 hover:bg-muted/50">
              <span className="min-w-0 flex-1 truncate">
                {shortDate(invoice.period_start)} <span className="text-muted-foreground">to {shortDate(invoice.period_end)}</span>
              </span>
              <span className="shrink-0 tabular-nums">{formatCents(invoice.amount)}</span>
              <Badge variant={invoice.status === 'paid' ? 'secondary' : 'outline'} className="shrink-0 text-[10px]">
                {invoice.status}
              </Badge>
              {invoice.pdf_url ? (
                <a href={invoice.pdf_url} target="_blank" rel="noreferrer" className="flex size-7 shrink-0 items-center justify-center rounded hover:bg-muted" title="Download PDF">
                  <Download className="size-3.5 text-muted-foreground" />
                </a>
              ) : (
                <span className="size-7 shrink-0" aria-hidden="true" />
              )}
            </div>
          ))
        )}
      </Card>

      {licenseGrants.length > 0 && (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">Redeemed packages</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Storage from redeemed codes and packages.</p>
            </div>
            {licenseGrants.some((g) => g.provider === 'gumroad') && (
              <a
                href="https://app.gumroad.com/library"
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-2"
              >
                Manage on Gumroad <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            )}
          </div>
          {licenseGrants.map((grant) => {
            const isActive = grant.status === 'active';
            const timeline = licenseTimeline(grant);
            return (
              <div key={grant.id} className="flex items-start gap-3 border-b px-5 py-4 last:border-b-0">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <PackageCheck className="size-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{grant.package_name}</p>
                    <Badge
                      variant="outline"
                      className={
                        timeline.tone === 'renews' ? 'text-[10px] text-green-600 border-green-200'
                          : timeline.tone === 'ending' ? 'text-[10px] text-amber-600 border-amber-200'
                            : 'text-[10px] text-muted-foreground'
                      }
                    >
                      {timeline.badge}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {licenseProviderLabel(grant.provider)}{grant.interval ? ` · ${licenseIntervalLabel(grant.interval)}` : ''} · Redeemed {formatLicenseDate(grant.linked_at)}
                  </p>
                  <p
                    className={
                      timeline.tone === 'ending'
                        ? 'mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-600'
                        : timeline.tone === 'renews'
                          ? 'mt-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground'
                          : 'mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground'
                    }
                    title={grant.renews_at && !grant.ends_at && grant.provider === 'gumroad' ? 'Estimated from your purchase date. Gumroad sets the exact charge date.' : undefined}
                  >
                    <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
                    {timeline.text}
                  </p>
                </div>
                <p className={isActive ? 'shrink-0 text-xs font-medium' : 'shrink-0 text-xs text-muted-foreground'}>
                  Adds {formatBytes(grant.contribution_bytes)}
                </p>
              </div>
            );
          })}
        </Card>
      )}

      {showCancel && (
        <CancelSubscriptionDialog
          data={data}
          onClose={() => setShowCancel(false)}
          onCancelled={reload}
        />
      )}
    </div>
  );
}

/**
 * A state that deserves the whole width: the number first, then what it means,
 * then the one or two things worth doing about it.
 */
function StateHero({ tone, eyebrow, figure, caption, body, bar, actions, note }: {
  tone: 'red' | 'amber';
  eyebrow: string;
  figure: string;
  caption: string;
  body: string;
  bar: React.ReactNode;
  actions: React.ReactNode;
  note: string;
}) {
  return (
    <Card
      className={cn(
        'gap-0 p-5',
        tone === 'red' ? 'border-destructive/40 bg-destructive/[0.04]' : 'border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/[0.07]',
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className={cn('text-[10px] font-semibold uppercase tracking-[0.1em]', tone === 'red' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400')}>
            {eyebrow}
          </p>
          <p className={cn('mt-1.5 font-mono text-4xl font-bold leading-none tracking-[-0.04em] tabular-nums sm:text-5xl', tone === 'red' && 'text-destructive')}>
            {figure}
            <span className="ml-2 text-sm font-medium tracking-normal text-muted-foreground">{caption}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      </div>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full border bg-muted" aria-hidden="true">{bar}</div>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-1.5">
        <p className="max-w-[70ch] text-sm text-muted-foreground">{body}</p>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">{note}</p>
      </div>
    </Card>
  );
}
