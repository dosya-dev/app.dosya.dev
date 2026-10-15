import { useState } from 'react';
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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency ?? 'usd').toUpperCase() })
    .format(cents / 100);
}

function day(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
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
          <DialogTitle>Refund {total} and end your plan?</DialogTitle>
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
          <p>Your plan ends now and your account goes back to {formatBytes(FREE_BYTES)}. Your files are not deleted. Items in Trash older than 7 days are removed, as on the free plan.</p>
          {overFreeLimit && (
            <p className="text-muted-foreground">
              You store {formatBytes(data.usage.used_bytes)}. Uploads pause until you are under {formatBytes(FREE_BYTES)}.
            </p>
          )}
          {familyMembers > 0 && (
            <p className="text-muted-foreground">
              {familyMembers} family {familyMembers === 1 ? 'member goes' : 'members go'} back to the free plan.
            </p>
          )}
          <p className="text-muted-foreground">
            The money returns to your original payment method in 5 to 10 business days.
          </p>
          <p className="text-muted-foreground">You can use a self-serve refund once.</p>
          {error && <p className="text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Keep my plan</Button>
          <Button variant="destructive" onClick={confirm} disabled={busy || moneyMoved}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Refund {total}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
