import { ExternalLink } from 'lucide-react';
import type { BillingStatus, StoreStatus } from '@/api/billing';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatDateWith } from '@/lib/format-locale';
import { useT } from '@/lib/i18n';

type Store = NonNullable<StoreStatus>;

export type StoreLayout = 'none' | 'locked' | 'conflict';

/**
 * Which billing page to draw, from billing state: the normal one, the store-managed
 * one, or the side-by-side one while a web (Stripe) base subscription is still active
 * next to the store one (including one set to end at period end). `store.conflict`
 * only says a billing_conflicts row is open; it picks the copy, not the layout.
 */
export function storeLayout(status: BillingStatus): StoreLayout {
  if (!status.store) return 'none';
  return status.subscription?.has_subscription ? 'conflict' : 'locked';
}

/** The store could not charge and the plan is living on its grace period: expired, but grace not yet over. */
export function inStoreGrace(store: Store, nowSec = Date.now() / 1000): boolean {
  return typeof store.grace_until === 'number' && store.expires_at != null
    && store.grace_until > nowSec && nowSec > store.expires_at;
}

/** The display name of the store that bills the plan. */
export function storeName(store: Store): string {
  return store.provider === 'apple' ? 'App Store' : 'Google Play';
}

export function storeDate(unix: number): string {
  return formatDateWith(unix, { month: 'short', day: 'numeric', year: 'numeric' }, 'en-US');
}

export function StoreManageLink({ store }: { store: Store }) {
  const t = useT();
  return (
    <a
      href={store.manage_url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-2"
    >
      {t('billing.store.action.manageIn', { store: storeName(store) })} <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}

/** What the store bills: plan, storage, renewal or end date and the link out. */
export function StorePlanDetails({ store, plan }: { store: Store; plan: BillingStatus['plan'] }) {
  const t = useT();
  const name = storeName(store);
  return (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {t('billing.store.heading.managedIn', { store: name })}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="text-2xl font-bold tracking-tight">{plan.name}</p>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">{plan.storage_label}</Badge>
        {store.environment === 'sandbox' && (
          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">{t('billing.store.label.sandbox')}</Badge>
        )}
      </div>
      {inStoreGrace(store) ? (
        <p data-testid="store-payment-problem" className="mt-2 text-sm font-medium text-amber-600">
          {t('billing.store.label.paymentProblem', { store: name, date: storeDate(store.grace_until as number) })}
        </p>
      ) : store.expires_at != null && (
        <p className="mt-2 text-sm text-muted-foreground">
          {store.will_renew
            ? t('billing.store.label.renewsOn', { date: storeDate(store.expires_at) })
            : t('billing.store.label.endsOn', { date: storeDate(store.expires_at) })}
        </p>
      )}
      <div className="mt-4"><StoreManageLink store={store} /></div>
    </>
  );
}

/** The plan card for an account whose plan is billed by the App Store or Google Play: no prices, no chooser, one link out. */
export function StorePlanCard({ store, plan }: { store: Store; plan: BillingStatus['plan'] }) {
  const t = useT();
  return (
    <Card className="gap-0 p-5">
      <StorePlanDetails store={store} plan={plan} />
      <p className="mt-3 max-w-[70ch] text-sm text-muted-foreground">{t('billing.store.description.locked', { store: storeName(store) })}</p>
      {store.conflict && (
        <p data-testid="store-conflict-pending" className="mt-2 max-w-[70ch] text-sm text-muted-foreground">{t('billing.store.label.conflictPending')}</p>
      )}
    </Card>
  );
}
