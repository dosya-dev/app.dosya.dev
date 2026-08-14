import { useState } from 'react';
import { cancelSubscription, type BillingStatus } from '@/api/billing';
import { apiErrorMessage } from '@/api/client';
import { formatBytes } from '@/lib/billing/cart-math';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

/** Storage every account keeps on the Free plan. Mirrors the `free` row in D1. */
const FREE_BYTES = 5 * 1024 * 1024 * 1024;

export function CancelSubscriptionDialog({ data, onClose, onCancelled }: {
  data: BillingStatus;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endsOn = data.subscription.current_period_end
    ? new Date(data.subscription.current_period_end * 1000)
        .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const overFreeLimit = data.usage.used_bytes > FREE_BYTES;

  const confirm = () => {
    setBusy(true);
    setError(null);
    cancelSubscription()
      .then(() => { onCancelled(); onClose(); })
      .catch((e) => { setError(apiErrorMessage(e)); setBusy(false); });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel subscription?</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p>
            Your {data.plan.name} plan and every add-on stay active
            {endsOn ? <> until <span className="font-medium">{endsOn}</span></> : ' until the end of the current period'}.
            After that you move to Free ({formatBytes(FREE_BYTES)}).
          </p>
          <p className="text-muted-foreground">
            You keep the old storage limit for 14 more days as a grace period once the
            subscription ends.
          </p>
          <p className="text-muted-foreground">
            You are using {formatBytes(data.usage.used_bytes)}.{' '}
            {overFreeLimit
              ? 'Your files are never deleted, but you will not be able to upload anything new while you are over the Free limit.'
              : 'That fits inside the Free limit, so nothing changes for your files.'}
          </p>
          <p className="text-muted-foreground">You can resume any time before the end date.</p>
          {error && <p className="text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Keep subscription</Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? 'Cancelling…' : 'Cancel subscription'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
