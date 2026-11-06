import { formatDateWith } from '@/lib/format-locale';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { apiErrorMessage } from '@/api/client';
import {
  getCatalog, previewSubscription, updateSubscription,
  type BillingStatus, type CartPayload, type CatalogAddon, type Currency,
} from '@/api/billing';
import { formatCents } from '@/lib/billing/cart-math';
import { rememberPlanChange, rememberStorageBeforePurchase } from '@/lib/checkout-return';
import { useT } from '@/lib/i18n';

const PLACES_ID = 'family_places';

/**
 * Buy or give back extra family places. No endpoint of its own: the cart is
 * the subscription as it stands (plan, every other add-on at its current
 * quantity) with the places line set to the new number, sent through the
 * same preview and change calls the plan chooser uses. Stripe prorates, and
 * the thank-you page shows the next invoice.
 */
export function FamilyPlacesDialog({ open, onClose, billing, current, included, max }: {
  open: boolean;
  onClose: () => void;
  billing: BillingStatus;
  /** Extra places on the subscription now. */
  current: number;
  included: number;
  max: number;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [qty, setQty] = useState(current);
  const [addon, setAddon] = useState<CatalogAddon | null>(null);
  const [currency, setCurrency] = useState<Currency>('usd');
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const seq = useRef(0);
  const planItem = billing.items.find((i) => i.kind === 'plan');

  // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the stepper each time the dialog opens
  useEffect(() => { if (open) { setQty(current); setError(null); } }, [open, current]);
  useEffect(() => {
    if (!open) return;
    getCatalog().then((c) => { setCurrency(c.currency ?? 'usd'); setAddon(c.addons.find((a) => a.id === PLACES_ID) ?? null); }).catch((e) => setError(apiErrorMessage(e, t('billing.error.couldNotLoadPrices'))));
  }, [open]);

  const cap = addon?.max_quantity ?? max;
  const interval = billing.interval;
  const unit = addon ? (interval === 'year' ? (addon.price_yearly ?? 0) : addon.price_monthly) : null;
  const available = !!addon && (interval === 'year' ? addon.has_yearly : addon.has_monthly);

  const cart = (n: number): CartPayload => ({
    interval,
    plan_id: planItem?.ref_id ?? billing.plan.id,
    addons: [
      ...billing.items.filter((i) => i.kind === 'addon' && i.ref_id !== PLACES_ID).map((i) => ({ id: i.ref_id, qty: i.quantity })),
      ...(n > 0 ? [{ id: PLACES_ID, qty: n }] : []),
    ],
  });

  // Proration preview, debounced like the chooser's.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears a stale preview when the quantity returns to the current one
    if (!open || qty === current) { setPreview(null); return; }
    const mine = ++seq.current;
    setPreview(null); setPreviewFailed(false);
    const timer = setTimeout(() => {
      previewSubscription(cart(qty))
        .then((r) => { if (seq.current === mine) setPreview(r.amount_due); })
        .catch(() => { if (seq.current === mine) { setPreview(null); setPreviewFailed(true); } });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, qty, current]);

  const confirm = async () => {
    setBusy(true); setError(null);
    rememberStorageBeforePurchase(billing.usage.limit_bytes);
    try {
      await updateSubscription(cart(qty));
      rememberPlanChange();
      onClose();
      navigate('/checkout/success?change=1');
    } catch (e) {
      setError(apiErrorMessage(e, t('billing.error.couldNotUpdateSpots')));
      setBusy(false);
    }
  };

  const people = included + qty;
  const unitLabel = interval === 'year' ? t('billing.label.aYear') : t('billing.label.aMonth');
  const currentBill = billing.items.reduce((sum, i) => sum + (i.unit_amount ?? 0) * i.quantity, 0);
  const newBill = currentBill + (qty - current) * (unit ?? 0);
  const changed = qty !== current;
  const pricesKnown = billing.items.every((i) => i.unit_amount != null);
  const billDelta = (qty - current) * (unit ?? 0);
  const deltaLabel = `${billDelta < 0 ? '-' : '+'}${formatCents(Math.abs(billDelta), currency)} ${unitLabel}`;
  const delta = qty - current;
  const periodEnd = billing.subscription?.current_period_end;
  const invoiceDate = periodEnd ? formatDateWith(periodEnd, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const confirmLabel = !changed
    ? t('billing.label.noChange')
    : delta > 0
      ? t('billing.description.addDeltaPluralOneSpotOtherSpots', { delta })
      : t('billing.description.removeDeltaPluralOneSpotOtherSpots', { delta: -delta });
  const btn = 'size-11 rounded-full';
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('billing.heading.purchaseMoreFamilySpots')}</DialogTitle>
          <DialogDescription>
            {t('billing.description.yourPlanIncludesIncludedPeopleBesidesYouUniteachextra', { included, unitEachExtra: unit !== null ? t('billing.description.eachExtraSpotIsPriceUnitLabel', { price: formatCents(unit, currency), unitLabel }) : '' }).trimEnd()}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
          <div>
            <p className="text-sm font-medium">{t('billing.label.extraSpots')}</p>
            <p className="text-xs text-muted-foreground">{t('billing.label.0ToCap', { cap })}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" className={btn} aria-label={t('billing.action.removeASpot')} disabled={busy || qty <= 0} onClick={() => setQty((q) => Math.max(0, q - 1))}>
              <Minus className="size-4" />
            </Button>
            <span className="w-10 text-center font-mono text-3xl tabular-nums" aria-live="polite">{qty}</span>
            <Button type="button" variant="outline" size="icon" className={btn} aria-label={t('billing.action.addASpot')} disabled={busy || !available || qty >= cap} onClick={() => setQty((q) => Math.min(cap, q + 1))}>
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 rounded-lg border px-4 py-3 text-sm">
          <dt className="text-muted-foreground">{t('billing.label.peopleWhoCanJoinYou')}</dt>
          <dd className="text-end font-mono">{people}</dd>
          {pricesKnown ? (<>
            <dt className="text-muted-foreground">{interval === 'year' ? t('billing.label.yearlyPriceBeforeDiscounts') : t('billing.label.monthlyPriceBeforeDiscounts')}</dt>
            <dd className="text-end font-mono">
              {changed ? (<><s className="me-2 text-muted-foreground">{formatCents(currentBill, currency)}</s>{formatCents(newBill, currency)}</>) : formatCents(currentBill, currency)}
            </dd>
          </>) : changed && (<>
            <dt className="text-muted-foreground">{t('billing.label.changeToYourBill')}</dt>
            <dd className="text-end font-mono">{deltaLabel}</dd>
          </>)}
          {changed && (<>
            <dt className="text-muted-foreground">{t('billing.description.nextInvoiceHasdate', { hasDate: invoiceDate ? 'true' : 'false', invoiceDate: invoiceDate ?? '' })}</dt>
            <dd className="text-end font-mono" aria-live="polite">
              {previewFailed ? t('billing.error.couldNotPriceThisChange') : preview === null ? t('billing.description.workingOut') : formatCents(preview, currency)}
            </dd>
          </>)}
        </dl>
        {changed && (
          <p className="text-xs text-muted-foreground">{t('billing.description.includesTheProratedDifferenceForTheRestOfThisPeriodNothing')}</p>
        )}
        {qty < current && (
          <p className="text-xs text-muted-foreground">{t('billing.description.nobodyIsRemovedWhenSpotsGoDownIfMorePeopleRemain')}</p>
        )}
        {error && <p dir="auto" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={() => void confirm()} disabled={busy || !available || !changed}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? t('billing.status.updating') : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
