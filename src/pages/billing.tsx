import { useState, useEffect } from 'react';
import { getBillingStatus, type BillingStatus } from '@/api/billing';
import { formatBytes, formatCents } from '@/lib/billing/cart-math';
import { SubscriptionModal } from '@/components/billing/subscription-modal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CreditCard, Download, AlertTriangle,
} from 'lucide-react';

const PLAN_COLORS: Record<string, string> = {
  free: '#6b7280', starter: '#3b82f6', plus: '#8b5cf6', pro: '#f59e0b', business: '#059669',
};

export default function BillingPage() {
  const [data, setData] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const reload = () => getBillingStatus().then((d) => setData(d)).catch(() => {});

  useEffect(() => {
    getBillingStatus()
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Handle the return from Stripe Checkout (?success / ?canceled).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) {
      // Stripe redirect back — the webhook may lag a moment; refetch after a short delay.
      const t = setTimeout(() => getBillingStatus().then((d) => setData(d)).catch(() => {}), 2500);
      window.history.replaceState({}, '', '/billing');
      return () => clearTimeout(t);
    }
    if (params.get('canceled')) window.history.replaceState({}, '', '/billing');
  }, []);

  // POST /billing/subscription only calls Stripe — the D1 mirror is updated
  // asynchronously by the webhook, so refetch immediately AND after a short delay
  // to pick up the settled state (mirrors the ?success handling above).
  const onModalUpdated = () => { reload(); setTimeout(reload, 2500); };

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">Failed to load billing information.</p>
      </div>
    );
  }

  const plan = data.plan;
  const usage = data.usage;
  const sub = data.subscription;
  const storagePct = usage.pct;
  const storageColor = storagePct > 90 ? '#ef4444' : storagePct > 70 ? '#D97706' : '#22c55e';

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-6">Billing</h1>

      {/* Current plan */}
      <Card className="gap-0 py-0 p-5 mb-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge style={{ background: PLAN_COLORS[plan.name.toLowerCase()] || '#6b7280', color: '#fff' }} className="text-xs">
                {plan.name}
              </Badge>
              {sub.status === 'active' && <Badge variant="outline" className="text-[10px] text-green-600 border-green-200">Active</Badge>}
              {sub.cancel_at_period_end && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">Cancelling</Badge>}
            </div>
            <p className="text-2xl font-bold">{formatCents(plan.price_monthly)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            {sub.current_period_end && (
              <p className="text-xs text-muted-foreground mt-1">
                {sub.cancel_at_period_end ? 'Cancels' : 'Renews'} {new Date(sub.current_period_end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>
        </div>

        {/* Storage */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Storage</span>
            <span className="text-xs text-muted-foreground">{usage.used_label} / {formatBytes(usage.limit_bytes)}</span>
          </div>
          <Progress
            value={Math.min(storagePct, 100)}
            className="**:data-[slot=progress-track]:h-2 **:data-[slot=progress-track]:bg-border **:data-[slot=progress-indicator]:bg-(--storage-color)"
            style={{ '--storage-color': storageColor } as React.CSSProperties}
          />
          {storagePct >= 80 && (
            storagePct >= 95 ? (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-1.5 mt-2 text-xs w-full text-left hover:underline"
                style={{ color: '#ef4444' }}
              >
                <AlertTriangle className="size-3" />
                Storage almost full. Upgrade your plan.
              </button>
            ) : (
              <div className="flex items-center gap-1.5 mt-2 text-xs" style={{ color: '#D97706' }}>
                <AlertTriangle className="size-3" />
                {Math.round(100 - storagePct)}% remaining
              </div>
            )
          )}
        </div>

        {/* Storage breakdown (the stack) */}
        <div className="mt-3 space-y-1 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">Storage breakdown</p>
          {/* Plan row — always, from data.plan (the source of truth for the base contribution).
              The backend mirrors a kind:"plan" row into subscription_items too, so we must NOT
              also render that item here or the plan would show twice for subscribers. */}
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{data.plan.name} plan</span><span>{data.plan.storage_label}</span>
          </div>
          {/* Add-on / custom rows */}
          {data.items.filter((i) => i.kind !== "plan").map((i) => (
            <div key={`${i.kind}-${i.ref_id}`} className="flex justify-between text-xs text-muted-foreground">
              <span>{i.kind === "custom" ? "Custom package" : `${i.ref_id} × ${i.quantity}`}</span>
              <span>{i.total_label}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 text-xs font-semibold">
            <span>Total</span><span>{formatBytes(data.usage.limit_bytes)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => setModalOpen(true)}>
            {data.subscription.has_subscription ? "Change plan" : "Upgrade"}
          </Button>
          {data.subscription.has_subscription && (
            <Button size="sm" variant="outline" onClick={() => setModalOpen(true)}>Add storage</Button>
          )}
          {data.portal_url && (
            <a href={data.portal_url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost">Manage billing</Button>
            </a>
          )}
        </div>
      </Card>

      {/* Invoices */}
      <Card className="gap-0 py-0 overflow-hidden">
        <div className="px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">Invoices</h2>
        </div>
        {data.invoices.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">No invoices yet</p>
        ) : (
          data.invoices.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 px-5 py-3 border-b last:border-b-0 hover:bg-muted/50">
              <CreditCard className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  ${(inv.amount / 100).toFixed(2)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(inv.period_start * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {new Date(inv.period_end * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              <Badge variant={inv.status === 'paid' ? 'secondary' : 'outline'} className="text-[10px]">
                {inv.status}
              </Badge>
              {inv.pdf_url && (
                <a href={inv.pdf_url} target="_blank" rel="noreferrer" className="size-7 rounded flex items-center justify-center hover:bg-muted" title="Download PDF">
                  <Download className="size-3.5 text-muted-foreground" />
                </a>
              )}
            </div>
          ))
        )}
      </Card>

      <SubscriptionModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        hasSubscription={data.subscription.has_subscription}
        usedBytes={data.usage.used_bytes}
        initial={{
          interval: data.interval,
          planId: data.plan.id === "free" ? (data.subscription.has_subscription ? data.plan.id : "starter") : data.plan.id,
          addonQty: Object.fromEntries(data.items.filter((i) => i.kind === "addon").map((i) => [i.ref_id, i.quantity])),
        }}
        onUpdated={onModalUpdated}
      />
    </div>
  );
}
