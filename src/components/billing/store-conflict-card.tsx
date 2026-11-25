import { AlertTriangle } from 'lucide-react';
import type { BillingStatus, StoreStatus } from '@/api/billing';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { StorePlanDetails, storeDate, storeName } from './store-plan-card';

/**
 * Shown above the normal page while an account has both a store subscription and an
 * active web one. The web one wins, so it carries the cancel and refund controls.
 * The warning copy is for an open billing conflict; otherwise the copy stays quiet.
 */
export function StoreConflictCard({ store, billing, onCancel, onRefund, openPortal }: {
  store: NonNullable<StoreStatus>;
  billing: BillingStatus;
  onCancel: () => void;
  onRefund: () => void;
  openPortal: () => void;
}) {
  const t = useT();
  const sub = billing.subscription;
  const periodEnd = sub.current_period_end;
  const warn = store.conflict;
  return (
    <Card className={cn('gap-0 p-5', warn && 'border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/[0.07]')}>
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {warn && <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />}
        {warn ? t('billing.store.heading.conflict') : t('billing.store.heading.twoSubscriptions')}
      </h2>
      <p className="mt-2 max-w-[70ch] text-sm text-muted-foreground">
        {warn
          ? t('billing.store.description.conflict', { store: storeName(store) })
          : t('billing.store.description.twoSubscriptions', { store: storeName(store) })}
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-background/60 p-4" aria-label={storeName(store)}>
          <StorePlanDetails store={store} plan={billing.plan} />
        </section>
        <section className="rounded-lg border bg-background/60 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {t('billing.store.label.webSubscription')}
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight">{billing.plan.name}</p>
          {periodEnd != null && (
            <p className="mt-2 text-sm text-muted-foreground">
              {sub.cancel_at_period_end
                ? t('billing.store.label.endsOn', { date: storeDate(periodEnd) })
                : t('billing.store.label.renewsOn', { date: storeDate(periodEnd) })}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!sub.cancel_at_period_end && (
              <Button size="sm" variant="outline" onClick={onCancel}>{t('billing.action.cancelSubscription')}</Button>
            )}
            {billing.refund?.eligible && (
              <Button size="sm" variant="destructive" onClick={onRefund}>{t('billing.action.requestRefund')}</Button>
            )}
            {sub.has_subscription && (
              <Button size="sm" variant="outline" onClick={openPortal}>{t('billing.action.managePaymentMethod')}</Button>
            )}
          </div>
        </section>
      </div>
    </Card>
  );
}
