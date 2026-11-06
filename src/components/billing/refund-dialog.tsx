import { formatDateWith, formatNumberWith } from '@/lib/format-locale';
import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { requestRefund, type BillingStatus } from '@/api/billing';
import { ApiError, apiErrorMessage } from '@/api/client';
import { formatBytes } from '@/lib/billing/cart-math';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

/** Storage every account keeps on the Free plan. Mirrors the `free` row in D1. */
const FREE_BYTES = 5 * 1024 * 1024 * 1024;

function money(cents: number, currency: string | null): string {
  return formatNumberWith(cents / 100, { style: 'currency', currency: (currency ?? 'usd').toUpperCase() }, 'en-US');
}

function day(unix: number): string {
  return formatDateWith(unix, { month: 'long', day: 'numeric', year: 'numeric' }, 'en-US');
}

function errorCode(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  try {
    const c = (JSON.parse(e.body) as { code?: unknown }).code;
    return typeof c === 'string' ? c : null;
  } catch { return null; }
}

export function RefundDialog({ data, familyMembers, onClose, onRefunded, onStale }: {
  data: BillingStatus;
  familyMembers: number;
  onClose: () => void;
  onRefunded: () => void;
  /**
   * The billing state moved under the dialog (money went back but the plan did
   * not end, or the amount changed): the page must reload its status.
   */
  onStale?: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Money has moved (partial or cancel_failed): another click can only earn a
  // confusing 409, so the confirm button stays off for the dialog's life.
  const [moneyMoved, setMoneyMoved] = useState(false);

  const refund = data.refund;
  const total = money(refund?.amount ?? 0, refund?.currency ?? null);
  const overFreeLimit = data.usage.used_bytes > FREE_BYTES;

  const confirm = () => {
    setBusy(true);
    setError(null);
    requestRefund((refund?.charges ?? []).map((c) => c.id))
      .then(() => { onRefunded(); onClose(); })
      .catch((e) => {
        const code = errorCode(e);
        setError(apiErrorMessage(e));
        setBusy(false);
        if (code === 'partial' || code === 'cancel_failed') setMoneyMoved(true);
        if (code === 'partial' || code === 'cancel_failed' || code === 'amount_changed') onStale?.();
      });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('billing.heading.refundTotalAndEndYourPlan', { total })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {refund && refund.charges.length > 0 && (
            <ul className="divide-y rounded-md border">
              {refund.charges.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    <span className="text-muted-foreground">{day(c.created)}</span>{' '}
                    {c.description}
                  </span>
                  <span className="font-medium">{money(c.amount, refund.currency)}</span>
                </li>
              ))}
            </ul>
          )}
          <p>{t('billing.description.yourPlanEndsNowAndYourAccountGoesBackToFreeBytes', { FREE_BYTES: formatBytes(FREE_BYTES) })}</p>
          {overFreeLimit && (
            <p className="text-muted-foreground">
              {t('billing.description.youStoreUsageusedBytesUploadsPauseUntilYouAreUnderFreeBytes', { usageUsed_bytes: formatBytes(data.usage.used_bytes), FREE_BYTES: formatBytes(FREE_BYTES) })}
            </p>
          )}
          {familyMembers > 0 && (
            <p className="text-muted-foreground">
              {t('billing.description.familymembersFamilyFamilymembersPluralOneMemberGoesOtherMembersGoBack', { familyMembers })}
            </p>
          )}
          <p className="text-muted-foreground">
            {t('billing.description.theMoneyReturnsToYourOriginalPaymentMethodIn5To')}
          </p>
          <p className="text-muted-foreground">{t('billing.description.youCanUseASelfServeRefundOnce')}</p>
          {error && <p dir="auto" className="text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('billing.action.keepMyPlan')}</Button>
          <Button variant="destructive" onClick={confirm} disabled={busy || moneyMoved}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('billing.action.refundTotal', { total })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
